# Room Allocation & Optimization Service — Member 2

**Owner:** Member 2 · **Stack:** Node.js / Express / MongoDB · **Default port:** 4001

## 1. Overview and current status

This service recommends rooms and recovery arrangements. It searches empty rooms, explores moving existing lectures, and compares solutions. It must never update official or simulated timetable bookings. Spring Boot alone validates scheduling and applies administrator-approved simulation changes.

**Available now:** an Express service with `GET /health` and `POST /allocation/candidates`, strict input validation, read-only fixture clients, room checks and direct-room candidate generation. [Four fictional fixtures](fixtures/README.md) support independent testing. Every generated candidate is a target-only move at its original time, explicitly marked fixture/pending. Swaps, ranking, live upstream integration, authentication, persistence and allocation UI pages remain **planned**.

`GET /health` returns `200` with `{"status":"ok","service":"allocation-service"}`. This is a liveness check: it does not connect to or report readiness for MongoDB, Platform or Facilities. Each response has a generated `X-Request-Id`; errors include the same value as `traceId`. Unknown routes return a JSON `404`, malformed JSON returns `400`, JSON bodies over 100kb return `413`, and unsupported body encodings return `415`. Unexpected failures return a generic `500` without internal error details.

Read [team ownership](../../docs/01-team-ownership.md), [service interfaces](../../docs/04-service-interfaces.md), and [OpenAPI guidance](../../contracts/openapi/README.md). These preserve the original service handover references.

Spring Boot now has basic timetable endpoints and `/api/simulations` preview/move APIs. Its preview explicitly warns that changes are not scheduling-validated. It still lacks the proposed versioned `/api/scenarios` snapshot/validate/apply contract needed by Allocation: current previews have recurring times and omit required enrollment/equipment facts. Facilities currently has a local demo UI, without a backend API. The fixture clients below do not call these services or infer missing facts. Java uses port **8081**; the root template proposes **8080**. Confirm the live contract with the owners before integration.

## 2. Responsibilities and data ownership

| Owner | Owns | Allocation may do |
|---|---|---|
| Allocation | Optimization runs, candidates, scoring settings | Store recommendations and measurements |
| Facilities | Physical rooms, seats, equipment and restrictions | Read suitability through APIs |
| Spring Boot | Sessions, bookings, availability constraints, scenarios and revisions | Read snapshots and request authoritative validation |
| Agent | Investigations, recovery plans and explanations | Call deterministic allocation tools |
| Operations | Disruptions, decisions and notifications | Reference recommendations for human review |

Never connect directly to another service's MongoDB database. A cached schedule is a versioned input snapshot, never a second timetable authority. Allocation should have no apply credentials.

## 3. Development modules and feature explanations

| Module | What to build | Input → output |
|---|---|---|
| Smart search | Filter rooms by capacity, equipment, requested time and restrictions, then remove overlapping bookings | Session requirements + snapshot → eligible rooms and rejection reasons |
| Direct allocation | Recommend an eligible empty room without moving another session | Eligible rooms → direct candidates |
| Suitability scoring | Prefer rooms with a sensible seat fit and convenient location | Eligible room + requirements → score and explanation |
| Room swaps | Move an occupant to another room to free a hall; also consider exchanging two occupied rooms | Assignments → complete move sets |
| Multi-step reallocation | Search chains of movements with strict limits | Snapshot + limits → bounded candidate list |
| Alternative slots | Try permitted dates/times while respecting lecturer and group availability | Search window + constraints → time-change proposals |
| Optimization | Prefer fewer displaced lectures and fewer time changes | Candidates → ranked options with costs |
| Simulation preview | Apply moves to an in-memory copy and show differences | Snapshot + moves → before/after view, never a booking write |
| Analytics | Compare recovery approaches and measure performance | Run records → success, movement and latency charts |

### Algorithm workflow

