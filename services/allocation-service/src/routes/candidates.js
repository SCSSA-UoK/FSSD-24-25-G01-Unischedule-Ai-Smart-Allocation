const express = require('express');
const { AllocationInputError, parseCandidateRequest } = require('../validation/allocation-input');
const { resolveFixtureClients } = require('../clients/scenario-fixture-clients');
const { generateDirectCandidates } = require('../services/generate-direct-candidates');
const { generateRoomSwaps } = require('../services/generate-room-swaps');
const { parseScoreRequest } = require('../validation/scoring-input');
const { scoreCandidates } = require('../services/score-candidates');
const { parseValidationRequest } = require('../validation/platform-validation');
const { validateCandidates } = require('../services/validate-candidates');
const { runOperation } = require('../services/run-operation');

function createCandidateRouter({ clients, searchOptions, validationClient, validationOptions, runStore } = {}) {
  const router = express.Router();
  const selectClients = (input) => clients === undefined ? resolveFixtureClients(input.scenarioId) : clients;
  async function respondWithRun(response, operation, input, execute) {
    const result = await runOperation({
      operation, request: input, runStore, traceId: response.locals.traceId,
      onRunId: (runId) => response.set('X-Allocation-Run-Id', runId),
    }, execute);
    if (runStore) response.location(`/allocation/results/${result.runId}`);
    response.json(result);
  }
  router.post('/allocation/candidates', async (request, response) => {
    if (!request.is('application/json')) {
      throw new AllocationInputError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send an application/json request body.');
    }
    const input = parseCandidateRequest(request.body);
    await respondWithRun(response, 'direct', input, () => generateDirectCandidates(input, selectClients(input), searchOptions));
  });
  router.post('/allocation/room-swaps', async (request, response) => {
    if (!request.is('application/json')) {
      throw new AllocationInputError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send an application/json request body.');
    }
    const input = parseCandidateRequest(request.body);
    await respondWithRun(response, 'single-displacement', input, () => generateRoomSwaps(input, selectClients(input), searchOptions));
  });
  router.post('/allocation/score', async (request, response) => {
    if (!request.is('application/json')) {
      throw new AllocationInputError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send an application/json request body.');
    }
    const input = parseScoreRequest(request.body);
    await respondWithRun(response, 'score', input, () => scoreCandidates(input, selectClients(input), searchOptions));
  });
  router.post('/allocation/validate', async (request, response) => {
    if (!request.is('application/json')) {
      throw new AllocationInputError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send an application/json request body.');
    }
    const input = parseValidationRequest(request.body);
    await respondWithRun(response, 'validate', input, () => validateCandidates(input, selectClients(input), validationClient, validationOptions));
  });
  return router;
}

module.exports = { createCandidateRouter };
