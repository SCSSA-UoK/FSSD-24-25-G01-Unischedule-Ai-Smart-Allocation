const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FIXTURE_NAMES,
  loadFixture,
  createFixtureClients,
} = require('../clients/fixture-clients');

test('the fixture allowlist provides four explicitly fictional scenarios', () => {
  assert.deepEqual([...FIXTURE_NAMES].sort(), [
    'direct-room', 'equipment-failure', 'no-solution', 'single-relocation',
  ]);
  for (const name of FIXTURE_NAMES) {
    const fixture = loadFixture(name);
    assert.equal(fixture.mode, 'fixture');
    assert.ok(fixture.rooms.length > 0);
    assert.ok(fixture.sessions.length > 0);
  }
});

test('fixture loading rejects unknown names and path traversal', () => {
  for (const name of ['missing', '../single-relocation', '../../.env', 'single-relocation.json']) {
    assert.throws(() => loadFixture(name), { status: 404, code: 'FIXTURE_NOT_FOUND' });
  }
});

test('fixture clients reject missing or unsupported fixture-format versions', () => {
  const source = loadFixture('single-relocation');
  for (const fixture of [null, [], { ...source, fixtureVersion: 2 }, { ...source, fixtureVersion: undefined }]) {
    assert.throws(() => createFixtureClients({ fixture }), { status: 422, code: 'INVALID_INPUT' });
  }
});

test('clients return projected snapshots without requests, expected answers or candidate validity', async () => {
  for (const name of FIXTURE_NAMES) {
    const fixture = loadFixture(name);
    const { platformClient, facilitiesClient } = createFixtureClients({ fixtureName: name });
    const platform = await platformClient.getScenarioSnapshot(fixture.scenarioId);
    const facilities = await facilitiesClient.getRoomSnapshot();
    assert.equal(platform.mode, 'fixture');
    assert.equal(platform.scenarioId, fixture.scenarioId);
    assert.equal(platform.scenarioRevision, fixture.scenarioRevision);
    assert.deepEqual(platform.sessions, fixture.sessions);
    assert.equal(facilities.mode, 'fixture');
    assert.equal(facilities.facilitiesVersion, fixture.facilitiesVersion);
    assert.deepEqual(facilities.rooms, fixture.rooms);
    for (const snapshot of [platform, facilities]) {
      assert.equal(snapshot.expected, undefined);
      assert.equal(snapshot.request, undefined);
      assert.equal(snapshot.candidates, undefined);
      assert.equal(snapshot.validationStatus, undefined);
    }
  }
});

test('client reads and fixture loads return fresh copies that do not change the source', async () => {
  const source = loadFixture('single-relocation');
  const before = structuredClone(source);
  const { platformClient, facilitiesClient } = createFixtureClients({ fixture: source });
  const firstPlatform = await platformClient.getScenarioSnapshot(source.scenarioId);
  const firstFacilities = await facilitiesClient.getRoomSnapshot();
  firstPlatform.sessions[0].registeredStudents = 1;
  firstPlatform.constraints.lecturerUnavailability.push({ lecturerId: 'modified' });
  firstFacilities.rooms[0].seats = 1;

  const nextPlatform = await platformClient.getScenarioSnapshot(source.scenarioId);
  const nextFacilities = await facilitiesClient.getRoomSnapshot();
  assert.deepEqual(nextPlatform.sessions, before.sessions);
  assert.deepEqual(nextPlatform.constraints, before.constraints);
  assert.deepEqual(nextFacilities.rooms, before.rooms);
  assert.deepEqual(source, before);

  const loaded = loadFixture('single-relocation');
  loaded.rooms[0].seats = 1;
  assert.deepEqual(loadFixture('single-relocation').rooms, before.rooms);
});

test('platform fixture clients reject a different scenario instead of returning unrelated data', async () => {
  const { platformClient } = createFixtureClients();
  await assert.rejects(platformClient.getScenarioSnapshot('scenario-missing'), {
    status: 404,
    code: 'SCENARIO_NOT_FOUND',
  });
});

test('malformed injected snapshots fail validation before being returned', async () => {
  const invalidPlatform = loadFixture('single-relocation');
  delete invalidPlatform.sessions[0].registeredStudents;
  await assert.rejects(async () => {
    const { platformClient } = createFixtureClients({ fixture: invalidPlatform });
    await platformClient.getScenarioSnapshot(invalidPlatform.scenarioId);
  }, { status: 422, code: 'INVALID_INPUT' });

  const invalidFacilities = loadFixture('single-relocation');
  invalidFacilities.rooms[0].seats = -1;
  await assert.rejects(async () => {
    const { facilitiesClient } = createFixtureClients({ fixture: invalidFacilities });
    await facilitiesClient.getRoomSnapshot();
  }, { status: 422, code: 'INVALID_INPUT' });
});