1. Read a scenario snapshot and revision from Spring Boot; read physical facts and restrictions from Facilities.
2. Reject missing requirements instead of guessing enrollment or facilities.
3. Try direct room search first. Intervals overlap when `a.start < b.end && b.start < a.end`; touching intervals do not overlap. Agree on any travel/setup buffers separately.
4. If direct search fails, inspect occupied halls large enough for the target. Find an empty suitable destination for each occupant. Return the occupant and target moves together.
5. For longer chains, use breadth-first search: examine one-displacement solutions before two-displacement solutions. Track the complete assignment as the state, remember visited states, and reject cycles. Cap depth, candidates and elapsed time.
6. If needed, search alternative slots inside agreed teaching hours and the lecturer/group availability window. Preserve duration unless explicitly authorized.
7. Send every complete candidate to Spring Boot for validation. Local filtering cannot prove scheduling validity.
8. Rank valid candidates and store their revision, validation evidence and reasons. If time expires, return `truncated: true`; an incomplete search cannot prove that no solution exists.

### Scoring and comparing solutions

First reject hard failures: insufficient seats/equipment, closures and scheduling conflicts. A high score cannot cancel a hard failure.

An illustrative seat-fit score is `100 * registeredStudents / seats`, calculated only for eligible rooms. It describes seat fit, not scheduling validity. A proposed candidate cost is:

```text
cost = 100 * displacedExistingSessions
     + 200 * timeChangedSessions
     + 10  * buildingChangedSessions
     + totalUnusedSeats / 10
```

Count each session once per applicable component. Exclude the target from `displacedExistingSessions`, but include its time/building changes where applicable. These weights are suggested settings, not university policy. Record a scoring version, show each component and use stable ID ordering for ties. Compare candidates validated against the same revision.

## 4. Complete example: a lecture needs 100 seats

Create an additional fictional fixture for **2026-11-02 09:00–11:00 Asia/Colombo**. These rooms are additions, not the existing sample rooms.

| Session/resource | Before | Requirements |
|---|---|---|
| S010 | 40 students in HALL_LARGE, capacity 150 | Projector |
| S100 | 100 students, no assigned room in simulation | Projector |
| ROOM_SMALL | Empty, 50 seats, working projector | Open for the full interval |

All other rooms are occupied or too small. Direct search correctly finds no empty room for S100.

1. S010 fits ROOM_SMALL because 40 ≤ 50 and the projector works.
2. Propose S010 → ROOM_SMALL at the same time.
3. Propose S100 → HALL_LARGE at the same time.
4. Spring Boot validates the whole final assignment, including both lecturers, student groups, room occupancy and equipment.
5. Compare this option, with one displaced existing session, against alternatives such as moving S100 to another time.
6. Show both moves together. Operations obtains approval; Spring Boot rechecks fresh constraints and applies the entire plan only to the simulation.

Assuming both rooms are in the same building, spare seats total `(50-40)+(150-100)=60`; the illustrative cost is `100+60/10=106`. This is a relocation that frees a hall. A two-way swap exchanges rooms of two already assigned sessions; it also needs whole-plan validation.

## 5. Shared input and output formats

Use the following **proposed** normalized contract consistently across all three services:

- Stable string IDs: `scenarioId`, `sessionId`, `roomId`, `disruptionId`, `caseId`, `runId`, `candidateId`, `recoveryPlanId`.
- Requirements: `registeredStudents`, `requiredFacilities`, `requiredWorkingComputers`. Physical capacity: `seats`.
- Dated ISO 8601 `startAt`/`endAt` with offsets and `timezone: "Asia/Colombo"`. Intervals are half-open `[startAt, endAt)`.
- Integer `scenarioRevision` comes from Spring Boot and accompanies every proposal and decision.
- `allowedMoveCount` is the maximum number of **other existing sessions** displaced, excluding the target; the returned move list still includes the target.
- Candidate validation states: `pending`, `valid`, `invalid`, `stale`. Only an actual Spring Boot result may set `valid`; store its reference/time.

The current Java models use recurring weekday/time fields and lack the normalized revision/dates/requirements contract. Agree identity mapping with Member 1; do not guess a lecturer or join unrelated records to invent enrollment. For fictional CSV-style rows, `normalizeTimetableRow()` maps `session_id`, `registered_count` and `room_code`, requiring an explicit matching date and facilities/computer requirements. It preserves IDs and uses the project's `+05:30` offset. `normalizeFacilitiesRoom()` maps canonical sample rooms; computer-equipped rooms require an explicit working count. These functions accept parsed objects, not raw CSV files or the Facilities UI's display labels. Shared samples are unchanged.

