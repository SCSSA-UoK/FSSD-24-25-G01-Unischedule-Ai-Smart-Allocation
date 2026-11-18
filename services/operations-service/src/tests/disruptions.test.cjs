const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../app');
const { storage } = require('../services/storage');

test('operations service - Part 1 suite', async (t) => {
  const app = createApp();

  t.beforeEach(async () => {
    await storage.clear();
  });

  await t.test('GET /health returns 200 and healthy status', async () => {
    const res = await request(app).get('/health').expect(200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.service, 'operations-service');
    assert.ok(res.body.traceId);
  });

  await t.test('POST /operations/disruptions creates lecturer unavailability report', async () => {
    const payload = {
      type: 'lecturer_unavailable',
      scenarioId: 'scenario-demo-01',
      scenarioRevision: 2,
      affectedSessionIds: ['S001'],
      lecturerId: 'L001',
      startAt: '2026-11-02T09:00:00+05:30',
      endAt: '2026-11-02T11:00:00+05:30',
      timezone: 'Asia/Colombo',
      priority: 'high',
      description: 'Lecturer cannot attend the scheduled session.'
    };

    const res = await request(app)
      .post('/operations/disruptions')
      .send(payload)
      .expect(201);

    assert.ok(res.body.disruptionId.startsWith('disruption-'));
    assert.ok(res.body.caseId.startsWith('case-'));
    assert.equal(res.body.status, 'reported');
    assert.equal(res.body.scenarioId, 'scenario-demo-01');
    assert.equal(res.body.scenarioRevision, 2);
    assert.equal(res.body.constraintSyncStatus, 'pending');
  });

  await t.test('POST /operations/disruptions creates room maintenance report', async () => {
    const payload = {
      type: 'room_maintenance',
      scenarioId: 'scenario-demo-01',
      scenarioRevision: 2,
      affectedSessionIds: ['S002'],
      roomId: 'LAB_A',
      startAt: '2026-11-02T11:00:00+05:30',
      endAt: '2026-11-02T13:00:00+05:30',
      description: 'Lab A power maintenance required.'
    };

    const res = await request(app)
      .post('/operations/disruptions')
      .send(payload)
      .expect(201);

    assert.equal(res.body.status, 'reported');
  });

  await t.test('POST /operations/disruptions rejects missing lecturerId for lecturer_unavailable', async () => {
    const payload = {
      type: 'lecturer_unavailable',
      scenarioId: 'scenario-demo-01',
      scenarioRevision: 2,
      affectedSessionIds: ['S001'],
      startAt: '2026-11-02T09:00:00+05:30',
      endAt: '2026-11-02T11:00:00+05:30',
      description: 'Missing lecturer ID.'
    };

    const res = await request(app)
      .post('/operations/disruptions')
      .send(payload)
      .expect(400);

    assert.equal(res.body.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(res.body.details));
  });

  await t.test('POST /operations/disruptions rejects invalid date order', async () => {
    const payload = {
      type: 'emergency_incident',
      scenarioId: 'scenario-demo-01',
      scenarioRevision: 1,
      affectedSessionIds: ['S001'],
      startAt: '2026-11-02T12:00:00+05:30',
      endAt: '2026-11-02T10:00:00+05:30',
      description: 'Emergency incident with invalid interval.'
    };

    const res = await request(app)
      .post('/operations/disruptions')
      .send(payload)
      .expect(400);

    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });

  await t.test('POST /operations/disruptions supports idempotency replay', async () => {
    const payload = {
      type: 'lecturer_unavailable',
      scenarioId: 'scenario-demo-01',
      scenarioRevision: 2,
      affectedSessionIds: ['S001'],
      lecturerId: 'L001',
      startAt: '2026-11-02T09:00:00+05:30',
      endAt: '2026-11-02T11:00:00+05:30',
      description: 'Test idempotency replay.'
    };

    const res1 = await request(app)
      .post('/operations/disruptions')
      .set('idempotency-key', 'idem-test-1')
      .send(payload)
      .expect(201);

    const res2 = await request(app)
      .post('/operations/disruptions')
      .set('idempotency-key', 'idem-test-1')
      .send(payload)
      .expect(201);

    assert.equal(res1.body.disruptionId, res2.body.disruptionId);
    assert.equal(res1.body.caseId, res2.body.caseId);
  });

  await t.test('POST /operations/disruptions detects idempotency key conflict', async () => {
    const payload1 = {
      type: 'lecturer_unavailable',
      scenarioId: 'scenario-demo-01',
      scenarioRevision: 2,
      affectedSessionIds: ['S001'],
      lecturerId: 'L001',
      startAt: '2026-11-02T09:00:00+05:30',
      endAt: '2026-11-02T11:00:00+05:30',
      description: 'First payload.'
    };

    const payload2 = {
      ...payload1,
      description: 'Different payload with same key.'
    };

    await request(app)
      .post('/operations/disruptions')
      .set('idempotency-key', 'conflict-key-1')
      .send(payload1)
      .expect(201);

    const res2 = await request(app)
      .post('/operations/disruptions')
      .set('idempotency-key', 'conflict-key-1')
      .send(payload2)
      .expect(409);

    assert.equal(res2.body.code, 'IDEMPOTENCY_CONFLICT');
  });

  await t.test('GET /operations/disruptions/:id returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/operations/disruptions/disruption-unknown')
      .expect(404);

    assert.equal(res.body.code, 'NOT_FOUND');
  });

  await t.test('GET /operations/disruptions lists and filters disruptions', async () => {
    await request(app)
      .post('/operations/disruptions')
      .send({
        type: 'lecturer_unavailable',
        scenarioId: 'scenario-demo-01',
        scenarioRevision: 2,
        affectedSessionIds: ['S001'],
        lecturerId: 'L001',
        startAt: '2026-11-02T09:00:00+05:30',
        endAt: '2026-11-02T11:00:00+05:30',
        priority: 'high',
        description: 'First disruption item.'
      })
      .expect(201);

    await request(app)
      .post('/operations/disruptions')
      .send({
        type: 'room_maintenance',
        scenarioId: 'scenario-demo-01',
        scenarioRevision: 2,
        affectedSessionIds: ['S002'],
        roomId: 'ROOM_C',
        startAt: '2026-11-02T14:00:00+05:30',
        endAt: '2026-11-02T16:00:00+05:30',
        priority: 'low',
        description: 'Second disruption item.'
      })
      .expect(201);

    const listAll = await request(app).get('/operations/disruptions').expect(200);
    assert.equal(listAll.body.count, 2);

    const filterType = await request(app)
      .get('/operations/disruptions?type=room_maintenance')
      .expect(200);
    assert.equal(filterType.body.count, 1);
    assert.equal(filterType.body.items[0].type, 'room_maintenance');
  });

  await t.test('Trace ID header propagation', async () => {
    const customTrace = 'custom-trace-test-123';
    const res = await request(app)
      .get('/health')
      .set('x-trace-id', customTrace)
      .expect(200);

    assert.equal(res.headers['x-trace-id'], customTrace);
    assert.equal(res.body.traceId, customTrace);
  });
});
