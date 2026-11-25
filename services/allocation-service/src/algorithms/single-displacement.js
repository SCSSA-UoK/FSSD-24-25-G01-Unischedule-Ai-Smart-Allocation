const { AllocationInputError } = require('../validation/allocation-input');
const { evaluateRoomChecks } = require('./room-checks');
const { createCandidateId } = require('./candidate-id');

// Records are looked up from the prepared snapshot, not supplied as replacement room facts.
function buildSingleDisplacementCandidate(input, targetRoomId, displacedSessionId, destinationRoomId) {
  const { snapshot } = input;
  const target = snapshot.sessions.find((session) => session.sessionId === input.affectedSession.sessionId);
  const displaced = snapshot.sessions.find((session) => session.sessionId === displacedSessionId);
  const targetRoom = snapshot.rooms.find((room) => room.roomId === targetRoomId);
  const destination = snapshot.rooms.find((room) => room.roomId === destinationRoomId);
  if (!target || !displaced || !targetRoom || !destination) {
    throw new AllocationInputError(422, 'INVALID_SNAPSHOT', 'Move inputs reference an unknown session or room.');
  }
  if (input.request.allowedMoveCount < 1 || target.sessionId === displaced.sessionId
      || target.roomId === targetRoomId || displaced.roomId !== targetRoomId
      || destinationRoomId === targetRoomId) return null;

  const moves = [
    {
      sessionId: displaced.sessionId,
      fromRoomId: displaced.roomId,
      toRoomId: destinationRoomId,
      startAt: displaced.startAt,
      endAt: displaced.endAt,
    },
    {
      sessionId: target.sessionId,
      fromRoomId: target.roomId,
      toRoomId: targetRoomId,
      startAt: target.startAt,
      endAt: target.endAt,
    },
  ];

  // Remove both original assignments before inserting either final assignment.
  const movedIds = new Set(moves.map((move) => move.sessionId));
  const finalSessions = structuredClone(snapshot.sessions.filter((session) => !movedIds.has(session.sessionId)));
  const movedTarget = { ...structuredClone(target), roomId: targetRoomId };
  const movedDisplaced = { ...structuredClone(displaced), roomId: destinationRoomId };
  finalSessions.push(movedDisplaced, movedTarget);
  const context = { sessions: finalSessions, restrictions: snapshot.restrictions };
  if (!evaluateRoomChecks(targetRoom, movedTarget, context).eligible
      || !evaluateRoomChecks(destination, movedDisplaced, context).eligible) return null;

  return {
    candidateId: createCandidateId(input, moves),
    kind: target.roomId !== null && destinationRoomId === target.roomId ? 'swap' : 'relocation',
    validationStatus: 'pending',
    displacedExistingSessions: 1,
    moves,
    reasons: [
      `Move ${displaced.sessionId} to ${destinationRoomId} to free ${targetRoomId} for ${target.sessionId}.`,
      'Both moves pass local room checks against the copied final assignment at their original times; platform validation is pending.',
    ],
  };
}

module.exports = { buildSingleDisplacementCandidate };
