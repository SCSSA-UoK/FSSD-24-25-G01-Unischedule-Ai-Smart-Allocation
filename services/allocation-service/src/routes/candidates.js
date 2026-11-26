const express = require('express');
const { AllocationInputError, parseCandidateRequest } = require('../validation/allocation-input');
const { resolveFixtureClients } = require('../clients/scenario-fixture-clients');
const { generateDirectCandidates } = require('../services/generate-direct-candidates');
const { generateRoomSwaps } = require('../services/generate-room-swaps');
const { parseScoreRequest } = require('../validation/scoring-input');
const { scoreCandidates } = require('../services/score-candidates');
const { parseValidationRequest } = require('../validation/platform-validation');
const { validateCandidates } = require('../services/validate-candidates');

function createCandidateRouter({ clients, searchOptions, validationClient, validationOptions } = {}) {
  const router = express.Router();
  router.post('/allocation/candidates', async (request, response) => {
    if (!request.is('application/json')) {
      throw new AllocationInputError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send an application/json request body.');
    }
    const input = parseCandidateRequest(request.body);
    const selectedClients = clients === undefined ? resolveFixtureClients(input.scenarioId) : clients;
    response.json(await generateDirectCandidates(input, selectedClients, searchOptions));
  });
  router.post('/allocation/room-swaps', async (request, response) => {
    if (!request.is('application/json')) {
      throw new AllocationInputError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send an application/json request body.');
    }
    const input = parseCandidateRequest(request.body);
    const selectedClients = clients === undefined ? resolveFixtureClients(input.scenarioId) : clients;
    response.json(await generateRoomSwaps(input, selectedClients, searchOptions));
  });
  router.post('/allocation/score', async (request, response) => {
    if (!request.is('application/json')) {
      throw new AllocationInputError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send an application/json request body.');
    }
    const input = parseScoreRequest(request.body);
    const selectedClients = clients === undefined ? resolveFixtureClients(input.scenarioId) : clients;
    response.json(await scoreCandidates(input, selectedClients, searchOptions));
  });
  router.post('/allocation/validate', async (request, response) => {
    if (!request.is('application/json')) {
      throw new AllocationInputError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send an application/json request body.');
    }
    const input = parseValidationRequest(request.body);
    const selectedClients = clients === undefined ? resolveFixtureClients(input.scenarioId) : clients;
    response.json(await validateCandidates(input, selectedClients, validationClient, validationOptions));
  });
  return router;
}

module.exports = { createCandidateRouter };
