const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../app');
const { createFixtureClients, loadFixture } = require('../clients/fixture-clients');
const { createCandidateId } = require('../algorithms/candidate-id');

function scorePayload(fixture, candidates = []) {
  return {
    scenarioId: fixture.scenarioId,
    scenarioRevision: fixture.scenarioRevision,
    facilitiesVersion: fixture.facilitiesVersion,
    affectedSessionId: fixture.request.affectedSessionId,
    allowedMoveCount: fixture.request.allowedMoveCount,
    candidates: candidates.map((candidate) => ({
      candidateId: candidate.candidateId, moves: structuredClone(candidate.moves),
    })),
  };
}

async function generate(app, fixture, path = '/allocation/candidates') {
  const response = await request(app).post(path).send(fixture.request).expect(200);
  return response.body.candidates;
}

function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.code, code);
  assert.equal(typeof response.body.message, 'string');
  assert.ok(response.headers['x-request-id']);
  assert.equal(response.body.traceId, response.headers['x-request-id']);
  assert.equal(response.body.stack, undefined);
  assert.equal(response.body.rankedCandidates, undefined);
}

test('the score endpoint calculates a direct candidate cost from snapshot facts and stays pending', async () => {
  const fixture = loadFixture('direct-room');
  const app = createApp();
  const candidates = await generate(app, fixture);
  const response = await request(app).post('/allocation/score')
    .send(scorePayload(fixture, candidates)).expect('Content-Type', /json/).expect(200);
  const result = response.body;
  assert.equal(result.mode, 'fixture');
  assert.equal(result.scope, 'submitted-candidates');
  assert.equal(result.validationStatus, 'pending');
  assert.equal(result.scenarioId, fixture.scenarioId);
  assert.equal(result.scenarioRevision, fixture.scenarioRevision);
  assert.equal(result.facilitiesVersion, fixture.facilitiesVersion);
  assert.equal(typeof result.runId, 'string');
  assert.deepEqual(result.scoringPolicy, {
    version: 'allocation-cost-v1',
    weights: { displacedExistingSessions: 100, timeChangedSessions: 200, buildingChangedSessions: 10, totalUnusedSeats: 0.1 },
  });
  assert.equal(result.rankedCandidates.length, 1);
  const ranked = result.rankedCandidates[0];
  assert.equal(ranked.candidateId, candidates[0].candidateId);
  assert.equal(ranked.rank, 1);
  assert.equal(ranked.kind, 'direct');
  assert.equal(ranked.validationStatus, 'pending');
  assert.deepEqual(ranked.moves, candidates[0].moves);
  assert.equal(ranked.cost, 2);
  assert.deepEqual(ranked.costBreakdown, {
    displacedExistingSessions: 0, timeChangedSessions: 0, buildingChangedSessions: 0, totalUnusedSeats: 20,
    weightedCosts: { displacedExistingSessions: 0, timeChangedSessions: 0, buildingChangedSessions: 0, totalUnusedSeats: 2 },
  });
  assert.ok(ranked.reasons.length > 0);
  assert.ok(ranked.reasons.every((reason) => typeof reason === 'string'));
  assert.equal(result.expected, undefined);
});

test('generated relocation and literal swap proposals each receive the explained one-displacement cost', async () => {
  for (const [name, kind] of [['single-relocation', 'relocation'], ['single-swap', 'swap']]) {
    const fixture = loadFixture(name);
    const app = createApp();
    const candidates = await generate(app, fixture, '/allocation/room-swaps');
    const response = await request(app).post('/allocation/score').send(scorePayload(fixture, candidates)).expect(200);
    assert.equal(response.body.rankedCandidates.length, 1);
    const ranked = response.body.rankedCandidates[0];
    assert.equal(ranked.kind, kind);
    assert.equal(ranked.validationStatus, 'pending');
    assert.equal(ranked.cost, 103);
    assert.equal(ranked.costBreakdown.displacedExistingSessions, 1);
    assert.equal(ranked.costBreakdown.totalUnusedSeats, 30);
    assert.equal(ranked.costBreakdown.weightedCosts.displacedExistingSessions, 100);
    assert.equal(ranked.costBreakdown.weightedCosts.totalUnusedSeats, 3);
  }
});

