const { storage } = require('./storage');
const { createAuditLogModel } = require('../models/audit-log');
const { platformClient } = require('../clients/platform-client');

async function listRecoveryCases(filters = {}) {
  const { items, nextCursor, total } = await storage.listRecoveryRequests(filters);
  return {
    items,
    nextCursor,
    count: items.length,
    total
  };
}

async function getRecoveryCaseDetails(caseId) {
  const recoveryCase = await storage.getRecoveryRequestById(caseId);
  if (!recoveryCase) {
    const error = new Error(`Recovery case '${caseId}' not found.`);
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  const disruption = await storage.getDisruptionById(recoveryCase.disruptionId);
  const auditLogs = await storage.getAuditLogsByCaseId(caseId);

  return {
    ...recoveryCase,
    disruption,
    auditCount: auditLogs.length
  };
}

async function updateCasePriority(
  caseId,
  { priority, reason, version = null, actorId = 'demo-operator', traceId = null }
) {
  const current = await storage.getRecoveryRequestById(caseId);
  if (!current) {
    const error = new Error(`Recovery case '${caseId}' not found.`);
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  const versionToMatch = version ?? current.version;
  const trimmedReason = reason.trim();

  const updated = await storage.updateRecoveryRequestWithVersion(caseId, versionToMatch, {
    priority,
    priorityReason: trimmedReason
  });

  if (!updated) {
    const error = new Error('Recovery case version conflict. Refresh and retry.');
    error.status = 409;
    error.code = 'VERSION_CONFLICT';
    error.details = { expectedVersion: versionToMatch, currentVersion: current.version };
    throw error;
  }

  const audit = createAuditLogModel({
    caseId: updated.caseId,
    disruptionId: updated.disruptionId,
    eventType: 'PRIORITY_UPDATED',
    actorId,
    traceId,
    oldStatus: current.status,
    newStatus: updated.status,
    details: {
      previousPriority: current.priority,
      newPriority: priority,
      reason: trimmedReason
    }
  });
  await storage.saveAuditLog(audit);

  return updated;
}

async function syncCaseConstraints(
  caseId,
  { actorId = 'demo-operator', traceId = null, client = platformClient } = {}
) {
  const current = await storage.getRecoveryRequestById(caseId);
  if (!current) {
    const error = new Error(`Recovery case '${caseId}' not found.`);
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  const disruption = await storage.getDisruptionById(current.disruptionId);
  if (!disruption) {
    const error = new Error(`Linked disruption '${current.disruptionId}' not found.`);
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }

  try {
    const syncResult = await client.registerConstraint({
      scenarioId: current.scenarioId,
      scenarioRevision: current.scenarioRevision,
      disruption,
      traceId
    });

    const updated = await storage.updateRecoveryRequestWithVersion(caseId, current.version, {
      constraintSyncStatus: 'synced',
      constraintId: syncResult.constraintId,
      constraintSyncMode: syncResult.mode,
      scenarioRevision: syncResult.scenarioRevision
    });

    if (!updated) {
      const conflict = new Error('Recovery case was modified during constraint sync.');
      conflict.status = 409;
      conflict.code = 'VERSION_CONFLICT';
      throw conflict;
    }

    await storage.saveAuditLog(
      createAuditLogModel({
        caseId: updated.caseId,
        disruptionId: updated.disruptionId,
        eventType: 'CONSTRAINT_SYNCED',
        actorId,
        traceId,
        oldStatus: current.status,
        newStatus: updated.status,
        details: {
          constraintId: syncResult.constraintId,
          previousRevision: current.scenarioRevision,
          scenarioRevision: syncResult.scenarioRevision,
          isMock: syncResult.isMock
        }
      })
    );

    return {
      caseId: updated.caseId,
      constraintSyncStatus: updated.constraintSyncStatus,
      constraintId: updated.constraintId,
      constraintSyncMode: updated.constraintSyncMode,
      isMock: syncResult.isMock,
      scenarioRevision: updated.scenarioRevision,
      version: updated.version
    };
  } catch (error) {
    if (error.code !== 'VERSION_CONFLICT') {
      await storage.updateRecoveryRequestWithVersion(caseId, current.version, {
        constraintSyncStatus: 'failed'
      });

      await storage.saveAuditLog(
        createAuditLogModel({
          caseId: current.caseId,
          disruptionId: current.disruptionId,
          eventType: 'CONSTRAINT_SYNC_FAILED',
          actorId,
          traceId,
          oldStatus: current.status,
          newStatus: current.status,
          details: { errorCode: error.code || 'CONSTRAINT_SYNC_FAILED', message: error.message }
        })
      );
    }
    throw error;
  }
}

module.exports = {
  listRecoveryCases,
  getRecoveryCaseDetails,
  updateCasePriority,
  syncCaseConstraints
};
