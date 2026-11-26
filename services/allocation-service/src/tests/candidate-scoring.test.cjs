const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFixture, createFixtureClients } = require('../clients/fixture-clients');
const { prepareAllocationInput } = require('../services/prepare-allocation-input');
const { createCandidateId } = require('../algorithms/candidate-id');
const { parseScoreRequest } = require('../validation/scoring-input');
const { SCORING_POLICY, rankCandidates } = require('../algorithms/candidate-scoring');
const { scoreCandidates } = require('../services/score-candidates');

function session(data, sessionId = 'S007') {
  return data.sessions.find((item) => item.sessionId === sessionId);
}

function move(data, toRoomId, sessionId = 'S007') {
  const original = session(data, sessionId);
  return {
    sessionId, fromRoomId: original.roomId, toRoomId,
    startAt: original.startAt, endAt: original.endAt,
  };
}

function prepare(data) {
  return prepareAllocationInput(data.request, createFixtureClients({ fixture: data }));
}

function submit(input, moves) {
  return { candidateId: createCandidateId(input, moves), moves: structuredClone(moves) };
}

function scoreRequest(data, candidates) {
  return {
    scenarioId: data.scenarioId,
    scenarioRevision: data.scenarioRevision,
    facilitiesVersion: data.facilitiesVersion,
    affectedSessionId: data.request.affectedSessionId,
    allowedMoveCount: data.request.allowedMoveCount,
    candidates,
  };
}

function invalidCandidate(action) {
  assert.throws(action, { status: 422, code: 'INVALID_CANDIDATE' });
}

function addRoom(data, roomId, seats, building = 'Main') {
  data.rooms.push({ roomId, seats, features: ['projector', 'computers'], usableComputers: 65, building });
}

test('the original relocation has an explained cost of 103 under the fixed scoring policy', async () => {
  const data = loadFixture('single-relocation');
  const input = await prepare(data);
  const candidate = submit(input, data.expected.proposal.moves);
  const [ranked] = rankCandidates(input, [candidate]);
  assert.equal(ranked.candidateId, candidate.candidateId);
  assert.equal(ranked.rank, 1);
  assert.equal(ranked.kind, 'relocation');
  assert.equal(ranked.validationStatus, 'pending');
  assert.equal(ranked.cost, 103);
  assert.deepEqual(ranked.costBreakdown, {
    displacedExistingSessions: 1, timeChangedSessions: 0, buildingChangedSessions: 0,
    totalUnusedSeats: 30,
    weightedCosts: {
      displacedExistingSessions: 100, timeChangedSessions: 0, buildingChangedSessions: 0,
      totalUnusedSeats: 3,
    },
  });
  assert.deepEqual(ranked.moves, data.expected.proposal.moves);
  assert.ok(ranked.reasons.length > 0);
  assert.ok(ranked.reasons.every((reason) => typeof reason === 'string' && reason.trim().length > 0));
  assert.deepEqual(SCORING_POLICY, {
    version: 'allocation-cost-v1',
    weights: { displacedExistingSessions: 100, timeChangedSessions: 200, buildingChangedSessions: 10, totalUnusedSeats: 0.1 },
  });
});

test('a direct unassigned target uses only its destination spare seats and costs 2', async () => {
  const data = loadFixture('direct-room');
  const input = await prepare(data);
  const [ranked] = rankCandidates(input, [submit(input, [move(data, 'HALL_A')])]);
  assert.equal(ranked.kind, 'direct');
  assert.equal(ranked.cost, 2);
  assert.equal(ranked.costBreakdown.displacedExistingSessions, 0);
  assert.equal(ranked.costBreakdown.totalUnusedSeats, 20);
  assert.equal(ranked.costBreakdown.timeChangedSessions, 0);
});

test('an unassigned target does not acquire a guessed origin-building penalty', async () => {
  const data = loadFixture('direct-room');
  data.rooms.find((room) => room.roomId === 'HALL_A').building = 'Other campus';
  const input = await prepare(data);
  const [ranked] = rankCandidates(input, [submit(input, [move(data, 'HALL_A')])]);
  assert.equal(ranked.costBreakdown.buildingChangedSessions, 0);
  assert.equal(ranked.cost, 2);
});