test('mixed direct and relocation alternatives are ranked by recalculated cost rather than submission order', async () => {
  const fixture = loadFixture('single-relocation');
  fixture.rooms.push({ ...structuredClone(fixture.rooms[0]), roomId: 'HALL_B' });
  const app = createApp({ clients: createFixtureClients({ fixture }) });
  const direct = await generate(app, fixture);
  const relocations = await generate(app, fixture, '/allocation/room-swaps');
  assert.equal(direct.length, 1);
  assert.equal(relocations.length, 2);
  const candidates = [...relocations, ...direct];
  const response = await request(app).post('/allocation/score').send(scorePayload(fixture, candidates)).expect(200);
  const ranked = response.body.rankedCandidates;
  assert.deepEqual(ranked.map((candidate) => candidate.cost), [2, 103, 106]);
  assert.deepEqual(ranked.map((candidate) => candidate.rank), [1, 2, 3]);
  assert.equal(ranked[0].kind, 'direct');
  assert.ok(ranked.every((candidate) => candidate.validationStatus === 'pending'));
});

test('equal costs use candidate ID ties, read each snapshot once and leave source data unchanged', async () => {
  const fixture = loadFixture('direct-room');
  fixture.rooms.push({ ...structuredClone(fixture.rooms[0]), roomId: 'HALL_B' });
  const before = structuredClone(fixture);
  const clients = createFixtureClients({ fixture });
  const originalPlatformRead = clients.platformClient.getScenarioSnapshot;
  const originalFacilitiesRead = clients.facilitiesClient.getRoomSnapshot;
  let platformReads = 0;
  let facilitiesReads = 0;
  clients.platformClient.getScenarioSnapshot = async (...args) => {
    platformReads += 1;
    return originalPlatformRead(...args);
  };
  clients.facilitiesClient.getRoomSnapshot = async () => {
    facilitiesReads += 1;
    return originalFacilitiesRead();
  };
  const app = createApp({ clients });
  const candidates = await generate(app, fixture);
  assert.equal(candidates.length, 2);
  platformReads = 0;
  facilitiesReads = 0;
  const payload = scorePayload(fixture, [...candidates].reverse());
  const originalPayload = structuredClone(payload);
  const first = await request(app).post('/allocation/score').send(payload).expect(200);
  assert.equal(platformReads, 1);
  assert.equal(facilitiesReads, 1);
  assert.deepEqual(first.body.rankedCandidates.map((candidate) => candidate.cost), [2, 2]);
  assert.deepEqual(first.body.rankedCandidates.map((candidate) => candidate.candidateId),
    candidates.map((candidate) => candidate.candidateId).sort());
  const second = await request(app).post('/allocation/score')
    .send({ ...payload, candidates: [...payload.candidates].reverse() }).expect(200);
  assert.notEqual(first.body.runId, second.body.runId);
  assert.deepEqual(first.body.rankedCandidates, second.body.rankedCandidates);
  assert.deepEqual(fixture, before);
  assert.deepEqual(payload, originalPayload);
});

test('an empty submitted list succeeds only after reading the current snapshots and checking their versions', async () => {
  const fixture = loadFixture('direct-room');
  const clients = createFixtureClients({ fixture });
  const platformRead = clients.platformClient.getScenarioSnapshot;
  const facilitiesRead = clients.facilitiesClient.getRoomSnapshot;
  let platformReads = 0;
  let facilitiesReads = 0;
  clients.platformClient.getScenarioSnapshot = async (...args) => { platformReads += 1; return platformRead(...args); };
  clients.facilitiesClient.getRoomSnapshot = async () => { facilitiesReads += 1; return facilitiesRead(); };
  const app = createApp({ clients });
  const response = await request(app).post('/allocation/score').send(scorePayload(fixture)).expect(200);
  assert.deepEqual(response.body.rankedCandidates, []);
  assert.equal(response.body.validationStatus, 'pending');
  assert.equal(platformReads, 1);
  assert.equal(facilitiesReads, 1);
  const stale = await request(app).post('/allocation/score')
    .send({ ...scorePayload(fixture), facilitiesVersion: 'fixture-older' });
  assertError(stale, 409, 'STALE_FACILITIES');
});

