# Allocation acceptance fixtures

These four datasets are fictional inputs for independent development. Each has explicit dated sessions, physical room facts, constraints and a versioned request. Its `expected` section is hand-written acceptance data; clients do not return it as a generated answer.

| Fixture name | Scenario ID | Hand-written acceptance story |
|---|---|---|
| `single-relocation` | `scenario-relocation-001` | Move S001 to ROOM_C to free HALL_A for S007 |
| `direct-room` | `scenario-direct-001` | HALL_A is empty and can fit S007 |
| `equipment-failure` | `scenario-equipment-001` | S002 needs 50 computers; LAB_A has 40 working, and LAB_BACKUP has 60 |
| `no-solution` | `scenario-no-solution-001` | ROOM_C is closed; the same relocation is unavailable within the allowed move count |

From the allocation-service directory, run `npm.cmd run preview:input -- <fixture-name>`. This prepares validated input with `mode: "fixture"` and `validationStatus: "pending"`; it does not run allocation search or produce candidates. Fixture names are allowlisted, and returned data is copied so a caller cannot alter the stored example. `npm.cmd test` checks all input adapters, normalizers and schemas.

Use `npm.cmd run preview:rooms -- <fixture-name>` for actual local room screening. The report includes sorted eligible room IDs and physical/booking rejection reasons while retaining fixture mode and pending validation. Tests compare those IDs with the hand-written direct-room expectations: HALL_A for `direct-room`, LAB_BACKUP for `equipment-failure`, and none for the other two cases. An empty list does not prove that no relocation or broader recovery exists. No moves or bookings are produced.

`POST /allocation/candidates` now generates direct target-only move proposals using these facts. Use the fixture's `request` as the JSON body, as shown in the [service API guide](../README.md). Candidates are computed from the inputs, never copied from `expected`; they remain fixture/pending and cause no booking changes. The target's current room is excluded from direct destinations. The direct-room and equipment-failure cases produce one proposal each; the other cases produce a complete empty direct-search result. Relocation and scoring are not implemented.

## The relocation example

`single-relocation.json` describes the 60-student example in the [shared workflow](../../../docs/02-end-to-end-workflow.md). All IDs and records are fictional. Room capacities and IDs follow the [shared facilities sample](../../../examples/sample_facilities.json).

| Session | Students | Before | Expected proposal |
|---|---|---|---|
| S001 | 40 | HALL_A (80 seats) | ROOM_C (50 seats) |
| S002 | 60 | LAB_A (70 seats, 65 working computers) | Unchanged |
| S007 | 60 | No assigned room | HALL_A (80 seats) |

All sessions run on **16 November 2026, 09:00-11:00 Asia/Colombo**. ROOM_C is empty but too small for S007. Both sufficiently large rooms are occupied, so a direct allocation cannot work. Moving S001 to ROOM_C frees HALL_A for S007. S002 remains in LAB_A and requires 50 working computers.

This is a **single displacement**: one other existing lecture changes rooms, and the target gains a room. The proposal includes two moves. A two-way swap between already assigned sessions is a different case.

## Data format

This fixture makes the existing [proposed interface](../../../docs/04-service-interfaces.md) concrete for one example. It is not a published HTTP endpoint or proof of team agreement.

- `fixtureVersion` identifies the data format. `mode: "fixture"` distinguishes this data from live service responses.
- `scenarioId` and `scenarioRevision` identify the fictional schedule snapshot; `facilitiesVersion` identifies the fictional room snapshot.
- `sessions` use stable IDs, actual registered-student counts, required facilities and working-computer counts. `roomId: null` means the target is unassigned.
- `rooms` retain the sample's `features` and `usableComputers` names. A room's seat count and working-computer count are separate limits.
- `startAt` and `endAt` are dated ISO timestamps with offsets. Intervals are half-open: `[startAt, endAt)`. Sessions ending exactly when another begins do not overlap.
- `constraints` explicitly disallows time changes and has no lecturer/group unavailability in this example. `restrictions` is empty; the fixture has no closures or equipment outages.
- `request.allowedMoveCount` limits displaced existing sessions, excluding the target. The returned move list still includes the target.
- `expected` contains hand-written acceptance data, not output from an implemented optimizer. The proposal stays `pending`; a fixture check cannot establish authoritative validity.

Restrictions in the other examples use `restrictionId`, `roomId`, `kind`, dated `startAt`/`endAt`, `unavailableFacilities`, nullable `usableComputers` and a reason. A working-computer restriction is an effective count cap, not a number to subtract. In the equipment-failure snapshot, LAB_A already has 40 usable computers after the fault; the room check keeps the effective count at 40. LAB_BACKUP is an additional fictional room, not a change to the shared facilities sample. The no-solution example closes ROOM_C for the full interval. Local direct-room checks are implemented; relocation proposals and whole-plan validation remain outside these checks.

## Reproduce the checks

From `services/allocation-service`, using Node.js with the built-in test runner:

```powershell
node --test src/tests/single-relocation-fixture.test.cjs
```

The checks cover referenced IDs, interval and count consistency, the absence of a direct suitable room, completeness of the expected moves, and room capacity/equipment/occupancy after replaying those moves into a copy. They also check that the original fixture is unchanged and no expected move changes a session's time.

These are fixture integrity checks. They do not run candidate generation, call external services, verify live restrictions or prove an integrated booking boundary. Spring Boot remains responsible for whole-plan validation; Operations handles approval; only Spring Boot applies an approved change to simulation data. Allocation does not own bookings.
