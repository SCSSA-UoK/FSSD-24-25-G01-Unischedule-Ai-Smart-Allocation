const test = require('node:test');
const assert = require('node:assert/strict');
const { intervalsOverlap } = require('../algorithms/interval-overlap');
const { AllocationInputError } = require('../validation/allocation-input');

function interval(start, end, date = '2026-11-16') {
  return { startAt: `${date}T${start}:00+05:30`, endAt: `${date}T${end}:00+05:30` };
}

test('half-open intervals detect intersections and allow both touching boundaries', () => {
  const target = interval('09:00', '11:00');
  const cases = [
    ['identical', '09:00', '11:00', true],
    ['overlap at the start', '08:30', '09:30', true],
    ['overlap at the end', '10:30', '11:30', true],
    ['fully contained', '09:30', '10:00', true],
    ['fully enclosing', '08:00', '12:00', true],
    ['touching before', '08:00', '09:00', false],
    ['touching after', '11:00', '12:00', false],
    ['separated before', '07:00', '08:00', false],
    ['separated after', '12:00', '13:00', false],
  ];
  for (const [label, start, end, expected] of cases) {
    const other = interval(start, end);
    assert.equal(intervalsOverlap(target, other), expected, label);
    assert.equal(intervalsOverlap(other, target), expected, `${label}, reversed arguments`);
  }
});

test('overlap compares actual instants across explicit offsets rather than local clock text', () => {
  const target = interval('09:00', '11:00');
  for (const equivalent of [
    { startAt: '2026-11-16T03:30:00Z', endAt: '2026-11-16T05:30:00Z' },
    { startAt: '2026-11-15T23:30:00-04:00', endAt: '2026-11-16T01:30:00-04:00' },
    { startAt: '2026-11-16T09:15:00+05:45', endAt: '2026-11-16T11:15:00+05:45' },
  ]) {
    assert.equal(intervalsOverlap(target, equivalent), true);
  }
  assert.equal(intervalsOverlap(target, {
    startAt: '2026-11-16T05:30:00Z', endAt: '2026-11-16T06:30:00Z',
  }), false);
});

test('interval checks accept full records, preserve them and distinguish different dates', () => {
  const session = { sessionId: 'S001', roomId: 'HALL_A', ...interval('09:00', '11:00') };
  const restriction = { restrictionId: 'closure-1', kind: 'closure', ...interval('10:00', '12:00') };
  const before = structuredClone({ session, restriction });
  assert.equal(intervalsOverlap(session, restriction), true);
  assert.equal(intervalsOverlap(session, interval('09:00', '11:00', '2026-11-17')), false);
  assert.deepEqual({ session, restriction }, before);
});

test('invalid, unzoned, impossible or non-forward intervals raise a controlled input error', () => {
  const valid = interval('09:00', '11:00');
  const invalid = [
    null,
    [],
    {},
    { startAt: valid.startAt },
    { startAt: '2026-11-16T09:00:00', endAt: '2026-11-16T11:00:00' },
    { startAt: '2026-11-16T09:00:00.001+05:30', endAt: valid.endAt },
    { startAt: '2026-02-30T09:00:00+05:30', endAt: '2026-03-01T11:00:00+05:30' },
    { startAt: '2025-02-29T09:00:00+05:30', endAt: '2025-03-01T11:00:00+05:30' },
    { startAt: '2026-11-16T25:00:00+05:30', endAt: valid.endAt },
    { startAt: valid.startAt, endAt: valid.startAt },
    { startAt: valid.endAt, endAt: valid.startAt },
  ];
  for (const value of invalid) {
    for (const args of [[value, valid], [valid, value]]) {
      assert.throws(() => intervalsOverlap(...args), (error) => (
        error instanceof AllocationInputError && error.status === 422 && error.code === 'INVALID_INPUT'
      ));
    }
  }
});
