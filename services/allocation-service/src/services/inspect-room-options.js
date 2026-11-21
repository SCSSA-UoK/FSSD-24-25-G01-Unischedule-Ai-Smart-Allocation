const { prepareAllocationInput } = require('./prepare-allocation-input');
const { evaluateRoomChecks } = require('../algorithms/room-checks');

async function inspectRoomOptions(request, clients) {
  // Keep request, revision and cross-room reference validation at the input boundary.
  const input = await prepareAllocationInput(request, clients);
  const roomChecks = input.snapshot.rooms.map((room) => evaluateRoomChecks(room, input.affectedSession, {
    sessions: input.snapshot.sessions,
    restrictions: input.snapshot.restrictions,
  })).sort((first, second) => first.roomId < second.roomId ? -1 : 1);

  return {
    mode: input.mode,
    validationStatus: 'pending',
    scope: 'room-checks-only',
    scenarioId: input.snapshot.scenarioId,
    scenarioRevision: input.snapshot.scenarioRevision,
    facilitiesVersion: input.snapshot.facilitiesVersion,
    affectedSessionId: input.affectedSession.sessionId,
    eligibleRoomIds: roomChecks.filter((room) => room.eligible).map((room) => room.roomId),
    roomChecks,
  };
}

module.exports = { inspectRoomOptions };
