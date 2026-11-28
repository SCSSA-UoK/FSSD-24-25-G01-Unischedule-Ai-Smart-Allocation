const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../app');
const { storage } = require('../services/storage');
const { agentClient } = require('../clients/agent-client');

async function seedCase(app, overrides = {}) {
  const payload = {
    type: 'lecturer_unavailable',
    scenarioId: 'scenario-demo-01',
    scenarioRevision: 2,
    affectedSessionIds: ['S001'],
    lecturerId: 'L001',
    startAt: '2026-11-02T09:00:00+05:30',
    endAt: '2026-11-02T11:00:00+05:30',
    priority: 'high',
    description: 'Lecturer unavailable for scheduled Monday lecture.',
    ...overrides
  };

  const res = await request(app)
    .post('/operations/disruptions')
    .send(payload)
    .expect(201);

  return res.body;
}

test('operations service - Part 3 AI investigations & recommendations suite', async (t) => {
  const app = createApp();

  t.beforeEach(async () => {
    await storage.clear();
    agentClient.clearMockRuns();
  });

  await t.test('POST /investigations dispatches run and GET /recommendations returns plans', async () => {
    const created = await seedCase(app);

    const startRes = await request(app)
      .post(`/operations/cases/${created.caseId}/investigations`)
      .set('x-user-id', 'operator-01')
      .send({ scenarioRevision: 2 })
      .expect(202);

    assert.equal(startRes.body.caseId, created.caseId);
    assert.equal(startRes.body.status, 'investigating');
    assert.ok(startRes.body.runId.startsWith('agent-'));
    assert.equal(startRes.body.isMock, true);

    const recRes = await request(app)
      .get(`/operations/cases/${created.caseId}/recommendations`)
      .expect(200);

    assert.equal(recRes.body.status, 'awaiting_approval');
    assert.equal(recRes.body.runId, startRes.body.runId);
    assert.equal(recRes.body.isMock, true);
    assert.equal(recRes.body.plans.length, 1);

    const plan = recRes.body.plans[0];
    assert.ok(plan.recoveryPlanId.startsWith('plan-'));
    assert.ok(plan.candidateId.startsWith('candidate-'));
    assert.equal(plan.validationStatus, 'valid');
    assert.equal(plan.isMockValidation, true);
    assert.ok(plan.planHash);
    assert.equal(plan.moves.length, 1);
    assert.equal(plan.beforeAfterPreview[0].after.roomId, 'ROOM_C');

    const logs = await storage.getAuditLogsByCaseId(created.caseId);
    const eventTypes = logs.map((l) => l.eventType);
    assert.ok(eventTypes.includes('INVESTIGATION_STARTED'));
    assert.ok(eventTypes.includes('RECOMMENDATIONS_READY'));
  });

  await t.test('POST /investigations rejects stale scenarioRevision with 409', async () => {
    const created = await seedCase(app, { scenarioRevision: 3 });

    const res = await request(app)
      .post(`/operations/cases/${created.caseId}/investigations`)
      .send({ scenarioRevision: 2 })
      .expect(409);

    assert.equal(res.body.code, 'STALE_SCENARIO');
  });

  await t.test('POST /investigations rejects invalid payload and unknown case', async () => {
    const created = await seedCase(app);

    const badPayload = await request(app)
      .post(`/operations/cases/${created.caseId}/investigations`)
      .send({ scenarioRevision: -1 })
      .expect(400);
    assert.equal(badPayload.body.code, 'VALIDATION_ERROR');

    const missing = await request(app)
      .post('/operations/cases/case-missing/investigations')
      .send({})
      .expect(404);
    assert.equal(missing.body.code, 'NOT_FOUND');
  });

  await t.test('handles no_solution outcome and allows re-investigation preserving old runIds', async () => {
    const created = await seedCase(app, { lecturerId: 'SIMULATE_NO_SOLUTION' });

    const run1 = await request(app)
      .post(`/operations/cases/${created.caseId}/investigations`)
      .send({})
      .expect(202);

    const rec1 = await request(app)
      .get(`/operations/cases/${created.caseId}/recommendations`)
      .expect(200);

    assert.equal(rec1.body.status, 'no_solution');
    assert.equal(rec1.body.plans.length, 0);

    // Re-investigate from no_solution must succeed and retain previous runId.
    const run2 = await request(app)
      .post(`/operations/cases/${created.caseId}/investigations`)
      .send({})
      .expect(202);

    assert.notEqual(run2.body.runId, run1.body.runId);
    const updatedCase = await storage.getRecoveryRequestById(created.caseId);
    assert.deepEqual(updatedCase.runIds, [run1.body.runId, run2.body.runId]);
  });

  await t.test('handles investigation_failed during polling and allows retry', async () => {
    const created = await seedCase(app, { lecturerId: 'SIMULATE_AGENT_FAIL' });

    await request(app)
      .post(`/operations/cases/${created.caseId}/investigations`)
      .send({})
      .expect(202);

    const rec = await request(app)
      .get(`/operations/cases/${created.caseId}/recommendations`)
      .expect(200);

    assert.equal(rec.body.status, 'investigation_failed');
    assert.ok(rec.body.investigationError);
    assert.equal(rec.body.plans.length, 0);

    const retry = await request(app)
      .post(`/operations/cases/${created.caseId}/investigations`)
      .send({})
      .expect(202);

    assert.equal(retry.body.status, 'investigating');
  });

  await t.test('handles agent dispatch failure with 503 and marks investigation_failed', async () => {
    const created = await seedCase(app, { lecturerId: 'SIMULATE_DISPATCH_FAIL' });

    const res = await request(app)
      .post(`/operations/cases/${created.caseId}/investigations`)
      .send({})
      .expect(503);

    assert.equal(res.body.code, 'AGENT_UNAVAILABLE');

    const failedCase = await storage.getRecoveryRequestById(created.caseId);
    assert.equal(failedCase.status, 'investigation_failed');
    assert.ok(failedCase.investigationError);
  });

  await t.test('blocks starting a new investigation while awaiting_approval', async () => {
    const created = await seedCase(app);

    await request(app)
      .post(`/operations/cases/${created.caseId}/investigations`)
      .send({})
      .expect(202);

    await request(app)
      .get(`/operations/cases/${created.caseId}/recommendations`)
      .expect(200);

    const duplicate = await request(app)
      .post(`/operations/cases/${created.caseId}/investigations`)
      .send({})
      .expect(409);

    assert.equal(duplicate.body.code, 'INVALID_STATE_TRANSITION');
  });
});
