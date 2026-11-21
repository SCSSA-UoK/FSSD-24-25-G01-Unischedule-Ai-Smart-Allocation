const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createApp } = require('../app');
const { createFixtureClients, loadFixture } = require('../clients/fixture-clients');
const { AllocationInputError } = require('../validation/allocation-input');
const { errorHandler } = require('../middleware/error-handler');
const { traceId } = require('../middleware/trace-id');

function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.code, code);
  assert.equal(typeof response.body.message, 'string');
  assert.ok(response.body.message.trim());
  assert.ok(response.headers['x-request-id']);
  assert.equal(response.body.traceId, response.headers['x-request-id']);
  assert.equal(response.body.stack, undefined);
}

test('the direct endpoint returns a pending one-move proposal with no existing session displaced', async () => {
  const fixture = loadFixture('direct-room');
  const target = fixture.sessions.find((session) => session.sessionId === fixture.request.affectedSessionId);
  const response = await request(createApp()).post('/allocation/candidates')
    .send({ ...fixture.request, allowedMoveCount: 0 }).expect('Content-Type', /json/).expect(200);
  const result = response.body;
  assert.equal(result.mode, 'fixture');
  assert.equal(result.scope, 'direct-only');
  assert.equal(result.validationStatus, 'pending');
  assert.equal(result.scenarioId, fixture.scenarioId);
  assert.equal(result.scenarioRevision, fixture.scenarioRevision);
  assert.equal(result.facilitiesVersion, fixture.facilitiesVersion);
  assert.equal(result.truncated, false);
  assert.equal(typeof result.runId, 'string');
  assert.ok(result.runId);
  assert.equal(result.roomChecks.length, fixture.rooms.length);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.validationStatus, 'pending');
  assert.equal(candidate.displacedExistingSessions, 0);
  assert.equal(typeof candidate.candidateId, 'string');
  assert.ok(candidate.candidateId.length > 0 && candidate.candidateId.length <= 100);
  assert.deepEqual(candidate.moves, [{
    sessionId: target.sessionId, fromRoomId: target.roomId, toRoomId: 'HALL_A',
    startAt: target.startAt, endAt: target.endAt,
  }]);
  assert.ok(candidate.reasons.length > 0);
  assert.ok(candidate.reasons.every((reason) => typeof reason === 'string'));
  assert.equal(candidate.cost, undefined);
  assert.equal(candidate.costBreakdown, undefined);
  assert.equal(result.expected, undefined);
});

test('default fixture resolution proposes the backup lab rather than the damaged laboratory', async () => {
  const fixture = loadFixture('equipment-failure');
  const response = await request(createApp()).post('/allocation/candidates').send(fixture.request).expect(200);
  assert.deepEqual(response.body.candidates.map((candidate) => candidate.moves[0].toRoomId), ['LAB_BACKUP']);
  const backup = response.body.roomChecks.find((room) => room.roomId === 'LAB_BACKUP');
  assert.ok(backup);
  assert.equal(backup.eligible, true);
  assert.ok(!response.body.roomChecks.some((room) => room.roomId === 'LAB_A'));
  assert.equal(response.body.validationStatus, 'pending');
});

test('relocation and closed-room fixtures return complete empty direct searches with explanations', async () => {
  for (const name of ['single-relocation', 'no-solution']) {
    const response = await request(createApp()).post('/allocation/candidates')
      .send(loadFixture(name).request).expect(200);
    assert.equal(response.body.mode, 'fixture');
    assert.equal(response.body.scope, 'direct-only');
    assert.equal(response.body.validationStatus, 'pending');
    assert.equal(response.body.truncated, false);
    assert.deepEqual(response.body.candidates, []);
    assert.ok(response.body.reasons.includes('No eligible empty destination was found for a direct room change.'));
    assert.equal(response.body.expected, undefined);
  }
});

