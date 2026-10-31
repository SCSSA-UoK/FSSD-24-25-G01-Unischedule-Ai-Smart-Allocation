# UniSchedule AI — Four-Member Project Structure

**Purpose:** A university module demo using permitted faculty timetable data (when available), simulated disruptions, Agentic AI investigations, and intelligent room reallocation.

> This download is a **repository structure and team handover starter**, not a finished runnable university app. The folders, example data, docs, service ownership and a local MongoDB Docker Compose file are prepared. Members will implement each service inside the provided folders.

## Who develops what

| Owner | Main responsibility | Technology |
|---|---|---|
| Member 1 (project lead) | Shared foundation, identity, official demo timetable/simulation core, timetable import, AI orchestration, integration | Spring Boot + MongoDB + FastAPI/LangGraph + Next.js foundation |
| Member 2 | Intelligent room allocation, candidate search, single/multi-move swap optimizer, comparison dashboard | Node.js + MongoDB + Next.js pages |
| Member 3 | Buildings, labs, room metadata, equipment, maintenance closures, utilization analytics | Node.js + MongoDB + Next.js pages |
| Member 4 | Disruption reporting, recovery cases, demo approvals, notifications, operational analytics | Node.js + MongoDB + Next.js pages |

## Important idea

The faculty timetable is imported with permission into a **read-only baseline snapshot**. A **simulation scenario** is copied from the baseline. The project only modifies **simulation data**, not the faculty's official systems or source files.

## Repository navigation

- `apps/web/`: shared Next.js interface; each member owns their feature routes.
- `services/platform-service/`: Member 1; Java Spring Boot platform, authentication, timetable import, scenarios, constraints, controlled changes.
- `services/agent-service/`: Member 1; Python FastAPI and agent tools/workflow.
- `services/allocation-service/`: Member 2; candidate generation and scoring.
- `services/facilities-service/`: Member 3; physical resource catalog and constraints.
- `services/operations-service/`: Member 4; case management, approvals, alerts, logs.
- `contracts/openapi/`: agreed service API definitions before implementation.
- `docs/`: responsibilities, workflow, database ownership, security, implementation plan.
- `examples/`: fictitious timetable and facility fixtures safe to commit.
- `data/private-faculty/`: local-only folder for permitted real timetable files (**gitignored**).

## Suggested local ports

| Component | Port |
|---|---:|
| Next.js web | 3000 |
| Spring Boot platform | 8080 |
| Python AI | 8000 |
| Node allocation | 4001 |
| Node facilities | 4002 |
| Node operations | 4003 |
| MongoDB | 27017 |

## Quick start for foundation (Windows PowerShell)

1. Copy `.env.example` to `.env` and adjust for your machine.
2. Install Docker Desktop and run `docker compose up -d mongodb` to start local MongoDB only.
3. Initialize the Spring Boot, Next.js, FastAPI and Node.js projects **inside their assigned folders**. This skeleton does not yet contain application executables.
4. Keep the sample CSV under `examples/`; put faculty-provided timetables only under `data/private-faculty/` and never commit them.
5. Agree on each service's request/response schemas in `contracts/openapi/` before writing dependent UI or AI tools.

See `docs/01-team-ownership.md`, `docs/02-end-to-end-workflow.md`, `docs/03-import-and-simulations.md`, and `docs/04-service-interfaces.md`.

## Technical rules

- Only the **platform-service** owns timetable bookings and applies validated modifications to a simulation.
- Only the **facilities-service** owns room specifications and maintenance restrictions.
- Only the **allocation-service** generates and scores candidate reallocations. It does not modify bookings.
- Only the **operations-service** owns recovery cases and simulated approval records.
- The **agent-service** may investigate and recommend, but may not directly edit the timetable, rooms or approval records.
- Cross-service access is through APIs, not direct writes into someone else's MongoDB database.
- Each service must enforce authentication/authorization on protected endpoints; don't trust a user ID sent by the browser.
- All time slots use one consistent `Asia/Colombo` interpretation for the demonstration; explicitly represent day/date, start and end times.
- Changes should be revalidated against the **current scenario revision** before they are committed, to avoid double bookings.

## Evaluation

Compare direct empty-room search, deterministic room-swap search and Agentic AI orchestration. Measure recovery success, conflicts (must be zero), moves, execution time, and tool-call correctness. Use fictional or de-identified data for screenshots and public demos.
