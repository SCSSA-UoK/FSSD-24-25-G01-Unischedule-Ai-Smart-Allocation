const { parseInterval } = require('../validation/allocation-input');

function intervalsOverlap(first, second) {
  const left = parseInterval({ startAt: first?.startAt, endAt: first?.endAt });
  const right = parseInterval({ startAt: second?.startAt, endAt: second?.endAt });
  // Half-open intervals: a session may start exactly when another one ends.
  return Date.parse(left.startAt) < Date.parse(right.endAt)
    && Date.parse(right.startAt) < Date.parse(left.endAt);
}

module.exports = { intervalsOverlap };
