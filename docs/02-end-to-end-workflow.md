# Simple end-to-end workflow

## Scenario: 60 students need a room; no large room is empty

Baseline: A 40-student lecture occupies an 80-seat hall; a 50-seat classroom is free. A 60-student lecture requires a place.

1. **Member 1 / platform:** Import permitted timetable data or use fictional fixtures. Create a new simulation scenario from the baseline.
2. **Member 4 / operations:** Create a demo disruption or reschedule request referencing the scenario and affected sessions.
3. **Member 1 / AI:** Begin an investigation, ask Spring Boot for current timetable and constraints.
4. **Member 3 / facilities:** Provide suitable room properties and maintenance restrictions.
5. **Member 2 / allocation:** Search empty rooms. When none fit, propose moving the 40-student lecture to the 50-seat classroom so the 80-seat hall is freed.
6. **Member 1 / platform:** Deterministically validate lecturer, room, student-group, capacity, time and facility constraints.
7. **Member 1 / AI:** Explain multiple validated alternatives and compare disturbance cost; include real tool-call trace.
8. **Member 4 / operations:** An admin clicks approve **for the demo simulation**.
9. **Member 1 / platform:** Recheck scenario revision and all constraints, then update only simulated timetable data. Reject if it changed meanwhile.
10. **Member 4 / operations:** Record simulated approval, notifications and audit timeline.

## Scenario: laboratory equipment failure

- Member 3 marks 20 out of 60 computers unavailable, reducing usable computers to 40.
- Member 4 creates a disruption for a class needing 50 computers.
- AI requests restriction info from facilities and alternatives from allocation service.
- Platform verifies timetable conflicts; operations records chosen demo recovery.

## Safety rules

- A room swap is a *candidate*, not an actual booking.
- LLM text is never sufficient proof of no conflicts.
- No writes back to the faculty's actual timetable or source spreadsheet.
