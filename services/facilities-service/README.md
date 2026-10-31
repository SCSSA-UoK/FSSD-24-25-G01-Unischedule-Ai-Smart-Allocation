# Smart Campus Facilities & Resource Analytics Service — Member 3

**Owner:** Member 3 · **Stack:** Node.js / Express / MongoDB · **Planned port:** 4002

## 1. Overview and current status

Facilities describes campus spaces and whether their physical resources are usable. It owns rooms, laboratories, equipment, maintenance and restrictions. Spring Boot owns official and simulated bookings. A room can be physically usable while already booked; these are different checks.

**Available now:** this folder and documentation. There is no Node application, package manifest, running endpoint, seed script or test runner. All features, APIs, UI routes and application commands below are **planned** unless explicitly described as existing.

Keep the original handover references: [team ownership](../../docs/01-team-ownership.md), [service interfaces](../../docs/04-service-interfaces.md), and [OpenAPI guidance](../../contracts/openapi/README.md).

The repository contains basic Spring Boot `GET` and `POST /api/timetables` code, but not scenario read/validate/apply APIs. Java currently uses **8081**, while the root environment template proposes **8080**. Confirm the port with Member 1 before integration.

## 2. Purpose, responsibilities and boundaries

| Facilities owns | Other services own |
|---|---|
| Campus → building → floor → room hierarchy | Spring Boot: sessions, bookings, scenarios and scheduling validation |
| Room type, seats, equipment and working counts | Allocation: candidate assignments and ranking |
| Maintenance reports, closures and physical restrictions | Operations: disruptions, approvals and notifications |
| Physical suitability and derived resource reports | Agent: investigation runs, tool traces and recovery explanations |

Never write to `platform_db` or create a second authoritative bookings collection. Usage analytics read Spring Boot snapshots and label their revision/time. A report cache is disposable derived data.

## 3. Development modules and feature explanations

| Module | What to build in simple English |
|---|---|
| Campus directory | Manage campuses, buildings and floors; each child must reference a real parent. |
| Rooms and lecture halls | Store room type, seats, location, accessibility and features. Archive referenced rooms instead of deleting history. |
| Laboratories | Attach computer/workstation requirements to an existing room ID. A lab is a room with extra details, not another booking resource. |
| Equipment | Track installed and working projectors, computers, sound systems and other facilities separately. |
| Maintenance | Record faults, staff responsibility, repair status and downtime. A broken projector need not close every use of a room. |
| Restrictions | Represent full closures, partial equipment outages and allowed-use windows with dated intervals. |
| Suitability | Explain whether a room meets capacity and facility requirements for the whole requested interval. This is physical checking only. |
| Utilization | Combine owned room metadata with Spring Boot bookings to calculate room and building use. |
| Resource demand | Show requested equipment/room types, peak periods and unmet demand from authorized request aggregates. |
| Maintenance impact | Show affected sessions and unavailable seat/equipment hours. |

## 4. Complete example: 60 computers, 20 unavailable

Create fictional lab `LAB_DEMO_60` with **60 seats and 60 installed computers**. On **2026-11-02 09:00–11:00 Asia/Colombo**, maintenance makes computers C041–C060 unavailable.

```text
working computers = 60 installed - 20 distinct unavailable = 40
required working computers = 50
shortfall = 50 - 40 = 10
```

The room has enough seats for 50 students, but cannot support a lecture needing 50 working computers. Return `INSUFFICIENT_WORKING_COMPUTERS`. Allocation must find another lab or permitted time. The AI must not assume students will share computers.

The existing sample `LAB_A` has 70 seats and 65 usable computers. LAB_DEMO_60 is an additional fixture, not a description of that sample.

### Avoid counting failures twice

Prefer asset IDs for individually tracked equipment. Count the union of unavailable IDs, including permanent failures, so two reports about C041 subtract it only once. If beginning with aggregate counts, define one authoritative count per type and prohibit ambiguous overlapping deductions. Do not subtract both a current usable count and the outages already represented in that count.

If working counts change during a lecture, use the minimum simultaneous count over its full interval. Fifty working at the start and forty later is unsuitable for a lecture needing fifty throughout.

## 5. Step-by-step workflows

### Register a room

