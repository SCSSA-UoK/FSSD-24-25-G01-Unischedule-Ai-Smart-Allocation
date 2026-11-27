const express = require('express');
const { AllocationInputError } = require('../validation/allocation-input');
const { parseRunId } = require('../validation/run-id');
const { storageUnavailable } = require('../models/mongo-run-store');

function createResultRouter({ runStore } = {}) {
  const router = express.Router();
  router.get('/allocation/results/:runId', async (request, response) => {
    const runId = parseRunId(request.params.runId);
    if (!runStore) throw storageUnavailable();
    let record;
    try { record = await runStore.findById(runId); } catch { throw storageUnavailable(); }
    if (!record) throw new AllocationInputError(404, 'RUN_NOT_FOUND', 'Allocation run was not found.');
    response.set('Cache-Control', 'no-store').json(record);
  });
  return router;
}

module.exports = { createResultRouter };
