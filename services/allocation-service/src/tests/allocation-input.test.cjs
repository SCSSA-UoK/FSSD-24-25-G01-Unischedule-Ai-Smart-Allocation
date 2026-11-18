const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../fixtures/single-relocation.json');
const {
  AllocationInputError,
  parseCandidateRequest,
  parseSession,
  parseRoom,
  parsePlatformSnapshot,
  parseFacilitiesSnapshot,
} = require('../validation/allocation-input');

function request() {
  return {
    scenarioId: fixture.scenarioId,
    scenarioRevision: fixture.scenarioRevision,
    affectedSessionId: 'S007',
    allowedMoveCount: 1,
  };
}

function invalidInput(action) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof AllocationInputError);
    assert.equal(error.status, 422);
    assert.equal(error.code, 'INVALID_INPUT');
    assert.ok(Array.isArray(error.details) && error.details.length > 0);
    for (const detail of error.details) {
      assert.equal(typeof detail.field, 'string');
      assert.equal(typeof detail.message, 'string');
      assert.ok(detail.message.length > 0);
    }
    return true;
  });
}

function platformSnapshot() {
  return structuredClone({
    mode: fixture.mode,
    scenarioId: fixture.scenarioId,
    scenarioRevision: fixture.scenarioRevision,
    timezone: fixture.timezone,
    constraints: fixture.constraints,
    sessions: fixture.sessions,
  });
}

function facilitiesSnapshot() {
  return structuredClone({
    mode: fixture.mode,
    facilitiesVersion: fixture.facilitiesVersion,
    rooms: fixture.rooms,
    restrictions: fixture.restrictions,
  });
}

function closure() {
  return {
    restrictionId: 'restriction-001',
    roomId: 'HALL_A',
    kind: 'closure',
    startAt: '2026-11-16T09:00:00+05:30',
    endAt: '2026-11-16T11:00:00+05:30',
    unavailableFacilities: [],
    usableComputers: null,
    reason: 'Fictional maintenance closure',
  };
}

test('candidate requests receive explicit defaults without changing the supplied object', () => {
  const raw = request();
  const before = structuredClone(raw);
  assert.deepEqual(parseCandidateRequest(raw), {
    ...raw,
    preferences: { minimizeChanges: true },
    limits: { maxCandidates: 10, timeoutMs: 2000 },
  });
  assert.deepEqual(raw, before);
  assert.equal(parseCandidateRequest({
    ...raw, preferences: { minimizeChanges: false },
  }).preferences.minimizeChanges, false);
});

test('candidate requests reject unknown fields, missing values and unnormalized identifiers', async (t) => {
  const cases = [
    ['missing target', { ...request(), affectedSessionId: undefined }],
    ['missing move count', { ...request(), allowedMoveCount: undefined }],
    ['unexpected field', { ...request(), roomId: 'HALL_A' }],
    ['blank ID', { ...request(), scenarioId: '' }],
    ['whitespace', { ...request(), scenarioId: ' scenario-001' }],
    ['path syntax', { ...request(), scenarioId: '../scenario' }],
    ['invalid first character', { ...request(), affectedSessionId: '_S007' }],
    ['overlong ID', { ...request(), scenarioId: 'a'.repeat(101) }],
    ['coerced revision', { ...request(), scenarioRevision: '3' }],
    ['unknown nested preference', { ...request(), preferences: { fakeSuccess: true } }],
  ];
  for (const [name, value] of cases) {
    await t.test(name, () => invalidInput(() => parseCandidateRequest(value)));
  }
});

test('request numeric bounds reject unsafe revisions and excessive search budgets', async (t) => {
  const valid = parseCandidateRequest({
    ...request(),
    scenarioRevision: 0,
    allowedMoveCount: 3,
    limits: { maxCandidates: 50, timeoutMs: 10000 },
  });
  assert.equal(valid.scenarioRevision, 0);
  assert.equal(valid.allowedMoveCount, 3);
  assert.equal(parseCandidateRequest({ ...request(), allowedMoveCount: 0 }).allowedMoveCount, 0);

  const cases = [
    ['negative revision', { scenarioRevision: -1 }],
    ['unsafe revision', { scenarioRevision: Number.MAX_SAFE_INTEGER + 1 }],
    ['fractional move count', { allowedMoveCount: 1.5 }],
    ['negative move count', { allowedMoveCount: -1 }],
    ['too many moves', { allowedMoveCount: 4 }],
    ['no candidates', { limits: { maxCandidates: 0, timeoutMs: 2000 } }],
    ['too many candidates', { limits: { maxCandidates: 51, timeoutMs: 2000 } }],
    ['zero timeout', { limits: { maxCandidates: 10, timeoutMs: 0 } }],
    ['excessive timeout', { limits: { maxCandidates: 10, timeoutMs: 10001 } }],
  ];
  for (const [name, patch] of cases) {
    await t.test(name, () => invalidInput(() => parseCandidateRequest({ ...request(), ...patch })));
  }
});

