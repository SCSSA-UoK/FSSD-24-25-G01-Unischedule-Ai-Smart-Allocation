# Academic Disruption & Operations Service — Member 4

**Owner:** Member 4 · **Stack:** Node.js / Express / MongoDB · **Planned port:** 4003

## 1. Overview and current status

Operations manages the recovery process: report a problem, investigate it, review recommendations, record a human decision, and track the result. It owns requests and approvals. **Only Spring Boot can apply an approved change to a simulated timetable.** Approval alone does not mean that a change was applied.

**Available now:** this folder and documentation. There is no Node application, package manifest, running API, notification sender, seed script or test command. All features, routes, schemas, UI pages and application commands below are **planned** unless explicitly described as existing.

Keep the original references: [team ownership](../../docs/01-team-ownership.md), [service interfaces](../../docs/04-service-interfaces.md), and [OpenAPI guidance](../../contracts/openapi/README.md).

Current Spring Boot code has basic `GET` and `POST /api/timetables`, not the proposed scenario validation/application, authentication or approval workflow. Java uses **8081**, while the root template proposes **8080**. Confirm the port with Member 1. Do not bypass simulation validation using the existing create endpoint.

## 2. Main responsibilities and ownership

| Service | Owns |
|---|---|
| Operations | Disruptions, recovery cases, priorities, decisions, notifications and audit history |
| Spring Boot | Baseline records, simulation bookings, revisions, constraints, scheduling validation and authorized application |
| Facilities | Physical rooms, equipment failures, maintenance and closures |
| Allocation | Candidate assignments and optimization measurements |
| Agent | Investigation runs, tool traces and explained recovery plans |

Store references to others' records rather than independently editable copies. Never connect directly to another service's database. Neither Operations nor the Agent may update timetable collections.

## 3. Development modules and feature explanations

| Module | Features in simple English |
|---|---|
| Disruption reporting | Record lecturer absence, lecture postponement, classroom/lab problems and emergency incidents with affected intervals/sessions. |
| Recovery cases | Turn a report into a trackable request with scenario, sessions, investigation and recommendation references. |
| Priority | Use low, normal, high or critical urgency with a written reason; urgency affects queue order, never validation or approval requirements. |
| AI investigation | Start an Agent run, show actual progress, and handle failure/no-solution/retry. |
| Recommendations | Show complete moves, explanations, affected users, validation evidence and before/after preview. |
| Administrator review | Record approval/rejection of an exact plan and revision, then request platform application separately. |
| Notifications | Start with in-app messages after confirmed application; track delivery and retry. Optional demo email comes later. |
| Audit history | Record who reported, investigated, decided and applied, with times and trace IDs. |
| Analytics/reports | Show disruption types, backlog, recovery rates, approval/application time and failure reasons. |

### Reporting rules

- **Lecturer unavailability:** identify lecturer and full absence interval. Resolve affected sessions through Spring Boot rather than trusting only the reporter's list.
- **Postponement:** record the original session and acceptable replacement window; preserve duration, enrollment and equipment requirements.
- **Room/lab disruption:** reference a Facilities restriction where available. Recording a report here does not itself close a physical room.
- **Emergency:** record scope, priority and reason, then prioritize investigation. Human approval and Spring Boot validation still apply.

If an absence is only stored in Operations, Spring Boot cannot reliably validate it. Agree on registering scenario-scoped absence constraints with Member 1. The proposed constraint interface below is a contract addition, not existing functionality.

## 4. Step-by-step recovery workflow and statuses

Proposed case lifecycle:

```text
reported → investigating → awaiting_approval → approved → applying → applied
                         ↘ no_solution
investigating → investigation_failed
awaiting_approval → rejected
approved / applying → stale | application_failed
```

