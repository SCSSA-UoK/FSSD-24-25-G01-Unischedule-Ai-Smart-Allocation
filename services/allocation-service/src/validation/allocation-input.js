const { z } = require('zod');

class AllocationInputError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AllocationInputError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const id = z.string().regex(ID_PATTERN, 'Use 1-100 letters, digits, underscores or hyphens; start with a letter or digit.');
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const positiveCount = z.number().int().min(1).max(100000);
const computerCount = z.number().int().min(0).max(100000);
const timestamp = z.iso.datetime({ offset: true, precision: 0 });
const label = z.string().min(1).max(200).regex(/\S/, 'Must contain non-whitespace text.');
const facilities = z.array(id).max(100).refine(
  (items) => new Set(items).size === items.length,
  'Facility codes must be unique.',
);

function checkInterval(value, context) {
  if (Date.parse(value.endAt) <= Date.parse(value.startAt)) {
    context.addIssue({ code: 'custom', path: ['endAt'], message: 'endAt must be after startAt.' });
  }
}

function checkUniqueIds(items, key, path, context) {
  const seen = new Set();
  items.forEach((item, index) => {
    if (seen.has(item[key])) {
      context.addIssue({ code: 'custom', path: [path, index, key], message: 'Duplicate identifier.' });
    }
    seen.add(item[key]);
  });
}

const searchWindow = z.object({ startAt: timestamp, endAt: timestamp }).strict()
  .superRefine((value, context) => {
    checkInterval(value, context);
    if (Date.parse(value.endAt) - Date.parse(value.startAt) > 7 * 24 * 60 * 60 * 1000) {
      context.addIssue({ code: 'custom', path: ['endAt'], message: 'Search windows cannot exceed seven days.' });
    }
  });

const CandidateRequestSchema = z.object({
  scenarioId: id,
  scenarioRevision: revision,
  affectedSessionId: id,
  allowedMoveCount: z.number().int().min(0).max(3),
  preferences: z.object({ minimizeChanges: z.boolean().default(true) }).strict()
    .default({ minimizeChanges: true }),
  limits: z.object({
    maxCandidates: z.number().int().min(1).max(50).default(10),
    timeoutMs: z.number().int().min(1).max(10000).default(2000),
  }).strict().default({ maxCandidates: 10, timeoutMs: 2000 }),
  searchWindow: searchWindow.optional(),
}).strict();

const SessionSchema = z.object({
  sessionId: id,
  lecturerId: id,
  studentGroupId: id,
  roomId: id.nullable(),
  registeredStudents: positiveCount,
  requiredFacilities: facilities,
  requiredWorkingComputers: computerCount,
  startAt: timestamp,
  endAt: timestamp,
}).strict().superRefine(checkInterval);

const RoomSchema = z.object({
  roomId: id,
  seats: positiveCount,
  features: facilities,
  usableComputers: computerCount,
  building: label,
}).strict();

const lecturerUnavailability = z.object({
  lecturerId: id, startAt: timestamp, endAt: timestamp,
}).strict().superRefine(checkInterval);
const groupUnavailability = z.object({
  studentGroupId: id, startAt: timestamp, endAt: timestamp,
}).strict().superRefine(checkInterval);

const PlatformSnapshotSchema = z.object({
  mode: z.literal('fixture'),
  scenarioId: id,
  scenarioRevision: revision,
  timezone: z.literal('Asia/Colombo'),
  constraints: z.object({
    allowTimeChanges: z.boolean(),
    lecturerUnavailability: z.array(lecturerUnavailability).max(5000),
    studentGroupUnavailability: z.array(groupUnavailability).max(5000),
  }).strict(),
  sessions: z.array(SessionSchema).min(1).max(5000),
}).strict().superRefine((value, context) => {
  checkUniqueIds(value.sessions, 'sessionId', 'sessions', context);
});

const RestrictionSchema = z.object({
  restrictionId: id,
  roomId: id,
  kind: z.enum(['closure', 'equipment-outage']),
  startAt: timestamp,
  endAt: timestamp,
  unavailableFacilities: facilities,
  usableComputers: computerCount.nullable(),
  reason: label,
}).strict().superRefine((value, context) => {
  checkInterval(value, context);
  if (value.kind === 'equipment-outage'
      && value.usableComputers === null && value.unavailableFacilities.length === 0) {
    context.addIssue({ code: 'custom', message: 'An equipment outage must identify an affected resource.' });
  }
});

const IntervalSchema = z.object({ startAt: timestamp, endAt: timestamp }).strict()
  .superRefine(checkInterval);
const SessionListSchema = z.array(SessionSchema).max(5000).superRefine((value, context) => {
  checkUniqueIds(value, 'sessionId', 'sessions', context);
});
const RestrictionListSchema = z.array(RestrictionSchema).max(5000).superRefine((value, context) => {
  checkUniqueIds(value, 'restrictionId', 'restrictions', context);
});

const FacilitiesSnapshotSchema = z.object({
  mode: z.literal('fixture'),
  facilitiesVersion: id,
  rooms: z.array(RoomSchema).min(1).max(1000),
  restrictions: z.array(RestrictionSchema).max(5000),
}).strict().superRefine((value, context) => {
  checkUniqueIds(value.rooms, 'roomId', 'rooms', context);
  checkUniqueIds(value.restrictions, 'restrictionId', 'restrictions', context);
});

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'), message: issue.message,
    }));
    throw new AllocationInputError(422, 'INVALID_INPUT', 'Allocation input is invalid.', details);
  }
  return result.data;
}

module.exports = {
  AllocationInputError,
  ID_PATTERN,
  CandidateRequestSchema,
  SessionSchema,
  RoomSchema,
  PlatformSnapshotSchema,
  FacilitiesSnapshotSchema,
  parseCandidateRequest: (value) => parse(CandidateRequestSchema, value),
  parseId: (value) => parse(id, value),
  parseInterval: (value) => parse(IntervalSchema, value),
  parseSession: (value) => parse(SessionSchema, value),
  parseSessions: (value) => parse(SessionListSchema, value),
  parseRoom: (value) => parse(RoomSchema, value),
  parseRestrictions: (value) => parse(RestrictionListSchema, value),
  parsePlatformSnapshot: (value) => parse(PlatformSnapshotSchema, value),
  parseFacilitiesSnapshot: (value) => parse(FacilitiesSnapshotSchema, value),
};
