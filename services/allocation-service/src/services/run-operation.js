const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { AllocationInputError } = require('../validation/allocation-input');
const { storageUnavailable } = require('../models/mongo-run-store');

async function runOperation({
  operation, request, runStore, traceId, onRunId = () => {},
  clock = () => performance.now(), now = () => new Date().toISOString(),
}, execute) {
  if (!runStore) return execute();
  const runId = `run-${randomUUID()}`;
  onRunId(runId);
  const acceptedRequest = structuredClone(request);
  const createdAt = now();
  const startedAt = clock();
  let response;
  let failure;
  let failed = false;
  try {
    response = { ...await execute(), runId };
  } catch (error) {
    failed = true;
    failure = error;
  }
  const publicError = failed ? (
    failure instanceof AllocationInputError
      ? { status: failure.status, code: failure.code, message: failure.message, traceId }
      : { status: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', traceId }
  ) : null;
  const candidates = response?.candidates ?? response?.rankedCandidates ?? [];
  const record = {
    schemaVersion: 1, runId, operation,
    status: failed ? 'error' : response.truncated ? 'truncated' : 'completed',
    historical: true, createdAt, completedAt: now(), elapsedMs: Math.max(0, Math.round((clock() - startedAt) * 1000) / 1000),
    scenarioId: acceptedRequest.scenarioId, scenarioRevision: acceptedRequest.scenarioRevision,
    facilitiesVersion: response?.facilitiesVersion ?? acceptedRequest.facilitiesVersion ?? null,
    mode: response?.mode ?? null,
    scoringVersion: response?.scoringPolicy?.version ?? null,
    limits: acceptedRequest.limits ?? null, request: acceptedRequest,
    candidateCount: candidates.length, validatedCount: response?.validatedCandidates?.length ?? 0,
    response: response ?? null, error: publicError,
  };
  try {
    await runStore.save(record);
  } catch (error) {
    if (error instanceof AllocationInputError && ['RUN_STORAGE_UNAVAILABLE', 'RUN_STORAGE_LIMIT'].includes(error.code)) throw error;
    throw storageUnavailable();
  }
  if (failed) throw failure;
  return response;
}

module.exports = { runOperation };
