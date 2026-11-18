const VALID_TYPES = [
  'lecturer_unavailable',
  'lecture_postponement',
  'room_maintenance',
  'emergency_incident'
];

const VALID_PRIORITIES = ['low', 'normal', 'high', 'critical'];

function validateDisruptionPayload(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object.'] };
  }

  if (!VALID_TYPES.includes(body.type)) {
    errors.push(`Type must be one of: ${VALID_TYPES.join(', ')}.`);
  }

  if (typeof body.scenarioId !== 'string' || body.scenarioId.trim() === '') {
    errors.push('scenarioId is required.');
  }

  if (typeof body.scenarioRevision !== 'number' || !Number.isInteger(body.scenarioRevision) || body.scenarioRevision < 0) {
    errors.push('scenarioRevision must be a non-negative integer.');
  }

  if (!Array.isArray(body.affectedSessionIds) || body.affectedSessionIds.length === 0) {
    errors.push('affectedSessionIds must be a non-empty array of strings.');
  } else if (!body.affectedSessionIds.every((id) => typeof id === 'string' && id.trim() !== '')) {
    errors.push('All affectedSessionIds must be non-empty strings.');
  }

  if (body.type === 'lecturer_unavailable') {
    if (typeof body.lecturerId !== 'string' || body.lecturerId.trim() === '') {
      errors.push('lecturerId is required for lecturer_unavailable.');
    }
  }

  if (body.type === 'room_maintenance') {
    if (typeof body.roomId !== 'string' || body.roomId.trim() === '') {
      errors.push('roomId is required for room_maintenance.');
    }
  }

  const start = Date.parse(body.startAt);
  const end = Date.parse(body.endAt);

  if (Number.isNaN(start)) {
    errors.push('startAt must be a valid ISO-8601 date string.');
  }
  if (Number.isNaN(end)) {
    errors.push('endAt must be a valid ISO-8601 date string.');
  }
  if (!Number.isNaN(start) && !Number.isNaN(end) && start >= end) {
    errors.push('startAt must be strictly before endAt.');
  }

  if (body.priority !== undefined && !VALID_PRIORITIES.includes(body.priority)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')}.`);
  }

  if (typeof body.description !== 'string' || body.description.trim().length < 5 || body.description.trim().length > 500) {
    errors.push('description must be a string between 5 and 500 characters.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = { validateDisruptionPayload, VALID_TYPES, VALID_PRIORITIES };