Request validation accepts bounded IDs, nonnegative safe scenario revisions, `allowedMoveCount` from 0 to 3, and optional preferences/search limits. Defaults are `minimizeChanges: true`, `maxCandidates: 10` and `timeoutMs: 2000`; maximum limits are 50 candidates and 10000ms. An optional dated search window must run forwards, span at most seven days and contain the entire affected session. Validation rejects unknown fields, missing requirements, invalid calendar dates, reversed intervals, duplicate IDs and unknown room/session references. These are input checks, not authoritative scheduling validation.

### Local room checks

`inspectRoomOptions(request, clients)` uses the validated input-preparation boundary, then checks every room at the affected session's existing time. It returns stable, ID-sorted `roomChecks` and `eligibleRoomIds`, along with the scenario revision and facilities version. Output retains `mode: "fixture"`, `scope: "room-checks-only"` and `validationStatus: "pending"`; it contains no moves or candidates.

- `suitable` means the room meets these physical capacity, equipment and restriction checks.
- `available` means no other session occupies that room during the affected interval. The target's own booking is excluded by session ID; every other overlapping booking remains a blocker.
- `eligible` requires both. This is local room eligibility, not proof of lecturer/group availability or whole-plan validity.
- Intervals are half-open and compared as parsed instants, so adjacent sessions do not overlap and equivalent timestamps with different offsets compare correctly. No travel/setup buffer is applied.
- Any overlapping closure rejects a room. Outages remove affected facilities; working-computer caps use the minimum of the baseline and all overlapping caps. Zero is a real cap, null is no cap, and a cap never increases the baseline. Counts already reduced in a snapshot are not reduced twice.

Checks accumulate reasons with `code` and `message`: `CAPACITY_EXCEEDED`, `MISSING_FACILITY`, `INSUFFICIENT_COMPUTERS`, `ROOM_CLOSED` and `ROOM_OCCUPIED`. Each result also reports effective computers, missing facilities, active restriction IDs and blocking session IDs. An empty eligible list means no room passes these direct checks; it does not prove that relocation or another recovery plan is impossible.

`checkRoomSuitability()` and `findRoomConflicts()` are reusable helpers for individual room facts and bookings. For a complete request, use `inspectRoomOptions()` so scenario/revision checks and cross-room reference validation run first. Room inspection does not write bookings or call external services.

## 6. Stack and folder structure

The service uses CommonJS, Express, dotenv and Zod. Tests use Node's built-in test runner, Supertest and YAML parsing for contract checks. Node.js 22 or later is required. The service does not use a database or live external API client yet.

```text
services/allocation-service/
  README.md
  package.json
  package-lock.json
  src/
    server.js
    app.js
    config/env.js
    preview-input.js            # local fixture-input command
    preview-rooms.js            # local room-check command
    routes/health.js
    routes/candidates.js
    middleware/                # request IDs and error responses
    tests/                     # HTTP, environment and fixture checks
    controllers/               # placeholder
    services/                  # input preparation, room inspection and direct candidates
    algorithms/                # interval overlap and room suitability/occupancy checks
    clients/                   # read-only fixture clients and sample normalizers
    models/                    # placeholder
    validation/                # request, session, room and snapshot schemas
  fixtures/
```

Algorithms should accept plain data so they can be tested without a live LLM or database.

## 7. MongoDB design

Use owned logical database `allocation_db` under the shared MongoDB URI.

| Collection | Suggested fields | Indexes |
|---|---|---|
| `optimization_runs` | runId, scenarioId, scenarioRevision, request, limits, status, elapsedMs, truncated, facilitiesVersion, createdAt | unique runId; scenarioId + createdAt |
| `allocation_candidates` | candidateId, runId, moves, costBreakdown, reasons, validationStatus, validationReference, validatedAt | unique candidateId; runId + cost |
| `scoring_settings` | version, weights, searchLimits, createdAt | unique version |

Use public IDs separately from MongoDB `_id`. Record scoring and facilities versions for reproducibility. Agree retention for large temporary snapshots. Do not create a timetable-bookings collection here.

## 8. REST API and JSON examples

The [OpenAPI contract](../../contracts/openapi/allocation.openapi.yaml) documents the implemented fixture-only candidate endpoint and health route. Scoring and other routes remain proposals. The contract awaits team review and does not establish live upstream compatibility or implemented authentication.