1. Authenticate the reporter and validate the report. Save a disruption and linked case using a retry-safe request.
2. Read affected sessions/current revision from Spring Boot. Register required absence constraints through the agreed platform interface. If this changes the revision, use the returned new revision.
3. Start `POST /agent/runs` with scenario, revision, disruption and case references. Store `runId`; poll with bounded retries.
4. The Agent reads timetable/facility data, calls Allocation, and requests Spring Boot validation of whole candidate plans.
5. Retrieve the plans and validation evidence. Display pending/invalid options clearly; offer approval only for a current, validated plan.
6. An authorized administrator approves or rejects one exact plan. Save the decision and audit event. Rejection must not call apply.
7. For approval, request Spring Boot application with the approved moves, expected revision, decision reference and idempotency key. An idempotency key identifies one operation so network retries cannot repeat it.
8. Spring Boot verifies authorization, approval binding, revision and fresh scheduling constraints, then atomically applies all moves to the simulation. It returns an application reference and new revision.
9. Only after confirmed application, mark the case applied, record the receipt and queue notifications. Refresh the timetable from Spring Boot to confirm.

Retain old investigation runs. A failed/no-solution case can be reopened with revised constraints and a new run. A stale plan needs renewed investigation/validation and a new decision; never silently transfer approval to changed moves.

## 5. Complete lecturer-unavailability example

Use fictional `scenario-demo-01`. S001 has 40 students, lecturer L001, group G1 and room HALL_A, initially scheduled for **2026-11-02 09:00–11:00 Asia/Colombo**. This is a dated expansion of the sample Monday entry, not a real faculty booking.

1. L001 reports absence for the Monday interval.
2. Operations creates `disruption-001` and `case-001`.
3. Assume the scenario started at revision 2. Spring Boot registers the absence constraint and returns revision **3**.
4. Operations starts Agent run `agent-001` against revision 3.
5. In this fixture, Tuesday **2026-11-03 09:00–11:00** has no L001/G1 conflict. HALL_A is occupied by S004, but ROOM_C is empty. Facilities confirms ROOM_C has 50 seats and a working projector.
6. Agent/Allocation proposes S001 → ROOM_C on Tuesday. Spring Boot validates lecturer, group, room, capacity, equipment and absence constraints. The Agent publishes `plan-001`, linked to `candidate-001`.
7. Operations displays the time/room changes and validation revision. An administrator approves that exact plan.
8. Spring Boot revalidates and applies only to the simulation, returning revision **4** and receipt `application-001`.
9. Operations marks the case applied, queues simulated in-app messages for L001 and G1 demonstration users, and records the history. The baseline stays unchanged.

If L001 is also unavailable Tuesday, that recommendation must fail. An empty room alone cannot prove lecturer/group availability.

## 6. Stack and suggested folder structure

Suggested libraries: Express for HTTP, Mongoose for owned data, dotenv for root configuration, Zod for validation, Vitest and Supertest for tests. These are not installed yet.

```text
services/operations-service/
  README.md
  package.json                  # to create
  src/
    server.js
    app.js
    config/env.js
    routes/
    controllers/
    services/                   # cases, decisions, notifications, reports
    clients/                    # platform, agent, facilities
    models/
    validators/
    middleware/                 # auth, errors, trace IDs
    workers/                    # polling, retry and reconciliation
  fixtures/
  tests/
```

Keep workflow transitions in a service layer rather than duplicating them across route handlers.

## 7. MongoDB database and collection design

Use owned logical database `operations_db` under the shared MongoDB URI.

| Collection | Suggested fields | Indexes / rules |
|---|---|---|
| `disruptions` | disruptionId, type, scenarioId, affectedSessionIds, lecturerId/roomId, interval, description, priority, reporterId, createdAt | unique disruptionId; scenarioId + createdAt |
| `recovery_requests` | caseId, disruptionId, priority, status, scenarioRevision, runIds, planReferences, selectedPlanId, decisionId, applicationId, createdAt, updatedAt, version | unique caseId; status + priority + createdAt |
| `approval_records` | decisionId, caseId, recoveryPlanId, candidateId, scenarioRevision, planHash, decision, reason, actorId, decidedAt | unique decisionId; caseId + decidedAt |
| `notifications` | notificationId, caseId, recipientId, channel, template, applicationId, deliveryStatus, attempts, createdAt | unique delivery deduplication key; recipientId + createdAt |
| `audit_logs` | auditId, caseId, eventType, actorId, traceId, oldStatus, newStatus, referenceIds, createdAt | unique auditId; caseId + createdAt |
| `delivery_jobs` (optional outbox) | jobId, kind, deduplicationKey, payloadReferences, status, nextAttemptAt, attempts | unique deduplicationKey; status + nextAttemptAt |

