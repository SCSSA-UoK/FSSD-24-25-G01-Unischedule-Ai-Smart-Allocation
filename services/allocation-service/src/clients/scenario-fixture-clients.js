const { AllocationInputError, parseId } = require('../validation/allocation-input');
const { FIXTURE_NAMES, loadFixture, createFixtureClients } = require('./fixture-clients');

function resolveFixtureClients(scenarioId) {
  parseId(scenarioId);
  try {
    for (const name of FIXTURE_NAMES) {
      const fixture = loadFixture(name);
      if (fixture.scenarioId === scenarioId) return createFixtureClients({ fixture });
    }
  } catch (error) {
    if (error instanceof AllocationInputError) throw error;
    throw new AllocationInputError(503, 'DEPENDENCY_UNAVAILABLE', 'Allocation fixture data could not be loaded.');
  }
  throw new AllocationInputError(404, 'SCENARIO_NOT_FOUND', 'Scenario is not present in the fixture catalog.');
}

module.exports = { resolveFixtureClients };