| Method and path | Behavior | Status |
|---|---|---|
| GET `/health` | HTTP process liveness | Implemented |
| POST `/allocation/candidates` | Direct room changes from the fixture catalog | Implemented, 200 |
| POST `/allocation/room-swaps` | Relocation/swap search | Planned |
| POST `/allocation/score` | Ranked costs | Planned |
| GET `/allocation/results/{runId}` | Stored run lookup | Planned |
| GET `/allocation/analytics?from=...&to=...` | Benchmark summaries | Planned |

Send `Content-Type: application/json`. The default resolver accepts only the four fixture scenario IDs in the [fixture guide](fixtures/README.md); an unknown scenario returns 404 instead of falling back to another dataset. Clients can be injected through `createApp({ clients })` for independent tests. Neither mode calls timetable mutation or apply APIs.

Example candidate request:

```json
{
  "scenarioId": "scenario-direct-001",
  "scenarioRevision": 3,
  "affectedSessionId": "S007",
  "allowedMoveCount": 0,
  "preferences": {"minimizeChanges": true},
  "limits": {"maxCandidates": 10, "timeoutMs": 2000}
}
```

A response includes a unique `runId`, scenario/revision, `facilitiesVersion`, `mode: "fixture"`, `scope: "direct-only"`, `validationStatus: "pending"`, candidates, processed room checks, reasons and `truncated`. The direct-room fixture produces one candidate containing this move:

```json
{
  "sessionId": "S007",
  "fromRoomId": null,
  "toRoomId": "HALL_A",
  "startAt": "2026-11-16T09:00:00+05:30",
  "endAt": "2026-11-16T11:00:00+05:30"
}
```

Each candidate also has a stable bounded `candidateId`, `validationStatus: "pending"`, `displacedExistingSessions: 0` and reasons. Its ID hashes the scenario/revision, facilities version and exact move; it is not approval evidence. Room-ID order is deterministic, while `runId` changes per request. The current room is excluded to avoid no-op moves. `roomChecks` contains only processed non-current destinations and their rejection reasons.

`allowedMoveCount` greater than zero does not enable swaps yet, and a wider `searchWindow` does not change session times. No costs or rankings are returned. The relocation fixture therefore returns 200 with `candidates: []`, `truncated: false` and a direct-search explanation, even though a relocation could recover it later.

`maxCandidates` bounds returned candidates. Finding exactly that many does not imply truncation: remaining rooms are checked until another eligible destination proves omission or the search finishes. `timeoutMs` is a soft monotonic-clock budget for the search loop after inputs are prepared. It is checked between rooms and cannot interrupt a synchronous room check. Limit exhaustion returns 200 with `truncated: true` and a reason; an incomplete empty search does not establish no solution.

Input preparation waits at most 5000ms by default, separately from the search budget. Failed reads produce a sanitized 503; a read deadline produces 504. Strict request/snapshot errors retain 422, missing scenarios/sessions 404, and stale revisions 409, all with the response trace ID. Only trusted `AllocationInputError` instances supply domain status/details; unexpected errors remain generic 500 responses. Results are not stored yet, and allocation never applies a candidate.

## 9. Integration and Agentic AI usage

1. Call proposed platform `GET /api/scenarios/{scenarioId}/sessions` for dated sessions, constraints and revision.
2. Call Facilities `GET /facilities/rooms`, `GET /facilities/restrictions` and `POST /facilities/rooms/suitability` for physical facts.
3. Submit `{scenarioRevision, candidateId, moves}` to proposed `POST /api/scenarios/{scenarioId}/validate`. Agree with Member 1 on a response carrying revision, validation reference and conflicts.
4. Expose bounded deterministic search/score tools to the Agent. The LLM can request and explain options but cannot declare validity or call an apply tool.
5. The Agent owns `recoveryPlanId`, linking it to Allocation's `candidateId`. Operations owns approval. Spring Boot alone owns application.

If revision or restrictions change, mark results stale and regenerate/revalidate. A preview is not an applied simulation. Missing data or a failed dependency is never permission to use a room. Use HTTP timeouts, trace IDs and bounded retries on safe reads.

## 10. Frontend requirements

Use the shared Next.js app under proposed `apps/web/src/app/(dashboard)/allocation/`, following team ownership. The frontend is currently also a skeleton.

