const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFixture, createFixtureClients } = require('../clients/fixture-clients');
const { AllocationInputError } = require('../validation/allocation-input');
const { generateDirectCandidates } = require('../services/generate-direct-candidates');

function generate(fixture, options) {
  return generateDirectCandidates(fixture.request, createFixtureClients({ fixture }), options);
}

function addRoom(fixture, roomId) {
  fixture.rooms.push({
    roomId, seats: 80, features: ['projector'], usableComputers: 0, building: 'Main',
  });
}

function clockSequence(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

test('the four fixtures produce pending direct-only results without inventing relocations', async () => {
  const expectedRooms = {
    'direct-room': ['HALL_A'],
    'single-relocation': [],
    'equipment-failure': ['LAB_BACKUP'],
    'no-solution': [],
  };
  for (const [name, rooms] of Object.entries(expectedRooms)) {
    const fixture = loadFixture(name);
    const result = await generate(fixture);
    assert.equal(result.mode, 'fixture');
    assert.equal(result.scope, 'direct-only');
    assert.equal(result.validationStatus, 'pending');
    assert.equal(result.scenarioId, fixture.scenarioId);
    assert.equal(result.scenarioRevision, fixture.scenarioRevision);
    assert.equal(result.facilitiesVersion, fixture.facilitiesVersion);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.candidates.map((candidate) => candidate.moves[0].toRoomId), rooms);
    assert.match(result.runId, /^run-[0-9a-f-]{36}$/);
    assert.ok(result.reasons.every((reason) => typeof reason === 'string' && reason.length > 0));
    if (rooms.length === 0) assert.ok(result.reasons.some((reason) => /no eligible empty destination/i.test(reason)));
    assert.equal(result.expected, undefined);
    assert.equal(result.costBreakdown, undefined);
  }
});

test('each candidate contains exactly the original target move and zero displaced sessions', async () => {
  for (const name of ['direct-room', 'equipment-failure']) {
    const fixture = loadFixture(name);
    const target = fixture.sessions.find((session) => session.sessionId === fixture.request.affectedSessionId);
    const result = await generate(fixture);
    for (const candidate of result.candidates) {
      assert.match(candidate.candidateId, /^candidate-[0-9a-f]{24}$/);
      assert.equal(candidate.validationStatus, 'pending');
      assert.equal(candidate.displacedExistingSessions, 0);
      assert.deepEqual(candidate.moves, [{
        sessionId: target.sessionId,
        fromRoomId: target.roomId,
        toRoomId: candidate.moves[0].toRoomId,
        startAt: target.startAt,
        endAt: target.endAt,
      }]);
      assert.ok(candidate.reasons.length > 0);
      assert.ok(candidate.reasons.every((reason) => typeof reason === 'string' && reason.trim().length > 0));
      assert.equal(candidate.cost, undefined);
      assert.equal(candidate.costBreakdown, undefined);
    }
  }
});

test('the target current room is excluded from candidates and processed-room reports', async () => {
  const fixture = loadFixture('single-relocation');
  fixture.request.affectedSessionId = 'S001';
  const result = await generate(fixture);
  assert.deepEqual(result.candidates.map((candidate) => candidate.moves[0].toRoomId), ['ROOM_C']);
  assert.ok(result.roomChecks.every((room) => room.roomId !== 'HALL_A'));
  assert.equal(result.candidates[0].moves[0].fromRoomId, 'HALL_A');
});

test('a move allowance and wider search window do not enable swaps or time changes', async () => {
  const fixture = loadFixture('single-relocation');
  fixture.request.allowedMoveCount = 3;
  fixture.request.searchWindow = {
    startAt: '2026-11-16T08:00:00+05:30',
    endAt: '2026-11-16T15:00:00+05:30',
  };
  const result = await generate(fixture);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.truncated, false);
  assert.ok(result.reasons.some((reason) => /only direct room changes.*original session time/i.test(reason)));
  assert.ok(result.roomChecks.some((room) => room.blockingSessionIds.includes('S001')));
});

