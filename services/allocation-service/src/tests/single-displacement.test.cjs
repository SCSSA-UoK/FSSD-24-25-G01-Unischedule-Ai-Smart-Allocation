const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFixture, createFixtureClients } = require('../clients/fixture-clients');
const { AllocationInputError } = require('../validation/allocation-input');
const { generateRoomSwaps } = require('../services/generate-room-swaps');

function fixture() {
  return loadFixture('single-relocation');
}

function session(data, id) {
  return data.sessions.find((item) => item.sessionId === id);
}

function generate(data, options) {
  return generateRoomSwaps(data.request, createFixtureClients({ fixture: data }), options);
}

function addRoom(data, roomId) {
  data.rooms.push({ roomId, seats: 50, features: ['projector'], usableComputers: 0, building: 'Main' });
}

function addBooking(data, roomId, startAt, endAt, id = 'S008') {
  data.sessions.push({
    ...session(data, 'S001'), sessionId: id, lecturerId: `L_${id}`, studentGroupId: `G_${id}`,
    roomId, startAt, endAt,
  });
}

function restriction(roomId, changes = {}) {
  return {
    restrictionId: 'restriction-001', roomId, kind: 'closure',
    startAt: '2026-11-16T09:00:00+05:30', endAt: '2026-11-16T11:00:00+05:30',
    unavailableFacilities: [], usableComputers: null, reason: 'Fictional restriction',
    ...changes,
  };
}

function clockSequence(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test('relocation proposes both required moves with one displaced session and pending metadata', async () => {
  const data = fixture();
  const result = await generate(data);
  assert.equal(result.scope, 'single-displacement');
  assert.equal(result.mode, 'fixture');
  assert.equal(result.validationStatus, 'pending');
  assert.equal(result.scenarioId, data.scenarioId);
  assert.equal(result.scenarioRevision, data.scenarioRevision);
  assert.equal(result.facilitiesVersion, data.facilitiesVersion);
  assert.match(result.runId, /^run-[0-9a-f-]{36}$/);
  assert.equal(result.truncated, false);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.kind, 'relocation');
  assert.equal(candidate.validationStatus, 'pending');
  assert.equal(candidate.displacedExistingSessions, 1);
  assert.match(candidate.candidateId, /^candidate-[0-9a-f]{24}$/);
  assert.deepEqual(candidate.moves, data.expected.proposal.moves);
  assert.ok(candidate.reasons.length > 0);
  assert.ok(candidate.reasons.every((reason) => typeof reason === 'string' && reason.trim().length > 0));
  assert.ok(result.reasons.every((reason) => typeof reason === 'string' && reason.trim().length > 0));
  assert.equal(candidate.costBreakdown, undefined);
  assert.equal(candidate.cost, undefined);
  assert.equal(result.expected, undefined);
});

test('a literal swap frees both original assignments before checking the complete result', async () => {
  const data = fixture();
  session(data, 'S007').roomId = 'ROOM_C';
  const result = await generate(data);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.kind, 'swap');
  assert.deepEqual(candidate.moves.map((move) => [move.sessionId, move.fromRoomId, move.toRoomId]), [
    ['S001', 'HALL_A', 'ROOM_C'], ['S007', 'ROOM_C', 'HALL_A'],
  ]);
  assert.equal(new Set(candidate.moves.map((move) => move.sessionId)).size, 2);
  for (const move of candidate.moves) {
    assert.equal(move.startAt, session(data, move.sessionId).startAt);
    assert.equal(move.endAt, session(data, move.sessionId).endAt);
  }
});

test('zero permitted displacements returns a complete empty result after revision validation', async () => {
  const data = fixture();
  data.request.allowedMoveCount = 0;
  const result = await generate(data);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.truncated, false);
  assert.ok(result.reasons.some((reason) => /allowedMoveCount|at least one|one existing session/i.test(reason)));
  data.request.scenarioRevision -= 1;
  await assert.rejects(generate(data), { status: 409, code: 'STALE_SCENARIO' });
});

