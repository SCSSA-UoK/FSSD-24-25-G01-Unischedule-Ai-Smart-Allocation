const { AllocationInputError, parseCandidateRequest } = require('../validation/allocation-input');
const { prepareAllocationInput } = require('./prepare-allocation-input');

async function readDependency(read) {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AllocationInputError) throw error;
    throw new AllocationInputError(503, 'DEPENDENCY_UNAVAILABLE', 'Schedule or facilities data is unavailable.');
  }
}

async function prepareCandidateInput(rawRequest, clients, dependencyTimeoutMs = 5000) {
  const request = parseCandidateRequest(rawRequest);
  if (!Number.isInteger(dependencyTimeoutMs) || dependencyTimeoutMs < 1) {
    throw new RangeError('dependencyTimeoutMs must be a positive integer.');
  }
  let timer;
  const guardedClients = {
    platformClient: {
      getScenarioSnapshot: (scenarioId) => readDependency(() => clients.platformClient.getScenarioSnapshot(scenarioId)),
    },
    facilitiesClient: {
      getRoomSnapshot: () => readDependency(() => clients.facilitiesClient.getRoomSnapshot()),
    },
  };
  try {
    return await Promise.race([
      prepareAllocationInput(request, guardedClients),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new AllocationInputError(
          504, 'DEPENDENCY_TIMEOUT', 'Schedule or facilities data did not arrive within the time limit.',
        )), dependencyTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { prepareCandidateInput };
