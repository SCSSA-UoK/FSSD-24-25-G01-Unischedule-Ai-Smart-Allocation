const test = require('node:test');
const assert = require('node:assert/strict');
const { checkRoomSuitability, findRoomConflicts, evaluateRoomChecks } = require('../algorithms/room-checks');
const { AllocationInputError } = require('../validation/allocation-input');
const { loadFixture } = require('../clients/fixture-clients');

const startAt = '2026-11-16T09:00:00+05:30';
const endAt = '2026-11-16T11:00:00+05:30';

function room(overrides = {}) {
  return {
    roomId: 'LAB_A', seats: 70, features: ['computers', 'projector', 'sound'],
    usableComputers: 65, building: 'IT', ...overrides,
  };
}

function session(overrides = {}) {
  return {
    sessionId: 'S_TARGET', lecturerId: 'L_TARGET', studentGroupId: 'G_TARGET', roomId: null,
    registeredStudents: 50, requiredFacilities: ['projector', 'computers'],
    requiredWorkingComputers: 50, startAt, endAt, ...overrides,
  };
}

function restriction(overrides = {}) {
  return {
    restrictionId: 'outage-1', roomId: 'LAB_A', kind: 'equipment-outage', startAt, endAt,
    unavailableFacilities: [], usableComputers: 40, reason: 'Fictional equipment fault.',
    ...overrides,
  };
}

function closure(overrides = {}) {
  return restriction({ kind: 'closure', usableComputers: null, ...overrides });
}

function reasonCodes(result) {
  return result.reasons.map((reason) => reason.code);
}

test('a room meeting exact capacity and computer requirements returns clear physical results', () => {
  const result = checkRoomSuitability(room({ seats: 50, usableComputers: 50 }), session());
  assert.deepEqual(result, {
    roomId: 'LAB_A', suitable: true, effectiveUsableComputers: 50,
    missingFacilities: [], activeRestrictionIds: [], reasons: [],
  });
  assert.equal(result.validationStatus, undefined);
});

test('capacity and usable computers are independent limits with exact boundaries', () => {
  for (const [changes, expected] of [
    [{ seats: 49, usableComputers: 50 }, ['CAPACITY_EXCEEDED']],
    [{ seats: 50, usableComputers: 49 }, ['INSUFFICIENT_COMPUTERS']],
    [{ seats: 70, usableComputers: 40 }, ['INSUFFICIENT_COMPUTERS']],
    [{ seats: 49, usableComputers: 40 }, ['CAPACITY_EXCEEDED', 'INSUFFICIENT_COMPUTERS']],
  ]) {
    const result = checkRoomSuitability(room(changes), session());
    assert.equal(result.suitable, false);
    assert.deepEqual(reasonCodes(result).sort(), expected.sort());
  }
});

test('each missing required facility has one reason and the missing list is sorted', () => {
  const result = checkRoomSuitability(room({ features: [], usableComputers: 0 }), session({
    requiredFacilities: ['whiteboard', 'sound', 'projector'], requiredWorkingComputers: 0,
  }));
  assert.equal(result.suitable, false);
  assert.deepEqual(result.missingFacilities, ['projector', 'sound', 'whiteboard']);
  assert.equal(reasonCodes(result).filter((code) => code === 'MISSING_FACILITY').length, 3);
  for (const reason of result.reasons) {
    assert.equal(typeof reason.message, 'string');
    assert.ok(reason.message.trim());
  }
});

test('an overlapping projector fault blocks its required use while an unused facility fault does not', () => {
  const fault = restriction({
    startAt: '2026-11-16T10:00:00+05:30', unavailableFacilities: ['projector'], usableComputers: null,
  });
  const blocked = checkRoomSuitability(room(), session(), [fault]);
  assert.equal(blocked.suitable, false);
  assert.deepEqual(blocked.missingFacilities, ['projector']);
  assert.deepEqual(reasonCodes(blocked), ['MISSING_FACILITY']);

  const unaffected = checkRoomSuitability(room(), session({ requiredFacilities: ['computers'] }), [fault]);
  assert.equal(unaffected.suitable, true);
  assert.deepEqual(unaffected.activeRestrictionIds, ['outage-1']);
});

