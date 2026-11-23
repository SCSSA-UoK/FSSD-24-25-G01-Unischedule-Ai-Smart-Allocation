const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../app');
const { storage } = require('../services/storage');
const { canTransition, transitionCaseStatus } = require('../services/case-lifecycle');

async function seedDisruption(app, overrides = {}) {
  const payload = {
    type: 'lecturer_unavailable',
    scenarioId: 'scenario-demo-01',
    scenarioRevision: 2,
    affectedSessionIds: ['S001'],
    lecturerId: 'L001',
    startAt: '2026-11-02T09:00:00+05:30',
    endAt: '2026-11-02T11:00:00+05:30',
    priority: 'normal',
    description: 'Lecturer unavailable for scheduled lecture.',
    ...overrides
  };

  const res = await request(app)
    .post('/operations/disruptions')
    .send(payload)
    .expect(201);

  return res.body;
}

test('operations service - Part 2 recovery cases suite', async (t) => {
  const app = createApp();

  t.beforeEach(async () => {
    await storage.clear();
  });

  await t.test('GET /operations/recovery-cases orders by priority and supports pagination', async () => {
    await seedDisruption(app, { priority: 'low', description: 'Low priority disruption.' });
    await seedDisruption(app, { priority: 'critical', description: 'Critical disruption.' });
    await seedDisruption(app, { priority: 'high', description: 'High priority disruption.' });

    const page1 = await request(app)
      .get('/operations/recovery-cases?limit=2&cursor=0')
      .expect(200);

    assert.equal(page1.body.count, 2);
    assert.equal(page1.body.total, 3);
    assert.equal(page1.body.nextCursor, '2');
    assert.equal(page1.body.items[0].priority, 'critical');
    assert.equal(page1.body.items[1].priority, 'high');

    const page2 = await request(app)
      .get('/operations/recovery-cases?limit=2&cursor=2')
      .expect(200);

    assert.equal(page2.body.count, 1);
    assert.equal(page2.body.nextCursor, null);
    assert.equal(page2.body.items[0].priority, 'low');
  });

  await t.test('GET /operations/recovery-cases filters by priority and rejects invalid query', async () => {
    await seedDisruption(app, { priority: 'high', description: 'High case.' });
    await seedDisruption(app, { priority: 'low', description: 'Low case.' });

    const filtered = await request(app)
      .get('/operations/recovery-cases?priority=high&status=reported')
      .expect(200);

    assert.equal(filtered.body.count, 1);
    assert.equal(filtered.body.items[0].priority, 'high');

    const invalid = await request(app)
      .get('/operations/recovery-cases?limit=500')
      .expect(400);

    assert.equal(invalid.body.code, 'VALIDATION_ERROR');
  });

  await t.test('GET /operations/cases/:caseId returns case with linked disruption', async () => {
    const created = await seedDisruption(app, { priority: 'high' });

    const res = await request(app)
      .get(`/operations/cases/${created.caseId}`)
      .expect(200);

    assert.equal(res.body.caseId, created.caseId);
    assert.equal(res.body.disruptionId, created.disruptionId);
    assert.equal(res.body.status, 'reported');
    assert.equal(res.body.disruption.lecturerId, 'L001');
    assert.equal(res.body.auditCount, 1);

    const missing = await request(app)
      .get('/operations/cases/case-missing')
      .expect(404);
    assert.equal(missing.body.code, 'NOT_FOUND');
  });

  await t.test('PATCH /operations/cases/:caseId/priority updates priority with optimistic locking', async () => {
    const created = await seedDisruption(app, { priority: 'normal' });

    const updated = await request(app)
      .patch(`/operations/cases/${created.caseId}/priority`)
      .set('x-user-id', 'admin-01')
      .send({
        priority: 'critical',
        reason: 'Exam week lecture cannot be missed.',
        version: 1
      })
      .expect(200);

    assert.equal(updated.body.priority, 'critical');
    assert.equal(updated.body.priorityReason, 'Exam week lecture cannot be missed.');
    assert.equal(updated.body.version, 2);

    // Stale version must fail with 409.
    const conflict = await request(app)
      .patch(`/operations/cases/${created.caseId}/priority`)
      .send({
        priority: 'low',
        reason: 'Stale concurrent update attempt.',
        version: 1
      })
      .expect(409);

    assert.equal(conflict.body.code, 'VERSION_CONFLICT');

    const logs = await storage.getAuditLogsByCaseId(created.caseId);
    assert.equal(logs.length, 2);
    assert.equal(logs[1].eventType, 'PRIORITY_UPDATED');
    assert.equal(logs[1].actorId, 'admin-01');
  });

  await t.test('PATCH /operations/cases/:caseId/priority validates payload', async () => {
    const created = await seedDisruption(app);

    const res = await request(app)
      .patch(`/operations/cases/${created.caseId}/priority`)
      .send({ priority: 'urgent', reason: 'no' })
      .expect(400);

    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });

  await t.test('POST /operations/cases/:caseId/sync-constraints syncs via mock platform adapter', async () => {
    const created = await seedDisruption(app, { scenarioRevision: 2 });

    const res = await request(app)
      .post(`/operations/cases/${created.caseId}/sync-constraints`)
      .set('x-user-id', 'operator-01')
      .expect(200);

    assert.equal(res.body.constraintSyncStatus, 'synced');
    assert.equal(res.body.isMock, true);
    assert.equal(res.body.constraintSyncMode, 'mock');
    assert.equal(res.body.scenarioRevision, 3);
    assert.ok(res.body.constraintId.startsWith('mock-constraint-'));

    const logs = await storage.getAuditLogsByCaseId(created.caseId);
    assert.equal(logs[logs.length - 1].eventType, 'CONSTRAINT_SYNCED');
  });

  await t.test('POST /operations/cases/:caseId/sync-constraints records failed sync status', async () => {
    const created = await seedDisruption(app, { lecturerId: 'SIMULATE_SYNC_FAIL' });

    const res = await request(app)
      .post(`/operations/cases/${created.caseId}/sync-constraints`)
      .expect(503);

    assert.equal(res.body.code, 'CONSTRAINT_SYNC_FAILED');

    const updatedCase = await storage.getRecoveryRequestById(created.caseId);
    assert.equal(updatedCase.constraintSyncStatus, 'failed');
  });

  await t.test('case-lifecycle enforces allowed state transitions and version locks', async () => {
    assert.equal(canTransition('reported', 'investigating'), true);
    assert.equal(canTransition('reported', 'applied'), false);
    assert.equal(canTransition('no_solution', 'investigating'), true);

    const created = await seedDisruption(app);

    // Invalid jump must throw 409.
    await assert.rejects(
      () => transitionCaseStatus(created.caseId, { toStatus: 'applied', expectedVersion: 1 }),
      (err) => err.status === 409 && err.code === 'INVALID_STATE_TRANSITION'
    );

    // Valid transition increments version and records audit.
    const investigating = await transitionCaseStatus(created.caseId, {
      toStatus: 'investigating',
      expectedVersion: 1,
      actorId: 'operator-01'
    });
    assert.equal(investigating.status, 'investigating');
    assert.equal(investigating.version, 2);

    // Stale version fails with 409.
    await assert.rejects(
      () => transitionCaseStatus(created.caseId, { toStatus: 'awaiting_approval', expectedVersion: 1 }),
      (err) => err.status === 409 && err.code === 'VERSION_CONFLICT'
    );
  });
});
