const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTimetableRow, normalizeFacilitiesRoom } = require('../clients/normalize-reference-data');
const { AllocationInputError } = require('../validation/allocation-input');

function timetableRow(overrides = {}) {
  return {
    session_id: 'S001', day: 'Monday', start_time: '09:00', end_time: '11:00',
    module_code: 'CS101', lecturer_code: 'L001', student_group: 'G1',
    registered_count: '40', room_code: 'HALL_A', session_type: 'Lecture',
    ...overrides,
  };
}

function requirements(overrides = {}) {
  return {
    date: '2026-11-16', requiredFacilities: ['projector'], requiredWorkingComputers: 0,
    ...overrides,
  };
}

test('a timetable row preserves IDs and enrollment while expanding its explicit date and requirements', () => {
  const row = timetableRow();
  const options = requirements();
  const before = structuredClone({ row, options });
  assert.deepEqual(normalizeTimetableRow(row, options), {
    sessionId: 'S001', lecturerId: 'L001', studentGroupId: 'G1', roomId: 'HALL_A',
    registeredStudents: 40, requiredFacilities: ['projector'], requiredWorkingComputers: 0,
    startAt: '2026-11-16T09:00:00+05:30', endAt: '2026-11-16T11:00:00+05:30',
  });
  assert.deepEqual({ row, options }, before);
});

test('only an explicitly empty source room becomes an unassigned room', () => {
  assert.equal(normalizeTimetableRow(timetableRow({ room_code: '' }), requirements()).roomId, null);
  for (const room_code of [undefined, ' ']) {
    assert.throws(() => normalizeTimetableRow(timetableRow({ room_code }), requirements()), AllocationInputError);
  }
});

test('mapping refuses to guess missing session requirements', () => {
  for (const field of ['requiredFacilities', 'requiredWorkingComputers']) {
    const options = requirements();
    delete options[field];
    assert.throws(() => normalizeTimetableRow(timetableRow(), options), AllocationInputError);
  }
});

test('mapping rejects missing or impossible dates and a date that does not match the source weekday', () => {
  for (const date of [undefined, '2026-02-30', '2026-11-16T00:00:00Z', '2026-11-17']) {
    assert.throws(() => normalizeTimetableRow(timetableRow(), requirements({ date })), AllocationInputError);
  }
});

test('source clock times must be valid and the resulting interval must run forwards', () => {
  for (const times of [
    { start_time: '9:00' }, { start_time: '24:00' }, { end_time: '11:60' },
    { end_time: '08:00' }, { end_time: '09:00' },
  ]) {
    assert.throws(() => normalizeTimetableRow(timetableRow(times), requirements()), AllocationInputError);
  }
});

test('enrollment must be explicit digits representing a positive bounded integer', () => {
  for (const registered_count of ['', '-1', '1.5', '40 students', '0', '100001', 40]) {
    assert.throws(() => normalizeTimetableRow(timetableRow({ registered_count }), requirements()), AllocationInputError);
  }
});

test('malformed or missing source identifiers are rejected without trimming them into valid IDs', () => {
  for (const changes of [{ session_id: '' }, { lecturer_code: undefined }, { student_group: 'G 1' }]) {
    assert.throws(() => normalizeTimetableRow(timetableRow(changes), requirements()), AllocationInputError);
  }
  assert.throws(() => normalizeTimetableRow(null, requirements()), AllocationInputError);
  assert.throws(() => normalizeTimetableRow(timetableRow(), null), AllocationInputError);
});

test('canonical non-computer room metadata maps without changing the source', () => {
  const room = {
    roomId: 'HALL_A', name: 'Main Hall A', seats: 80,
    features: ['projector', 'sound'], building: 'Main',
  };
  const before = structuredClone(room);
  assert.deepEqual(normalizeFacilitiesRoom(room), {
    roomId: 'HALL_A', seats: 80, features: ['projector', 'sound'], usableComputers: 0, building: 'Main',
  });
  assert.deepEqual(room, before);
});

test('laboratory metadata preserves an explicit working count and rejects missing computer facts', () => {
  const laboratory = {
    roomId: 'LAB_A', seats: 70, features: ['computers', 'projector'], usableComputers: 65, building: 'IT',
  };
  assert.equal(normalizeFacilitiesRoom(laboratory).usableComputers, 65);
  delete laboratory.usableComputers;
  assert.throws(() => normalizeFacilitiesRoom(laboratory), AllocationInputError);
});

test('room mapping rejects incomplete facts, invalid counts and duplicate feature entries', () => {
  const room = { roomId: 'ROOM_C', seats: 50, features: ['projector'], usableComputers: 0, building: 'Main' };
  for (const changes of [
    { seats: -1 }, { seats: '50' }, { usableComputers: -1 }, { features: undefined },
    { features: ['projector', 'projector'] }, { building: undefined },
  ]) {
    assert.throws(() => normalizeFacilitiesRoom({ ...room, ...changes }), AllocationInputError);
  }
  assert.throws(() => normalizeFacilitiesRoom(null), AllocationInputError);
});