1. Create campus, building and floor records.
2. Register a stable `roomId`, type, seat count and features.
3. Register equipment assets; add a lab profile if needed.
4. Validate parent references, uniqueness and counts; save only to `facilities_db`.
5. Display the room in the shared frontend. Editing physical facts does not rewrite bookings.

### Report maintenance or a closure

1. Authorized staff submit the room, interval, fault and affected assets.
2. Create a maintenance record and linked restriction through one coordinated service operation. Avoid a report saved without its intended restriction.
3. Increase the facilities version and invalidate stale suitability caches.
4. Read affected sessions from Spring Boot. When integrated, create an Operations disruption using a retry-safe request. The restriction remains active if downstream notification fails.
5. After repair, record the actual end time and resolve the restriction; retain historical records.

The current standalone local MongoDB does not support multi-document transactions. Initially embed pending synchronization work in one atomic record and reconcile linked records using unique IDs, or agree on a replica set before relying on transactions.

### Answer physical suitability

1. Validate room, requirements and interval.
2. Check room status, seats, allowed-use windows and every overlapping restriction.
3. Calculate working equipment over the full interval.
4. Return suitability, counts, reasons and physical-state version.
5. Allocation/Agent combines this with a platform snapshot. Spring Boot still makes the authoritative scheduling decision.

## 6. Stack and suggested folder structure

Suggested dependencies: Express (HTTP), Mongoose (MongoDB models), dotenv (root configuration), Zod (validation), Vitest and Supertest (tests). None is installed here yet.

```text
services/facilities-service/
  README.md
  package.json                 # to create
  src/
    server.js
    app.js
    config/env.js
    routes/
    controllers/
    services/                  # suitability, restrictions, analytics
    models/
    clients/                   # platform and operations adapters
    validators/
    middleware/
  fixtures/
  tests/
```

Keep suitability functions separate from HTTP/database logic so dummy-data tests can run independently.

## 7. MongoDB database and collection design

Use owned logical database `facilities_db` under the shared MongoDB URI.

| Collection | Suggested fields | Indexes / rules |
|---|---|---|
| `campuses` | campusId, name, timezone | unique campusId |
| `buildings` | buildingId, campusId, name | unique buildingId; campusId |
| `floors` | floorId, buildingId, label | unique floorId; buildingId + label |
| `rooms` | roomId, floorId, name, type, seats, features, status, version | unique roomId; floorId + type |
| `laboratories` | roomId, labType, workstationPolicy | unique roomId referencing rooms |
| `equipment` | assetId, roomId, type, operationalStatus | unique assetId; roomId + type |
| `maintenance_records` | maintenanceId, roomId, assetIds, description, status, reportedBy, reportedAt, resolvedAt | unique maintenanceId; roomId + status |
| `room_restrictions` | restrictionId, roomId, maintenanceId, kind, startAt, endAt, assetIds, reason | unique restrictionId; roomId + startAt + endAt |
| `analytics_snapshots` (optional) | scenarioId, scenarioRevision, facilitiesVersion, window, metrics, generatedAt | scenarioId + window; retention index if agreed |

Use public string IDs separately from MongoDB `_id`. `rooms` is the capacity authority; do not repeat seats in lab profiles. Store timestamps as database dates and return ISO strings. Handle open-ended outages explicitly, such as `endAt: null`, in overlap queries.

Example proposed room representation:

```json
{
  "roomId": "LAB_DEMO_60",
  "floorId": "IT_F1",
  "name": "Demonstration Computer Lab",
  "type": "laboratory",
  "seats": 60,
  "features": ["computers", "projector"],
  "status": "active",
  "version": 1
}
```

## 8. Shared formats and sample-data mapping

Use the same proposed contract as Allocation and Operations:

- Stable string `roomId`, `sessionId`, `scenarioId`, `disruptionId`, `caseId`, `runId` and `recoveryPlanId`.
- Requirements: `registeredStudents`, `requiredFacilities`, `requiredWorkingComputers`. Room capacity: `seats`.
- Dated ISO 8601 `startAt`/`endAt` with offsets and `timezone: "Asia/Colombo"`. Intervals are `[startAt, endAt)`, so adjacent intervals do not overlap.
- `scenarioRevision` belongs to Spring Boot. `facilitiesVersion` identifies physical-state freshness and changes when inventory/restrictions change; agree on its generation before implementation.