- **Room search:** session, seats, equipment and time filters; explain rejected rooms.
- **Candidate comparison:** costs, reasons, displaced sessions and valid/pending/invalid states side by side.
- **Allocation visualization:** before/after room calendar highlighting every move in a chain.
- **Optimization analytics:** success rate, movement count and direct-versus-swap latency/results.

Show revision and validation time, a recommendation-only label, and loading/empty/error/stale states. Link decision actions to Operations. Use agreed platform authentication/gateway routing; never place database credentials in browser code.

## 11. Development setup and root environment

From `services/allocation-service`, install the locked dependencies and start the service:

```powershell
npm.cmd ci
npm.cmd start
```

Use `npm.cmd run dev` for Node's watch mode and `npm.cmd test` for all tests. The `.cmd` form works in PowerShell when execution policy blocks `npm.ps1`; `npm` also works in shells that permit it. Stop the server with Ctrl+C.

Prepare input without starting HTTP, MongoDB or other services:

```powershell
npm.cmd run preview:input -- direct-room
npm.cmd run preview:rooms -- equipment-failure
```

Available fixture names are `single-relocation`, `direct-room`, `equipment-failure` and `no-solution`. Output is explicitly `mode: "fixture"` and `validationStatus: "pending"`. It contains the request, affected session and versioned schedule/room context; it contains no generated candidates or fixture `expected` answers. Unknown fixture names fail rather than falling back to another scenario.

The room-check command produces a room-only report rather than the full input snapshot. In the equipment-failure case, LAB_A reports 40 effective working computers and is rejected for S002's 50-computer requirement; LAB_BACKUP passes. The candidate endpoint then proposes the actual target-only move to LAB_BACKUP, excluding the current room from its destination list.

In a second PowerShell terminal:

```powershell
Invoke-RestMethod http://localhost:4001/health

$body = @{
  scenarioId = 'scenario-direct-001'
  scenarioRevision = 3
  affectedSessionId = 'S007'
  allowedMoveCount = 0
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:4001/allocation/candidates -ContentType 'application/json' -Body $body
```

`src/app.js` constructs the Express app without listening or loading private configuration. `src/server.js` loads configuration and starts the listener. The HTTP service and tests run without MongoDB, Platform, Facilities or an LLM.

`src/config/env.js` resolves the shared **root** `.env` relative to the file, independently of the terminal's working directory. Existing shell environment values take precedence. A missing `.env` uses defaults; an unreadable file or invalid configuration stops startup. Explicit ports must be integers from 1 to 65535 and the configured timezone must be recognized by Node's timezone data.

MongoDB is not required for the implemented HTTP endpoints. When persistence is added, the existing root `docker-compose.yml` provides a local standalone MongoDB through `docker compose up -d mongodb`. Never put credentials in source or fixtures.

| Variable | Status / use |
|---|---|
| `ALLOCATION_PORT=4001` | Implemented; defaults to 4001 |
| `PROJECT_TIMEZONE=Asia/Colombo` | Implemented; defaults to Asia/Colombo |
| `MONGODB_URI` | Existing key; unused by the HTTP scaffold; select `allocation_db` when implementing persistence |
| `FACILITIES_PORT=4002` | Existing key; reserved for facilities integration |
| `PLATFORM_BASE_URL=http://localhost:8081` | Proposed new root key matching current Java configuration; confirm first |
| `FACILITIES_BASE_URL=http://localhost:4002` | Proposed new root key |
| `ALLOCATION_DB=allocation_db` | Optional proposed root key |
| `USE_MOCK_CLIENTS=true` | Proposed development-only fixture adapter key |

The template's `SPRING_PORT=8080` does not override the current hardcoded Java port. Container URLs will differ from localhost when application containers are introduced. Keep `.env` untracked; never expose secrets via `NEXT_PUBLIC_*`.

## 12. Dummy-data workflow and testing

Run `npm.cmd test` from the service directory. Checks cover HTTP/configuration, strict inputs, normalization, fixture isolation, revisions/references, both preview commands, OpenAPI and room checks, plus direct candidate generation and its actual HTTP responses. Candidate tests cover original-time moves, zero displaced sessions, stable IDs/order, current-room exclusion, exact/overflow candidate limits, deterministic time budgets, sanitized dependency failures and unchanged source data. Environment tests use temporary files instead of private root configuration. Live integration is not implemented.

