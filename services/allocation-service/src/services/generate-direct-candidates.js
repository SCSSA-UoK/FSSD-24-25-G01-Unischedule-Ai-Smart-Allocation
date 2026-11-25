const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { prepareCandidateInput } = require('./prepare-candidate-input');
const { createCandidateId } = require('../algorithms/candidate-id');
const { evaluateRoomChecks } = require('../algorithms/room-checks');

function makeCandidate(input, room) {
  const session = input.affectedSession;
  const move = {
    sessionId: session.sessionId,
    fromRoomId: session.roomId,
    toRoomId: room.roomId,
    startAt: session.startAt,
    endAt: session.endAt,
  };
  return {
    candidateId: createCandidateId(input, [move]),
    validationStatus: 'pending',
    displacedExistingSessions: 0,
    moves: [move],
    reasons: [
      `Room ${room.roomId} has ${room.seats} seats for ${session.registeredStudents} students and passes local equipment, restriction and occupancy checks.`,
      'No other session is displaced; platform validation is pending.',
    ],
  };
}

async function generateDirectCandidates(rawRequest, clients, {
  clock = () => performance.now(), dependencyTimeoutMs = 5000,
} = {}) {
  const input = await prepareCandidateInput(rawRequest, clients, dependencyTimeoutMs);
  const request = input.request;
  const startedAt = clock();
  const rooms = input.snapshot.rooms
    .filter((room) => room.roomId !== input.affectedSession.roomId)
    .sort((first, second) => first.roomId < second.roomId ? -1 : first.roomId > second.roomId ? 1 : 0);
  const candidates = [];
  const roomChecks = [];
  const reasons = ['Only direct room changes at the original session time were searched.'];
  let truncated = false;

  if (input.affectedSession.roomId !== null) {
    reasons.push(`Current room ${input.affectedSession.roomId} was excluded because a direct move must change rooms.`);
  }
  for (const room of rooms) {
    // A soft loop budget: a synchronous room check cannot be interrupted midway.
    if (clock() - startedAt >= request.limits.timeoutMs) {
      truncated = true;
      reasons.push('Search time limit reached; remaining rooms were not checked.');
      break;
    }
    const check = evaluateRoomChecks(room, input.affectedSession, {
      sessions: input.snapshot.sessions,
      restrictions: input.snapshot.restrictions,
    });
    roomChecks.push(check);
    if (!check.eligible) continue;
    if (candidates.length === request.limits.maxCandidates) {
      truncated = true;
      reasons.push('Candidate limit reached; additional direct alternatives were omitted.');
      break;
    }
    candidates.push(makeCandidate(input, room));
  }
  if (candidates.length === 0 && !truncated) {
    reasons.push('No eligible empty destination was found for a direct room change.');
  }

  return {
    runId: `run-${randomUUID()}`,
    mode: input.mode,
    scope: 'direct-only',
    validationStatus: 'pending',
    scenarioId: input.snapshot.scenarioId,
    scenarioRevision: input.snapshot.scenarioRevision,
    facilitiesVersion: input.snapshot.facilitiesVersion,
    truncated,
    candidates,
    roomChecks,
    reasons,
  };
}

module.exports = { generateDirectCandidates };
