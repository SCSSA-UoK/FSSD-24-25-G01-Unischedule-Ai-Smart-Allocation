const { z } = require('zod');
const { isDeepStrictEqual } = require('node:util');
const { AllocationInputError, CandidateRequestSchema } = require('./allocation-input');
const { MoveSchema, parseScoreRequest } = require('./scoring-input');

const fields = CandidateRequestSchema.shape;
const ProposalSchema = z.object({
  scenarioId: fields.scenarioId,
  scenarioRevision: fields.scenarioRevision,
  facilitiesVersion: fields.scenarioId,
  candidateId: fields.scenarioId,
  moves: z.array(MoveSchema).min(1).max(2),
}).strict();
const ResponseSchema = ProposalSchema.extend({
  validationStatus: z.enum(['valid', 'invalid', 'stale']),
  validationReference: fields.scenarioId,
  validatedAt: z.iso.datetime({ offset: true, precision: 0 }),
  conflicts: z.array(z.object({
    code: fields.scenarioId,
    message: z.string().min(1).max(500).regex(/\S/),
    sessionIds: z.array(fields.scenarioId).max(20),
  }).strict()).max(100),
}).strict();

function parseValidationRequest(value) {
  const request = parseScoreRequest(value);
  if (request.candidates.length > 10) {
    throw new AllocationInputError(422, 'INVALID_INPUT', 'Submit at most 10 candidates for validation.');
  }
  return request;
}

function parseValidationProposal(value) {
  const result = ProposalSchema.safeParse(value);
  if (!result.success || new Set(value.moves.map((move) => move.sessionId)).size !== value.moves.length) {
    throw new AllocationInputError(422, 'INVALID_INPUT', 'Validation requires one complete room-change plan.');
  }
  return result.data;
}

function parseValidationResponse(value, proposal) {
  const result = ResponseSchema.safeParse(value);
  const order = (moves) => [...moves].sort((first, second) => (
    first.sessionId < second.sessionId ? -1 : first.sessionId > second.sessionId ? 1 : 0
  ));
  if (!result.success || result.data.scenarioId !== proposal.scenarioId
      || result.data.candidateId !== proposal.candidateId
      || !isDeepStrictEqual(order(result.data.moves), order(proposal.moves))
      || (result.data.validationStatus === 'valid' && result.data.conflicts.length !== 0)
      || (result.data.validationStatus === 'invalid' && result.data.conflicts.length === 0)) {
    throw new AllocationInputError(502, 'PLATFORM_INVALID_RESPONSE', 'Platform returned unusable validation evidence.');
  }
  return result.data;
}

module.exports = { parseValidationRequest, parseValidationProposal, parseValidationResponse };
