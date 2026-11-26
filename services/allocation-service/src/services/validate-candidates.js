const { AllocationInputError } = require('../validation/allocation-input');
const { parseValidationRequest, parseValidationResponse } = require('../validation/platform-validation');
const { PlatformValidationClient } = require('../clients/platform-validation-client');
const { scoreCandidates } = require('./score-candidates');

async function validateCandidates(rawRequest, clients, validationClient, {
  dependencyTimeoutMs = 5000, timeoutMs = 5000, now = () => Date.now(),
} = {}) {
  const request = parseValidationRequest(rawRequest);
  const scored = await scoreCandidates(request, clients, { dependencyTimeoutMs });
  if (validationClient instanceof PlatformValidationClient) {
    // Current schedule/facility inputs are fixture-only. Never send fictional IDs to a live validator.
    throw new AllocationInputError(503, 'LIVE_INPUTS_REQUIRED', 'Live versioned schedule and facilities adapters are required before Platform validation.');
  }
  if (!validationClient || validationClient.source !== 'fixture' || typeof validationClient.validateProposal !== 'function') {
    throw new AllocationInputError(503, 'PLATFORM_VALIDATION_UNAVAILABLE', 'Authoritative Platform validation is not available.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
    throw new RangeError('Validation timeout must be an integer from 1 to 10000.');
  }
  const controller = new AbortController();
  let timer;
  try {
    const rankedCandidates = await Promise.race([
      (async () => {
        const results = [];
        for (const candidate of scored.rankedCandidates) {
          if (controller.signal.aborted) throw new Error('Validation deadline reached.');
          const proposal = {
            scenarioId: scored.scenarioId, scenarioRevision: scored.scenarioRevision,
            facilitiesVersion: scored.facilitiesVersion, candidateId: candidate.candidateId,
            moves: structuredClone(candidate.moves),
          };
          let rawEvidence;
          try {
            rawEvidence = await validationClient.validateProposal(structuredClone(proposal), { signal: controller.signal });
          } catch (error) {
            if (error instanceof AllocationInputError) throw error;
            throw new AllocationInputError(503, 'PLATFORM_UNAVAILABLE', 'Platform validation is unavailable.');
          }
          if (controller.signal.aborted) throw new Error('Validation deadline reached.');
          const evidence = parseValidationResponse(rawEvidence, proposal);
          const validationStatus = evidence.validationStatus === 'valid' ? 'pending' : evidence.validationStatus;
          results.push({
            ...candidate,
            validationStatus,
            validationEvidence: {
              source: 'fixture', reportedStatus: evidence.validationStatus,
              validationReference: evidence.validationReference, validatedAt: evidence.validatedAt,
              scenarioRevision: evidence.scenarioRevision, facilitiesVersion: evidence.facilitiesVersion,
              conflicts: evidence.conflicts,
            },
          });
        }
        if (controller.signal.aborted) throw new Error('Validation deadline reached.');
        // Reject changes during validation, including new restrictions and lost local eligibility.
        await scoreCandidates(request, clients, { dependencyTimeoutMs });
        if (controller.signal.aborted) throw new Error('Validation deadline reached.');
        // Earlier evidence can expire while later candidates or freshness reads are pending.
        const checkedAt = now();
        return results.map((candidate) => {
          const evidence = candidate.validationEvidence;
          const ageMs = checkedAt - Date.parse(evidence.validatedAt);
          const stale = evidence.scenarioRevision !== scored.scenarioRevision
            || evidence.facilitiesVersion !== scored.facilitiesVersion || ageMs > 60000 || ageMs < -5000;
          return stale ? { ...candidate, validationStatus: 'stale' } : candidate;
        });
      })(),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new AllocationInputError(504, 'PLATFORM_VALIDATION_TIMEOUT', 'Platform validation timed out.'));
        }, timeoutMs);
      }),
    ]);
    return {
      ...scored, scope: 'platform-validation', validationSource: 'fixture', rankedCandidates,
      validatedCandidates: [],
      reasons: [
        'Validation evidence is explicitly mocked; a reported valid result remains pending.',
        'No authoritative recommendations are available until live versioned inputs and Platform validation are integrated.',
      ],
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { validateCandidates };