Preserve sample IDs `HALL_A`, `ROOM_C`, `LAB_A` and feature names such as `projector`. The facilities sample has a building name string, not a hierarchy ID; map names into explicit campus/building/floor records. Its `usableComputers` is a starting snapshot; normalize it once when introducing asset tracking, avoiding competing totals.

The current Java session uses `id`, weekday and string start/end times. Member 1 must define `id` → `sessionId` and recurring-weekday expansion into dates. Do not guess which Monday a restriction applies to.

## 9. Proposed REST API and JSON examples

**These routes are not implemented.** Publish final schemas in `contracts/openapi/facilities.openapi.yaml` after agreement.

| Method and path | Purpose | Success |
|---|---|---|
| GET / POST `/facilities/campuses` | List / create campus | 200 / 201 |
| GET / POST `/facilities/buildings` | Filter by campusId / create building | 200 / 201 |
| GET / POST `/facilities/floors` | Filter by buildingId / create floor | 200 / 201 |
| GET / POST `/facilities/rooms` | Filter type, seats, features / create room | 200 / 201 |
| GET / PATCH `/facilities/rooms/{roomId}` | Read / update physical metadata with version check | 200 |
| GET / POST `/facilities/laboratories` | List / attach profile to existing room | 200 / 201 |
| GET / POST `/facilities/equipment` | Filter by room / register asset | 200 / 201 |
| PATCH `/facilities/equipment/{assetId}` | Update operational state with history | 200 |
| GET / POST `/facilities/maintenance` | List / report fault | 200 / 201 |
| PATCH `/facilities/maintenance/{maintenanceId}` | Update or resolve fault | 200 |
| GET / POST `/facilities/restrictions` | Query by room and interval / create restriction | 200 / 201 |
| PATCH `/facilities/restrictions/{restrictionId}` | Correct/end restriction while preserving history | 200 |
| POST `/facilities/rooms/suitability` | Room + requirements + interval → physical result | 200 |
| GET `/facilities/analytics` | scenarioId + from/to → utilization, demand, maintenance impact | 200 |

Lists use bounded `limit`/`cursor` and return `{items, nextCursor}`. Room search filters physical properties; it does not promise a room is unbooked.

Create LAB_DEMO_60 with `POST /facilities/rooms` and section 7 JSON; return 201 with the stored object. Register assets C001–C060 through equipment APIs or a future owned-data seed script.

Example `POST /facilities/restrictions` request:

```json
{
  "restrictionId": "restriction-demo-20",
  "roomId": "LAB_DEMO_60",
  "maintenanceId": "maintenance-demo-01",
  "kind": "equipment_outage",
  "startAt": "2026-11-02T09:00:00+05:30",
  "endAt": "2026-11-02T11:00:00+05:30",
  "assetIds": ["C041","C042","C043","C044","C045","C046","C047","C048","C049","C050","C051","C052","C053","C054","C055","C056","C057","C058","C059","C060"],
  "reason": "Power supply repairs"
}
```

Return 201 with the restriction and `facilitiesVersion`. Validate the referenced maintenance and asset records. IDs may instead be server-generated if the team agrees consistently. A full closure uses `kind: "closure"`; allowed-use windows need a separate explicit kind/schema.

Example suitability request:

```json
{
  "roomId": "LAB_DEMO_60",
  "registeredStudents": 50,
  "requiredFacilities": ["computers", "projector"],
  "requiredWorkingComputers": 50,
  "startAt": "2026-11-02T09:00:00+05:30",
  "endAt": "2026-11-02T11:00:00+05:30",
  "timezone": "Asia/Colombo"
}
```

Example response, assuming the projector works:

```json
{
  "roomId": "LAB_DEMO_60",
  "physicallySuitable": false,
  "seats": 60,
  "installedComputers": 60,
  "workingComputers": 40,
  "facilitiesVersion": "facilities-demo-v2",
  "bookingChecked": false,
  "reasons": [{"code":"INSUFFICIENT_WORKING_COMPUTERS","required":50,"available":40,"shortfall":10}]
}
```

A negative suitability result is a normal 200 response, not an internal server error. An unknown room returns 404.

