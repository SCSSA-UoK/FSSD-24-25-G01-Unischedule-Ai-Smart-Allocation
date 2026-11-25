const express = require('express');
const { AllocationInputError, parseCandidateRequest } = require('../validation/allocation-input');
const { resolveFixtureClients } = require('../clients/scenario-fixture-clients');
const { generateDirectCandidates } = require('../services/generate-direct-candidates');
const { generateRoomSwaps } = require('../services/generate-room-swaps');

function createCandidateRouter({ clients, searchOptions } = {}) {
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
  return router;
}

module.exports = { createCandidateRouter };
