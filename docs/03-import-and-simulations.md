# Faculty timetable import and simulation management

## Data policy

- Obtain written/recorded permission to use university timetable data for this module and agree on permitted display/storage.
- Limit copied fields. Replace student names/IDs and unnecessary lecturer identifiers with pseudonyms when possible.
- Store permitted originals **outside Git**, in `data/private-faculty/` (gitignored); never include these in public demos.
- Use fictitious fixtures for screenshots and examples unless permission clearly permits sharing.

## Minimum supported importer

1. Upload a CSV or XLSX file. If faculty provides PDF, manually convert it to a clean table first (automatic PDF import is optional).
2. Preview the mapped fields: weekday/date, start time, end time, course, lecturer, student group, room, session type.
3. Detect missing columns, unknown room codes, duplicate sessions, bad times, overlaps and invalid capacities.
4. Show the import errors and let the admin fix the input.
5. Save a **read-only baseline snapshot** with source label, import timestamp and version.
6. Allow `Clone into simulation`, creating a separate scenario with its own revision number.
7. Perform all disruptions/reallocations/approval changes only against this scenario.
8. Show a before/after diff and optional CSV export of simulated changes.

## Example sample CSV columns

`session_id,day,start_time,end_time,module_code,lecturer_code,student_group,registered_count,room_code,session_type`

See `examples/sample_timetable.csv` for completely fabricated data.

## Recommended collections (Spring Boot ownership)

- `timetable_imports`: filename metadata, source, validation status and permitted usage, not confidential file body.
- `timetable_baselines`: immutable normalized snapshots (or immutable versioned sessions).
- `scenarios`: baseline ID, scenario status, owner and revision.
- `scenario_sessions`: per-scenario session allocations.
- `validation_reports`: saved conflict results.
- `scenario_changes`: before/after changes, actor, approved case and timestamp.

## Multi-user safety

When applying a proposal, revalidate against the active scenario version in Spring Boot, and use suitable concurrency control. For multi-document atomic updates with MongoDB, configure a replica set and transactions (a standalone MongoDB demo setup is insufficient for this). Do not update the baseline.
