function validateStartInvestigationPayload(body) {
  const errors = [];

  if (body === undefined || body === null) {
    return { valid: true, errors: [] };
  }

  if (typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object.'] };
  }

  if (body.scenarioRevision !== undefined) {
    if (
      typeof body.scenarioRevision !== 'number' ||
      !Number.isInteger(body.scenarioRevision) ||
      body.scenarioRevision < 0
    ) {
      errors.push('scenarioRevision must be a non-negative integer.');
    }
  }

  if (body.version !== undefined) {
    if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 1) {
      errors.push('version must be a positive integer.');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = { validateStartInvestigationPayload };