test('the displaced session needs its own capacity, equipment and working computers', async () => {
  const cases = [
    (data) => { data.rooms.find((room) => room.roomId === 'ROOM_C').seats = 35; },
    (data) => { session(data, 'S001').requiredFacilities = ['sound']; },
    (data) => { session(data, 'S001').requiredWorkingComputers = 1; },
  ];
  for (const change of cases) {
    const data = fixture();
    change(data);
    const result = await generate(data);
    assert.deepEqual(result.candidates, []);
    assert.equal(result.truncated, false);
  }
});

test('an occupied or closed alternate room prevents relocation', async () => {
  const occupied = fixture();
  addBooking(occupied, 'ROOM_C', session(occupied, 'S001').startAt, session(occupied, 'S001').endAt);
  assert.deepEqual((await generate(occupied)).candidates, []);
  const closed = fixture();
  closed.restrictions.push(restriction('ROOM_C'));
  assert.deepEqual((await generate(closed)).candidates, []);
});

test('two successive blockers spanning the target require more than single displacement', async () => {
  const data = fixture();
  data.request.allowedMoveCount = 3;
  session(data, 'S001').endAt = '2026-11-16T10:00:00+05:30';
  addBooking(data, 'HALL_A', '2026-11-16T10:00:00+05:30', '2026-11-16T11:00:00+05:30');
  const result = await generate(data);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.roomChecks.find((room) => room.roomId === 'HALL_A').blockingSessionIds, ['S001', 'S008']);
});

test('alternate occupancy outside the target interval still conflicts with a longer displaced session', async () => {
  for (const [startAt, endAt] of [
    ['2026-11-16T08:00:00+05:30', '2026-11-16T09:00:00+05:30'],
    ['2026-11-16T11:00:00+05:30', '2026-11-16T12:00:00+05:30'],
  ]) {
    const data = fixture();
    session(data, 'S001').startAt = '2026-11-16T08:00:00+05:30';
    session(data, 'S001').endAt = '2026-11-16T12:00:00+05:30';
    addBooking(data, 'ROOM_C', startAt, endAt);
    assert.deepEqual((await generate(data)).candidates, []);
  }
});

test('swapping into the target old room cannot overlook a different occupant outside target hours', async () => {
  const data = fixture();
  session(data, 'S007').roomId = 'ROOM_C';
  session(data, 'S001').startAt = '2026-11-16T08:00:00+05:30';
  session(data, 'S001').endAt = '2026-11-16T12:00:00+05:30';
  addBooking(data, 'ROOM_C', '2026-11-16T08:00:00+05:30', '2026-11-16T09:00:00+05:30');
  assert.deepEqual((await generate(data)).candidates, []);
});

test('closures and equipment outages are checked across the displaced session whole interval', async () => {
  for (const kind of ['closure', 'equipment-outage']) {
    const data = fixture();
    session(data, 'S001').startAt = '2026-11-16T08:00:00+05:30';
    session(data, 'S001').endAt = '2026-11-16T12:00:00+05:30';
    data.restrictions.push(restriction('ROOM_C', {
      kind,
      startAt: '2026-11-16T08:00:00+05:30',
      endAt: '2026-11-16T09:00:00+05:30',
      unavailableFacilities: kind === 'equipment-outage' ? ['projector'] : [],
    }));
    assert.deepEqual((await generate(data)).candidates, []);
  }
});

test('bookings touching the displaced session boundaries leave the alternate room available', async () => {
  const data = fixture();
  addBooking(data, 'ROOM_C', '2026-11-16T07:00:00+05:30', '2026-11-16T09:00:00+05:30');
  addBooking(data, 'ROOM_C', '2026-11-16T11:00:00+05:30', '2026-11-16T13:00:00+05:30', 'S009');
  const result = await generate(data);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].moves, data.expected.proposal.moves);
});

test('a valid blocker move alone never becomes a partial plan when the target hall is closed', async () => {
  const data = fixture();
  data.restrictions.push(restriction('HALL_A'));
  const result = await generate(data);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.truncated, false);
  assert.ok(result.reasons.some((reason) => /no feasible single-displacement/i.test(reason)));
});