test('strict request validation rejects unknown keys, malformed IDs and invalid limits before reading clients', async () => {
  let reads = 0;
  const clients = {
    platformClient: { async getScenarioSnapshot() { reads += 1; } },
    facilitiesClient: { async getRoomSnapshot() { reads += 1; } },
  };
  const app = createApp({ clients });
  const valid = loadFixture('direct-room').request;
  for (const changes of [
    { fixtureName: '../../.env' },
    { scenarioId: '../scenario' },
    { affectedSessionId: 'bad session' },
    { allowedMoveCount: -1 },
    { limits: { maxCandidates: 0, timeoutMs: 2000 } },
    { limits: { maxCandidates: 10, timeoutMs: -1 } },
  ]) {
    const response = await request(app).post('/allocation/candidates').send({ ...valid, ...changes });
    assertError(response, 422, 'INVALID_INPUT');
    assert.ok(Array.isArray(response.body.details));
    assert.ok(response.body.details.length > 0);
  }
  assert.equal(reads, 0);
});

test('candidate requests require JSON content type rather than interpreting text or an absent type', async () => {
  const app = createApp();
  const text = await request(app).post('/allocation/candidates')
    .set('Content-Type', 'text/plain').send(JSON.stringify(loadFixture('direct-room').request));
  assertError(text, 415, 'UNSUPPORTED_MEDIA_TYPE');
  const missing = await request(app).post('/allocation/candidates');
  assertError(missing, 415, 'UNSUPPORTED_MEDIA_TYPE');
});

test('unknown scenarios and unknown affected sessions produce explicit 404 errors', async () => {
  const fixture = loadFixture('direct-room');
  const unknownScenario = await request(createApp()).post('/allocation/candidates')
    .send({ ...fixture.request, scenarioId: 'scenario-not-in-fixtures' });
  assertError(unknownScenario, 404, 'SCENARIO_NOT_FOUND');
  const unknownSession = await request(createApp()).post('/allocation/candidates')
    .send({ ...fixture.request, affectedSessionId: 'S_MISSING' });
  assertError(unknownSession, 404, 'SESSION_NOT_FOUND');
});

test('a stale scenario revision returns 409 instead of proposals based on different data', async () => {
  const fixture = loadFixture('direct-room');
  const response = await request(createApp()).post('/allocation/candidates')
    .send({ ...fixture.request, scenarioRevision: fixture.scenarioRevision - 1 });
  assertError(response, 409, 'STALE_SCENARIO');
  assert.equal(response.body.candidates, undefined);
});

