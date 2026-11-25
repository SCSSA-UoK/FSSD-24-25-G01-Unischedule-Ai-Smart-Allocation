const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../app');
const { FIXTURE_NAMES, createFixtureClients, loadFixture } = require('../clients/fixture-clients');

function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.code, code);
  assert.equal(typeof response.body.message, 'string');
  assert.ok(response.headers['x-request-id']);
  assert.equal(response.body.traceId, response.headers['x-request-id']);
  assert.equal(response.body.stack, undefined);
  assert.equal(response.body.candidates, undefined);
}

function assertTwoMoves(candidate, fixture, kind) {
  assert.match(candidate.candidateId, /^candidate-[a-f0-9]{24}$/);
  assert.equal(candidate.kind, kind);
  assert.equal(candidate.validationStatus, 'pending');
  assert.equal(candidate.displacedExistingSessions, 1);
  assert.equal(candidate.moves.length, 2);
  assert.deepEqual(candidate.moves.map((move) => move.sessionId), ['S001', 'S007']);
  assert.deepEqual(candidate.moves.map((move) => move.toRoomId), ['ROOM_C', 'HALL_A']);
  assert.equal(new Set(candidate.moves.map((move) => move.sessionId)).size, 2);
  for (const move of candidate.moves) {
    const source = fixture.sessions.find((session) => session.sessionId === move.sessionId);
    assert.equal(move.fromRoomId, source.roomId);
    assert.notEqual(move.fromRoomId, move.toRoomId);
    assert.equal(move.startAt, source.startAt);
    assert.equal(move.endAt, source.endAt);
  }
  assert.ok(candidate.reasons.length > 0);
  assert.ok(candidate.reasons.every((reason) => typeof reason === 'string'));
  assert.equal(candidate.cost, undefined);
  assert.equal(candidate.costBreakdown, undefined);
}

function postFixture(fixture, changes = {}) {
  return request(createApp({ clients: createFixtureClients({ fixture }) }))
    .post('/allocation/room-swaps').send({ ...fixture.request, ...changes });
}

function roomClosure(roomId, startAt, endAt) {
  return {
    restrictionId: 'restriction-closure', roomId, kind: 'closure', startAt, endAt,
    unavailableFacilities: [], usableComputers: null, reason: 'Fictional maintenance closure.',
  };
}

test('the swap endpoint returns the complete single relocation as a pending fixture recommendation', async () => {
  const fixture = loadFixture('single-relocation');
  const response = await request(createApp()).post('/allocation/room-swaps')
    .send(fixture.request).expect('Content-Type', /json/).expect(200);
  const result = response.body;
  assert.equal(result.mode, 'fixture');
  assert.equal(result.scope, 'single-displacement');
  assert.equal(result.validationStatus, 'pending');
  assert.equal(result.scenarioId, fixture.scenarioId);
  assert.equal(result.scenarioRevision, fixture.scenarioRevision);
  assert.equal(result.facilitiesVersion, fixture.facilitiesVersion);
  assert.equal(result.truncated, false);
  assert.equal(typeof result.runId, 'string');
  assert.ok(result.runId);
  assert.ok(Array.isArray(result.roomChecks));
  assert.ok(result.reasons.every((reason) => typeof reason === 'string'));
  assert.equal(result.candidates.length, 1);
  assertTwoMoves(result.candidates[0], fixture, 'relocation');
  assert.deepEqual(result.candidates[0].moves, fixture.expected.proposal.moves);
  assert.equal(result.expected, undefined);
});

test('the literal swap fixture exchanges the occupied rooms after removing both original assignments', async () => {
  const fixture = loadFixture('single-swap');
  const response = await request(createApp()).post('/allocation/room-swaps').send(fixture.request).expect(200);
  assert.equal(response.body.scope, 'single-displacement');
  assert.equal(response.body.truncated, false);
  assert.equal(response.body.candidates.length, 1);
  assertTwoMoves(response.body.candidates[0], fixture, 'swap');
  assert.deepEqual(response.body.candidates[0].moves, fixture.expected.proposal.moves);
  assert.equal(response.body.candidates[0].moves[1].fromRoomId, 'ROOM_C');
});

test('a zero displacement allowance returns an explained complete empty result', async () => {
  const response = await request(createApp()).post('/allocation/room-swaps')
    .send({ ...loadFixture('single-relocation').request, allowedMoveCount: 0 }).expect(200);
  assert.deepEqual(response.body.candidates, []);
  assert.equal(response.body.truncated, false);
  assert.equal(response.body.validationStatus, 'pending');
  assert.ok(response.body.reasons.some((reason) => /allow|displac/i.test(reason)));
});