Use public string IDs independently of MongoDB `_id`. Actor IDs come from authenticated identity, not an editable `approvedBy` field. Approval records are append-only; a revised decision is a new record. A plan hash is a fingerprint of its canonical move data; agree on canonicalization before using it to bind approval.

Audit records should preserve context without tokens or unnecessary personal data. An ordinary collection is not automatically tamper-proof; restrict writes and define retention.

### Durable changes with the current local MongoDB

The supplied standalone MongoDB does **not** support multi-document transactions. Initially make each case transition atomic using a version filter and embed pending audit/delivery events in the same case document. A worker creates linked records with unique event IDs, then marks the embedded event delivered. This allows recovery after crashes.

Alternatively, agree on a replica-set setup before relying on transactions spanning cases, decisions and outbox records. External Spring Boot application still needs idempotency and reconciliation: a local MongoDB transaction cannot roll back an HTTP call.

## 8. Shared identifiers and data formats

Use string `scenarioId`, `sessionId`, `roomId`, `disruptionId`, `caseId`, `runId`, `candidateId`, `recoveryPlanId`, and `decisionId`. The Agent's `recoveryPlanId` links to Allocation's `candidateId`; they are not interchangeable.

Requirements use `registeredStudents`, `requiredFacilities`, `requiredWorkingComputers`; physical capacity uses `seats`. Preserve sample IDs `HALL_A`, `ROOM_C`, `LAB_A`.

Use dated ISO 8601 `startAt`/`endAt` with offsets and `timezone: "Asia/Colombo"`. Intervals are half-open `[startAt, endAt)`. Every plan and decision includes the platform's integer `scenarioRevision`.

The current Java model has `id`, weekday and string times, without dated scenarios. Agree on `id` → `sessionId`, CSV mappings and recurrence expansion with Member 1. These examples are proposed dated fixtures, not supported current Java request payloads.

## 9. Proposed REST APIs and JSON examples

**These Operations APIs do not run yet.** Publish agreed schemas later in `contracts/openapi/operations.openapi.yaml`.

| Method and path | Purpose | Success |
|---|---|---|
| POST `/operations/disruptions` | Create report and linked case | 201 |
| GET `/operations/disruptions` | Filter by type, priority, status and date | 200 |
| GET `/operations/disruptions/{disruptionId}` | Read report/context | 200 |
| GET `/operations/recovery-cases` | Paginated case board | 200 |
| GET `/operations/cases/{caseId}` | Read status, details and references | 200 |
| POST `/operations/cases/{caseId}/investigations` | Queue/start Agent investigation | 202 |
| GET `/operations/cases/{caseId}/recommendations` | Read plans and validation evidence | 200 |
| POST `/operations/cases/{caseId}/decision` | Approve/reject; approval queues application | 202 approve / 200 reject |
| GET `/operations/cases/{caseId}/history` | Read audit timeline | 200 |
| GET `/operations/notifications` | Current user's notification history | 200 |
| PATCH `/operations/notifications/{notificationId}` | Mark own notification read | 200 |
| GET `/operations/reports` | Disruption and recovery metrics for from/to window | 200 |

The shared interfaces use `recovery-cases` for lists and `cases` for actions; preserve this unless the team agrees to change it. Lists use bounded `limit`/`cursor` and return `{items, nextCursor}`.

### A. Report lecturer unavailability

`POST /operations/disruptions`, with `Idempotency-Key: demo-absence-001`:

```json
{
  "type": "lecturer_unavailable",
  "scenarioId": "scenario-demo-01",
  "scenarioRevision": 2,
  "affectedSessionIds": ["S001"],
  "lecturerId": "L001",
  "startAt": "2026-11-02T09:00:00+05:30",
  "endAt": "2026-11-02T11:00:00+05:30",
  "timezone": "Asia/Colombo",
  "priority": "high",
  "description": "Lecturer cannot attend the scheduled session."
}
```

201 response:

