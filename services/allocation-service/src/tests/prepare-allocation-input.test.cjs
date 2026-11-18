const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFixture, createFixtureClients } = require('../clients/fixture-clients');
const { prepareAllocationInput } = require('../services/prepare-allocation-input');

function request(fixture) {
  return {
    scenarioId: fixture.scenarioId,
    scenarioRevision: fixture.scenarioRevision,
    affectedSessionId: fixture.request.affectedSessionId,
    allowedMoveCount: 1,
  };
}

test('input preparation combines validated fixture snapshots and stays pending without candidates', async () => {
  const fixture = loadFixture('single-relocation');
  const result = await prepareAllocationInput(request(fixture), createFixtureClients({ fixture }));
  assert.equal(result.mode, 'fixture');
  assert.equal(result.validationStatus, 'pending');
  assert.deepEqual(result.request.preferences, { minimizeChanges: true });
  assert.deepEqual(result.request.limits, { maxCandidates: 10, timeoutMs: 2000 });
  assert.equal(result.snapshot.scenarioId, fixture.scenarioId);
  assert.equal(result.snapshot.scenarioRevision, fixture.scenarioRevision);
  assert.equal(result.snapshot.facilitiesVersion, fixture.facilitiesVersion);
  assert.equal(result.snapshot.timezone, fixture.timezone);
  assert.deepEqual(result.snapshot.sessions, fixture.sessions);
  assert.deepEqual(result.snapshot.rooms, fixture.rooms);
  assert.deepEqual(result.snapshot.constraints, fixture.constraints);
  assert.deepEqual(result.snapshot.restrictions, fixture.restrictions);
  assert.deepEqual(result.affectedSession,
    fixture.sessions.find((session) => session.sessionId === fixture.request.affectedSessionId));
  assert.equal(result.candidates, undefined);
  assert.equal(result.expected, undefined);
  assert.equal(result.snapshot.expected, undefined);
  assert.equal(result.snapshot.request, undefined);
});

test('invalid requests are rejected before either dependency is called', async () => {
  let calls = 0;
  const clients = {
    platformClient: { async getScenarioSnapshot() { calls += 1; } },
    facilitiesClient: { async getRoomSnapshot() { calls += 1; } },
  };
  await assert.rejects(prepareAllocationInput({ scenarioId: '../invalid' }, clients), {
    status: 422,
    code: 'INVALID_INPUT',
  });
  assert.equal(calls, 0);
});

test('scenario mismatches and stale revisions are explicit errors', async () => {
  const fixture = loadFixture('single-relocation');
  const clients = createFixtureClients({ fixture });
  const snapshot = await clients.platformClient.getScenarioSnapshot(fixture.scenarioId);
  await assert.rejects(prepareAllocationInput(request(fixture), {
    ...clients,
    platformClient: { async getScenarioSnapshot() {
      return { ...snapshot, scenarioId: 'scenario-other' };
    } },
  }), { status: 404, code: 'SCENARIO_NOT_FOUND' });

  await assert.rejects(prepareAllocationInput({
    ...request(fixture), scenarioRevision: fixture.scenarioRevision - 1,
  }, clients), { status: 409, code: 'STALE_SCENARIO' });
});

test('a missing affected session is reported instead of choosing a different session', async () => {
  const fixture = loadFixture('single-relocation');
  await assert.rejects(prepareAllocationInput({
    ...request(fixture), affectedSessionId: 'S999',
  }, createFixtureClients({ fixture })), { status: 404, code: 'SESSION_NOT_FOUND' });
});

test('unknown assigned rooms and restriction rooms fail snapshot integrity checks', async () => {
  const unknownAssignment = loadFixture('single-relocation');
  unknownAssignment.sessions[0].roomId = 'ROOM_MISSING';
  await assert.rejects(prepareAllocationInput(request(unknownAssignment),
    createFixtureClients({ fixture: unknownAssignment })), {
    status: 422, code: 'INVALID_SNAPSHOT',
  });

  const unknownRestriction = loadFixture('single-relocation');
  unknownRestriction.restrictions = [{
    restrictionId: 'restriction-unknown-room',
    roomId: 'ROOM_MISSING',
    kind: 'closure',
    startAt: '2026-11-16T09:00:00+05:30',
    endAt: '2026-11-16T11:00:00+05:30',
    unavailableFacilities: [],
    usableComputers: null,
    reason: 'Fictional maintenance closure',
  }];
  await assert.rejects(prepareAllocationInput(request(unknownRestriction),
    createFixtureClients({ fixture: unknownRestriction })), {
    status: 422, code: 'INVALID_SNAPSHOT',
  });
});

test('a search window may match the target boundaries but must contain its whole interval', async () => {
  const fixture = loadFixture('single-relocation');
  const clients = createFixtureClients({ fixture });
  const target = fixture.sessions.find((session) => session.sessionId === fixture.request.affectedSessionId);
  const searchWindow = { startAt: target.startAt, endAt: target.endAt };
  const result = await prepareAllocationInput({ ...request(fixture), searchWindow }, clients);
  assert.deepEqual(result.request.searchWindow, searchWindow);

  for (const window of [
    { startAt: '2026-11-16T09:00:01+05:30', endAt: target.endAt },
    { startAt: target.startAt, endAt: '2026-11-16T10:59:59+05:30' },
  ]) {
    await assert.rejects(prepareAllocationInput({ ...request(fixture), searchWindow: window }, clients), {
      status: 422, code: 'INVALID_REQUIREMENTS',
    });
  }
});

test('returned data can be changed without altering request, source snapshots or subsequent reads', async () => {
  const fixture = loadFixture('single-relocation');
  const originalFixture = structuredClone(fixture);
  const rawRequest = request(fixture);
  const originalRequest = structuredClone(rawRequest);
  const clients = createFixtureClients({ fixture });
  const result = await prepareAllocationInput(rawRequest, clients);
  result.snapshot.rooms[0].seats = 1;
  result.snapshot.sessions[0].registeredStudents = 1;
  result.affectedSession.registeredStudents = 1;
  result.request.preferences.minimizeChanges = false;

  assert.deepEqual(fixture, originalFixture);
  assert.deepEqual(rawRequest, originalRequest);
  const next = await prepareAllocationInput(rawRequest, clients);
  assert.deepEqual(next.snapshot.rooms, originalFixture.rooms);
  assert.deepEqual(next.snapshot.sessions, originalFixture.sessions);
  assert.equal(next.affectedSession.registeredStudents, 60);
  assert.equal(next.request.preferences.minimizeChanges, true);
});

test('dependency failures propagate rather than producing fallback data or successful validation', async () => {
  const fixture = loadFixture('single-relocation');
  const clients = createFixtureClients({ fixture });
  const failure = new Error('Fixture dependency unavailable');
  await assert.rejects(prepareAllocationInput(request(fixture), {
    ...clients,
    facilitiesClient: { async getRoomSnapshot() { throw failure; } },
  }), (error) => error === failure);
});
