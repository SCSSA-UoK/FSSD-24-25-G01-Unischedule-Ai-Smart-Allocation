# Proposed API contracts (agree before coding)

These paths are **planned**, not implemented in this starter.

## Spring Boot platform (Member 1, port 8080)

- `POST /api/auth/login`: issue access token.
- `GET /api/timetables`: list baseline timetable versions.
- `POST /api/imports/preview`: preview CSV/XLSX mapping/validation.
- `POST /api/imports/commit`: persist a validated baseline snapshot.
- `POST /api/scenarios`: create a simulation from baseline.
- `GET /api/scenarios/{scenarioId}/sessions`: retrieve authoritative simulation timetable.
- `POST /api/scenarios/{scenarioId}/validate`: validate proposed room/time changes.
- `POST /api/scenarios/{scenarioId}/apply`: simulation-only, authorized and revalidated change.

## FastAPI Agent (Member 1, port 8000)

- `POST /agent/runs`: start investigation with `scenarioId` and `disruptionId`.
- `GET /agent/runs/{runId}`: status and actual tool-call trace.
- `GET /agent/runs/{runId}/plans`: generated and validated recovery plans.

## Allocation (Member 2, port 4001)

- `POST /allocation/candidates`: direct room/swap/multi-move candidate search.
- `POST /allocation/score`: compare candidate disruption and suitability.

## Facilities (Member 3, port 4002)

- `GET /facilities/rooms`: list/search rooms.
- `POST /facilities/rooms/suitability`: compare required equipment vs room capabilities.
- `GET /facilities/restrictions`: closures and equipment outages.

## Operations (Member 4, port 4003)

- `POST /operations/disruptions`: report a demo disruption.
- `GET /operations/disruptions/{disruptionId}`: retrieve status and context.
- `POST /operations/cases/{caseId}/decision`: simulate approval/rejection.
- `GET /operations/notifications`: in-app notification history.

## Required common fields

All services should agree on:

- Stable IDs (`sessionId`, `roomId`, `scenarioId`, `disruptionId`, `runId`)
- Local timetable time-zone handling (`Asia/Colombo`)
- Whether sessions recur weekly or have a specific calendar date
- Room-required capacity based on enrollment, not LLM attendance guesses
- Error body with `code`, `message`, `traceId` and optional `details`
- `scenarioRevision` on every mutation proposal to prevent stale updates
- Auth scheme and service-to-service credentials

## Basic example: candidate request

```json
{
  "scenarioId": "scenario-demo-01",
  "scenarioRevision": 3,
  "affectedSessionId": "S007",
  "allowedMoveCount": 1,
  "preferences": {"minimizeChanges": true}
}
```

Candidate response should enumerate `moves`, `validationStatus`, `costBreakdown`, `reasons`, and the `scenarioRevision` it was created against. Never report `validationStatus=valid` purely from an LLM response.