test('working-computer caps use the minimum and never increase counts or subtract a fault twice', () => {
  const cases = [
    [65, [restriction({ usableComputers: 50 }), restriction({ restrictionId: 'outage-2', usableComputers: 40 })], 40],
    [40, [restriction({ usableComputers: 40 })], 40],
    [65, [restriction({ usableComputers: 100 })], 65],
    [65, [restriction({ usableComputers: 0 })], 0],
    [65, [restriction({ unavailableFacilities: ['sound'], usableComputers: null })], 65],
  ];
  for (const [baseline, restrictions, expected] of cases) {
    const result = checkRoomSuitability(room({ usableComputers: baseline }), session(), restrictions);
    assert.equal(result.effectiveUsableComputers, expected);
    assert.equal(reasonCodes(result).includes('INSUFFICIENT_COMPUTERS'), expected < 50);
  }
});

test('a computers outage forces zero working computers even when only a count is required', () => {
  const result = checkRoomSuitability(room(), session({ requiredFacilities: [] }), [restriction({
    unavailableFacilities: ['computers'], usableComputers: 65,
  })]);
  assert.equal(result.effectiveUsableComputers, 0);
  assert.equal(result.suitable, false);
  assert.deepEqual(result.missingFacilities, []);
  assert.deepEqual(reasonCodes(result), ['INSUFFICIENT_COMPUTERS']);
});

test('any overlapping closure blocks the full session and active restriction IDs are sorted', () => {
  const result = checkRoomSuitability(room(), session(), [
    closure({ restrictionId: 'closure-z', startAt: '2026-11-16T10:59:59+05:30' }),
    closure({ restrictionId: 'closure-a', endAt: '2026-11-16T09:00:01+05:30' }),
  ]);
  assert.equal(result.suitable, false);
  assert.deepEqual(result.activeRestrictionIds, ['closure-a', 'closure-z']);
  assert.equal(reasonCodes(result).filter((code) => code === 'ROOM_CLOSED').length, 2);
});

test('touching restrictions, a different room and another date do not affect suitability', () => {
  const result = checkRoomSuitability(room(), session(), [
    closure({ restrictionId: 'before', startAt: '2026-11-16T08:00:00+05:30', endAt: startAt }),
    restriction({ restrictionId: 'after', startAt: endAt, endAt: '2026-11-16T12:00:00+05:30', usableComputers: 0 }),
    closure({ restrictionId: 'other-room', roomId: 'ROOM_C' }),
    restriction({ restrictionId: 'tomorrow', startAt: '2026-11-17T09:00:00+05:30', endAt: '2026-11-17T11:00:00+05:30', usableComputers: 0 }),
  ]);
  assert.equal(result.suitable, true);
  assert.equal(result.effectiveUsableComputers, 65);
  assert.deepEqual(result.activeRestrictionIds, []);
});

test('conflicts include every overlapping occupant and exclude only the target session itself', () => {
  const target = session({ roomId: 'LAB_A' });
  const bookings = [
    session({ sessionId: 'S_Z', roomId: 'LAB_A' }),
    session({ sessionId: 'S_A', roomId: 'LAB_A', startAt: '2026-11-16T10:59:59+05:30', endAt: '2026-11-16T12:00:00+05:30' }),
    target,
    session({ sessionId: 'S_BEFORE', roomId: 'LAB_A', startAt: '2026-11-16T08:00:00+05:30', endAt: startAt }),
    session({ sessionId: 'S_AFTER', roomId: 'LAB_A', startAt: endAt, endAt: '2026-11-16T12:00:00+05:30' }),
    session({ sessionId: 'S_OTHER_ROOM', roomId: 'ROOM_C' }),
    session({ sessionId: 'S_UNASSIGNED' }),
  ];
  assert.deepEqual(findRoomConflicts('LAB_A', target, bookings), ['S_A', 'S_Z']);
});

test('checking a different destination does not require the target to be assigned there already', () => {
  const target = session({ roomId: 'ROOM_C' });
  assert.deepEqual(findRoomConflicts('LAB_A', target, [
    target,
    session({ sessionId: 'S_BLOCKER', roomId: 'LAB_A' }),
  ]), ['S_BLOCKER']);
  assert.deepEqual(findRoomConflicts('LAB_A', target), []);
});

test('physical suitability remains separate from occupancy and aggregate eligibility', () => {
  const target = session();
  const blocker = session({ sessionId: 'S_BLOCKER', roomId: 'LAB_A' });
  const physical = checkRoomSuitability(room(), target);
  const occupied = evaluateRoomChecks(room(), target, { sessions: [blocker] });
  assert.equal(physical.suitable, true);
  assert.equal(occupied.suitable, true);
  assert.equal(occupied.available, false);
  assert.equal(occupied.eligible, false);
  assert.deepEqual(occupied.blockingSessionIds, ['S_BLOCKER']);
  assert.deepEqual(reasonCodes(occupied), ['ROOM_OCCUPIED']);
  assert.equal(occupied.validationStatus, undefined);

  const unsuitable = evaluateRoomChecks(room({ seats: 49 }), target);
  assert.equal(unsuitable.suitable, false);
  assert.equal(unsuitable.available, true);
  assert.equal(unsuitable.eligible, false);
  assert.deepEqual(unsuitable.blockingSessionIds, []);
  assert.equal(evaluateRoomChecks(room(), target).eligible, true);
});

