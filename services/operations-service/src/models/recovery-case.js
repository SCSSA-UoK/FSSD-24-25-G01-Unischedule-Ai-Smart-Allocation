const crypto = require('node:crypto');
const mongoose = require('mongoose');

const recoveryCaseSchema = new mongoose.Schema(
  {
    caseId: { type: String, required: true, unique: true, index: true },
    disruptionId: { type: String, required: true, index: true },
    scenarioId: { type: String, required: true },
    scenarioRevision: { type: Number, required: true },
    priority: { type: String, default: 'normal', index: true },
    priorityReason: { type: String, default: null },
    status: { type: String, default: 'reported', index: true },
    constraintSyncStatus: { type: String, default: 'pending' },
    constraintId: { type: String, default: null },
    constraintSyncMode: { type: String, default: null },
    latestRunId: { type: String, default: null },
    investigationMode: { type: String, default: null },
    investigationError: { type: String, default: null },
    runIds: { type: [String], default: [] },
    planReferences: { type: [mongoose.Schema.Types.Mixed], default: [] },
    selectedPlanId: { type: String, default: null },
    decisionId: { type: String, default: null },
    applicationId: { type: String, default: null },
    version: { type: Number, default: 1 },
    createdAt: { type: String, required: true },
    updatedAt: { type: String, required: true }
  },
  {
    collection: 'recovery_requests',
    versionKey: false
  }
);

const RecoveryCaseModel =
  mongoose.models.RecoveryCase || mongoose.model('RecoveryCase', recoveryCaseSchema);

function createRecoveryCaseModel({
  disruptionId,
  scenarioId,
  scenarioRevision,
  priority = 'normal'
}) {
  const caseId = `case-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  return {
    caseId,
    disruptionId,
    scenarioId,
    scenarioRevision,
    priority,
    priorityReason: null,
    status: 'reported',
    constraintSyncStatus: 'pending',
    constraintId: null,
    constraintSyncMode: null,
    latestRunId: null,
    investigationMode: null,
    investigationError: null,
    runIds: [],
    planReferences: [],
    selectedPlanId: null,
    decisionId: null,
    applicationId: null,
    version: 1,
    createdAt: now,
    updatedAt: now
  };
}

module.exports = { createRecoveryCaseModel, RecoveryCaseModel };
