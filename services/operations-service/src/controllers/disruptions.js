const { validateDisruptionPayload } = require('../validation/disruption');
const { createDisruption, getDisruption, listDisruptions } = require('../services/disruptions');

async function handleCreateDisruption(request, response, next) {
  try {
    const validation = validateDisruptionPayload(request.body);
    if (!validation.valid) {
      const error = new Error('Invalid disruption report payload.');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }

    const idempotencyKey = request.header('idempotency-key') || null;
    const actorId = request.header('x-user-id') || 'demo-reporter';
    const traceId = response.locals.traceId;

    const result = await createDisruption(request.body, { idempotencyKey, actorId, traceId });
    return response.status(201).json(result);
  } catch (error) {
    return next(error);
  }
}

async function handleGetDisruption(request, response, next) {
  try {
    const { disruptionId } = request.params;
    const disruption = await getDisruption(disruptionId);
    return response.status(200).json(disruption);
  } catch (error) {
    return next(error);
  }
}

async function handleListDisruptions(request, response, next) {
  try {
    const { type, priority, scenarioId, status } = request.query;
    const items = await listDisruptions({ type, priority, scenarioId, status });
    return response.status(200).json({
      items,
      count: items.length
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  handleCreateDisruption,
  handleGetDisruption,
  handleListDisruptions
};