test('a cross-building literal swap counts both moved sessions and costs 123', async () => {
  const data = loadFixture('single-relocation');
  session(data).roomId = 'ROOM_C';
  data.rooms.find((room) => room.roomId === 'ROOM_C').building = 'IT';
  const input = await prepare(data);
  const moves = [move(data, 'ROOM_C', 'S001'), move(data, 'HALL_A')];
  const [ranked] = rankCandidates(input, [submit(input, moves)]);
  assert.equal(ranked.kind, 'swap');
  assert.equal(ranked.costBreakdown.displacedExistingSessions, 1);
  assert.equal(ranked.costBreakdown.buildingChangedSessions, 2);
  assert.equal(ranked.costBreakdown.weightedCosts.buildingChangedSessions, 20);
  assert.equal(ranked.costBreakdown.totalUnusedSeats, 30);
  assert.equal(ranked.cost, 123);
});

test('an assigned target contributes its building change without becoming a displaced existing session', async () => {
  const data = loadFixture('direct-room');
  session(data).roomId = 'ROOM_C';
  data.rooms.find((room) => room.roomId === 'HALL_A').building = 'IT';
  const input = await prepare(data);
  const [ranked] = rankCandidates(input, [submit(input, [move(data, 'HALL_A')])]);
  assert.equal(ranked.costBreakdown.displacedExistingSessions, 0);
  assert.equal(ranked.costBreakdown.buildingChangedSessions, 1);
  assert.equal(ranked.cost, 12);
});

test('lower costs determine rank rather than submitted order or destination ID order', async () => {
  const data = loadFixture('direct-room');
  addRoom(data, 'ROOM_TIGHT', 61);
  addRoom(data, 'ROOM_LARGE', 99);
  const input = await prepare(data);
  const candidates = ['ROOM_LARGE', 'HALL_A', 'ROOM_TIGHT']
    .map((roomId) => submit(input, [move(data, roomId)]));
  const ranked = rankCandidates(input, candidates);
  assert.deepEqual(ranked.map((candidate) => candidate.moves[0].toRoomId), ['ROOM_TIGHT', 'HALL_A', 'ROOM_LARGE']);
  assert.deepEqual(ranked.map((candidate) => candidate.cost), [0.1, 2, 3.9]);
  assert.deepEqual(ranked.map((candidate) => candidate.rank), [1, 2, 3]);
});

test('equal costs use stable candidate ID order and do not depend on submission order', async () => {
  const data = loadFixture('direct-room');
  addRoom(data, 'ROOM_TIE', 80);
  const input = await prepare(data);
  const candidates = ['HALL_A', 'ROOM_TIE'].map((roomId) => submit(input, [move(data, roomId)]));
  const ranked = rankCandidates(input, candidates);
  assert.deepEqual(ranked.map((candidate) => candidate.candidateId),
    candidates.map((candidate) => candidate.candidateId).sort());
  assert.deepEqual(rankCandidates(input, [...candidates].reverse()), ranked);
  assert.deepEqual(ranked.map((candidate) => candidate.cost), [2, 2]);
});

test('fifty submitted alternatives retain exact tenths without being capped by search defaults', async () => {
  const data = loadFixture('direct-room');
  for (let index = 0; index < 50; index += 1) addRoom(data, `ROOM_${String(index).padStart(2, '0')}`, 61 + index);
  const input = await prepare(data);
  const candidates = data.rooms.filter((room) => room.roomId.startsWith('ROOM_') && /^ROOM_\d+$/.test(room.roomId))
    .map((room) => submit(input, [move(data, room.roomId)]));
  const result = await scoreCandidates(scoreRequest(data, candidates.reverse()), createFixtureClients({ fixture: data }));
  assert.equal(result.rankedCandidates.length, 50);
  assert.equal(result.rankedCandidates[0].cost, 0.1);
  assert.equal(result.rankedCandidates[2].cost, 0.3);
  assert.equal(result.rankedCandidates[2].costBreakdown.weightedCosts.totalUnusedSeats, 0.3);
  assert.equal(result.rankedCandidates[28].cost, 2.9);
  assert.equal(result.rankedCandidates[49].cost, 5);
  assert.deepEqual(result.rankedCandidates.map((candidate) => candidate.rank), Array.from({ length: 50 }, (_, index) => index + 1));
});

test('score requests reject supplied costs, validity assertions and policy overrides', async () => {
  const data = loadFixture('direct-room');
  const input = await prepare(data);
  const candidate = submit(input, [move(data, 'HALL_A')]);
  const raw = scoreRequest(data, [candidate]);
  for (const value of [
    { ...raw, weights: { totalUnusedSeats: 0 } },
    { ...raw, candidates: [{ ...candidate, cost: -100 }] },
    { ...raw, candidates: [{ ...candidate, validationStatus: 'valid' }] },
    { ...raw, scenarioRevision: '3' },
    { ...raw, candidates: Array.from({ length: 51 }, () => candidate) },
  ]) {
    assert.throws(() => parseScoreRequest(value), { status: 422, code: 'INVALID_INPUT' });
  }
});

