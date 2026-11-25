const fs = require('node:fs');
const path = require('node:path');
const {
  AllocationInputError, parsePlatformSnapshot, parseFacilitiesSnapshot,
} = require('../validation/allocation-input');

const FIXTURE_NAMES = Object.freeze([
  'single-relocation', 'single-swap', 'direct-room', 'equipment-failure', 'no-solution',
]);

function loadFixture(name) {
  if (!FIXTURE_NAMES.includes(name)) {
    throw new AllocationInputError(404, 'FIXTURE_NOT_FOUND', 'Unknown allocation fixture.');
  }
  const filename = path.resolve(__dirname, '../../fixtures', `${name}.json`);
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function createFixtureClients({ fixtureName = 'single-relocation', fixture } = {}) {
  const source = fixture === undefined ? loadFixture(fixtureName) : structuredClone(fixture);
  if (!source || typeof source !== 'object' || Array.isArray(source) || source.fixtureVersion !== 1) {
    throw new AllocationInputError(422, 'INVALID_INPUT', 'Unsupported allocation fixture format.', [
      { field: 'fixtureVersion', message: 'Use a fixture object with fixtureVersion 1.' },
    ]);
  }
  // Project only input data. Hand-written expectations are never client results.
  const platform = parsePlatformSnapshot({
    mode: source.mode,
    scenarioId: source.scenarioId,
    scenarioRevision: source.scenarioRevision,
    timezone: source.timezone,
    constraints: source.constraints,
    sessions: source.sessions,
  });
  const facilities = parseFacilitiesSnapshot({
    mode: source.mode,
    facilitiesVersion: source.facilitiesVersion,
    rooms: source.rooms,
    restrictions: source.restrictions,
  });

  return {
    platformClient: {
      async getScenarioSnapshot(scenarioId) {
        if (scenarioId !== platform.scenarioId) {
          throw new AllocationInputError(404, 'SCENARIO_NOT_FOUND', 'Scenario is not present in this fixture.');
        }
        return structuredClone(platform);
      },
    },
    facilitiesClient: {
      async getRoomSnapshot() {
        return structuredClone(facilities);
      },
    },
  };
}

module.exports = { FIXTURE_NAMES, loadFixture, createFixtureClients };
