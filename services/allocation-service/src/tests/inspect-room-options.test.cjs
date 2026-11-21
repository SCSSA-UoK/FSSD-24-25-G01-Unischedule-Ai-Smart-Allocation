const test = require('node:test');
const assert = require('node:assert/strict');
const { FIXTURE_NAMES, loadFixture, createFixtureClients } = require('../clients/fixture-clients');
const { inspectRoomOptions } = require('../services/inspect-room-options');

function inspect(fixture) {
  return inspectRoomOptions(fixture.request, createFixtureClients({ fixture }));
}

function findRoom(result, roomId) {
  const room = result.roomChecks.find((item) => item.roomId === roomId);
  assert.ok(room, `Missing room check for ${roomId}`);
  return room;
}

function codes(room) {
  return room.reasons.map((reason) => reason.code);
}

test('room inspection matches each fixture while returning revision metadata and room checks only', async () => {
  for (const name of FIXTURE_NAMES) {
    const fixture = loadFixture(name);
    const result = await inspect(fixture);
    assert.equal(result.mode, 'fixture');
    assert.equal(result.validationStatus, 'pending');
    assert.equal(result.scope, 'room-checks-only');
    assert.equal(result.scenarioId, fixture.scenarioId);
    assert.equal(result.scenarioRevision, fixture.scenarioRevision);
    assert.equal(result.facilitiesVersion, fixture.facilitiesVersion);
    assert.equal(result.affectedSessionId, fixture.request.affectedSessionId);
    assert.deepEqual(result.eligibleRoomIds, [...fixture.expected.directRoomIds].sort());
    assert.deepEqual(result.roomChecks.map((room) => room.roomId),
      fixture.rooms.map((room) => room.roomId).sort());

    for (const room of result.roomChecks) {
      assert.equal(typeof room.suitable, 'boolean');
      assert.equal(typeof room.available, 'boolean');
      assert.equal(room.eligible, room.suitable && room.available);
      assert.ok(Array.isArray(room.missingFacilities));
      assert.ok(Array.isArray(room.blockingSessionIds));
      assert.ok(Array.isArray(room.activeRestrictionIds));
      assert.ok(Number.isInteger(room.effectiveUsableComputers));
      if (!room.eligible) assert.ok(room.reasons.length > 0, `Missing rejection reason for ${room.roomId}`);
      for (const reason of room.reasons) {
        assert.equal(typeof reason.code, 'string');
        assert.ok(typeof reason.message === 'string' && reason.message.length > 0);
      }
    }
    for (const field of ['moves', 'candidates', 'costs', 'costBreakdown', 'expected']) {
      assert.equal(result[field], undefined, `Room inspection must not expose ${field}`);
    }
  }
});

test('equipment checks reject too few working computers without treating the target as its own blocker', async () => {
  const result = await inspect(loadFixture('equipment-failure'));
  const affectedLaboratory = findRoom(result, 'LAB_A');
  assert.equal(affectedLaboratory.effectiveUsableComputers, 40);
  assert.equal(affectedLaboratory.suitable, false);
  assert.equal(affectedLaboratory.available, true);
  assert.equal(affectedLaboratory.eligible, false);
  assert.deepEqual(affectedLaboratory.blockingSessionIds, []);
  assert.ok(codes(affectedLaboratory).includes('INSUFFICIENT_COMPUTERS'));
  assert.ok(!codes(affectedLaboratory).includes('ROOM_OCCUPIED'));

  const backup = findRoom(result, 'LAB_BACKUP');
  assert.equal(backup.effectiveUsableComputers, 60);
  assert.equal(backup.eligible, true);
  assert.deepEqual(backup.reasons, []);
});

test('closure and occupied-room reasons distinguish physical restrictions from booking availability', async () => {
  const result = await inspect(loadFixture('no-solution'));
  const closedRoom = findRoom(result, 'ROOM_C');
  assert.equal(closedRoom.available, true);
  assert.equal(closedRoom.suitable, false);
  assert.ok(codes(closedRoom).includes('ROOM_CLOSED'));
  assert.ok(codes(closedRoom).includes('CAPACITY_EXCEEDED'));
  assert.deepEqual(closedRoom.activeRestrictionIds, ['restriction-room-c-001']);

  const occupiedHall = findRoom(result, 'HALL_A');
  assert.equal(occupiedHall.suitable, true);
  assert.equal(occupiedHall.available, false);
  assert.deepEqual(occupiedHall.blockingSessionIds, ['S001']);
  assert.ok(codes(occupiedHall).includes('ROOM_OCCUPIED'));
});

