const crypto = require('node:crypto');
const { storage } = require('./storage');
const { createDisruptionModel } = require('../models/disruption');
const { createRecoveryCaseModel } = require('../models/recovery-case');
const { createAuditLogModel } = require('../models/audit-log');

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function createDisruption(payload, { idempotencyKey = null, actorId = 'demo-reporter', traceId = null } = {}) {
  if (idempotencyKey) {
    const existing = storage.getIdempotency(idempotencyKey);
    if (existing) {
      const currentHash = hashPayload(payload);
      if (existing.hash === currentHash) {
        return existing.response;
      }
      const conflictError = new Error('Idempotency key already used with different payload.');
      conflictError.status = 409;
      conflictError.code = 'IDEMPOTENCY_CONFLICT';
      throw conflictError;
    }
  }

  const recoveryCase = createRecoveryCaseModel({
    disruptionId: '',
    scenarioId: payload.scenarioId,
    scenarioRevision: payload.scenarioRevision,
    priority: payload.priority || 'normal'
  });

  const disruption = createDisruptionModel({
    ...payload,
    caseId: recoveryCase.caseId,
    reporterId: actorId
  });

  recoveryCase.disruptionId = disruption.disruptionId;

  await storage.saveDisruption(disruption);
  await storage.saveRecoveryRequest(recoveryCase);

  const audit = createAuditLogModel({
    caseId: recoveryCase.caseId,
    disruptionId: disruption.disruptionId,
    eventType: 'DISRUPTION_REPORTED',
    actorId,
    traceId,
    newStatus: 'reported',
    details: {
      type: disruption.type,
      priority: disruption.priority,
      affectedSessionIds: disruption.affectedSessionIds
    }
  });
  await storage.saveAuditLog(audit);

  const response = {
    disruptionId: disruption.disruptionId,
    caseId: recoveryCase.caseId,
    status: recoveryCase.status,
    scenarioId: disruption.scenarioId,
    scenarioRevision: disruption.scenarioRevision,
    constraintSyncStatus: recoveryCase.constraintSyncStatus
  };

  if (idempotencyKey) {
    storage.setIdempotency(idempotencyKey, {
      hash: hashPayload(payload),
      response
    });
  }

  return response;
}

async function getDisruption(disruptionId) {
  const disruption = await storage.getDisruptionById(disruptionId);
  if (!disruption) {
    const error = new Error(`Disruption with id '${disruptionId}' not found.`);
    error.status = 404;
    error.code = 'NOT_FOUND';
    throw error;
  }
  return disruption;
}

async function listDisruptions(filters = {}) {
  return storage.listDisruptions(filters);
}

module.exports = {
  createDisruption,
  getDisruption,
  listDisruptions
};
