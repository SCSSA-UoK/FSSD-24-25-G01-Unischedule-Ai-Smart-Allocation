# UniSchedule AI — Milestone 02: Lecturer Reference Data & Spring Boot APIs

This is an **overlay** for your existing UniSchedule AI repository, not a replacement for your working Spring Boot application.

## What is included

- `data/lecturers.jsonl`: 140 public staff-directory entries + 3 separately identified visiting/external lecturers.
- `data/lecturer_course_assignments.jsonl`: provisional course-to-lecturer associations.
- `data/reference_sessions.jsonl`: 55 **selected** historical timetable entries from the consolidated review.
- `data/dataset_manifest.json`: data limitations, revision details, and excluded names.
- `tools/import_reference_data.py`: a repeatable one-time MongoDB Atlas importer.
- `services/platform-service/src/main/java/com/unischedule/platform/reference/`: 6 Java files that add read-only APIs.

**Limitations:** This is **not a complete faculty-wide transcription**. The uploaded Year 1, 2 and 3 PDF tables contain many sessions beyond these 55 review records, and Year 4 is based on screenshots. The reference data is not the faculty's current official timetable. Some lecturers and rooms are unknown. Do not use missing records to claim availability.

**Corrections applied:** Dr. K.K.K.R. Perera, Dr. A.P. Hewaarachchi, Prof. K.M.D.C. Jayathilaka, and previously clarified surname matches. Chatura Liyanage, Hashini Sewwandi, and Dinidi Wijeratna have been excluded from teaching assignments as requested. The affected lecture bookings can remain as occupancy-only records. The Year 3 reference records use the **10 September 2026** source revision (not the older 7 September version). Cross-listed course codes remain in one session.

## Step 1 — Copy files into your project

Extract the ZIP and merge the `data/`, `tools/` and `services/` directories into:

`E:\unischeduler\UniSchedule_AI_Project_Structure\`

**Do not delete your existing** `TimetableSession.java`, `TimetableRepository.java`, `TimetableService.java`, `TimetableController.java`, `pom.xml`, or `.env`.

The new Java files live under a separate `reference` package so they do not overwrite your existing `/api/timetables` endpoints.

Make sure `pom.xml` includes `spring-boot-starter-data-mongodb` and `spring-boot-starter-web` (or the equivalent supported Spring MVC starter for your Spring Boot version).

## Step 2 — Check your Atlas environment

At the repository root, keep your secret local `.env` file. Do not upload it to GitHub.

```dotenv
MONGODB_URI=mongodb+srv://YOUR_USER:YOUR_PASSWORD@YOUR_ATLAS_CLUSTER.mongodb.net/?retryWrites=true&w=majority
PLATFORM_DB=platform_db
```

For Spring Boot **4.x**, your existing `application.properties` should include:

```properties
spring.application.name=platform-service
server.port=8081
spring.config.import=optional:file:../../.env[.properties]
spring.mongodb.uri=${MONGODB_URI}
spring.mongodb.database=${PLATFORM_DB:platform_db}
```

The import path above is relative to running Maven inside `services/platform-service`. If your Spring Boot version is **3.x**, use `spring.data.mongodb.uri` and `spring.data.mongodb.database` instead.

## Step 3 — Import reference records (CMD)

Open **CMD** in the root folder:

```bat
cd /d E:\unischeduler\UniSchedule_AI_Project_Structure
py -m pip install pymongo python-dotenv
py tools\import_reference_data.py
```

The last command is a **dry run**. It checks the file contents but writes nothing.

After checking the counts, run:

```bat
py tools\import_reference_data.py --apply
```

This writes only into `platform_db.lecturers`, `platform_db.lecturer_course_assignments` and `platform_db.reference_sessions`. It **does not touch** your existing `timetable_sessions` collection. Repeating the import skips IDs already present rather than overwriting them.

If connection fails, check Atlas Database Access, Network Access, and your local `.env` URI. Do not paste the password into chat or GitHub.

## Step 4 — Run Spring Boot

```bat
cd /d E:\unischeduler\UniSchedule_AI_Project_Structure\services\platform-service
mvn spring-boot:run
```

## Step 5 — Open these APIs in a browser

| Endpoint | Purpose |
| --- | --- |
| `http://localhost:8081/api/reference-data/status` | Counts of imported records |
| `http://localhost:8081/api/lecturers?search=Amarasooriya` | Search the lecturer directory |
| `http://localhost:8081/api/lecturers/KLN-SCI-STCS-014/timetable` | Reported sessions for Shehan Amarasooriya |
| `http://localhost:8081/api/reference-sessions?day=WEDNESDAY` | Wednesday reference sessions |
| `http://localhost:8081/api/reference-sessions?moduleCode=BECS%2032253` | Sessions with a particular module code |
| `http://localhost:8081/api/reference-sessions?yearOfStudy=1` | Year 1 reference sessions |
| `http://localhost:8081/api/rooms/A7%20406/schedule` | Known sessions recorded for that room |

A working import should show around **143 lecturer records**, **55 reference sessions**, and the course association count from `dataset_manifest.json`. MongoDB Atlas **Browse Collections** should show the three new collections.

## How the four files relate

- **Model:** describes fields from MongoDB (`ReferenceLecturer`, `ReferenceSession`).
- **Repository:** provides basic MongoDB data access.
- **Service:** handles search/filter and timetable ordering.
- **Controller:** makes those functions available as HTTP GET endpoints.

This is read-only code. It does not assign rooms or change existing sessions.

## Next after successful import

1. Build a reviewable import for **all** Year 1–3 faculty PDF timetable cells, and preserve source-version information.
2. Add a `student_groups` mapping and lecturer/session assignment review screen.
3. Implement **known conflicts / unknown availability**, not merely `free` versus `busy`.
4. Connect the read-only Spring Boot tools to the Python Agentic AI service.

Do not assume a lecturer is available just because this partial dataset does not list a session at that time.

### Before pushing to GitHub

The included `data/.gitignore` prevents accidentally committing the provisional JSONL data. Keep the dataset private until you have permission to share it. You may commit the importer and Java source code. If you previously committed data files, `.gitignore` alone does not remove them from Git history.
