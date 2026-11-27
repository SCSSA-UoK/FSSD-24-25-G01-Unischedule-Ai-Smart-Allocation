const { AllocationInputError } = require('./allocation-input');

function parseRunId(value) {
  if (typeof value !== 'string'
      || !/^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new AllocationInputError(422, 'INVALID_INPUT', 'Use a generated allocation run ID.');
  }
  return value;
}

module.exports = { parseRunId };
