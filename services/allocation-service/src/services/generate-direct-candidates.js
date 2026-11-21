const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { AllocationInputError, parseCandidateRequest } = require('../validation/allocation-input');
const { prepareAllocationInput } = require('./prepare-allocation-input');
const { evaluateRoomChecks } = require('../algorithms/room-checks');

async function readDependency(read) {
  try {
    return await read();
  } catch (error) {
    if (error instanceof AllocationInputError) throw error;
    throw new AllocationInputError(503, 'DEPENDENCY_UNAVAILABLE', 'Schedule or facilities data is unavailable.');
  }
}

async function prepareWithTimeout(request, clients, timeoutMs) {
  let timer;
  const guardedClients = {
    platformClient: {
      getScenarioSnapshot: (scenarioId) => readDependency(() => clients.platformClient.getScenarioSnapshot(scenarioId)),
    },
    facilitiesClient: {
      getRoomSnapshot: () => readDependency(() => clients.facilitiesClient.getRoomSnapshot()),
    },
  };
  try {
    return await Promise.race([
      prepareAllocationInput(request, guardedClients),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new AllocationInputError(
          504, 'DEPENDENCY_TIMEOUT', 'Schedule or facilities data did not arrive within the time limit.',
        )), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function makeCandidate(input, room) {
  const session = input.affectedSession;
  const move = {
    sessionId: session.sessionId,
    fromRoomId: session.roomId,
    toRoomId: room.roomId,
    startAt: session.startAt,
    endAt: session.endAt,
  };
  const identity = [
    input.snapshot.scenarioId, input.snapshot.scenarioRevision, input.snapshot.facilitiesVersion,
    move.sessionId, move.fromRoomId, move.toRoomId, move.startAt, move.endAt,
  ];
  const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24);
  return {
    candidateId: `candidate-${digest}`,
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
  const request = parseCandidateRequest(rawRequest);
  if (!Number.isInteger(dependencyTimeoutMs) || dependencyTimeoutMs < 1) {
    throw new RangeError('dependencyTimeoutMs must be a positive integer.');
  }
  const input = await prepareWithTimeout(request, clients, dependencyTimeoutMs);
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