```json
{
  "disruptionId": "disruption-001",
  "caseId": "case-001",
  "status": "reported",
  "scenarioId": "scenario-demo-01",
  "scenarioRevision": 2,
  "constraintSyncStatus": "pending"
}
```

The reporter comes from authentication. Before investigation, proposed platform addition `POST /api/scenarios/{scenarioId}/constraints` registers `{type, lecturerId, startAt, endAt, disruptionId, scenarioRevision}`. For this fixture expect `{constraintId, scenarioRevision: 3}`. Agree on this interface and revision behavior with Member 1; use an explicit mock until implemented and never claim authoritative absence validation occurred.

### B. Start and view an investigation

`POST /operations/cases/case-001/investigations`:

```json
{"scenarioRevision":3}
```

Return 202 `{"caseId":"case-001","status":"investigating","runId":"agent-001"}` only after a run reference is known. If queued before dispatch, return an explicit `dispatchStatus: "queued"` without inventing a run ID. The internal proposed Agent request carries scenarioId, scenarioRevision, disruptionId and caseId.

After polling the Agent, an example recommendation response is:

```json
{
  "caseId": "case-001",
  "status": "awaiting_approval",
  "plans": [{
    "recoveryPlanId": "plan-001",
    "candidateId": "candidate-001",
    "scenarioRevision": 3,
    "validationStatus": "valid",
    "validationReference": "validation-001",
    "explanation": "Move S001 to an available Tuesday slot in ROOM_C.",
    "moves": [{"sessionId":"S001","fromRoomId":"HALL_A","toRoomId":"ROOM_C","startAt":"2026-11-03T09:00:00+05:30","endAt":"2026-11-03T11:00:00+05:30"}]
  }]
}
```

This example assumes Spring Boot really validated revision 3. Mocked validation must be labelled and cannot be presented as integrated approval evidence.

### C. Approve, then apply through Spring Boot

`POST /operations/cases/case-001/decision`, authenticated as administrator, with an idempotency key:

```json
{
  "decision": "approve",
  "recoveryPlanId": "plan-001",
  "scenarioRevision": 3,
  "reason": "Lecturer and group are available on Tuesday."
}
```

Return 202 `{"caseId":"case-001","decisionId":"decision-001","status":"approved","applicationStatus":"queued"}`. This is not an applied result. For rejection, use `decision: "reject"` and a reason, return status `rejected`, and never call apply.

Operations loads the immutable server-side plan, binds it to the decision, then makes this proposed platform call:

```http
POST /api/scenarios/scenario-demo-01/apply
Idempotency-Key: apply-decision-001
```

```json
{
  "scenarioRevision": 3,
  "decisionId": "decision-001",
  "recoveryPlanId": "plan-001",
  "candidateId": "candidate-001",
  "moves": [{"sessionId":"S001","fromRoomId":"HALL_A","toRoomId":"ROOM_C","startAt":"2026-11-03T09:00:00+05:30","endAt":"2026-11-03T11:00:00+05:30"}]
}
```

Expected platform receipt:

```json
{"applicationId":"application-001","scenarioId":"scenario-demo-01","previousRevision":3,"scenarioRevision":4,"status":"applied"}
```

After saving the receipt, the case response may be `{"caseId":"case-001","status":"applied","applicationId":"application-001","scenarioRevision":4}`.

Member 1 must define how Spring Boot verifies the approval actor, exact moves and authorization, for example using an authenticated lookup of an approval record. A client-supplied decision ID alone is not proof. Add any internal lookup endpoint to the agreed contract before implementation.

## 10. Integration, failures and Agent permissions

- **Platform:** proposed scenario sessions API supplies dated sessions and revision. Constraint sync, `/validate` and `/apply` remain authoritative; no local timetable edits.
- **Agent:** start runs, poll `GET /agent/runs/{runId}`, and retrieve `GET /agent/runs/{runId}/plans`. Preserve failed, timed-out and no-solution outcomes. Agree retry-safe dispatch or lookup by request key to avoid duplicate runs after timeouts.
- **Facilities:** reference maintenance/restrictions. A physical closure must reach Facilities before validation can rely on it.
- **Allocation:** normally called by Agent. Display candidate IDs/costs as plan context, not a separate approval authority.
- **Auth:** agree JWT/user roles and service credentials with Member 1. Reporters access authorized cases; only administrators decide. Agent credentials have no decision or apply permission.

