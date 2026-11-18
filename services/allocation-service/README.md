# Room Allocation & Optimization Service — Member 2

**Owner:** Member 2 · **Stack:** Node.js / Express / MongoDB · **Default port:** 4001

## 1. Overview and current status

This service recommends rooms and recovery arrangements. It searches empty rooms, explores moving existing lectures, and compares solutions. It must never update official or simulated timetable bookings. Spring Boot alone validates scheduling and applies administrator-approved simulation changes.

**Available now:** a runnable Express service, `GET /health`, root environment configuration, consistent JSON errors, HTTP/configuration tests, and a [fictional relocation fixture with consistency checks](fixtures/README.md). Run `npm.cmd test` from this directory to execute the tests. Allocation algorithms, allocation endpoints, database persistence and allocation UI pages are still **planned**.

`GET /health` returns `200` with `{"status":"ok","service":"allocation-service"}`. This is a liveness check: it does not connect to or report readiness for MongoDB, Platform or Facilities. Each response has a generated `X-Request-Id`; errors include the same value as `traceId`. Unknown routes return a JSON `404`, malformed JSON returns `400`, JSON bodies over 100kb return `413`, and unsupported body encodings return `415`. Unexpected failures return a generic `500` without internal error details.

Read [team ownership](../../docs/01-team-ownership.md), [service interfaces](../../docs/04-service-interfaces.md), and [OpenAPI guidance](../../contracts/openapi/README.md). These preserve the original service handover references.

Repository inspection found basic Spring Boot `GET` and `POST /api/timetables` code, but no scenario read/validate/apply APIs. Current Java configuration uses port **8081**; the root template proposes **8080**. Confirm the port with Member 1. Do not treat the existing create endpoint as a validated simulation API.

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

The current Java model uses `id`, `dayOfWeek`, `startTime` and `endTime`; it has no scenario revision or dated interval yet. Agree with Member 1 on `id` → `sessionId` and expanding recurring weekdays into dates. Do not assume this contract already exists. For the CSV, map `session_id`, `registered_count`, `room_code` to the normalized fields. Preserve sample IDs `HALL_A`, `ROOM_C`, `LAB_A`.

## 6. Stack and folder structure

The service uses CommonJS, Express and dotenv. Tests use Node's built-in test runner and Supertest. Node.js 22 or later is required. Mongoose and domain-validation libraries have not been added; the service currently does not use a database or external API client.

```text
services/allocation-service/
  README.md
  package.json
  package-lock.json
  src/
    server.js
    app.js
    config/env.js
    routes/health.js
    middleware/                # request IDs and error responses
    tests/                     # HTTP, environment and fixture checks
    controllers/               # placeholder
    services/                  # placeholder: orchestration, ranking, preview
    algorithms/                # placeholder: direct, swaps, bounded search
    clients/                   # placeholder: platform and facilities adapters
    models/                    # placeholder
    validation/                # placeholder
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

## 8. Proposed REST API and JSON examples

**These endpoints do not run yet.** Publish agreed schemas later in `contracts/openapi/allocation.openapi.yaml`.

| Method and path | Request → response | Success |
|---|---|---|
| POST `/allocation/candidates` | Scenario, target, limits → run and candidates | 200 synchronous result |
| POST `/allocation/room-swaps` | Same shape, restricted relocation/swap search | 200 |
| POST `/allocation/score` | Revision + candidate IDs → ranked costs | 200 |
| GET `/allocation/results/{runId}` | Read stored run and candidates | 200 |
| GET `/allocation/analytics?from=...&to=...` | Read benchmark summaries | 200 |

Agree that the root README's generic result `{id}` means `runId`.

Example candidate request:

```json
{
  "scenarioId": "scenario-demo-01",
  "scenarioRevision": 3,
  "affectedSessionId": "S100",
  "allowedMoveCount": 1,
  "searchWindow": {
    "startAt": "2026-11-02T09:00:00+05:30",
    "endAt": "2026-11-02T11:00:00+05:30"
  },
  "preferences": {"minimizeChanges": true},
  "limits": {"maxCandidates": 10, "timeoutMs": 2000}
}
```

Example response before authoritative validation:

```json
{
  "runId": "opt-001",
  "scenarioId": "scenario-demo-01",
  "scenarioRevision": 3,
  "truncated": false,
  "candidates": [{
    "candidateId": "candidate-001",
    "validationStatus": "pending",
    "moves": [
      {"sessionId":"S010","fromRoomId":"HALL_LARGE","toRoomId":"ROOM_SMALL","startAt":"2026-11-02T09:00:00+05:30","endAt":"2026-11-02T11:00:00+05:30"},
      {"sessionId":"S100","fromRoomId":null,"toRoomId":"HALL_LARGE","startAt":"2026-11-02T09:00:00+05:30","endAt":"2026-11-02T11:00:00+05:30"}
    ],
    "costBreakdown": {"displacedExistingSessions":1,"timeChangedSessions":0,"buildingChangedSessions":0,"totalUnusedSeats":60,"cost":106},
    "reasons": ["Move the 40-student lecture to release a 150-seat hall."]
  }]
}
```

Score request: `{"scenarioId":"scenario-demo-01","scenarioRevision":3,"candidateIds":["candidate-001"]}`. Response: `{"rankedCandidates":[{"candidateId":"candidate-001","cost":106,"validationStatus":"pending"}]}`. Pending candidates are previews, not verified solutions.

No-solution example: `{"runId":"opt-002","candidates":[],"truncated":false,"reasons":["No assignment within the allowed window and move limit."]}`. This is a successful search result, not an HTTP server error.

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

In a second PowerShell terminal:

```powershell
Invoke-RestMethod http://localhost:4001/health
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

Run `npm.cmd test` from the service directory. The current checks cover liveness, trace IDs, JSON error handling, configuration defaults/file precedence, invalid configuration and the fictional relocation fixture. Environment tests use temporary files instead of reading private root configuration. The fixture checks verify hand-written example data; candidate generation and live integration are not implemented.

The following workflow and candidate tests describe the intended algorithm implementation:

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

- [ ] Direct search and rejection reasons work with dummy data.
- [ ] Suitability, swaps and bounded multi-step algorithms are tested.
- [ ] Alternative slots preserve duration and respect availability.
- [ ] Scores and cost components are reproducible.
- [ ] Candidates record IDs, revision, facilities freshness and validation evidence.
- [ ] Search, comparison, visualization and analytics pages handle errors/empty results.
- [ ] Owned collections and root environment loading work independently.
- [ ] Allocation cannot write timetable bookings or call apply.
- [ ] Contracts, benchmarks and demonstration fixtures are documented.
- [ ] Team agrees ports, recurrence mapping, weights, auth and search limits.
