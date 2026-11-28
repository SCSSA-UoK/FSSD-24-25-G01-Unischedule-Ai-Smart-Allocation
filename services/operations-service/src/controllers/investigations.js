const { validateStartInvestigationPayload } = require('../validation/investigation');
const { startCaseInvestigation, getCaseRecommendations } = require('../services/investigations');

async function handleStartInvestigation(request, response, next) {
  try {
    const validation = validateStartInvestigationPayload(request.body);
    if (!validation.valid) {
      const error = new Error('Invalid investigation dispatch payload.');
      error.status = 400;
      error.code = 'VALIDATION_ERROR';
      error.details = validation.errors;
      throw error;
    }

    const { caseId } = request.params;
    const actorId = request.header('x-user-id') || 'demo-operator';
    const traceId = response.locals.traceId;

    const result = await startCaseInvestigation(caseId, {
      scenarioRevision: request.body?.scenarioRevision,
      version: request.body?.version,
      actorId,
      traceId
    });
    return response.status(202).json(result);
  } catch (error) {
    return next(error);
  }
}

async function handleGetRecommendations(request, response, next) {
  try {
    const { caseId } = request.params;
    const actorId = request.header('x-user-id') || 'demo-operator';
    const traceId = response.locals.traceId;

    const result = await getCaseRecommendations(caseId, { actorId, traceId });
    return response.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  handleStartInvestigation,
  handleGetRecommendations
};