On a stale-revision 409, mark the case stale and obtain a fresh plan/decision. If the network times out after apply, the outcome is unknown: reconcile using the same idempotency key and an agreed platform application-status lookup, or retry that same idempotent operation. Do not generate a new application or notify success until confirmed. Application-status lookup is another contract to finalize with Member 1.

Repeated identical idempotency keys return the same result; the same key with different content returns 409. Concurrent decisions require a case-version check so only one current decision wins. Keep bounded retries, timeouts and correlation IDs.

## 11. Notifications, audit logs and performance reports

Start with fictional in-app recipients. Email is optional and requires a sender and private configuration later. Notification failure must not reapply or roll back a completed simulation change.

Deduplicate messages by `(applicationId, recipientId, channel, template)`. Record attempts and backoff, show failed deliveries, and make messages explicitly about simulated changes. Do not send real imported student lists demonstration messages.

Audit events include report creation, priority changes, constraint synchronization, investigation start/result, review, approval/rejection, apply request/result and notification delivery. Preserve actor, timestamp, trace ID, plan and revision references.

Define reports so readers can interpret them:

- Disruptions by type/priority and open-case backlog by age.
- Median/p95 report-to-recommendation and report-to-application time.
- Approval waiting time: recommendation available → administrator decision.
- Applied recovery rate: applied cases ÷ cases created in a named cohort/window. Show pending/rejected/no-solution/failed counts separately.
- Application success rate: confirmed applications ÷ attempted applications, deduplicated by operation key.
- Notification delivery rate and failed-message count.

Do not count approval as recovery. Return null for empty denominators and explain unfinished cases. Record measurements from actual dummy runs instead of inventing results.

## 12. Frontend pages and dashboards

Build proposed routes under `apps/web/src/app/(dashboard)/operations/` in the shared Next.js app:

- **Incident form/board:** type, interval, sessions, priority, filters and age.
- **Recovery details:** lifecycle timeline, constraint-sync state, real investigation progress and retry controls.
- **Approval dashboard:** exact plan, before/after moves, reasons, conflicts, validation revision and approve/reject reason.
- **Notifications:** read/unread messages; administrators can inspect failed deliveries.
- **Audit history:** searchable actor/event timeline with trace IDs.
- **Reports:** disruption mix, backlog, recovery time and application outcomes.

Show approved-but-pending separately from applied. Disable approval for pending/invalid/stale plans and enforce this on the server too. Include loading/empty/dependency-error states. The shared frontend/auth shell still needs implementation.

## 13. Development setup and shared root environment

Existing infrastructure steps, from repository root:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d mongodb
docker compose ps
```

Compose starts only local standalone MongoDB. Atlas is optional through a private root `.env` URI. Never commit real credentials or `.env` files.

From this service directory, initialize the future application:

```powershell
npm init -y
npm install express mongoose dotenv zod
npm install --save-dev nodemon vitest supertest
```

Create `src/server.js` and proposed scripts `dev: nodemon src/server.js`, `start: node src/server.js`, `test: vitest run`. Only then use `npm run dev` and `npm test`; these commands are not currently supplied. Agree on CommonJS or ES modules.

In future CommonJS `src/config/env.js`, load the root file independently of the shell working directory:

```js
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
```

| Variable | Status / use |
|---|---|
| `MONGODB_URI` | Existing key; select `operations_db` explicitly in the client |
| `OPERATIONS_PORT=4003` | Existing key |
| `AI_PORT=8000` | Existing key |
| `FACILITIES_PORT=4002` | Existing key |
| `PROJECT_TIMEZONE=Asia/Colombo` | Existing key |
| `PLATFORM_BASE_URL=http://localhost:8081` | Proposed new root key matching Java config; confirm first |
| `AGENT_BASE_URL=http://localhost:8000` | Proposed new root key |
| `FACILITIES_BASE_URL=http://localhost:4002` | Proposed new root key |
| `OPERATIONS_DB=operations_db` | Optional proposed root key |
| `USE_MOCK_CLIENTS=true` | Proposed development-only fixture adapter key |