## 10. Analytics algorithms and definitions

Agree on reporting windows, teaching hours and denominators. Always identify the scenario and source revision:

- **Room utilization:** booked minutes inside physically open teaching intervals ÷ physically open teaching minutes × 100. Intersect bookings with open intervals and count overlapping minutes only once.
- **Building utilization:** sum booked-open minutes across its rooms ÷ sum open minutes. Do not average room percentages without weighting.
- **Seat utilization:** sum(enrollment × booked-open minutes) ÷ sum(seats × booked-open minutes). Report capacity violations separately rather than hiding them by clamping the value.
- **Resource demand:** distinct requested sessions by equipment type/time bucket, with unmet requests separate from bookings. Obtain request aggregates from Allocation/Operations through an agreed API; stock totals cannot reveal demand.
- **Maintenance impact:** distinct affected sessions, closed room-hours, unusable computer-hours and seats unavailable. A failed projector is equipment degradation, not automatically the loss of all seats.

For zero denominators return null with an explanation. If the platform is unavailable, show unavailable or a dated cached result, never zero usage. Results should include interval, `generatedAt`, `scenarioRevision`, `facilitiesVersion` and data source.

Example room analytics response:

```json
{
  "scenarioId": "scenario-demo-01",
  "scenarioRevision": 3,
  "roomId": "LAB_DEMO_60",
  "openTeachingMinutes": 480,
  "bookedOpenMinutes": 120,
  "utilizationPercent": 25,
  "facilitiesVersion": "facilities-demo-v2",
  "source": "mock-platform"
}
```

## 11. Integration and Agentic AI usage

1. Read proposed platform `GET /api/scenarios/{scenarioId}/sessions` for utilization/impact snapshots with dated sessions and revision.
2. Allocation and Agent call room search, restrictions and suitability before proposing changes. Include quantities and reasons so failures can be explained accurately.
3. Spring Boot must consult fresh Facilities data during final scheduling validation. Old suitability evidence is not a guarantee of safe later application.
4. Operations receives maintenance-related incidents and references `maintenanceId`/`restrictionId`; Facilities remains owner of the physical restrictions.
5. Agent credentials allow read/suitability tools, not physical edits. The AI cannot remove a closure to make a plan fit.

Use HTTP clients with timeouts, trace IDs and bounded retries. If Operations is offline, retain pending restriction-notification delivery and retry with the same idempotency key. Basic room management must not require a live Agent.

## 12. Frontend pages and dashboards

Build proposed routes under `apps/web/src/app/(dashboard)/facilities/` in the shared Next.js app:

- **Campus directory:** campus/building/floor navigation and room forms.
- **Facilities:** physical status, capacity, equipment and restriction calendar, with platform booking overlays.
- **Laboratories:** installed versus working counts and failed-asset details.
- **Maintenance:** report form, active faults, repair timeline, closures and affected sessions.
- **Analytics:** room utilization, weighted building charts, demand heatmap and maintenance impact comparisons.

Show physical status separately from booking status. Display freshness, filters and loading/empty/error states. Restrict edits to authorized staff. Shared frontend/authentication are still planned.

## 13. Development setup and root environment

Existing infrastructure steps, from repository root:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d mongodb
docker compose ps
```

Compose starts only local standalone MongoDB. Atlas is optional via a private root `.env` URI. Never paste credentials into documentation, source, screenshots or fixtures.

From this service directory, initialize the future app:

```powershell
npm init -y
npm install express mongoose dotenv zod
npm install --save-dev nodemon vitest supertest
```

Create `src/server.js`; add proposed scripts `dev: nodemon src/server.js`, `start: node src/server.js`, `test: vitest run`. Only then run `npm run dev` or `npm test`; neither is supplied today. Agree on CommonJS or ES modules.

Use the shared root `.env`. For future CommonJS `src/config/env.js`:

```js
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
```

| Variable | Status / use |
|---|---|
| `MONGODB_URI` | Existing key; select `facilities_db` explicitly in the client |
| `FACILITIES_PORT=4002` | Existing key |
| `OPERATIONS_PORT=4003` | Existing key; local development |
| `PROJECT_TIMEZONE=Asia/Colombo` | Existing key |
| `PLATFORM_BASE_URL=http://localhost:8081` | Proposed new root key matching current Java port; confirm first |
| `OPERATIONS_BASE_URL=http://localhost:4003` | Proposed new root key |
| `FACILITIES_DB=facilities_db` | Optional proposed root key |
| `USE_MOCK_CLIENTS=true` | Proposed development-only fixture adapter key |

