const mongoose = require('mongoose');
const { DisruptionModel } = require('../models/disruption');
const { RecoveryCaseModel } = require('../models/recovery-case');
const { AuditLogModel } = require('../models/audit-log');

const PRIORITY_WEIGHT = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1
};

function compareCaseQueueOrder(a, b) {
  const weightDiff = (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0);
  if (weightDiff !== 0) {
    return weightDiff;
  }
  return new Date(a.createdAt) - new Date(b.createdAt);
}

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

  async listRecoveryRequests({ status, priority, scenarioId, from, to, limit = 20, offset = 0 } = {}) {
    let items;
    if (this.isMongoConnected) {
      const query = {};
      if (status) query.status = status;
      if (priority) query.priority = priority;
      if (scenarioId) query.scenarioId = scenarioId;
      items = await RecoveryCaseModel.find(query).lean();
    } else {
      items = Array.from(this.recoveryRequests.values()).map((c) => ({ ...c }));
      if (status) items = items.filter((c) => c.status === status);
      if (priority) items = items.filter((c) => c.priority === priority);
      if (scenarioId) items = items.filter((c) => c.scenarioId === scenarioId);
    }

    if (from) {
      const fromTime = Date.parse(from);
      items = items.filter((c) => Date.parse(c.createdAt) >= fromTime);
    }
    if (to) {
      const toTime = Date.parse(to);
      items = items.filter((c) => Date.parse(c.createdAt) <= toTime);
    }

    items.sort(compareCaseQueueOrder);

    const total = items.length;
    const paged = items.slice(offset, offset + limit);
    const nextCursor = offset + paged.length < total ? String(offset + paged.length) : null;

    return { items: paged, nextCursor, total };
  }

  async updateRecoveryRequestWithVersion(caseId, expectedVersion, updates) {
    const nextVersion = expectedVersion + 1;
    const updatedAt = new Date().toISOString();

    if (this.isMongoConnected) {
      const updated = await RecoveryCaseModel.findOneAndUpdate(
        { caseId, version: expectedVersion },
        { $set: { ...updates, version: nextVersion, updatedAt } },
        { returnDocument: 'after' }
      ).lean();

      if (!updated) {
        return null;
      }
      this.recoveryRequests.set(caseId, { ...updated });
      return updated;
    }

    const current = this.recoveryRequests.get(caseId);
    if (!current || current.version !== expectedVersion) {
      return null;
    }

    const updated = {
      ...current,
      ...updates,
      version: nextVersion,
      updatedAt
    };
    this.recoveryRequests.set(caseId, updated);
    return { ...updated };
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
