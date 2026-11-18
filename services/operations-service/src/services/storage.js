const mongoose = require('mongoose');
const { DisruptionModel } = require('../models/disruption');
const { RecoveryCaseModel } = require('../models/recovery-case');
const { AuditLogModel } = require('../models/audit-log');

class Storage {
  constructor() {
    this.disruptions = new Map();
    this.recoveryRequests = new Map();
    this.auditLogs = [];
    this.idempotencyRecords = new Map();
  }

  get isMongoConnected() {
    return mongoose.connection && mongoose.connection.readyState === 1;
  }

  async saveDisruption(disruption) {
    this.disruptions.set(disruption.disruptionId, { ...disruption });
    if (this.isMongoConnected) {
      await DisruptionModel.findOneAndUpdate(
        { disruptionId: disruption.disruptionId },
        disruption,
        { upsert: true, returnDocument: 'after' }
      );
    }
    return this.disruptions.get(disruption.disruptionId);
  }

  async getDisruptionById(disruptionId) {
    if (this.isMongoConnected) {
      const doc = await DisruptionModel.findOne({ disruptionId }).lean();
      if (doc) {
        return doc;
      }
    }
    const item = this.disruptions.get(disruptionId);
    return item ? { ...item } : null;
  }

  async listDisruptions({ type, priority, scenarioId, status } = {}) {
    if (this.isMongoConnected) {
      const query = {};
      if (type) query.type = type;
      if (priority) query.priority = priority;
      if (scenarioId) query.scenarioId = scenarioId;
      const docs = await DisruptionModel.find(query).sort({ createdAt: -1 }).lean();
      if (status) {
        const caseIds = docs.map((d) => d.caseId);
        const cases = await RecoveryCaseModel.find({ caseId: { $in: caseIds }, status }).lean();
        const validCaseIds = new Set(cases.map((c) => c.caseId));
        return docs.filter((d) => validCaseIds.has(d.caseId));
      }
      return docs;
    }

    let items = Array.from(this.disruptions.values());
    if (type) items = items.filter((d) => d.type === type);
    if (priority) items = items.filter((d) => d.priority === priority);
    if (scenarioId) items = items.filter((d) => d.scenarioId === scenarioId);
    if (status) {
      items = items.filter((d) => {
        const linkedCase = this.recoveryRequests.get(d.caseId);
        return linkedCase && linkedCase.status === status;
      });
    }
    return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async saveRecoveryRequest(request) {
    this.recoveryRequests.set(request.caseId, { ...request });
    if (this.isMongoConnected) {
      await RecoveryCaseModel.findOneAndUpdate(
        { caseId: request.caseId },
        request,
        { upsert: true, returnDocument: 'after' }
      );
    }
    return this.recoveryRequests.get(request.caseId);
  }

  async getRecoveryRequestById(caseId) {
    if (this.isMongoConnected) {
      const doc = await RecoveryCaseModel.findOne({ caseId }).lean();
      if (doc) {
        return doc;
      }
    }
    const item = this.recoveryRequests.get(caseId);
    return item ? { ...item } : null;
  }

  async saveAuditLog(entry) {
    const log = { ...entry };
    this.auditLogs.push(log);
    if (this.isMongoConnected) {
      await AuditLogModel.create(entry);
    }
    return log;
  }

  async getAuditLogsByCaseId(caseId) {
    if (this.isMongoConnected) {
      return AuditLogModel.find({ caseId }).sort({ createdAt: 1 }).lean();
    }
    return this.auditLogs
      .filter((log) => log.caseId === caseId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  getIdempotency(key) {
    return this.idempotencyRecords.get(key) || null;
  }

  setIdempotency(key, record) {
    this.idempotencyRecords.set(key, record);
  }

  async clear() {
    this.disruptions.clear();
    this.recoveryRequests.clear();
    this.auditLogs = [];
    this.idempotencyRecords.clear();
    if (this.isMongoConnected) {
      await DisruptionModel.deleteMany({});
      await RecoveryCaseModel.deleteMany({});
      await AuditLogModel.deleteMany({});
    }
  }
}

const storage = new Storage();

module.exports = { storage, Storage };
