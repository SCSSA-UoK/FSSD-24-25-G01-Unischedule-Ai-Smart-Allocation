const { z } = require('zod');
const { AllocationInputError, CandidateRequestSchema } = require('./allocation-input');

const fields = CandidateRequestSchema.shape;
const timestamp = z.iso.datetime({ offset: true, precision: 0 });
const MoveSchema = z.object({
  sessionId: fields.affectedSessionId,
  fromRoomId: fields.scenarioId.nullable(),
  toRoomId: fields.scenarioId,
  startAt: timestamp,
  endAt: timestamp,
}).strict().superRefine((move, context) => {
  if (Date.parse(move.endAt) <= Date.parse(move.startAt)) {
    context.addIssue({ code: 'custom', path: ['endAt'], message: 'endAt must be after startAt.' });
  }
});

const SubmittedCandidateSchema = z.object({
  candidateId: fields.scenarioId,
  moves: z.array(MoveSchema).min(1).max(2),
}).strict().superRefine((candidate, context) => {
  if (new Set(candidate.moves.map((move) => move.sessionId)).size !== candidate.moves.length) {
    context.addIssue({ code: 'custom', path: ['moves'], message: 'Each session may occur only once per plan.' });
  }
});

const ScoreRequestSchema = z.object({
  scenarioId: fields.scenarioId,
  scenarioRevision: fields.scenarioRevision,
  facilitiesVersion: fields.scenarioId,
  affectedSessionId: fields.affectedSessionId,
  allowedMoveCount: fields.allowedMoveCount,
  candidates: z.array(SubmittedCandidateSchema).max(50),
}).strict().superRefine((request, context) => {
  if (new Set(request.candidates.map((candidate) => candidate.candidateId)).size !== request.candidates.length) {
    context.addIssue({ code: 'custom', path: ['candidates'], message: 'Candidate identifiers must be unique.' });
  }
});

function parseScoreRequest(value) {
  const result = ScoreRequestSchema.safeParse(value);
  if (!result.success) {
    throw new AllocationInputError(422, 'INVALID_INPUT', 'Allocation scoring input is invalid.',
      result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })));
  }
  return result.data;
}

module.exports = { ScoreRequestSchema, parseScoreRequest };
