const crypto = require('node:crypto');
const mongoose = require('mongoose');

const disruptionSchema = new mongoose.Schema(
  {
    disruptionId: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true },
    scenarioId: { type: String, required: true, index: true },
    scenarioRevision: { type: Number, required: true },
    affectedSessionIds: { type: [String], required: true },
    lecturerId: { type: String, default: null },
    roomId: { type: String, default: null },
    startAt: { type: String, required: true },
    endAt: { type: String, required: true },
    timezone: { type: String, default: 'Asia/Colombo' },
    priority: { type: String, default: 'normal' },
    description: { type: String, required: true },
    reporterId: { type: String, default: 'demo-reporter' },
    caseId: { type: String, required: true, index: true },
    createdAt: { type: String, required: true }
  },
  {
    collection: 'disruptions',
    versionKey: false
  }
);

const DisruptionModel =
  mongoose.models.Disruption || mongoose.model('Disruption', disruptionSchema);

function createDisruptionModel({
  type,
  scenarioId,
  scenarioRevision,
  affectedSessionIds,
  lecturerId = null,
  roomId = null,
  startAt,
  endAt,
  timezone = 'Asia/Colombo',
  priority = 'normal',
  description,
  reporterId = 'demo-reporter',
  caseId
}) {
  const disruptionId = `disruption-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();

  return {
    disruptionId,
    type,
    scenarioId,
    scenarioRevision,
    affectedSessionIds,
    lecturerId,
    roomId,
    startAt,
    endAt,
    timezone,
    priority,
    description: description.trim(),
    reporterId,
    caseId,
    createdAt
  };
}

module.exports = { createDisruptionModel, DisruptionModel };