test('duplicate candidate IDs and duplicate moved sessions fail syntactic validation', async () => {
  const data = loadFixture('direct-room');
  const input = await prepare(data);
  const candidate = submit(input, [move(data, 'HALL_A')]);
  assert.throws(() => parseScoreRequest(scoreRequest(data, [candidate, candidate])), {
    status: 422, code: 'INVALID_INPUT',
  });
  assert.throws(() => parseScoreRequest(scoreRequest(data, [{
    ...candidate, moves: [candidate.moves[0], candidate.moves[0]],
  }])), { status: 422, code: 'INVALID_INPUT' });
});

test('a content ID, source assignment or destination cannot be silently replaced', async () => {
  const data = loadFixture('direct-room');
  const input = await prepare(data);
  const candidate = submit(input, [move(data, 'HALL_A')]);
  invalidCandidate(() => rankCandidates(input, [{ ...candidate, candidateId: `candidate-${'0'.repeat(24)}` }]));
  for (const changes of [{ fromRoomId: 'ROOM_C' }, { toRoomId: 'ROOM_MISSING' }, { sessionId: 'S999' }]) {
    const moves = [{ ...candidate.moves[0], ...changes }];
    invalidCandidate(() => rankCandidates(input, [submit(input, moves)]));
  }
});

test('partial relocations and unrelated extra rearrangements are rejected even if individual moves fit', async () => {
  const relocation = loadFixture('single-relocation');
  const input = await prepare(relocation);
  for (const moves of [
    [move(relocation, 'HALL_A')],
    [move(relocation, 'ROOM_C', 'S001')],
  ]) invalidCandidate(() => rankCandidates(input, [submit(input, moves)]));

  const unrelated = loadFixture('direct-room');
  addRoom(unrelated, 'ROOM_EXTRA', 50);
  const directInput = await prepare(unrelated);
  const moves = [move(unrelated, 'ROOM_EXTRA', 'S001'), move(unrelated, 'HALL_A')];
  invalidCandidate(() => rankCandidates(directInput, [submit(directInput, moves)]));
});

test('fixed-time scoring rejects changed intervals instead of assigning a time-change penalty', async () => {
  const data = loadFixture('direct-room');
  const input = await prepare(data);
  const moves = [{ ...move(data, 'HALL_A'), endAt: '2026-11-16T12:00:00+05:30' }];
  invalidCandidate(() => rankCandidates(input, [submit(input, moves)]));
  const [supported] = rankCandidates(input, [submit(input, [move(data, 'HALL_A')])]);
  assert.equal(supported.costBreakdown.timeChangedSessions, 0);
  assert.equal(supported.costBreakdown.weightedCosts.timeChangedSessions, 0);
});

test('any hard-invalid submitted alternative rejects the whole ranking rather than winning on price', async () => {
  const changes = [
    (data) => { data.rooms.find((room) => room.roomId === 'HALL_A').seats = 59; },
    (data) => { data.rooms.find((room) => room.roomId === 'HALL_A').features = []; },
    (data) => { session(data).requiredWorkingComputers = 10; },
    (data) => { data.sessions.push({ ...session(data, 'S001'), sessionId: 'S008', lecturerId: 'L008', studentGroupId: 'G8', roomId: 'HALL_A' }); },
    (data) => { data.restrictions.push({
      restrictionId: 'restriction-hall', roomId: 'HALL_A', kind: 'closure',
      startAt: session(data).startAt, endAt: session(data).endAt,
      unavailableFacilities: [], usableComputers: null, reason: 'Fictional closure',
    }); },
  ];
  for (const change of changes) {
    const data = loadFixture('direct-room');
    addRoom(data, 'ROOM_VALID', 80);
    change(data);
    const input = await prepare(data);
    const candidates = ['ROOM_VALID', 'HALL_A'].map((roomId) => submit(input, [move(data, roomId)]));
    invalidCandidate(() => rankCandidates(input, candidates));
    await assert.rejects(scoreCandidates(scoreRequest(data, candidates), createFixtureClients({ fixture: data })), {
      status: 422, code: 'INVALID_CANDIDATE',
    });
  }
});