test('score input rejects caller-supplied costs, status and policy metadata before dependency reads', async () => {
  const fixture = loadFixture('direct-room');
  const candidates = await generate(createApp(), fixture);
  const valid = scorePayload(fixture, candidates);
  let reads = 0;
  const app = createApp({ clients: {
    platformClient: { async getScenarioSnapshot() { reads += 1; } },
    facilitiesClient: { async getRoomSnapshot() { reads += 1; } },
  } });
  for (const changes of [
    { scoringPolicy: { weights: { totalUnusedSeats: 0 } } },
    { candidates: [{ ...valid.candidates[0], cost: 0 }] },
    { candidates: [{ ...valid.candidates[0], validationStatus: 'valid' }] },
    { candidates: [{ ...valid.candidates[0], kind: 'direct' }] },
    { allowedMoveCount: -1 },
  ]) {
    const response = await request(app).post('/allocation/score').send({ ...valid, ...changes });
    assertError(response, 422, 'INVALID_INPUT');
    assert.ok(Array.isArray(response.body.details));
  }
  assert.equal(reads, 0);
});

test('score schema bounds candidate and move lists and rejects duplicate identities', async () => {
  const fixture = loadFixture('direct-room');
  const candidates = await generate(createApp(), fixture);
  const valid = scorePayload(fixture, candidates);
  const candidate = valid.candidates[0];
  const invalidLists = [
    [candidate, structuredClone(candidate)],
    Array.from({ length: 51 }, () => structuredClone(candidate)),
    [{ ...candidate, moves: [] }],
    [{ ...candidate, moves: [candidate.moves[0], structuredClone(candidate.moves[0])] }],
    [{ ...candidate, moves: [candidate.moves[0], { ...candidate.moves[0], sessionId: 'S001' }, { ...candidate.moves[0], sessionId: 'S002' }] }],
  ];
  for (const submitted of invalidLists) {
    const response = await request(createApp()).post('/allocation/score').send({ ...valid, candidates: submitted });
    assertError(response, 422, 'INVALID_INPUT');
  }
});

test('a wrong candidate identity rejects the entire submitted batch rather than returning partial ranks', async () => {
  const fixture = loadFixture('direct-room');
  const candidates = await generate(createApp(), fixture);
  const valid = scorePayload(fixture, candidates);
  const response = await request(createApp()).post('/allocation/score').send({
    ...valid,
    candidates: [valid.candidates[0], { ...structuredClone(valid.candidates[0]), candidateId: 'candidate-000000000000000000000000' }],
  });
  assertError(response, 422, 'INVALID_CANDIDATE');
});

test('matching recomputed IDs do not allow incorrect sources, changed times or unknown destination rooms', async () => {
  const fixture = loadFixture('direct-room');
  const candidates = await generate(createApp(), fixture);
  for (const change of [
    (move) => { move.fromRoomId = 'ROOM_C'; },
    (move) => { move.startAt = '2026-11-16T09:01:00+05:30'; },
    (move) => { move.toRoomId = 'ROOM_MISSING'; },
  ]) {
    const payload = scorePayload(fixture, candidates);
    change(payload.candidates[0].moves[0]);
    payload.candidates[0].candidateId = createCandidateId({ snapshot: fixture }, payload.candidates[0].moves);
    const response = await request(createApp()).post('/allocation/score').send(payload);
    assertError(response, 422, 'INVALID_CANDIDATE');
  }
});

test('a submitted displacement cannot bypass an allowance of zero', async () => {
  const fixture = loadFixture('single-relocation');
  const candidates = await generate(createApp(), fixture, '/allocation/room-swaps');
  const response = await request(createApp()).post('/allocation/score')
    .send({ ...scorePayload(fixture, candidates), allowedMoveCount: 0 });
  assertError(response, 422, 'INVALID_CANDIDATE');
});