test('empty suitable halls are direct options rather than displacement candidates', async () => {
  const data = loadFixture('direct-room');
  const result = await generate(data);
  assert.deepEqual(result.candidates, []);
  const hall = result.roomChecks.find((room) => room.roomId === 'HALL_A');
  assert.equal(hall.eligible, true);
  assert.deepEqual(hall.blockingSessionIds, []);
});

test('candidate order and bounded content IDs stay stable when source arrays are reversed', async () => {
  const data = fixture();
  addRoom(data, 'ROOM_EXTRA');
  addRoom(data, 'Z'.repeat(100));
  data.restrictions.push(
    restriction('ROOM_C', { restrictionId: 'restriction-z', startAt: '2026-11-16T07:00:00+05:30', endAt: '2026-11-16T08:00:00+05:30' }),
    restriction('HALL_A', { restrictionId: 'restriction-a', startAt: '2026-11-16T07:00:00+05:30', endAt: '2026-11-16T08:00:00+05:30' }),
  );
  const first = await generate(data);
  const reordered = structuredClone(data);
  reordered.rooms.reverse();
  reordered.sessions.reverse();
  reordered.restrictions.reverse();
  const second = await generate(reordered);
  assert.notEqual(first.runId, second.runId);
  assert.deepEqual(first.candidates, second.candidates);
  assert.deepEqual(first.roomChecks, second.roomChecks);
  assert.deepEqual(first.candidates.map((candidate) => candidate.moves[0].toRoomId), [
    'ROOM_C', 'ROOM_EXTRA', 'Z'.repeat(100),
  ]);
  assert.ok(first.candidates.every((candidate) => /^candidate-[0-9a-f]{24}$/.test(candidate.candidateId)));
});

test('candidate identity includes both moves and the revision and facilities context', async () => {
  const data = fixture();
  const original = (await generate(data)).candidates[0].candidateId;
  const variants = [];
  const blockerTime = structuredClone(data);
  session(blockerTime, 'S001').endAt = '2026-11-16T12:00:00+05:30';
  variants.push(blockerTime);
  const targetTime = structuredClone(data);
  session(targetTime, 'S007').endAt = '2026-11-16T12:00:00+05:30';
  variants.push(targetTime);
  const revised = structuredClone(data);
  revised.scenarioRevision += 1;
  revised.request.scenarioRevision = revised.scenarioRevision;
  variants.push(revised);
  const newFacilities = structuredClone(data);
  newFacilities.facilitiesVersion = 'fixture-v2';
  variants.push(newFacilities);
  for (const variant of variants) {
    const result = await generate(variant);
    assert.equal(result.candidates.length, 1);
    assert.notEqual(result.candidates[0].candidateId, original);
  }
});

test('exactly reaching the candidate limit is complete when there are no additional feasible plans', async () => {
  const data = fixture();
  data.request.limits.maxCandidates = 1;
  const result = await generate(data);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.truncated, false);
  assert.ok(!result.reasons.some((reason) => /candidate limit/i.test(reason)));
});

test('only another complete feasible plan proves candidate-limit truncation', async () => {
  const data = fixture();
  data.request.limits.maxCandidates = 1;
  addRoom(data, 'ROOM_EXTRA');
  const result = await generate(data);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].moves[0].toRoomId, 'ROOM_C');
  assert.equal(result.candidates[0].moves.length, 2);
  assert.equal(result.truncated, true);
  assert.ok(result.reasons.some((reason) => /candidate limit/i.test(reason)));
});

test('expiration before any hall is checked reports incomplete search without a no-solution claim', async () => {
  const data = fixture();
  data.request.limits.timeoutMs = 10;
  const result = await generate(data, { clock: clockSequence(0, 10) });
  assert.equal(result.truncated, true);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.roomChecks, []);
  assert.ok(result.reasons.some((reason) => /search time limit/i.test(reason)));
  assert.ok(!result.reasons.some((reason) => /no feasible single-displacement/i.test(reason)));
});