test('eligible rooms remain pending room-only checks even when lecturer and group conflicts exist', async () => {
  const fixture = loadFixture('direct-room');
  const target = fixture.sessions.find((session) => session.sessionId === fixture.request.affectedSessionId);
  target.lecturerId = 'L001';
  target.studentGroupId = 'G1';
  fixture.constraints.lecturerUnavailability = [{
    lecturerId: 'L001', startAt: target.startAt, endAt: target.endAt,
  }];
  fixture.constraints.studentGroupUnavailability = [{
    studentGroupId: 'G1', startAt: target.startAt, endAt: target.endAt,
  }];

  const result = await inspect(fixture);
  assert.deepEqual(result.eligibleRoomIds, ['HALL_A']);
  assert.equal(result.validationStatus, 'pending');
  assert.equal(result.scope, 'room-checks-only');
});

test('room, blocker and restriction ordering is stable without changing source data', async () => {
  const fixture = loadFixture('single-relocation');
  fixture.sessions.push({ ...fixture.sessions[0], sessionId: 'S008', lecturerId: 'L008', studentGroupId: 'G8' });
  fixture.restrictions = ['restriction-z', 'restriction-a'].map((restrictionId) => ({
    restrictionId,
    roomId: 'ROOM_C',
    kind: 'closure',
    startAt: fixture.sessions[0].startAt,
    endAt: fixture.sessions[0].endAt,
    unavailableFacilities: [],
    usableComputers: null,
    reason: 'Fictional closure',
  }));
  const before = structuredClone(fixture);
  const result = await inspect(fixture);
  const reordered = structuredClone(fixture);
  reordered.rooms.reverse();
  reordered.sessions.reverse();
  reordered.restrictions.reverse();

  assert.deepEqual(await inspect(reordered), result);
  assert.deepEqual(findRoom(result, 'HALL_A').blockingSessionIds, ['S001', 'S008']);
  assert.deepEqual(findRoom(result, 'ROOM_C').activeRestrictionIds, ['restriction-a', 'restriction-z']);
  assert.deepEqual(fixture, before);

  result.roomChecks[0].reasons.push({ code: 'MODIFIED', message: 'Caller change' });
  result.eligibleRoomIds.push('ROOM_FAKE');
  assert.deepEqual(await inspect(fixture), await inspect(before));
  assert.deepEqual(fixture, before);
});

test('room inspection retains existing revision and snapshot integrity checks', async () => {
  const fixture = loadFixture('single-relocation');
  const clients = createFixtureClients({ fixture });
  await assert.rejects(inspectRoomOptions({
    ...fixture.request, scenarioRevision: fixture.scenarioRevision - 1,
  }, clients), { status: 409, code: 'STALE_SCENARIO' });

  const platform = await clients.platformClient.getScenarioSnapshot(fixture.scenarioId);
  const duplicated = structuredClone(platform);
  duplicated.sessions.push(structuredClone(duplicated.sessions[0]));
  await assert.rejects(inspectRoomOptions(fixture.request, {
    ...clients, platformClient: { async getScenarioSnapshot() { return duplicated; } },
  }), { status: 422, code: 'INVALID_INPUT' });

  const unknownRoom = structuredClone(platform);
  unknownRoom.sessions[0].roomId = 'ROOM_MISSING';
  await assert.rejects(inspectRoomOptions(fixture.request, {
    ...clients, platformClient: { async getScenarioSnapshot() { return unknownRoom; } },
  }), { status: 422, code: 'INVALID_SNAPSHOT' });
});

test('dependency failures do not become an empty successful room search', async () => {
  const fixture = loadFixture('single-relocation');
  const clients = createFixtureClients({ fixture });
  const failure = new Error('Facilities unavailable');
  await assert.rejects(inspectRoomOptions(fixture.request, {
    ...clients,
    facilitiesClient: { async getRoomSnapshot() { throw failure; } },
  }), (error) => error === failure);
});