test('canonical ranking accepts reversed move order without changing source snapshots or submitted plans', async () => {
  const data = loadFixture('single-relocation');
  const input = await prepare(data);
  const candidate = submit(input, [...data.expected.proposal.moves].reverse());
  const before = structuredClone({ input, candidate });
  const [ranked] = rankCandidates(input, [candidate]);
  assert.deepEqual(ranked.moves, data.expected.proposal.moves);
  assert.equal(ranked.candidateId, candidate.candidateId);
  assert.equal(ranked.cost, 103);
  assert.deepEqual({ input, candidate }, before);
  ranked.moves[0].toRoomId = 'CALLER_CHANGE';
  assert.deepEqual({ input, candidate }, before);
});

test('the service reads each dependency once and returns pending metadata with the recorded policy', async () => {
  const data = loadFixture('direct-room');
  const input = await prepare(data);
  const raw = scoreRequest(data, [submit(input, [move(data, 'HALL_A')])]);
  const before = structuredClone(raw);
  const clients = createFixtureClients({ fixture: data });
  const platform = await clients.platformClient.getScenarioSnapshot(data.scenarioId);
  const facilities = await clients.facilitiesClient.getRoomSnapshot();
  const source = structuredClone({ platform, facilities });
  const reads = [];
  let writes = 0;
  const result = await scoreCandidates(raw, {
    platformClient: {
      async getScenarioSnapshot() { reads.push('platform'); return platform; },
      async apply() { writes += 1; },
      async createTimetable() { writes += 1; },
    },
    facilitiesClient: { async getRoomSnapshot() { reads.push('facilities'); return facilities; } },
  });
  assert.deepEqual(reads.sort(), ['facilities', 'platform']);
  assert.equal(writes, 0);
  assert.equal(result.mode, 'fixture');
  assert.equal(result.scope, 'submitted-candidates');
  assert.equal(result.validationStatus, 'pending');
  assert.equal(result.scenarioId, data.scenarioId);
  assert.equal(result.scenarioRevision, data.scenarioRevision);
  assert.equal(result.facilitiesVersion, data.facilitiesVersion);
  assert.match(result.runId, /^run-[0-9a-f-]{36}$/);
  assert.deepEqual(result.scoringPolicy, SCORING_POLICY);
  assert.equal(result.rankedCandidates[0].validationStatus, 'pending');
  assert.deepEqual(raw, before);
  assert.deepEqual({ platform, facilities }, source);
});

test('stale facilities, scenario revisions and missing targets remain explicit service errors', async () => {
  const data = loadFixture('direct-room');
  const input = await prepare(data);
  const raw = scoreRequest(data, [submit(input, [move(data, 'HALL_A')])]);
  for (const [patch, status, code] of [
    [{ facilitiesVersion: 'fixture-v2' }, 409, 'STALE_FACILITIES'],
    [{ scenarioRevision: data.scenarioRevision - 1 }, 409, 'STALE_SCENARIO'],
    [{ affectedSessionId: 'S999' }, 404, 'SESSION_NOT_FOUND'],
  ]) {
    await assert.rejects(scoreCandidates({ ...raw, ...patch }, createFixtureClients({ fixture: data })), { status, code });
  }
});

test('empty candidate lists return an empty ranking only after validating snapshot metadata', async () => {
  const data = loadFixture('direct-room');
  const raw = scoreRequest(data, []);
  assert.deepEqual(parseScoreRequest(raw).candidates, []);
  const result = await scoreCandidates(raw, createFixtureClients({ fixture: data }));
  assert.deepEqual(result.rankedCandidates, []);
  assert.equal(result.validationStatus, 'pending');
  await assert.rejects(scoreCandidates({ ...raw, facilitiesVersion: 'fixture-v2' }, createFixtureClients({ fixture: data })), {
    status: 409, code: 'STALE_FACILITIES',
  });
});

test('zero permitted displacements still permits direct scoring but rejects an existing-session move', async () => {
  const direct = loadFixture('direct-room');
  direct.request.allowedMoveCount = 0;
  const directInput = await prepare(direct);
  assert.equal(rankCandidates(directInput, [submit(directInput, [move(direct, 'HALL_A')])])[0].cost, 2);
  const relocation = loadFixture('single-relocation');
  relocation.request.allowedMoveCount = 0;
  const relocationInput = await prepare(relocation);
  invalidCandidate(() => rankCandidates(relocationInput, [submit(relocationInput, relocation.expected.proposal.moves)]));
});
