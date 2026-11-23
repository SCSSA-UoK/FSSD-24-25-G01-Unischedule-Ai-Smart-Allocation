const { VALID_PRIORITIES } = require('./disruption');

const VALID_STATUSES = [
  'reported',
  'investigating',
  'awaiting_approval',
  'approved',
  'applying',
  'applied',
  'rejected',
  'stale',
  'no_solution',
  'investigation_failed',
  'application_failed'
];

function validatePriorityUpdate(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object.'] };
  }

  if (!VALID_PRIORITIES.includes(body.priority)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')}.`);
  }

  if (typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.trim().length > 300) {
    errors.push('reason must be a string between 5 and 300 characters.');
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

function validateCaseListQuery(query = {}) {
  const errors = [];

  if (query.status && !VALID_STATUSES.includes(query.status)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}.`);
  }

  if (query.priority && !VALID_PRIORITIES.includes(query.priority)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')}.`);
  }

  let limit = 20;
  if (query.limit !== undefined) {
    const parsed = Number(query.limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      errors.push('limit must be an integer between 1 and 100.');
    } else {
      limit = parsed;
    }
  }

  let offset = 0;
  if (query.cursor !== undefined && query.cursor !== '') {
    const parsed = Number(query.cursor);
    if (!Number.isInteger(parsed) || parsed < 0) {
      errors.push('cursor must be a non-negative integer.');
    } else {
      offset = parsed;
    }
  }

  if (query.from && Number.isNaN(Date.parse(query.from))) {
    errors.push('from must be a valid ISO-8601 date string.');
  }

  if (query.to && Number.isNaN(Date.parse(query.to))) {
    errors.push('to must be a valid ISO-8601 date string.');
  }

  return {
    valid: errors.length === 0,
    errors,
    parsed: {
      status: query.status || undefined,
      priority: query.priority || undefined,
      scenarioId: query.scenarioId || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
      limit,
      offset
    }
  };
}

module.exports = {
  VALID_STATUSES,
  validatePriorityUpdate,
  validateCaseListQuery
};