`prepareAllocationInput(request, { platformClient, facilitiesClient })` validates the request before reading the two clients, combines their snapshots and rejects mismatched scenarios/revisions, missing sessions and invalid room references. Fixture clients implement `getScenarioSnapshot(scenarioId)` and `getRoomSnapshot()`, return fresh copies and expose no mutation methods. Dependency failures propagate; no successful candidate or validity is invented.

The following workflow and tests cover direct search and the broader intended recovery implementation:

1. Start with [sample timetable](../../examples/sample_timetable.csv) and [sample facilities](../../examples/sample_facilities.json). Build mapping adapters without changing shared samples to satisfy a test.
2. Add S010/S100 from section 4 as another fictional fixture. Reuse the same IDs/intervals across services.
3. Seed only allocation-owned records. Mock external clients with versioned snapshots so other services need not run.
4. Test pure algorithms, then their HTTP routes using Supertest; add those tests to the existing `npm.cmd test` suite.
5. Replace mock adapters with real APIs as contracts become available; visibly distinguish mock and integrated results.

| Test | Expected result |
|---|---|
| Suitable empty room | Direct candidate, no displaced existing lecture |
| 100-seat example | Both moves present, one displaced lecture, no booking write |
| Closed room / broken required projector | Candidate rejected with reason |
| Lecturer/group overlap | Spring Boot invalidates candidate |
| Adjacent intervals | No overlap under agreed half-open convention |
| Cyclic chain / budget exhaustion | Terminates; reports truncation where appropriate |
| Revision changes | Stale, no reuse of old approval evidence |
| Dependency timeout | Explicit error, never invented validity |

For performance testing, generate reproducible snapshots (for example 50, 200 and 1,000 sessions) with a fixed random seed. Compare direct-only, single relocation and bounded multi-step strategies on identical inputs. Record p50/p95 elapsed time, explored states, validation calls, success rate and displaced lectures. Report hardware and search limits; do not invent measurements or promise latency before benchmarking.

## 13. Validation and errors

Validate IDs, positive integer enrollment/capacity, nonnegative equipment counts, supported facilities, start before end, bounded windows and move limits. Reject duplicate moves, unknown rooms/sessions and unauthorized duration changes. Spring Boot must check the final combined assignment for room, lecturer, group, equipment, maintenance and availability conflicts.

Use 400 malformed input, 401/403 auth failures, 404 missing IDs, 409 stale revision, 422 invalid requirements, and 503/504 dependency unavailable/timeout. A platform-invalid candidate may be returned with conflicts as a normal candidate result.

```json
{"code":"STALE_SCENARIO","message":"Reload revision 4 and regenerate candidates.","traceId":"trace-demo-01","details":{"expectedRevision":3,"currentRevision":4}}
```

Sanitize logs. Authentication does not automatically grant administrator privileges.

## 14. Development phases

1. **Foundation:** agree schemas, initialize Express, root configuration and fixture adapters.
2. **Basic recovery:** direct search, suitability filtering, owned persistence and search page.
3. **Core optimization:** relocation/swaps, scoring, platform validation adapter and comparison page.
4. **Advanced recovery:** bounded multi-step search, alternative slots and before/after calendar.
5. **Integration/evaluation:** real APIs, Agent tools, Operations references, stale-plan tests and benchmark reports.

## 15. Final demonstration and member checklist

Demonstrate the 100-seat case: direct search fails, relocation succeeds, both moves appear in the preview, Spring Boot validates, an administrator approves through Operations, and Spring Boot alone changes the simulation. Refresh the platform timetable to prove application; keep the baseline unchanged. Also show a no-solution case.

- [x] Direct search and rejection reasons work with fictional fixture data.
- [ ] Suitability, swaps and bounded multi-step algorithms are tested.
- [ ] Alternative slots preserve duration and respect availability.
- [ ] Scores and cost components are reproducible.
- [ ] Candidates record IDs, revision, facilities freshness and validation evidence.
- [ ] Search, comparison, visualization and analytics pages handle errors/empty results.
- [ ] Owned collections and root environment loading work independently.
- [ ] Allocation cannot write timetable bookings or call apply.
- [ ] Contracts, benchmarks and demonstration fixtures are documented.
- [ ] Team agrees ports, recurrence mapping, weights, auth and search limits.
