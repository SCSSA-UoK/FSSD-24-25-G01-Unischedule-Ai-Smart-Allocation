const crypto = require('node:crypto');
const { storage } = require('./storage');
const { canTransition, transitionCaseStatus } = require('./case-lifecycle');
const { createAuditLogModel } = require('../models/audit-log');
const { agentClient } = require('../clients/agent-client');

function computePlanHash(moves = []) {
  const canonical = [...moves]
    .map((m) => ({
      sessionId: m.sessionId,
      fromRoomId: m.fromRoomId,
      toRoomId: m.toRoomId,
      startAt: m.startAt,
      endAt: m.endAt
    }))
    .sort((a, b) => String(a.sessionId).localeCompare(String(b.sessionId)));

  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function formatRecommendationPlan(plan, disruption) {
  const moves = Array.isArray(plan.moves) ? plan.moves : [];
  const beforeAfterPreview = moves.map((move) => ({
    sessionId: move.sessionId,
    before: {
      roomId: move.fromRoomId,
      startAt: disruption?.startAt || null,
      endAt: disruption?.endAt || null
    },
    after: {
      roomId: move.toRoomId,
      startAt: move.startAt,
      endAt: move.endAt
    }
  }));

  return {
    recoveryPlanId: plan.recoveryPlanId,
    candidateId: plan.candidateId || null,
    scenarioRevision: plan.scenarioRevision,
    validationStatus: plan.validationStatus || 'pending',
    validationReference: plan.validationReference || null,
    isMockValidation: Boolean(plan.isMockValidation),
    explanation: plan.explanation || '',
    moves,
    beforeAfterPreview,
    planHash: computePlanHash(moves)
  };
}

async function startCaseInvestigation(
  caseId,
  { scenarioRevision = undefined, version = null, actorId = 'demo-operator', traceId = null, client = agentClient } = {}
) {
  const current = await storage.getRecoveryRequestById(caseId);
  if (!current) {
    const error = new Error(`Recovery case '${caseId}' not found.`);
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (scenarioRevision !== undefined && scenarioRevision !== current.scenarioRevision) {
    const error = new Error('Scenario revision does not match the current case revision.');
    error.status = 409;
    error.code = 'STALE_SCENARIO';
    error.details = { expectedRevision: scenarioRevision, currentRevision: current.scenarioRevision };
    throw error;
  }

  if (!canTransition(current.status, 'investigating')) {
    const error = new Error(`Cannot start investigation while case is in '${current.status}' status.`);
    error.status = 409;
    error.code = 'INVALID_STATE_TRANSITION';
    error.details = { currentStatus: current.status, targetStatus: 'investigating' };
    throw error;
  }

  const disruption = await storage.getDisruptionById(current.disruptionId);

  let runResult;
  try {
    runResult = await client.startRun({
      scenarioId: current.scenarioId,
      scenarioRevision: current.scenarioRevision,
      disruptionId: current.disruptionId,
      caseId: current.caseId,
      disruption,
      traceId
    });
  } catch (error) {
    await storage.updateRecoveryRequestWithVersion(caseId, version ?? current.version, {
      status: 'investigation_failed',
      investigationError: error.message
    });
    await storage.saveAuditLog(
      createAuditLogModel({
        caseId: current.caseId,
        disruptionId: current.disruptionId,
        eventType: 'INVESTIGATION_FAILED',
        actorId,
        traceId,
        oldStatus: current.status,
        newStatus: 'investigation_failed',
        details: { errorCode: error.code || 'AGENT_UNAVAILABLE', message: error.message }
      })
    );
    throw error;
  }

  const nextRunIds = [...(current.runIds || []), runResult.runId];

  const updated = await transitionCaseStatus(caseId, {
    toStatus: 'investigating',
    expectedVersion: version ?? current.version,
    actorId,
    traceId,
    eventType: 'INVESTIGATION_STARTED',
    details: {
      runId: runResult.runId,
      scenarioRevision: current.scenarioRevision,
      isMock: runResult.isMock
    },
    patch: {
      runIds: nextRunIds,
      latestRunId: runResult.runId,
      investigationMode: runResult.mode,
      investigationError: null
    }
  });

  return {
    caseId: updated.caseId,
    status: updated.status,
    runId: runResult.runId,
    scenarioRevision: updated.scenarioRevision,
    isMock: runResult.isMock,
    version: updated.version
  };
}

async function getCaseRecommendations(
  caseId,
  { actorId = 'system', traceId = null, client = agentClient } = {}
) {
  let current = await storage.getRecoveryRequestById(caseId);
  if (!current) {
    const error = new Error(`Recovery case '${caseId}' not found.`);
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  const disruption = await storage.getDisruptionById(current.disruptionId);

  if (current.status === 'investigating' && current.latestRunId) {
    const poll = await client.getRunResult(current.latestRunId, { traceId });

    if (poll.status === 'completed' && Array.isArray(poll.plans) && poll.plans.length > 0) {
      const formattedPlans = poll.plans.map((p) => formatRecommendationPlan(p, disruption));
      current = await transitionCaseStatus(caseId, {
        toStatus: 'awaiting_approval',
        expectedVersion: current.version,
        actorId,
        traceId,
        eventType: 'RECOMMENDATIONS_READY',
        details: {
          runId: current.latestRunId,
          planCount: formattedPlans.length,
          isMock: poll.isMock
        },
        patch: {
          planReferences: formattedPlans,
          investigationError: null
        }
      });
    } else if (poll.status === 'no_solution' || (poll.status === 'completed' && (!poll.plans || poll.plans.length === 0))) {
      current = await transitionCaseStatus(caseId, {
        toStatus: 'no_solution',
        expectedVersion: current.version,
        actorId,
        traceId,
        eventType: 'INVESTIGATION_NO_SOLUTION',
        details: { runId: current.latestRunId, isMock: poll.isMock },
        patch: {
          planReferences: [],
          investigationError: null
        }
      });
    } else if (poll.status === 'failed') {
      current = await transitionCaseStatus(caseId, {
        toStatus: 'investigation_failed',
        expectedVersion: current.version,
        actorId,
        traceId,
        eventType: 'INVESTIGATION_FAILED',
        details: { runId: current.latestRunId, error: poll.error || 'Investigation failed.' },
        patch: {
          planReferences: [],
          investigationError: poll.error || 'Investigation failed.'
        }
      });
    }
  }

  return {
    caseId: current.caseId,
    status: current.status,
    scenarioRevision: current.scenarioRevision,
    runId: current.latestRunId || null,
    runIds: current.runIds || [],
    investigationMode: current.investigationMode || null,
    isMock: current.investigationMode === 'mock',
    plans: current.planReferences || [],
    investigationError: current.investigationError || null
  };
}

module.exports = {
  computePlanHash,
  formatRecommendationPlan,
  startCaseInvestigation,
  getCaseRecommendations
};
