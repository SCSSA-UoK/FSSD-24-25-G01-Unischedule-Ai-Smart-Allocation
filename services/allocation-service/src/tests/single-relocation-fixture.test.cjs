const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixturePath = path.join(__dirname, '../../fixtures/single-relocation.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

// These helpers inspect the hand-written fixture, not a running optimizer.
function overlaps(first, second) {
  return Date.parse(first.startAt) < Date.parse(second.endAt)
    && Date.parse(second.startAt) < Date.parse(first.endAt);
}

function isSuitable(room, session) {
  return room.seats >= session.registeredStudents
    && room.usableComputers >= session.requiredWorkingComputers
    && session.requiredFacilities.every((facility) => room.features.includes(facility));
}

function replayExpectedMoves() {
  const sessions = structuredClone(fixture.sessions);
  const movedIds = new Set();

  for (const move of fixture.expected.proposal.moves) {
    assert.ok(!movedIds.has(move.sessionId), `Duplicate move for ${move.sessionId}`);
    movedIds.add(move.sessionId);
    const session = sessions.find((item) => item.sessionId === move.sessionId);
    assert.ok(session, `Unknown session ${move.sessionId}`);
    assert.ok(fixture.rooms.some((room) => room.roomId === move.toRoomId),
      `Unknown destination ${move.toRoomId}`);
    assert.equal(session.roomId, move.fromRoomId, `Incorrect source for ${move.sessionId}`);
    assert.equal(move.startAt, session.startAt);
    assert.equal(move.endAt, session.endAt);
    session.roomId = move.toRoomId;
  }

  return sessions;
}

test('fixture IDs and proposal references identify one pending scenario revision', () => {
  const roomIds = fixture.rooms.map((room) => room.roomId);
  const sessionIds = fixture.sessions.map((session) => session.sessionId);
  for (const id of [...roomIds, ...sessionIds]) {
    assert.equal(typeof id, 'string');
    assert.ok(id.trim().length > 0);
  }
  assert.equal(new Set(roomIds).size, roomIds.length, 'Room IDs must be unique');
  assert.equal(new Set(sessionIds).size, sessionIds.length, 'Session IDs must be unique');

  for (const session of fixture.sessions) {
    assert.ok(session.roomId === null || roomIds.includes(session.roomId),
      `Unknown room for ${session.sessionId}`);
    assert.equal(typeof session.lecturerId, 'string');
    assert.ok(session.lecturerId.trim().length > 0);
    assert.equal(typeof session.studentGroupId, 'string');
    assert.ok(session.studentGroupId.trim().length > 0);
  }

  assert.equal(fixture.mode, 'fixture');
  assert.ok(Number.isInteger(fixture.scenarioRevision) && fixture.scenarioRevision >= 0);
  assert.equal(fixture.request.scenarioId, fixture.scenarioId);
  assert.equal(fixture.request.scenarioRevision, fixture.scenarioRevision);
  assert.ok(sessionIds.includes(fixture.request.affectedSessionId));
  assert.equal(fixture.expected.proposal.scenarioId, fixture.scenarioId);
  assert.equal(fixture.expected.proposal.scenarioRevision, fixture.scenarioRevision);
  assert.equal(fixture.expected.proposal.validationStatus, 'pending');

  for (const move of fixture.expected.proposal.moves) {
    assert.ok(sessionIds.includes(move.sessionId), `Unknown moved session ${move.sessionId}`);
    assert.ok(move.fromRoomId === null || roomIds.includes(move.fromRoomId));
    assert.ok(roomIds.includes(move.toRoomId));
  }
});

test('counts and dated intervals are consistent with this unrestricted fixture', () => {
  assert.equal(fixture.timezone, 'Asia/Colombo');
  assert.equal(fixture.constraints.allowTimeChanges, false);
  assert.deepEqual(fixture.constraints.lecturerUnavailability, []);
  assert.deepEqual(fixture.constraints.studentGroupUnavailability, []);
  assert.deepEqual(fixture.restrictions, []);

  for (const room of fixture.rooms) {
    assert.ok(Number.isInteger(room.seats) && room.seats > 0);
    assert.ok(Number.isInteger(room.usableComputers) && room.usableComputers >= 0);
    assert.ok(Array.isArray(room.features));
  }

  const datedTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/;
  for (const session of fixture.sessions) {
    assert.ok(Number.isInteger(session.registeredStudents) && session.registeredStudents > 0);
    assert.ok(Number.isInteger(session.requiredWorkingComputers)
      && session.requiredWorkingComputers >= 0);
    assert.ok(Array.isArray(session.requiredFacilities));
    assert.match(session.startAt, datedTimestamp);
    assert.match(session.endAt, datedTimestamp);
    assert.ok(Number.isFinite(Date.parse(session.startAt)));
    assert.ok(Number.isFinite(Date.parse(session.endAt)));
    assert.ok(Date.parse(session.startAt) < Date.parse(session.endAt));
  }

  assert.ok(Number.isInteger(fixture.request.allowedMoveCount)
    && fixture.request.allowedMoveCount >= 0);
  assert.ok(Number.isInteger(fixture.request.limits.maxCandidates)
    && fixture.request.limits.maxCandidates > 0);
  assert.ok(Number.isInteger(fixture.request.limits.timeoutMs)
    && fixture.request.limits.timeoutMs > 0);
});

test('the target has no suitable empty room in the original snapshot', () => {
  const target = fixture.sessions.find(
    (session) => session.sessionId === fixture.request.affectedSessionId,
  );
  assert.ok(target);
  assert.equal(target.roomId, null);
  assert.equal(target.registeredStudents, 60);

  const suitableRooms = fixture.rooms.filter((room) => isSuitable(room, target));
  assert.deepEqual(suitableRooms.map((room) => room.roomId).sort(), ['HALL_A', 'LAB_A']);

  const emptyRooms = suitableRooms.filter((room) => !fixture.sessions.some(
    (session) => session.roomId === room.roomId && overlaps(session, target),
  ));
  assert.deepEqual(emptyRooms.map((room) => room.roomId), fixture.expected.directRoomIds);
  assert.deepEqual(fixture.expected.directRoomIds, []);

  const smallRoom = fixture.rooms.find((room) => room.roomId === 'ROOM_C');
  assert.ok(smallRoom);
  assert.equal(smallRoom.seats, 50);
  assert.ok(!isSuitable(smallRoom, target));
  assert.ok(!fixture.sessions.some(
    (session) => session.roomId === smallRoom.roomId && overlaps(session, target),
  ));
});

test('the expected proposal includes the target and one displaced session at unchanged times', () => {
  const moves = fixture.expected.proposal.moves;
  const movedIds = moves.map((move) => move.sessionId);
  assert.equal(new Set(movedIds).size, movedIds.length, 'Each session can move only once');
  assert.deepEqual([...movedIds].sort(), ['S001', 'S007']);
  assert.ok(movedIds.includes(fixture.request.affectedSessionId));

  const displacedMoves = moves.filter(
    (move) => move.sessionId !== fixture.request.affectedSessionId,
  );
  assert.equal(displacedMoves.length, fixture.expected.displacedExistingSessions);
  assert.equal(displacedMoves.length, 1);
  assert.ok(displacedMoves.length <= fixture.request.allowedMoveCount);

  for (const move of moves) {
    const original = fixture.sessions.find((session) => session.sessionId === move.sessionId);
    assert.ok(original, `Unknown moved session ${move.sessionId}`);
    assert.equal(move.fromRoomId, original.roomId);
    assert.notEqual(move.fromRoomId, move.toRoomId);
    assert.equal(move.startAt, original.startAt);
    assert.equal(move.endAt, original.endAt);
  }
  assert.deepEqual(moves.map((move) => [move.sessionId, move.toRoomId]), [
    ['S001', 'ROOM_C'],
    ['S007', 'HALL_A'],
  ]);
});

test('replaying the whole expected proposal satisfies the fixture room and overlap requirements', () => {
  const sessions = replayExpectedMoves();

  for (const session of sessions) {
    const room = fixture.rooms.find((item) => item.roomId === session.roomId);
    assert.ok(room, `No known final room for ${session.sessionId}`);
    assert.ok(isSuitable(room, session), `Unsuitable final room for ${session.sessionId}`);
  }

  for (let first = 0; first < sessions.length; first += 1) {
    for (let second = first + 1; second < sessions.length; second += 1) {
      const left = sessions[first];
      const right = sessions[second];
      if (overlaps(left, right)) {
        assert.notEqual(left.roomId, right.roomId, 'Overlapping room assignments');
        assert.notEqual(left.lecturerId, right.lecturerId, 'Overlapping lecturer assignments');
        assert.notEqual(left.studentGroupId, right.studentGroupId, 'Overlapping group assignments');
      }
    }
  }
});

test('replaying the expected proposal leaves the source snapshot and laboratory session unchanged', () => {
  const before = structuredClone(fixture);
  const replayed = replayExpectedMoves();
  const originalLaboratory = fixture.sessions.find((session) => session.sessionId === 'S002');
  const replayedLaboratory = replayed.find((session) => session.sessionId === 'S002');

  assert.deepEqual(fixture, before);
  assert.notStrictEqual(replayed, fixture.sessions);
  assert.ok(originalLaboratory, 'The unchanged laboratory session must exist');
  assert.equal(originalLaboratory.roomId, 'LAB_A');
  assert.deepEqual(replayedLaboratory, originalLaboratory);
  assert.equal(fixture.sessions.find((session) => session.sessionId === 'S001').roomId, 'HALL_A');
  assert.equal(fixture.sessions.find((session) => session.sessionId === 'S007').roomId, null);
});