test('fixtures requiring direct search or a closed destination do not produce invented rearrangements', async () => {
  for (const name of ['direct-room', 'equipment-failure', 'no-solution']) {
    const response = await request(createApp()).post('/allocation/room-swaps')
      .send(loadFixture(name).request).expect(200);
    assert.equal(response.body.mode, 'fixture');
    assert.equal(response.body.scope, 'single-displacement');
    assert.equal(response.body.validationStatus, 'pending');
    assert.equal(response.body.truncated, false);
    assert.deepEqual(response.body.candidates, []);
    assert.ok(response.body.reasons.length > 0);
  }
});

test('both moved sessions must meet their destination requirements and overlapping restrictions', async () => {
  const changes = [
    (fixture) => { fixture.sessions.find((session) => session.sessionId === 'S007').requiredFacilities.push('whiteboard'); },
    (fixture) => { fixture.sessions.find((session) => session.sessionId === 'S001').registeredStudents = 51; },
    (fixture) => {
      const target = fixture.sessions.find((session) => session.sessionId === 'S007');
      fixture.restrictions = [roomClosure('ROOM_C', target.startAt, target.endAt)];
    },
    (fixture) => {
      const target = fixture.sessions.find((session) => session.sessionId === 'S007');
      fixture.restrictions = [{
        ...roomClosure('ROOM_C', target.startAt, target.endAt), kind: 'equipment-outage',
        unavailableFacilities: ['projector'], reason: 'Fictional projector failure.',
      }];
    },
    (fixture) => {
      const target = fixture.sessions.find((session) => session.sessionId === 'S007');
      fixture.restrictions = [roomClosure('HALL_A', target.startAt, target.endAt)];
    },
  ];
  for (const change of changes) {
    const fixture = loadFixture('single-relocation');
    change(fixture);
    const response = await postFixture(fixture).expect(200);
    assert.deepEqual(response.body.candidates, []);
    assert.equal(response.body.truncated, false);
  }
});

test('two sequential occupants across the target interval cannot be displaced even with a larger move budget', async () => {
  const fixture = loadFixture('single-relocation');
  const first = fixture.sessions.find((session) => session.sessionId === 'S001');
  first.endAt = '2026-11-16T10:00:00+05:30';
  fixture.sessions.push({
    ...structuredClone(first), sessionId: 'S003', lecturerId: 'L003', studentGroupId: 'G3',
    startAt: first.endAt, endAt: '2026-11-16T11:00:00+05:30',
  });
  const response = await postFixture(fixture, { allowedMoveCount: 3 }).expect(200);
  assert.equal(response.body.scope, 'single-displacement');
  assert.equal(response.body.truncated, false);
  assert.deepEqual(response.body.candidates, []);
});

test('the displaced session destination must stay free outside the target interval for its own whole duration', async () => {
  for (const [startAt, endAt] of [
    ['2026-11-16T08:00:00+05:30', '2026-11-16T09:00:00+05:30'],
    ['2026-11-16T11:00:00+05:30', '2026-11-16T12:00:00+05:30'],
  ]) {
    const fixture = loadFixture('single-swap');
    const blocker = fixture.sessions.find((session) => session.sessionId === 'S001');
    blocker.startAt = '2026-11-16T08:00:00+05:30';
    blocker.endAt = '2026-11-16T12:00:00+05:30';
    fixture.sessions.push({
      ...structuredClone(blocker), sessionId: 'S003', lecturerId: 'L003', studentGroupId: 'G3',
      roomId: 'ROOM_C', startAt, endAt,
    });
    const response = await postFixture(fixture).expect(200);
    assert.deepEqual(response.body.candidates, []);
    assert.equal(response.body.truncated, false);
  }
});

test('stale revisions and missing scenario or session IDs are reported through the shared error envelope', async () => {
  const valid = loadFixture('single-relocation').request;
  for (const [changes, status, code] of [
    [{ scenarioRevision: valid.scenarioRevision - 1 }, 409, 'STALE_SCENARIO'],
    [{ scenarioId: 'scenario-missing' }, 404, 'SCENARIO_NOT_FOUND'],
    [{ affectedSessionId: 'S_MISSING' }, 404, 'SESSION_NOT_FOUND'],
  ]) {
    const response = await request(createApp()).post('/allocation/room-swaps').send({ ...valid, ...changes });
    assertError(response, status, code);
  }
});

test('strict swap request validation rejects malformed IDs, invalid limits and unknown body fields', async () => {
  const valid = loadFixture('single-relocation').request;
  for (const changes of [
    { scenarioId: '../scenario' }, { affectedSessionId: 'bad session' }, { allowedMoveCount: -1 },
    { limits: { maxCandidates: 0, timeoutMs: 2000 } }, { fixtureName: '../../.env' },
  ]) {
    const response = await request(createApp()).post('/allocation/room-swaps').send({ ...valid, ...changes });
    assertError(response, 422, 'INVALID_INPUT');
    assert.ok(Array.isArray(response.body.details));
  }
});