The template's `SPRING_PORT=8080` does not override the hardcoded Java port today. Never expose service credentials through `NEXT_PUBLIC_*`. Define authentication verification settings with Member 1 once the auth contract exists. No fabricated production key belongs here.

## 14. Independent dummy-data workflow and tests

1. Build fixtures from [sample timetable](../../examples/sample_timetable.csv), preserving IDs and mapping weekdays to explicit fictional dates.
2. Implement mock Platform, Agent and Facilities adapters. A mock platform tracks fixture revision and returns simulated application receipts. Label mock integration clearly.
3. Seed only Operations-owned records and user references, never timetable bookings.
4. Test workflow functions and HTTP routes with Supertest. Run proposed `npm test` after setup.
5. Replace one adapter at a time with real APIs. Full-system tests belong to the integration phase.

| Test | Expected outcome |
|---|---|
| Lecturer-absence happy path | Report → investigate → review → approve → confirmed apply → notify |
| Absence constraint sync fails | No claim of validated absence recovery |
| Agent fails or finds no solution | Explicit status/history; no approval/application |
| Non-administrator decides | 403, no decision or apply |
| Administrator rejects | Audit reason; no application |
| Proposed moves differ from approved moves | Reject; no silently changed plan |
| Revision changes during review | Stale response; renewed review required |
| Concurrent administrator decisions | One succeeds, other conflicts |
| Apply succeeds but response is lost | Reconcile same key; no duplicate change/message |
| Notification delivery fails | Case stays applied; delivery retries independently |
| Repeated report key | One report/case; different content conflicts |
| Physical closure overlaps candidate | Spring Boot rejects until a fresh valid option exists |

## 15. Validation and errors

Validate supported types/priorities, required lecturer or room IDs, known scenario/session IDs, start before end, reporting scope and bounded description length. Verify affected sessions against Spring Boot. Never let urgency bypass constraints.

Validate transitions on the server, bind decisions to exact plans/revisions, derive actors from authentication and use optimistic case versions. Restrict case/history/notification access. Sanitize logs; do not store tokens in audits.

Use 400 malformed input, 401/403 auth failures, 404 missing record, 409 stale/state/idempotency conflict, 422 invalid workflow requirements, and 503/504 dependency unavailable/timeout.

```json
{"code":"STALE_SCENARIO","message":"Investigate the updated scenario before approving this plan.","traceId":"trace-demo-03","details":{"expectedRevision":3,"currentRevision":4}}
```

Unknown application outcomes are neither definite success nor definite failure. Keep a reconciling flag/state visible until the platform confirms the result.

## 16. Development phases

1. **Foundation:** root config, owned models, schemas, fixture adapters and incident creation.
2. **Tracking:** priorities, safe transitions, board, audits and constraint-sync mocks.
3. **AI workflow:** dispatch/polling, recommendation display and failure/no-solution handling.
4. **Decisions:** administrator authorization, revision checks, retry-safe platform apply adapter and reconciliation.
5. **Reporting/integration:** durable notifications, dashboards, metrics and real service integration.

## 17. Final demonstration and member checklist

Demonstrate section 5: L001's report, synchronized absence revision, actual Agent investigation, validated Tuesday plan, administrator decision, confirmed platform revision 4, notifications and audit history. Compare baseline and simulation. Then show a rejected/stale plan that changes no booking.

- [ ] Lecturer, postponement, room/lab and emergency reports work.
- [ ] Priority, transitions and failure/no-solution states are visible.
- [ ] Absence constraints and Facilities restrictions reach authoritative validation.
- [ ] Runs/plans are traceable; mock evidence is clearly labelled.
- [ ] Only administrators decide on exact validated plans.
- [ ] Only Spring Boot applies simulation changes after fresh validation.
- [ ] Retries and unknown outcomes cannot duplicate changes.
- [ ] Notifications follow confirmed application and retry independently.
- [ ] Audit, incident, approval, notification and report pages work with dummy data.
- [ ] Root configuration and independent tests are documented.
- [ ] Team agrees ports, auth, approval proof, constraint sync, idempotency and application-status lookup.
- [ ] No source behavior, official baseline, credentials or private timetable data is changed.
