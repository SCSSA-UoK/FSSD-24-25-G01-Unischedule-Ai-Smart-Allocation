const { AllocationInputError } = require('../validation/allocation-input');
const { createCandidateId } = require('./candidate-id');
const { evaluateRoomChecks } = require('./room-checks');
const { buildSingleDisplacementCandidate } = require('./single-displacement');

const SCORING_POLICY = Object.freeze({
  version: 'allocation-cost-v1',
  weights: Object.freeze({
    displacedExistingSessions: 100,
    timeChangedSessions: 200,
    buildingChangedSessions: 10,
    totalUnusedSeats: 0.1,
  }),
});

function rejectCandidate(candidate, message) {
  throw new AllocationInputError(422, 'INVALID_CANDIDATE', message, { candidateId: candidate.candidateId });
}

function checkSubmittedPlan(input, candidate, sessions, rooms) {
  const targetMove = candidate.moves.find((move) => move.sessionId === input.affectedSession.sessionId);
  if (!targetMove || new Set(candidate.moves.map((move) => move.sessionId)).size !== candidate.moves.length) {
    rejectCandidate(candidate, 'A plan must move the affected session exactly once.');
  }
  if (candidate.moves.length - 1 > input.request.allowedMoveCount) {
    rejectCandidate(candidate, 'The plan exceeds the allowed number of displaced sessions.');
  }
  for (const move of candidate.moves) {
    const original = sessions.get(move.sessionId);
    if (!original || !rooms.has(move.toRoomId)) {
      rejectCandidate(candidate, 'A move references an unknown session or destination room.');
    }
    if (move.fromRoomId !== original.roomId || move.startAt !== original.startAt || move.endAt !== original.endAt) {
      rejectCandidate(candidate, 'Moves must match their original room and unchanged start/end timestamps.');
    }
    if (move.fromRoomId === move.toRoomId) {
      rejectCandidate(candidate, 'Each move must change rooms.');
    }
  }
  // A content ID identifies a proposal; it is not a signature or validation evidence.
  if (candidate.candidateId !== createCandidateId(input, candidate.moves)) {
    rejectCandidate(candidate, 'Candidate identity does not match the moves and snapshot versions.');
  }

  const targetRoom = rooms.get(targetMove.toRoomId);
  const check = evaluateRoomChecks(targetRoom, input.affectedSession, {
    sessions: input.snapshot.sessions, restrictions: input.snapshot.restrictions,
  });
  if (candidate.moves.length === 1) {
    if (!check.eligible) rejectCandidate(candidate, 'The direct plan fails local room checks.');
    return { kind: 'direct', moves: structuredClone(candidate.moves) };
  }

  const blockerMove = candidate.moves.find((move) => move.sessionId !== targetMove.sessionId);
  if (!check.suitable || check.blockingSessionIds.length !== 1
      || check.blockingSessionIds[0] !== blockerMove.sessionId) {
    rejectCandidate(candidate, 'A relocation must move the single original blocker of the target room.');
  }
  const plan = buildSingleDisplacementCandidate(input, targetMove.toRoomId, blockerMove.sessionId, blockerMove.toRoomId);
  if (!plan) rejectCandidate(candidate, 'The complete final assignment fails local room checks.');
  return { kind: plan.kind, moves: plan.moves };
}

function scorePlan(input, candidate, sessions, rooms) {
  const plan = checkSubmittedPlan(input, candidate, sessions, rooms);
  const counts = {
    displacedExistingSessions: plan.moves.length - 1,
    timeChangedSessions: 0,
    buildingChangedSessions: 0,
    totalUnusedSeats: 0,
  };
  for (const move of plan.moves) {
    const original = sessions.get(move.sessionId);
    const destination = rooms.get(move.toRoomId);
    // An unassigned session has no known origin building; do not invent a building change.
    if (original.roomId !== null && rooms.get(original.roomId).building !== destination.building) {
      counts.buildingChangedSessions++;
    }
    counts.totalUnusedSeats += destination.seats - original.registeredStudents;
  }

  // Integer tenths avoid floating-point accumulation changing cost ties.
  const weightedTenths = Object.fromEntries(Object.entries(counts).map(([key, count]) => (
    [key, count * Math.round(SCORING_POLICY.weights[key] * 10)]
  )));
  const cost = Object.values(weightedTenths).reduce((total, value) => total + value, 0) / 10;
  const weightedCosts = Object.fromEntries(Object.entries(weightedTenths).map(([key, value]) => [key, value / 10]));
  return {
    candidateId: candidate.candidateId,
    kind: plan.kind,
    validationStatus: 'pending',
    moves: plan.moves,
    cost,
    costBreakdown: { ...counts, weightedCosts },
    reasons: [
      `${counts.displacedExistingSessions} displaced session(s), ${counts.timeChangedSessions} time change(s), ${counts.buildingChangedSessions} building change(s), and ${counts.totalUnusedSeats} unused seats give cost ${cost}.`,
      'Lower cost is preferred under the fixed policy; local room checks do not establish Platform validity.',
    ],
  };
}

// Inputs are parsed and version-checked by the scoring service before reaching this function.
function rankCandidates(input, candidates) {
  const sessions = new Map(input.snapshot.sessions.map((session) => [session.sessionId, session]));
  const rooms = new Map(input.snapshot.rooms.map((room) => [room.roomId, room]));
  const scored = candidates.map((candidate) => scorePlan(input, candidate, sessions, rooms));
  scored.sort((first, second) => first.cost - second.cost
    || (first.candidateId < second.candidateId ? -1 : first.candidateId > second.candidateId ? 1 : 0));
  return scored.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

module.exports = { SCORING_POLICY, rankCandidates };