test('score requests reject stale scenario or facilities versions and unknown scenario or target IDs', async () => {
  const fixture = loadFixture('direct-room');
  for (const [changes, status, code] of [
    [{ scenarioRevision: fixture.scenarioRevision - 1 }, 409, 'STALE_SCENARIO'],
    [{ facilitiesVersion: 'fixture-older' }, 409, 'STALE_FACILITIES'],
    [{ scenarioId: 'scenario-missing' }, 404, 'SCENARIO_NOT_FOUND'],
    [{ affectedSessionId: 'S_MISSING' }, 404, 'SESSION_NOT_FOUND'],
  ]) {
    const response = await request(createApp()).post('/allocation/score').send({ ...scorePayload(fixture), ...changes });
    assertError(response, status, code);
  }
});

test('scoring rechecks current physical facts rather than accepting a previously generated candidate', async () => {
  const original = loadFixture('direct-room');
  const candidates = await generate(createApp(), original);
  for (const change of [
    (fixture) => { fixture.rooms.find((room) => room.roomId === 'HALL_A').seats = 59; },
    (fixture) => {
      const target = fixture.sessions.find((session) => session.sessionId === fixture.request.affectedSessionId);
      fixture.restrictions.push({
        restrictionId: 'closure-new', roomId: 'HALL_A', kind: 'closure',
        startAt: target.startAt, endAt: target.endAt, unavailableFacilities: [], usableComputers: null,
        reason: 'Fictional closure after the initial search.',
      });
    },
  ]) {
    const fixture = structuredClone(original);
    change(fixture);
    const response = await request(createApp({ clients: createFixtureClients({ fixture }) }))
      .post('/allocation/score').send(scorePayload(original, candidates));
    assertError(response, 422, 'INVALID_CANDIDATE');
  }
});

test('score HTTP parsing requires JSON and retains controlled malformed and oversized-body errors', async () => {
  const app = createApp();
  const payload = scorePayload(loadFixture('direct-room'));
  const text = await request(app).post('/allocation/score')
    .set('Content-Type', 'text/plain').send(JSON.stringify(payload));
  assertError(text, 415, 'UNSUPPORTED_MEDIA_TYPE');
  assertError(await request(app).post('/allocation/score'), 415, 'UNSUPPORTED_MEDIA_TYPE');
  const malformed = await request(app).post('/allocation/score')
    .set('Content-Type', 'application/json').send('{"scenarioId":');
  assertError(malformed, 400, 'INVALID_JSON');
  const large = await request(app).post('/allocation/score').send({ padding: 'x'.repeat(101 * 1024) });
  assertError(large, 413, 'PAYLOAD_TOO_LARGE');
});

test('scoring returns sanitized dependency failures even for an empty submitted list', async () => {
  const fixture = loadFixture('direct-room');
  const clients = createFixtureClients({ fixture });
  clients.facilitiesClient.getRoomSnapshot = async () => { throw new Error('PRIVATE_SCORING_DEPENDENCY'); };
  const response = await request(createApp({ clients })).post('/allocation/score').send(scorePayload(fixture));
  assertError(response, 503, 'DEPENDENCY_UNAVAILABLE');
  assert.ok(!JSON.stringify(response.body).includes('PRIVATE_SCORING_DEPENDENCY'));
});

test('scoring has a bounded dependency deadline instead of hanging or returning empty success', { timeout: 3000 }, async () => {
  const fixture = loadFixture('direct-room');
  const clients = createFixtureClients({ fixture });
  clients.platformClient.getScenarioSnapshot = () => new Promise(() => {});
  const response = await request(createApp({ clients, searchOptions: { dependencyTimeoutMs: 10 } }))
    .post('/allocation/score').send(scorePayload(fixture)).timeout({ deadline: 2000 });
  assertError(response, 504, 'DEPENDENCY_TIMEOUT');
});
