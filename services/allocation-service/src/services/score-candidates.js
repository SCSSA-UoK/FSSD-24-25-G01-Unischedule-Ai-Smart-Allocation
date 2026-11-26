const { randomUUID } = require('node:crypto');
const { AllocationInputError } = require('../validation/allocation-input');
const { parseScoreRequest } = require('../validation/scoring-input');
const { prepareCandidateInput } = require('./prepare-candidate-input');
const { SCORING_POLICY, rankCandidates } = require('../algorithms/candidate-scoring');

async function scoreCandidates(rawRequest, clients, { dependencyTimeoutMs = 5000 } = {}) {
  const request = parseScoreRequest(rawRequest);
  const { scenarioId, scenarioRevision, affectedSessionId, allowedMoveCount } = request;
  const input = await prepareCandidateInput({ scenarioId, scenarioRevision, affectedSessionId, allowedMoveCount },
    clients, dependencyTimeoutMs);
  if (request.facilitiesVersion !== input.snapshot.facilitiesVersion) {
    throw new AllocationInputError(409, 'STALE_FACILITIES', 'Reload room facts and regenerate candidates before scoring.');
  }
  return {
    runId: `run-${randomUUID()}`,
    mode: input.mode,
    scope: 'submitted-candidates',
    validationStatus: 'pending',
    scenarioId: input.snapshot.scenarioId,
    scenarioRevision: input.snapshot.scenarioRevision,
    facilitiesVersion: input.snapshot.facilitiesVersion,
    scoringPolicy: SCORING_POLICY,
    rankedCandidates: rankCandidates(input, request.candidates),
    reasons: [
      'Only the submitted candidates were compared; lower cost does not prove a global optimum.',
      'All candidates remain fixture proposals pending authoritative Platform whole-plan validation.',
    ],
  };
}

module.exports = { scoreCandidates };
