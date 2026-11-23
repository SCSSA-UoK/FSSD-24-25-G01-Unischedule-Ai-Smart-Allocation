const { storage } = require('./storage');
const { createAuditLogModel } = require('../models/audit-log');

const ALLOWED_TRANSITIONS = {
  reported: ['investigating'],
  investigating: ['awaiting_approval', 'no_solution', 'investigation_failed'],
  no_solution: ['investigating'],
  investigation_failed: ['investigating'],
  awaiting_approval: ['approved', 'rejected', 'stale'],
  approved: ['applying', 'stale'],
  applying: ['applied', 'stale', 'application_failed'],
  stale: ['investigating'],
  application_failed: ['applying', 'stale'],
  rejected: [],
  applied: []
};

function canTransition(fromStatus, toStatus) {
  const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

async function transitionCaseStatus(
  caseId,
  {
    toStatus,
    expectedVersion = null,
    actorId = 'system',
    traceId = null,
    eventType = 'CASE_STATUS_CHANGED',
    details = null,
    patch = {}
  }
) {
  const current = await storage.getRecoveryRequestById(caseId);
  if (!current) {
    const error = new Error(`Recovery case '${caseId}' not found.`);
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (!canTransition(current.status, toStatus)) {
    const error = new Error(`Cannot transition case from '${current.status}' to '${toStatus}'.`);
    error.status = 409;
    error.code = 'INVALID_STATE_TRANSITION';
    error.details = { currentStatus: current.status, targetStatus: toStatus };
    throw error;
  }

  const versionToMatch = expectedVersion ?? current.version;
  const updated = await storage.updateRecoveryRequestWithVersion(caseId, versionToMatch, {
    ...patch,
    status: toStatus
  });

  if (!updated) {
    const error = new Error('Recovery case was modified concurrently. Refresh and retry.');
    error.status = 409;
    error.code = 'VERSION_CONFLICT';
    error.details = { expectedVersion: versionToMatch, currentVersion: current.version };
    throw error;
  }

  const audit = createAuditLogModel({
    caseId: updated.caseId,
    disruptionId: updated.disruptionId,
    eventType,
    actorId,
    traceId,
    oldStatus: current.status,
    newStatus: toStatus,
    details
  });
  await storage.saveAuditLog(audit);

  return updated;
}

module.exports = {
  ALLOWED_TRANSITIONS,
  canTransition,
  transitionCaseStatus
};