test('candidate IDs and destination order are deterministic while run IDs identify distinct requests', async () => {
  const fixture = loadFixture('direct-room');
  addRoom(fixture, 'ROOM_EXTRA_B');
  addRoom(fixture, 'ROOM_EXTRA_A');
  addRoom(fixture, 'Z'.repeat(100));
  const first = await generate(fixture);
  const reordered = structuredClone(fixture);
  reordered.rooms.reverse();
  reordered.sessions.reverse();
  reordered.restrictions.reverse();
  const second = await generate(reordered);
  assert.notEqual(first.runId, second.runId);
  assert.deepEqual(first.candidates, second.candidates);
  assert.deepEqual(first.roomChecks, second.roomChecks);
  assert.deepEqual(first.candidates.map((candidate) => candidate.moves[0].toRoomId), [
    'HALL_A', 'ROOM_EXTRA_A', 'ROOM_EXTRA_B', 'Z'.repeat(100),
  ]);
  assert.ok(first.candidates.every((candidate) => /^candidate-[0-9a-f]{24}$/.test(candidate.candidateId)));
});

test('candidate identity changes with relevant revision, facilities and move data', async () => {
  const fixture = loadFixture('direct-room');
  const original = (await generate(fixture)).candidates[0].candidateId;
  const variants = [];
  const revised = structuredClone(fixture);
  revised.scenarioRevision += 1;
  revised.request.scenarioRevision = revised.scenarioRevision;
  variants.push(revised);
  const newFacilities = structuredClone(fixture);
  newFacilities.facilitiesVersion = 'fixture-v2';
  variants.push(newFacilities);
  const assigned = structuredClone(fixture);
  assigned.sessions.find((session) => session.sessionId === 'S007').roomId = 'ROOM_C';
  variants.push(assigned);
  const differentTime = structuredClone(fixture);
  differentTime.sessions.find((session) => session.sessionId === 'S007').endAt = '2026-11-16T12:00:00+05:30';
  variants.push(differentTime);
  for (const variant of variants) {
    const candidate = (await generate(variant)).candidates.find((item) => item.moves[0].toRoomId === 'HALL_A');
    assert.ok(candidate);
    assert.notEqual(candidate.candidateId, original);
  }
});

test('finding exactly the candidate limit does not claim truncation when all rooms were checked', async () => {
  const fixture = loadFixture('direct-room');
  fixture.request.limits.maxCandidates = 1;
  const result = await generate(fixture);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.roomChecks.length, fixture.rooms.length);
  assert.equal(result.truncated, false);
  assert.ok(!result.reasons.some((reason) => /candidate limit/i.test(reason)));
});

test('an additional eligible room proves candidate-limit truncation without exceeding the limit', async () => {
  const fixture = loadFixture('direct-room');
  fixture.request.limits.maxCandidates = 1;
  addRoom(fixture, 'ROOM_EXTRA');
  const result = await generate(fixture);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].moves[0].toRoomId, 'HALL_A');
  assert.equal(result.roomChecks.filter((room) => room.eligible).length, 2);
  assert.equal(result.truncated, true);
  assert.ok(result.reasons.some((reason) => /candidate limit/i.test(reason)));
  assert.ok(!result.reasons.some((reason) => /no eligible empty destination/i.test(reason)));
});

test('expiration before the first room returns an explicitly incomplete search', async () => {
  const fixture = loadFixture('direct-room');
  fixture.request.limits.timeoutMs = 10;
  const result = await generate(fixture, { clock: clockSequence(0, 10) });
  assert.equal(result.truncated, true);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.roomChecks, []);
  assert.ok(result.reasons.some((reason) => /search time limit/i.test(reason)));
  assert.ok(!result.reasons.some((reason) => /no eligible empty destination/i.test(reason)));
});

test('expiration after one room retains that candidate and reports the unexamined remainder', async () => {
  const fixture = loadFixture('direct-room');
  fixture.request.limits.timeoutMs = 10;
  const result = await generate(fixture, { clock: clockSequence(0, 0, 10) });
  assert.equal(result.truncated, true);
  assert.deepEqual(result.roomChecks.map((room) => room.roomId), ['HALL_A']);
  assert.deepEqual(result.candidates.map((candidate) => candidate.moves[0].toRoomId), ['HALL_A']);
  assert.ok(result.reasons.some((reason) => /search time limit/i.test(reason)));
});

test('generation reads each dependency once and preserves the request and snapshot objects', async () => {
  const fixture = loadFixture('direct-room');
  const source = structuredClone(fixture);
  const clients = createFixtureClients({ fixture });
  const platform = await clients.platformClient.getScenarioSnapshot(fixture.scenarioId);
  const facilities = await clients.facilitiesClient.getRoomSnapshot();
  const originalSnapshots = structuredClone({ platform, facilities });
  const reads = [];
  let writes = 0;
  const result = await generateDirectCandidates(fixture.request, {
    platformClient: {
      async getScenarioSnapshot() { reads.push('platform'); return platform; },
      async apply() { writes += 1; },
      async createTimetable() { writes += 1; },
    },
    facilitiesClient: {
      async getRoomSnapshot() { reads.push('facilities'); return facilities; },
    },
  });
  assert.deepEqual(reads.sort(), ['facilities', 'platform']);
  assert.equal(writes, 0);
  assert.deepEqual(fixture, source);
  assert.deepEqual({ platform, facilities }, originalSnapshots);
  result.candidates[0].moves[0].toRoomId = 'CALLER_CHANGE';
  assert.deepEqual({ platform, facilities }, originalSnapshots);
});

