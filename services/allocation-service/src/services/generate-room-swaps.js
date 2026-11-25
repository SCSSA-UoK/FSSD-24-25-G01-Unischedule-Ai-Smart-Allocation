const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { prepareCandidateInput } = require('./prepare-candidate-input');
const { evaluateRoomChecks } = require('../algorithms/room-checks');
const { buildSingleDisplacementCandidate } = require('../algorithms/single-displacement');

async function generateRoomSwaps(rawRequest, clients, {
  clock = () => performance.now(), dependencyTimeoutMs = 5000,
} = {}) {
  const input = await prepareCandidateInput(rawRequest, clients, dependencyTimeoutMs);
  const { request, snapshot, affectedSession } = input;
  const rooms = [...snapshot.rooms]
    .sort((first, second) => first.roomId < second.roomId ? -1 : first.roomId > second.roomId ? 1 : 0);
  const candidates = [];
  const roomChecks = [];
  const reasons = ['Only single-displacement room plans at each session\'s original time were searched.'];
  let truncated = false;

  if (request.allowedMoveCount === 0) {
    reasons.push('At least one displaced existing session must be allowed for a relocation or swap.');
  } else {
    const startedAt = clock();
    const expired = () => clock() - startedAt >= request.limits.timeoutMs;
    search: for (const targetRoom of rooms) {
      if (targetRoom.roomId === affectedSession.roomId) continue;
      if (expired()) {
        truncated = true;
        reasons.push('Search time limit reached; remaining plans were not checked.');
        break;
      }
      const check = evaluateRoomChecks(targetRoom, affectedSession, {
        sessions: snapshot.sessions, restrictions: snapshot.restrictions,
      });
      roomChecks.push(check);
      // Two occupants, even in separate parts of the interval, need more than one displacement.
      if (!check.suitable || check.blockingSessionIds.length !== 1) continue;

      for (const destination of rooms) {
        if (destination.roomId === targetRoom.roomId) continue;
        if (expired()) {
          truncated = true;
          reasons.push('Search time limit reached; remaining plans were not checked.');
          break search;
        }
        const candidate = buildSingleDisplacementCandidate(
          input, targetRoom.roomId, check.blockingSessionIds[0], destination.roomId,
        );
        if (!candidate) continue;
        if (candidates.length === request.limits.maxCandidates) {
          truncated = true;
          reasons.push('Candidate limit reached; additional single-displacement alternatives were omitted.');
          break search;
        }
        candidates.push(candidate);
      }
    }
    if (candidates.length === 0 && !truncated) {
      reasons.push('No feasible single-displacement plan was found under the local room checks.');
    }
  }

  return {
    runId: `run-${randomUUID()}`,
    mode: input.mode,
    scope: 'single-displacement',
    validationStatus: 'pending',
    scenarioId: snapshot.scenarioId,
    scenarioRevision: snapshot.scenarioRevision,
    facilitiesVersion: snapshot.facilitiesVersion,
    truncated,
    candidates,
    roomChecks,
    reasons,
  };
}

module.exports = { generateRoomSwaps };
