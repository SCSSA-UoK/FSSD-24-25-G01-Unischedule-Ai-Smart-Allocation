# Team ownership and handover

## Member 1 — Foundation, Spring Boot, Agentic AI

1. Initialize the repository, Docker, MongoDB and the shared Next.js shell.
2. Implement JWT login, role checks, platform settings and common API response/error conventions.
3. Build the **authoritative demonstration schedule** with timetable sessions and conflict validation.
4. Add timetable import (CSV/XLSX first), validation preview, immutable baseline snapshots and simulation scenarios.
5. Add approved-simulation change endpoint with revision recheck and room/group/lecturer conflict validation.
6. Create Python AI investigator, approved read-only tool adapters, investigation trace, rankings and explanations.
7. Provide sample payloads, mock routes and end-to-end test fixtures; own overall integration.

**Pages:** login, common navigation, timetable, import preview, simulation comparison and AI investigation trace.

## Member 2 — Allocation and optimization

1. Fetch schedule + constraints from Member 1 and valid room metadata from Member 3.
2. Implement direct suitable-room search, single-swap candidates and ranked alternatives.
3. Add multi-step moves and configurable cost/penalty scoring if time permits.
4. Show before/after room allocations and compare candidates; expose deterministic APIs for the agent.
5. Test all candidate generation and demonstrate no direct write into official bookings.

**Pages:** allocation explorer, candidate comparison, optimization analytics.

## Member 3 — Facilities and analytics

1. Create campuses, buildings, floors, rooms, room types, capacity and required equipment data.
2. Implement equipment availability, laboratory working stations, closures and maintenance restrictions.
3. Provide room suitability queries and restriction checks for Member 2 / AI.
4. Aggregate resource usage from Member 1 schedule APIs (do not duplicate authoritative room bookings).
5. Implement usage charts and facility management screens.

**Pages:** rooms, lab equipment, closures, resource calendar, analytics.

## Member 4 — Operations and recovery cases

1. Implement disruption reports, urgency, affected session references and case status.
2. Attach agent investigation runs and recommendation IDs to the disruption case.
3. Build simulated admin approval/rejection with traceable audit log.
4. Request revalidation and simulation-only application via the Spring Boot platform API.
5. Add in-app notification records and optional email sender for demo participants.
6. Implement operations dashboard, timeline and recovery analytics.

**Pages:** create disruption, incident board, pending approvals, notification center, audit history.

## Shared contract

- All members develop feature pages inside `apps/web/src/app/(dashboard)/` and avoid editing each other's routes.
- Agree on IDs: `scenarioId`, `sessionId`, `roomId`, `disruptionId`, `recoveryPlanId`, `runId`.
- Assign one reviewer per PR; require relevant tests and updated contract docs.
- If a service is unavailable, downstream clients should show an understandable error, not fake successful results.