The template's `SPRING_PORT=8080` currently does not override Java's hardcoded port. `NEXT_PUBLIC_API_BASE_URL` is a browser-facing URL, not a place for internal credentials. Keep `.env` untracked; `.env.example` is the safe template. Container URLs will differ when application containers are introduced.

## 14. Independent development and testing

1. Normalize [sample facilities](../../examples/sample_facilities.json) into owned models; preserve IDs and document fictional hierarchy mappings.
2. Mock the platform with a revisioned fixture from [sample timetable](../../examples/sample_timetable.csv). Do not insert authoritative bookings into Facilities.
3. Add LAB_DEMO_60 and 60 assets, then the 20-asset outage. Verify 40 working computers.
4. Test pure calculations, then HTTP routes. Use proposed `npm test` after setup.
5. Replace mock adapters with agreed real APIs and run integration checks. Keep mock/integrated sources visible.

| Test | Expected result |
|---|---|
| 60 installed, 20 unavailable, 50 required | Unsuitable, shortfall 10 |
| Two reports name the same asset | Count it once |
| Fault starts halfway through lecture | Use minimum working count over full interval |
| Closure ends at session start | No overlap under half-open intervals |
| Seats sufficient, required projector failed | Unsuitable |
| Physically usable room already booked | Physical result separate; platform rejects booking conflict |
| Missing parent / duplicate room / negative seats | Validation/conflict error |
| Unequal open hours per room | Correct weighted building utilization |
| No open teaching minutes | Null ratio with explanation |
| Platform unavailable | Explicit unavailable/stale analytics source |

Keep deterministic fixtures and mocked HTTP clients so Member 3 can work without running other services.

## 15. Validation and error handling

Validate positive integer seats, nonnegative working counts no greater than installed stock, unique IDs, existing hierarchy parents, supported equipment types and valid intervals/timezones. Assets in a fault must belong to the room. A `projector` feature still requires a working-state check.

Require staff permissions for edits and optimistic version checks to avoid lost updates. Archive referenced hierarchy records. Store actor/time for maintenance changes; derive the actor from authentication, not an editable request field.

Use 400 malformed input, 401/403 auth failures, 404 unknown ID, 409 duplicate/version conflict, 422 inconsistent counts/hierarchy, and 503/504 unavailable/timed-out dependency.

```json
{"code":"INVALID_EQUIPMENT_COUNT","message":"Working computers cannot exceed installed computers.","traceId":"trace-demo-02","details":{"installed":60,"working":65}}
```

## 16. Development phases

1. **Foundation:** Express, root config, owned models, schema agreement and fixture adapters.
2. **Directory:** campuses, buildings, floors, rooms, labs and inventory screens.
3. **Physical constraints:** maintenance, closures, equipment failures, suitability and interval tests.
4. **Analytics:** versioned platform reads, utilization, request-demand feeds and charts.
5. **Integration:** fresh validation reads, Operations incident delivery, Agent read tools and full demo.

## 17. Final demonstration and member checklist

Show LAB_DEMO_60 initially working, then the 20-computer outage. A 50-computer lecture fails suitability with 40 available. Allocation searches another lab, Spring Boot validates a candidate, Operations obtains approval, and Spring Boot alone updates the simulation. Show maintenance impact and utilization without editing the baseline.

- [ ] Campus/building/floor hierarchy and room/lab inventory work.
- [ ] Equipment counts and overlapping outages are correct.
- [ ] Maintenance, closures and repair history remain traceable.
- [ ] Suitability explains physical failures without claiming booking availability.
- [ ] Only Facilities owns physical details/restrictions.
- [ ] Analytics use versioned platform reads and documented denominators.
- [ ] Directory, labs, maintenance and analytics pages handle empty/error states.
- [ ] Shared root environment and independent dummy tests work.
- [ ] Schemas, hierarchy mapping, versioning and ports are agreed.
- [ ] No timetable writes, credentials or private faculty data are added.