test('aggregate checks accumulate capacity, equipment, closure and occupancy reasons', () => {
  const result = evaluateRoomChecks(room({ seats: 49, features: [], usableComputers: 0 }), session(), {
    sessions: [session({ sessionId: 'S_BLOCKER', roomId: 'LAB_A' })],
    restrictions: [closure()],
  });
  assert.equal(result.eligible, false);
  assert.deepEqual(result.missingFacilities, ['computers', 'projector']);
  assert.deepEqual(reasonCodes(result).sort(), [
    'CAPACITY_EXCEEDED', 'INSUFFICIENT_COMPUTERS', 'MISSING_FACILITY',
    'MISSING_FACILITY', 'ROOM_CLOSED', 'ROOM_OCCUPIED',
  ].sort());
});

test('checks preserve caller objects and return stable results when arrays are reordered', () => {
  const source = {
    room: room(), session: session(),
    sessions: [session({ sessionId: 'S_Z', roomId: 'LAB_A' }), session({ sessionId: 'S_A', roomId: 'LAB_A' })],
    restrictions: [restriction({ restrictionId: 'outage-z' }), closure({ restrictionId: 'closure-a' })],
  };
  const before = structuredClone(source);
  const first = evaluateRoomChecks(source.room, source.session, source);
  const second = evaluateRoomChecks(source.room, source.session, {
    sessions: [...source.sessions].reverse(), restrictions: [...source.restrictions].reverse(),
  });
  assert.deepEqual(source, before);
  assert.deepEqual(first, second);
});

test('duplicate booking IDs are rejected even if their room would otherwise be irrelevant', () => {
  const booking = session({ sessionId: 'S_DUPLICATE', roomId: 'ROOM_C' });
  assert.throws(() => findRoomConflicts('LAB_A', session(), [booking, structuredClone(booking)]), {
    status: 422, code: 'INVALID_INPUT',
  });
});

test('invalid records and collection arguments produce controlled input errors', () => {
  const actions = [
    () => checkRoomSuitability(room({ seats: -1 }), session()),
    () => checkRoomSuitability(room(), session({ registeredStudents: 0 })),
    () => checkRoomSuitability(room(), session(), null),
    () => checkRoomSuitability(room(), session(), [restriction({ usableComputers: -1 })]),
    () => checkRoomSuitability(room(), session(), [closure({ endAt: startAt })]),
    () => findRoomConflicts('bad room id', session(), []),
    () => findRoomConflicts('LAB_A', session(), null),
    () => findRoomConflicts('LAB_A', session(), [session({ startAt: '2026-02-30T09:00:00+05:30' })]),
    () => evaluateRoomChecks(room(), session(), { sessions: {} }),
    () => evaluateRoomChecks(room(), session(), { restrictions: {} }),
  ];
  for (const action of actions) {
    assert.throws(action, (error) => (
      error instanceof AllocationInputError && error.status === 422 && error.code === 'INVALID_INPUT'
    ));
  }
});

test('existing outage and closure fixtures produce physical reasons without generating candidates', () => {
  const equipment = loadFixture('equipment-failure');
  const target = equipment.sessions.find((item) => item.sessionId === equipment.request.affectedSessionId);
  const damagedRoom = equipment.rooms.find((item) => item.roomId === 'LAB_A');
  const backupRoom = equipment.rooms.find((item) => item.roomId === 'LAB_BACKUP');
  const damaged = evaluateRoomChecks(damagedRoom, target, equipment);
  assert.equal(damaged.effectiveUsableComputers, 40);
  assert.equal(damaged.available, true);
  assert.equal(damaged.eligible, false);
  assert.ok(reasonCodes(damaged).includes('INSUFFICIENT_COMPUTERS'));
  assert.equal(evaluateRoomChecks(backupRoom, target, equipment).eligible, true);

  const blocked = loadFixture('no-solution');
  const smallClass = blocked.sessions.find((item) => item.sessionId === 'S001');
  const classroom = blocked.rooms.find((item) => item.roomId === 'ROOM_C');
  const closed = evaluateRoomChecks(classroom, smallClass, blocked);
  assert.equal(closed.suitable, false);
  assert.ok(reasonCodes(closed).includes('ROOM_CLOSED'));
  assert.equal(closed.candidates, undefined);
});
