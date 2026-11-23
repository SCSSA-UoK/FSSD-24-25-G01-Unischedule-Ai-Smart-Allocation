const { validatePriorityUpdate, validateCaseListQuery } = require('../validation/recovery-case');
const {
  listRecoveryCases,
  getRecoveryCaseDetails,
  updateCasePriority,
  syncCaseConstraints
} = require('../services/recovery-cases');

async function handleListRecoveryCases(request, response, next) {
  try {
    const validation = validateCaseListQuery(request.query);
    if (!validation.valid) {
      const error = new Error('Invalid recovery case filter parameters.');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }

    const result = await listRecoveryCases(validation.parsed);
    return response.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function handleGetRecoveryCase(request, response, next) {
  try {
    const { caseId } = request.params;
    const result = await getRecoveryCaseDetails(caseId);
    return response.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function handleUpdateCasePriority(request, response, next) {
  try {
    const validation = validatePriorityUpdate(request.body);
    if (!validation.valid) {
      const error = new Error('Invalid priority update payload.');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }

    const { caseId } = request.params;
    const actorId = request.header('x-user-id') || 'demo-operator';
    const traceId = response.locals.traceId;

    const updated = await updateCasePriority(caseId, {
      priority: request.body.priority,
      reason: request.body.reason,
      version: request.body.version,
      actorId,
      traceId
    });
    return response.status(200).json(updated);
  } catch (error) {
    return next(error);
  }
}

async function handleSyncCaseConstraints(request, response, next) {
  try {
    const { caseId } = request.params;
    const actorId = request.header('x-user-id') || 'demo-operator';
    const traceId = response.locals.traceId;

    const result = await syncCaseConstraints(caseId, { actorId, traceId });
    return response.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  handleListRecoveryCases,
  handleGetRecoveryCase,
  handleUpdateCasePriority,
  handleSyncCaseConstraints
};
