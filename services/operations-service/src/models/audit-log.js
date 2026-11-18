const crypto = require('node:crypto');
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    auditId: { type: String, required: true, unique: true, index: true },
    caseId: { type: String, required: true, index: true },
    disruptionId: { type: String, default: null },
    eventType: { type: String, required: true },
    actorId: { type: String, default: 'system' },
    traceId: { type: String, default: null },
    oldStatus: { type: String, default: null },
    newStatus: { type: String, default: null },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: String, required: true }
  },
  {
    collection: 'audit_logs',
    versionKey: false
  }
);

const AuditLogModel =
  mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);

function createAuditLogModel({
  caseId,
  disruptionId = null,
  eventType,
  actorId = 'system',
  traceId = null,
  oldStatus = null,
  newStatus = null,
  details = null
}) {
  const auditId = `audit-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();

  return {
    auditId,
    caseId,
    disruptionId,
    eventType,
    actorId,
    traceId,
    oldStatus,
    newStatus,
    details,
    createdAt
  };
}

module.exports = { createAuditLogModel, AuditLogModel };