test('hand-written fixture expectations cannot replace computed room choices', async () => {
  const fixture = loadFixture('direct-room');
  fixture.expected = { directRoomIds: ['ROOM_FAKE'], candidates: [{ validationStatus: 'valid' }] };
  const result = await generate(fixture);
  assert.deepEqual(result.candidates.map((candidate) => candidate.moves[0].toRoomId), ['HALL_A']);
  assert.equal(result.validationStatus, 'pending');
  assert.equal(result.expected, undefined);
});

test('untyped dependency failures become sanitized 503 errors for either read client', async () => {
  const fixture = loadFixture('direct-room');
  for (const dependency of ['platform', 'facilities']) {
    const clients = createFixtureClients({ fixture });
    const failure = new Error('Private connection credentials must not appear');
    if (dependency === 'platform') {
      clients.platformClient.getScenarioSnapshot = async () => { throw failure; };
    } else {
      clients.facilitiesClient.getRoomSnapshot = async () => { throw failure; };
    }
    await assert.rejects(generateDirectCandidates(fixture.request, clients), (error) => {
      assert.ok(error instanceof AllocationInputError);
      assert.equal(error.status, 503);
      assert.equal(error.code, 'DEPENDENCY_UNAVAILABLE');
      assert.ok(!error.message.includes('Private connection credentials'));
      return true;
    });
  }
});

test('typed dependency errors preserve their domain status and code', async () => {
  const fixture = loadFixture('direct-room');
  const clients = createFixtureClients({ fixture });
  clients.platformClient.getScenarioSnapshot = async () => {
    throw new AllocationInputError(404, 'SCENARIO_NOT_FOUND', 'Scenario is unavailable.');
  };
  await assert.rejects(generateDirectCandidates(fixture.request, clients), {
    status: 404, code: 'SCENARIO_NOT_FOUND',
  });
});

test('a dependency that never settles fails with a bounded 504 error', async () => {
  const fixture = loadFixture('direct-room');
  const clients = createFixtureClients({ fixture });
  clients.platformClient.getScenarioSnapshot = () => new Promise(() => {});
  await assert.rejects(generateDirectCandidates(fixture.request, clients, { dependencyTimeoutMs: 20 }), {
    status: 504, code: 'DEPENDENCY_TIMEOUT',
  });
});

test('request and returned-snapshot validation errors remain 422 instead of dependency failures', async () => {
  const fixture = loadFixture('direct-room');
  let reads = 0;
  await assert.rejects(generateDirectCandidates({ ...fixture.request, allowedMoveCount: -1 }, {
    platformClient: { async getScenarioSnapshot() { reads += 1; } },
    facilitiesClient: { async getRoomSnapshot() { reads += 1; } },
  }), { status: 422, code: 'INVALID_INPUT' });
  assert.equal(reads, 0);

  const clients = createFixtureClients({ fixture });
  const platform = await clients.platformClient.getScenarioSnapshot(fixture.scenarioId);
  delete platform.sessions[0].registeredStudents;
  clients.platformClient.getScenarioSnapshot = async () => platform;
  await assert.rejects(generateDirectCandidates(fixture.request, clients), {
    status: 422, code: 'INVALID_INPUT',
  });
});

test('unknown scenarios, missing targets and stale revisions retain existing input-boundary errors', async () => {
  const fixture = loadFixture('direct-room');
  const cases = [
    [{ scenarioId: 'scenario-missing' }, 404, 'SCENARIO_NOT_FOUND'],
    [{ affectedSessionId: 'S999' }, 404, 'SESSION_NOT_FOUND'],
    [{ scenarioRevision: fixture.scenarioRevision - 1 }, 409, 'STALE_SCENARIO'],
  ];
  for (const [patch, status, code] of cases) {
    await assert.rejects(generateDirectCandidates({ ...fixture.request, ...patch },
      createFixtureClients({ fixture })), { status, code });
  }
});