test('search windows require real offset-bearing dates, increasing times and at most seven days', async (t) => {
  const startAt = '2026-11-16T09:00:00+05:30';
  const validWindow = { startAt, endAt: '2026-11-23T09:00:00+05:30' };
  assert.deepEqual(parseCandidateRequest({ ...request(), searchWindow: validWindow }).searchWindow,
    validWindow);

  const windows = [
    { startAt, endAt: startAt },
    { startAt, endAt: '2026-11-16T08:00:00+05:30' },
    { startAt, endAt: '2026-11-23T09:00:01+05:30' },
    { startAt: '2026-02-30T09:00:00+05:30', endAt: '2026-11-16T11:00:00+05:30' },
    { startAt: '2026-11-16T09:00:00', endAt: '2026-11-16T11:00:00+05:30' },
  ];
  for (const [index, searchWindow] of windows.entries()) {
    await t.test(`invalid window ${index + 1}`, () => {
      invalidInput(() => parseCandidateRequest({ ...request(), searchWindow }));
    });
  }
});

test('canonical sessions and rooms preserve enrollment, null assignments and working-computer counts', () => {
  assert.deepEqual(parseSession(fixture.sessions[2]), fixture.sessions[2]);
  assert.deepEqual(parseRoom(fixture.rooms[0]), fixture.rooms[0]);
  assert.equal(parseSession(fixture.sessions[2]).roomId, null);
  assert.equal(parseRoom(fixture.rooms[2]).usableComputers, 65);
  assert.equal(parseSession(fixture.sessions[1]).requiredWorkingComputers, 50);
});

test('session and room validation rejects missing enrollment, invalid counts and invalid intervals', async (t) => {
  const badSessions = [
    { ...fixture.sessions[0], registeredStudents: undefined },
    { ...fixture.sessions[0], registeredStudents: -1 },
    { ...fixture.sessions[0], registeredStudents: 0 },
    { ...fixture.sessions[0], registeredStudents: '40' },
    { ...fixture.sessions[0], requiredWorkingComputers: -1 },
    { ...fixture.sessions[0], startAt: '2026-02-30T09:00:00+05:30' },
    { ...fixture.sessions[0], startAt: '2026-11-16T12:00:00+05:30' },
    { ...fixture.sessions[0], endAt: '11:00' },
  ];
  for (const [index, session] of badSessions.entries()) {
    await t.test(`invalid session ${index + 1}`, () => invalidInput(() => parseSession(session)));
  }
  for (const room of [
    { ...fixture.rooms[0], seats: 0 },
    { ...fixture.rooms[0], seats: 100001 },
    { ...fixture.rooms[0], usableComputers: -1 },
    { ...fixture.rooms[0], seats: 40.5 },
  ]) {
    invalidInput(() => parseRoom(room));
  }
});

test('snapshots reject duplicate session, room and restriction IDs', () => {
  const platform = platformSnapshot();
  platform.sessions.push(structuredClone(platform.sessions[0]));
  invalidInput(() => parsePlatformSnapshot(platform));

  const facilities = facilitiesSnapshot();
  facilities.rooms.push(structuredClone(facilities.rooms[0]));
  invalidInput(() => parseFacilitiesSnapshot(facilities));

  const repeatedRestrictions = facilitiesSnapshot();
  repeatedRestrictions.restrictions = [closure(), closure()];
  invalidInput(() => parseFacilitiesSnapshot(repeatedRestrictions));
});

test('snapshots validate timed unavailability and restrictions instead of silently accepting them', () => {
  const platform = platformSnapshot();
  platform.constraints.lecturerUnavailability = [{
    lecturerId: 'L001',
    startAt: '2026-11-16T11:00:00+05:30',
    endAt: '2026-11-16T09:00:00+05:30',
  }];
  invalidInput(() => parsePlatformSnapshot(platform));

  const facilities = facilitiesSnapshot();
  facilities.restrictions = [{ ...closure(), startAt: '2026-11-16T12:00:00+05:30' }];
  invalidInput(() => parseFacilitiesSnapshot(facilities));
});