test('dependency exceptions return a sanitized 503 without fixture fallback', async () => {
  const fixture = loadFixture('direct-room');
  const clients = createFixtureClients({ fixture });
  clients.facilitiesClient.getRoomSnapshot = async () => {
    throw new Error('PRIVATE_DATABASE_CONNECTION_DETAILS');
  };
  const response = await request(createApp({ clients })).post('/allocation/candidates').send(fixture.request);
  assertError(response, 503, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(response.body.candidates, undefined);
  assert.ok(!JSON.stringify(response.body).includes('PRIVATE_DATABASE_CONNECTION_DETAILS'));
});

test('a dependency that never resolves returns a bounded 504 error', { timeout: 3000 }, async () => {
  const fixture = loadFixture('direct-room');
  const clients = createFixtureClients({ fixture });
  clients.platformClient.getScenarioSnapshot = () => new Promise(() => {});
  const response = await request(createApp({ clients, searchOptions: { dependencyTimeoutMs: 10 } }))
    .post('/allocation/candidates').send(fixture.request).timeout({ deadline: 2000 });
  assertError(response, 504, 'DEPENDENCY_TIMEOUT');
  assert.equal(response.body.candidates, undefined);
});

test('typed input errors preserve their status, code and safe details through the HTTP boundary', async () => {
  const fixture = loadFixture('direct-room');
  for (const [status, code] of [[422, 'INVALID_INPUT'], [404, 'SCENARIO_NOT_FOUND'], [409, 'STALE_SCENARIO']]) {
    const clients = createFixtureClients({ fixture });
    const details = [{ field: 'scenarioId', message: 'Fixture input requires attention.' }];
    clients.platformClient.getScenarioSnapshot = async () => {
      throw new AllocationInputError(status, code, 'Fixture input requires attention.', details);
    };
    const response = await request(createApp({ clients })).post('/allocation/candidates').send(fixture.request);
    assertError(response, status, code);
    assert.deepEqual(response.body.details, details);
  }
});

test('incorrect snapshot modes and invalid data are rejected instead of appearing platform-valid', async () => {
  const fixture = loadFixture('direct-room');
  for (const alter of [
    (snapshot) => { snapshot.mode = 'live'; },
    (snapshot) => { snapshot.sessions[0].registeredStudents = -1; },
    (snapshot) => { snapshot.sessions.push(structuredClone(snapshot.sessions[0])); },
  ]) {
    const clients = createFixtureClients({ fixture });
    const snapshot = await clients.platformClient.getScenarioSnapshot(fixture.scenarioId);
    alter(snapshot);
    clients.platformClient.getScenarioSnapshot = async () => structuredClone(snapshot);
    const response = await request(createApp({ clients })).post('/allocation/candidates').send(fixture.request);
    assertError(response, 422, 'INVALID_INPUT');
    assert.equal(response.body.validationStatus, undefined);
  }
});

test('ordinary errors cannot spoof a typed HTTP response by attaching status, code or private details', async () => {
  const app = express();
  app.use(traceId);
  app.get('/spoofed-error', (req, res, next) => {
    const error = Object.assign(new Error('PRIVATE_INTERNAL_MESSAGE'), {
      status: 422, code: 'PRIVATE_ERROR_CODE', details: { internal: 'PRIVATE_DETAILS' },
    });
    next(error);
  });
  app.use(errorHandler);
  const response = await request(app).get('/spoofed-error');
  assertError(response, 500, 'INTERNAL_ERROR');
  assert.equal(response.body.message, 'An unexpected error occurred.');
  assert.equal(response.body.details, undefined);
  assert.ok(!JSON.stringify(response.body).includes('PRIVATE_'));
});

test('repeated searches retain candidate identity and preserve fixture input while run IDs differ', async () => {
  const fixture = loadFixture('direct-room');
  const before = structuredClone(fixture);
  const rawRequest = structuredClone(fixture.request);
  const originalRequest = structuredClone(rawRequest);
  const app = createApp({ clients: createFixtureClients({ fixture }) });
  const first = await request(app).post('/allocation/candidates').send(rawRequest).expect(200);
  const second = await request(app).post('/allocation/candidates').send(rawRequest).expect(200);
  assert.notEqual(first.body.runId, second.body.runId);
  assert.deepEqual(first.body.candidates, second.body.candidates);
  assert.deepEqual(first.body.roomChecks, second.body.roomChecks);
  assert.deepEqual(fixture, before);
  assert.deepEqual(rawRequest, originalRequest);
  assert.equal(first.body.candidates[0].expected, undefined);
});

test('a target already occupying the only feasible room does not receive a no-op proposal', async () => {
  const fixture = loadFixture('direct-room');
  fixture.sessions.find((session) => session.sessionId === fixture.request.affectedSessionId).roomId = 'HALL_A';
  const response = await request(createApp({ clients: createFixtureClients({ fixture }) }))
    .post('/allocation/candidates').send(fixture.request).expect(200);
  assert.deepEqual(response.body.candidates, []);
  assert.equal(response.body.truncated, false);
});

test('health remains available while unknown routes and the unimplemented score route remain 404', async () => {
  const app = createApp();
  const health = await request(app).get('/health').expect(200);
  assert.deepEqual(health.body, { status: 'ok', service: 'allocation-service' });
  const unknown = await request(app).get('/allocation/unknown');
  assertError(unknown, 404, 'NOT_FOUND');
  const score = await request(app).post('/allocation/score').send({});
  assertError(score, 404, 'NOT_FOUND');
});