test('swap requests require JSON content type and malformed JSON still returns the parser error', async () => {
  const text = await request(createApp()).post('/allocation/room-swaps')
    .set('Content-Type', 'text/plain').send(JSON.stringify(loadFixture('single-relocation').request));
  assertError(text, 415, 'UNSUPPORTED_MEDIA_TYPE');
  const missing = await request(createApp()).post('/allocation/room-swaps');
  assertError(missing, 415, 'UNSUPPORTED_MEDIA_TYPE');
  const malformed = await request(createApp()).post('/allocation/room-swaps')
    .set('Content-Type', 'application/json').send('{"scenarioId":');
  assertError(malformed, 400, 'INVALID_JSON');
});

test('swap dependency failures produce sanitized 503 errors without falling back to stored expectations', async () => {
  const fixture = loadFixture('single-relocation');
  const clients = createFixtureClients({ fixture });
  clients.facilitiesClient.getRoomSnapshot = async () => { throw new Error('PRIVATE_UPSTREAM_DETAILS'); };
  const response = await request(createApp({ clients })).post('/allocation/room-swaps').send(fixture.request);
  assertError(response, 503, 'DEPENDENCY_UNAVAILABLE');
  assert.ok(!JSON.stringify(response.body).includes('PRIVATE_UPSTREAM_DETAILS'));
});

test('a swap dependency that never resolves returns a bounded 504 response', { timeout: 3000 }, async () => {
  const fixture = loadFixture('single-relocation');
  const clients = createFixtureClients({ fixture });
  clients.platformClient.getScenarioSnapshot = () => new Promise(() => {});
  const response = await request(createApp({ clients, searchOptions: { dependencyTimeoutMs: 10 } }))
    .post('/allocation/room-swaps').send(fixture.request).timeout({ deadline: 2000 });
  assertError(response, 504, 'DEPENDENCY_TIMEOUT');
});

test('swap results have stable candidate IDs, unique runs and unchanged source data without using expected answers', async () => {
  const fixture = loadFixture('single-swap');
  fixture.expected = { proposal: { validationStatus: 'valid', moves: [{ sessionId: 'FAKE_EXPECTED' }] } };
  const before = structuredClone(fixture);
  const rawRequest = structuredClone(fixture.request);
  const originalRequest = structuredClone(rawRequest);
  const app = createApp({ clients: createFixtureClients({ fixture }) });
  const first = await request(app).post('/allocation/room-swaps').send(rawRequest).expect(200);
  const second = await request(app).post('/allocation/room-swaps').send(rawRequest).expect(200);
  assert.notEqual(first.body.runId, second.body.runId);
  assert.deepEqual(first.body.candidates, second.body.candidates);
  assert.deepEqual(first.body.roomChecks, second.body.roomChecks);
  assert.deepEqual(fixture, before);
  assert.deepEqual(rawRequest, originalRequest);
  assert.equal(first.body.candidates.length, 1);
  assertTwoMoves(first.body.candidates[0], fixture, 'swap');
  assert.equal(first.body.expected, undefined);
  assert.ok(!JSON.stringify(first.body).includes('FAKE_EXPECTED'));
});

test('direct search remains direct-only for every fixture and scoring is still an unknown route', async () => {
  const app = createApp();
  for (const name of FIXTURE_NAMES) {
    const fixture = loadFixture(name);
    const response = await request(app).post('/allocation/candidates').send(fixture.request).expect(200);
    assert.equal(response.body.scope, 'direct-only');
    assert.deepEqual(response.body.candidates.map((candidate) => candidate.moves[0].toRoomId), fixture.expected.directRoomIds);
    assert.ok(response.body.candidates.every((candidate) => candidate.moves.length === 1));
  }
  const score = await request(app).post('/allocation/score').send({});
  assertError(score, 404, 'NOT_FOUND');
});

test('a swap search time limit reports truncation instead of claiming a completed empty search', async () => {
  let ticks = 0;
  const fixture = loadFixture('single-relocation');
  const app = createApp({ searchOptions: { clock: () => { ticks += 2; return ticks; } } });
  const response = await request(app).post('/allocation/room-swaps')
    .send({ ...fixture.request, limits: { maxCandidates: 10, timeoutMs: 1 } }).expect(200);
  assert.equal(response.body.truncated, true);
  assert.equal(response.body.validationStatus, 'pending');
  assert.deepEqual(response.body.candidates, []);
  assert.ok(response.body.reasons.some((reason) => /time limit|remaining|incomplete|budget/i.test(reason)));
});