test('the time budget is checked inside the destination loop before completing a plan', async () => {
  const data = fixture();
  data.request.limits.timeoutMs = 10;
  const result = await generate(data, { clock: clockSequence(0, 0, 10) });
  assert.equal(result.truncated, true);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.roomChecks.map((room) => room.roomId), ['HALL_A']);
  assert.ok(result.reasons.some((reason) => /search time limit/i.test(reason)));
});

test('later budget expiration preserves a completed two-move plan', async () => {
  const data = fixture();
  data.request.limits.timeoutMs = 10;
  const result = await generate(data, { clock: clockSequence(0, 0, 0, 0, 0, 10) });
  assert.equal(result.truncated, true);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].moves, data.expected.proposal.moves);
});

test('generation uses copies and read-only clients rather than expected answers or booking writes', async () => {
  const data = fixture();
  data.expected = { candidates: [{ validationStatus: 'valid', moves: [] }] };
  const before = structuredClone(data);
  const clients = createFixtureClients({ fixture: data });
  const platform = await clients.platformClient.getScenarioSnapshot(data.scenarioId);
  const facilities = await clients.facilitiesClient.getRoomSnapshot();
  const originalSnapshots = structuredClone({ platform, facilities });
  let writes = 0;
  const result = await generateRoomSwaps(data.request, {
    platformClient: {
      async getScenarioSnapshot() { return platform; },
      async apply() { writes += 1; },
      async createTimetable() { writes += 1; },
    },
    facilitiesClient: { async getRoomSnapshot() { return facilities; } },
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].moves.length, 2);
  assert.equal(result.candidates[0].validationStatus, 'pending');
  assert.equal(result.expected, undefined);
  assert.equal(writes, 0);
  assert.deepEqual(data, before);
  assert.deepEqual({ platform, facilities }, originalSnapshots);
  result.candidates[0].moves[0].toRoomId = 'CALLER_CHANGE';
  assert.deepEqual({ platform, facilities }, originalSnapshots);
});

test('typed dependency errors are preserved while untyped failures and waits have explicit statuses', async () => {
  const data = fixture();
  const typed = createFixtureClients({ fixture: data });
  typed.platformClient.getScenarioSnapshot = async () => {
    throw new AllocationInputError(404, 'SCENARIO_NOT_FOUND', 'Scenario missing.');
  };
  await assert.rejects(generateRoomSwaps(data.request, typed), { status: 404, code: 'SCENARIO_NOT_FOUND' });
  const failed = createFixtureClients({ fixture: data });
  failed.facilitiesClient.getRoomSnapshot = async () => { throw new Error('Private connection details'); };
  await assert.rejects(generateRoomSwaps(data.request, failed), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.code, 'DEPENDENCY_UNAVAILABLE');
    assert.ok(!error.message.includes('Private connection details'));
    return true;
  });
  const waiting = createFixtureClients({ fixture: data });
  waiting.platformClient.getScenarioSnapshot = () => new Promise(() => {});
  await assert.rejects(generateRoomSwaps(data.request, waiting, { dependencyTimeoutMs: 20 }), {
    status: 504, code: 'DEPENDENCY_TIMEOUT',
  });
});

test('request and snapshot errors remain validation failures at the displacement boundary', async () => {
  const data = fixture();
  let reads = 0;
  await assert.rejects(generateRoomSwaps({ ...data.request, allowedMoveCount: -1 }, {
    platformClient: { async getScenarioSnapshot() { reads += 1; } },
    facilitiesClient: { async getRoomSnapshot() { reads += 1; } },
  }), { status: 422, code: 'INVALID_INPUT' });
  assert.equal(reads, 0);
  const clients = createFixtureClients({ fixture: data });
  const platform = await clients.platformClient.getScenarioSnapshot(data.scenarioId);
  delete platform.sessions[0].registeredStudents;
  clients.platformClient.getScenarioSnapshot = async () => platform;
  await assert.rejects(generateRoomSwaps(data.request, clients), { status: 422, code: 'INVALID_INPUT' });
});
