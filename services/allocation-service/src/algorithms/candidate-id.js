const { createHash } = require('node:crypto');

function createCandidateId(input, moves) {
  const orderedMoves = [...moves].sort((first, second) => (
    first.sessionId < second.sessionId ? -1 : first.sessionId > second.sessionId ? 1 : 0
  ));
  const identity = [
    input.snapshot.scenarioId, input.snapshot.scenarioRevision, input.snapshot.facilitiesVersion,
    ...orderedMoves.flatMap((move) => [
      move.sessionId, move.fromRoomId, move.toRoomId, move.startAt, move.endAt,
    ]),
  ];
  const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24);
  return `candidate-${digest}`;
}

module.exports = { createCandidateId };
