
"use client";

import { useEffect, useMemo, useState } from "react";

type Lecturer = {
  id: string;
  name?: string | null;
  displayName?: string | null;
  designation?: string | null;
  departmentName?: string | null;
  departmentCode?: string | null;
};

type Session = {
  id?: string;
  originalSessionId?: string;
  dayOfWeek?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  roomCode?: string | null;
  moduleCodes?: string[] | null;
  moduleTitle?: string | null;
  sessionType?: string | null;
  group?: string | null;
  academicYear?: string | null;
  yearOfStudy?: number | null;
  reportedLecturerIds?: string[] | null;
  lecturerAssignmentStatus?: string | null;
  reportedLecturerNames?: string[] | null;
};

type Summary = {
  lecturers?: number;
  referenceSessions?: number;
  courseAssociations?: number;
};

type TimetableResponse = {
  lecturer: Lecturer;
  sessions: Session[];
  caution?: string;
};

const DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

const YEARS = [1, 2, 3, 4];
const UNKNOWN_DEPARTMENT = "Department not recorded";

const studyYear = (year?: number | null) =>
  year == null ? "Study year unknown" : `Year ${year}`;

const sessionSort = (a: Session, b: Session) =>
  (a.yearOfStudy ?? 99) - (b.yearOfStudy ?? 99) ||
  DAYS.indexOf(a.dayOfWeek || "") -
    DAYS.indexOf(b.dayOfWeek || "") ||
  (a.startTime || "").localeCompare(b.startTime || "");

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/platform-api${path}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Request failed (${response.status}). Check that Spring Boot is running on port 8081.`
    );
  }

  return response.json() as Promise<T>;
}

const lecturerName = (lecturer: Lecturer) =>
  lecturer.displayName?.trim() ||
  lecturer.name?.trim() ||
  lecturer.id;

const prettyDay = (day?: string | null) =>
  day
    ? day.charAt(0) + day.slice(1).toLowerCase()
    : "Day unknown";

const formatTime = (value?: string | null) =>
  value ? value.slice(0, 5) : "--:--";

function SessionCard({ session }: { session: Session }) {
  return (
    <article className="session-card">
      <div className="session-top">
        <span className="day-tag">
          {prettyDay(session.dayOfWeek)}
        </span>

        <span className="year-tag">
          {studyYear(session.yearOfStudy)}
        </span>

        <span className="session-time">
          {formatTime(session.startTime)} –{" "}
          {formatTime(session.endTime)}
        </span>
      </div>

      <div className="session-title">
        {session.moduleTitle || "Module title unavailable"}
      </div>

      <div className="session-codes">
        {session.moduleCodes?.join(" / ") ||
          "Code not recorded"}

        {session.sessionType
          ? ` · ${session.sessionType}`
          : ""}
      </div>

      <div className="session-footer">
        <span>
          📍 {session.roomCode || "Room not recorded"}
        </span>

        {session.group && <span>{session.group}</span>}
      </div>
    </article>
  );
}

export default function Home() {
  const [tab, setTab] = useState<
    "lecturers" | "rooms"
  >("lecturers");

  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] =
    useState("ALL");
  const [yearFilter, setYearFilter] = useState("ALL");

  const [selectedId, setSelectedId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [lecturerDay, setLecturerDay] = useState("ALL");

  const [roomCode, setRoomCode] = useState("A7 406");
  const [roomDay, setRoomDay] = useState("ALL");
  const [roomYear, setRoomYear] = useState("ALL");
  const [roomSessions, setRoomSessions] = useState<Session[]>([]);
  const [roomSearched, setRoomSearched] = useState(false);

  const [loadingDirectory, setLoadingDirectory] =
    useState(true);
  const [loadingSessions, setLoadingSessions] =
    useState(false);
  const [loadingRooms, setLoadingRooms] = useState(false);

  const [error, setError] = useState("");
  const [roomError, setRoomError] = useState("");

  // Load lecturers, sessions and database statistics.
  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [people, stats, recordedSessions] =
          await Promise.all([
            getJson<Lecturer[]>("/lecturers"),
            getJson<Summary>("/reference-data/status"),
            getJson<Session[]>("/reference-sessions"),
          ]);

        if (!active) return;

        setLecturers(people);
        setSummary(stats);
        setAllSessions(recordedSessions);

        const preferred = people.find((person) =>
          lecturerName(person)
            .toLowerCase()
            .includes("amarasooriya")
        );

        setSelectedId(
          preferred?.id || people[0]?.id || ""
        );
      } catch (e) {
        if (active) {
          setError(
            e instanceof Error
              ? e.message
              : "Unable to load lecturers."
          );
        }
      } finally {
        if (active) setLoadingDirectory(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  // Load timetable when a lecturer is selected.
  useEffect(() => {
    if (!selectedId) {
      setSessions([]);
      return;
    }

    let active = true;

    setLoadingSessions(true);
    setSessions([]);
    setError("");

    getJson<TimetableResponse>(
      `/lecturers/${encodeURIComponent(selectedId)}/timetable`
    )
      .then((data) => {
        if (active) {
          setSessions(data.sessions || []);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(
            e instanceof Error
              ? e.message
              : "Unable to load timetable."
          );
        }
      })
      .finally(() => {
        if (active) setLoadingSessions(false);
      });

    return () => {
      active = false;
    };
  }, [selectedId]);

  // Extract departments from the lecturer directory.
  const departmentOptions = useMemo(
    () =>
      Array.from(
        new Set(
          lecturers.map(
            (person) =>
              person.departmentName || UNKNOWN_DEPARTMENT
          )
        )
      ).sort((a, b) => a.localeCompare(b)),
    [lecturers]
  );

  // Find the study years associated with each lecturer.
  const lecturerYears = useMemo(() => {
    const result = new Map<string, Set<number>>();

    for (const session of allSessions) {
      if (session.yearOfStudy == null) continue;

      for (const id of session.reportedLecturerIds || []) {
        if (!result.has(id)) {
          result.set(id, new Set());
        }

        result.get(id)!.add(session.yearOfStudy);
      }
    }

    return result;
  }, [allSessions]);

  // Apply department, year and search filters.
  const filteredLecturers = useMemo(() => {
    const term = search.trim().toLowerCase();

    return lecturers
      .filter((person) => {
        const department =
          person.departmentName || UNKNOWN_DEPARTMENT;

        const matchesDepartment =
          departmentFilter === "ALL" ||
          departmentFilter === department;

        const matchesYear =
          yearFilter === "ALL" ||
          (lecturerYears
            .get(person.id)
            ?.has(Number(yearFilter)) ??
            false);

        const matchesSearch =
          `${lecturerName(person)} ${department} ${person.id}`
            .toLowerCase()
            .includes(term);

        return (
          matchesDepartment &&
          matchesYear &&
          matchesSearch
        );
      })
      .sort(
        (a, b) =>
          (
            a.departmentName || UNKNOWN_DEPARTMENT
          ).localeCompare(
            b.departmentName || UNKNOWN_DEPARTMENT
          ) ||
          lecturerName(a).localeCompare(lecturerName(b))
      );
  }, [
    lecturers,
    departmentFilter,
    yearFilter,
    search,
    lecturerYears,
  ]);

  // Automatically select a visible lecturer.
  useEffect(() => {
    if (loadingDirectory) return;

    if (
      !filteredLecturers.some(
        (person) => person.id === selectedId
      )
    ) {
      setSelectedId(filteredLecturers[0]?.id || "");
    }
  }, [
    filteredLecturers,
    selectedId,
    loadingDirectory,
  ]);

  // Group lecturers by department.
  const lecturerGroups = useMemo(() => {
    const groups: {
      name: string;
      people: Lecturer[];
    }[] = [];

    for (const person of filteredLecturers) {
      const name =
        person.departmentName || UNKNOWN_DEPARTMENT;

      const last = groups[groups.length - 1];

      if (last?.name === name) {
        last.people.push(person);
      } else {
        groups.push({
          name,
          people: [person],
        });
      }
    }

    return groups;
  }, [filteredLecturers]);

  const selectedLecturer = lecturers.find(
    (lecturer) => lecturer.id === selectedId
  );

  // Filter selected lecturer's timetable.
  const lecturerSessions = sessions
    .filter(
      (session) =>
        (lecturerDay === "ALL" ||
          session.dayOfWeek === lecturerDay) &&
        (yearFilter === "ALL" ||
          session.yearOfStudy === Number(yearFilter))
    )
    .sort(sessionSort);

  // Group the timetable by study year.
  const lecturerSessionGroups = useMemo(() => {
    const groups: {
      year: string;
      entries: Session[];
    }[] = [];

    for (const session of lecturerSessions) {
      const year = studyYear(session.yearOfStudy);
      const last = groups[groups.length - 1];

      if (last?.year === year) {
        last.entries.push(session);
      } else {
        groups.push({
          year,
          entries: [session],
        });
      }
    }

    return groups;
  }, [lecturerSessions]);

  // Search sessions for a room.
  async function findRooms() {
    setRoomError("");
    setLoadingRooms(true);
    setRoomSearched(true);

    try {
      const query = new URLSearchParams();

      if (roomCode.trim()) {
        query.set("roomCode", roomCode.trim());
      }

      if (roomDay !== "ALL") {
        query.set("day", roomDay);
      }

      if (roomYear !== "ALL") {
        query.set("yearOfStudy", roomYear);
      }

      const result = await getJson<Session[]>(
        `/reference-sessions?${query.toString()}`
      );

      setRoomSessions(result.sort(sessionSort));
    } catch (e) {
      setRoomError(
        e instanceof Error
          ? e.message
          : "Unable to search sessions."
      );
      setRoomSessions([]);
    } finally {
      setLoadingRooms(false);
    }
  }

  return (
    <main className="site-shell">
      {/* Header */}
      <header className="header">
        <div className="brand-symbol">U</div>

        <div className="brand-copy">
          <strong>
            UniSchedule <span>AI</span>
          </strong>
          <small>University timetable workspace</small>
        </div>

        <span className="header-pill">
          Reference data · Read only
        </span>
      </header>

      {/* Dashboard overview */}
      <section className="hero">
        <div>
          <p className="eyebrow">TIMETABLE EXPLORER</p>

          <h1>
            Know who teaches{" "}
            <em>what, where and when.</em>
          </h1>

          <p className="hero-subtitle">
            Browse the lecturer and room schedules
            collected for UniSchedule AI.
          </p>
        </div>

        <div className="stats">
          <div>
            <strong>{summary?.lecturers ?? "—"}</strong>
            <span>Lecturer records</span>
          </div>

          <div>
            <strong>
              {summary?.referenceSessions ?? "—"}
            </strong>
            <span>Weekly sessions</span>
          </div>

          <div>
            <strong>
              {summary?.courseAssociations ?? "—"}
            </strong>
            <span>Course mappings</span>
          </div>
        </div>
      </section>

      {/* Data warning */}
      <div className="notice">
        <span>ⓘ</span>
        <p>
          <strong>Historical simulation data.</strong>{" "}
          Lecturer mappings are provisional and the
          timetable is incomplete. An empty schedule
          does not mean someone is available.
        </p>
      </div>

      {/* Navigation */}
      <nav className="tabs" aria-label="Timetable views">
        <button
          className={
            tab === "lecturers" ? "active" : ""
          }
          onClick={() => setTab("lecturers")}
        >
          Lecturer timetables
        </button>

        <button
          className={tab === "rooms" ? "active" : ""}
          onClick={() => setTab("rooms")}
        >
          Room &amp; day lookup
        </button>
      </nav>

      {tab === "lecturers" ? (
        <section className="workspace">
          {/* Left sidebar */}
          <aside className="directory panel">
            <div className="panel-heading">
              <h2>Lecturers</h2>
              <span>{filteredLecturers.length}</span>
            </div>

            <div className="directory-filters">
              <label htmlFor="department-filter">
                Department
              </label>

              <select
                id="department-filter"
                className="select"
                value={departmentFilter}
                onChange={(e) =>
                  setDepartmentFilter(e.target.value)
                }
              >
                <option value="ALL">
                  All departments
                </option>

                {departmentOptions.map((department) => (
                  <option
                    key={department}
                    value={department}
                  >
                    {department}
                  </option>
                ))}
              </select>

              <label htmlFor="year-filter">
                Year of study
              </label>

              <select
                id="year-filter"
                className="select"
                value={yearFilter}
                onChange={(e) => {
                  setYearFilter(e.target.value);
                  setLecturerDay("ALL");
                }}
              >
                <option value="ALL">
                  All years
                </option>

                {YEARS.map((year) => (
                  <option key={year} value={year}>
                    Year {year}
                  </option>
                ))}
              </select>

              <label htmlFor="lecturer-search">
                Find lecturer
              </label>

              <input
                id="lecturer-search"
                className="field"
                placeholder="Search lecturer name..."
                value={search}
                onChange={(e) =>
                  setSearch(e.target.value)
                }
              />

              <p className="filter-helper">
                Year filters show lecturers with
                recorded sessions for that year.
              </p>
            </div>

            <div className="lecturer-list">
              {loadingDirectory && (
                <p className="placeholder">
                  Loading lecturer directory...
                </p>
              )}

              {!loadingDirectory &&
                filteredLecturers.length === 0 && (
                  <p className="placeholder">
                    No documented lecturer sessions
                    match these filters. Try another
                    year or department.
                  </p>
                )}

              {lecturerGroups.map((group) => (
                <div key={group.name}>
                  <div className="department-heading">
                    {group.name}
                    <span>
                      {group.people.length}
                    </span>
                  </div>

                  {group.people.map((person) => (
                    <button
                      key={person.id}
                      className={`lecturer-item ${
                        selectedId === person.id
                          ? "selected"
                          : ""
                      }`}
                      onClick={() => {
                        setSelectedId(person.id);
                        setLecturerDay("ALL");
                      }}
                    >
                      <span className="avatar">
                        {lecturerName(person)
                          .charAt(0)
                          .toUpperCase()}
                      </span>

                      <span className="lecturer-info">
                        <strong>
                          {lecturerName(person)}
                        </strong>

                        <small>
                          Recorded years:{" "}
                          {Array.from(
                            lecturerYears.get(
                              person.id
                            ) || []
                          )
                            .sort()
                            .map(
                              (year) => `Y${year}`
                            )
                            .join(", ") ||
                            "None yet"}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </aside>

          {/* Lecturer details */}
          <div className="details panel">
            <div className="detail-heading">
              <div>
                <p className="eyebrow">
                  LECTURER SCHEDULE
                </p>

                <h2>
                  {selectedLecturer
                    ? lecturerName(selectedLecturer)
                    : "Select a lecturer"}
                </h2>

                <p>
                  {selectedLecturer?.designation ||
                    ""}

                  {selectedLecturer?.departmentName
                    ? ` · ${selectedLecturer.departmentName}`
                    : ""}
                </p>

                <p className="selected-year-label">
                  {yearFilter === "ALL"
                    ? "All recorded study years"
                    : `Year ${yearFilter}`}
                </p>
              </div>

              <select
                className="select"
                aria-label="Filter by weekday"
                value={lecturerDay}
                onChange={(e) =>
                  setLecturerDay(e.target.value)
                }
              >
                <option value="ALL">
                  All weekdays
                </option>

                {DAYS.map((day) => (
                  <option
                    value={day}
                    key={day}
                  >
                    {prettyDay(day)}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div className="error">{error}</div>
            )}

            {loadingSessions ? (
              <div className="empty-state">
                Loading timetable...
              </div>
            ) : lecturerSessions.length ? (
              <div className="grouped-sessions">
                {lecturerSessionGroups.map(
                  (group) => (
                    <section
                      key={group.year}
                      className="study-year-section"
                    >
                      <h3>
                        {group.year}
                        <span>
                          {group.entries.length}{" "}
                          recorded session
                          {group.entries.length === 1
                            ? ""
                            : "s"}
                        </span>
                      </h3>

                      <div className="session-grid">
                        {group.entries.map(
                          (session, index) => (
                            <SessionCard
                              session={session}
                              key={
                                session.id ||
                                session.originalSessionId ||
                                index
                              }
                            />
                          )
                        )}
                      </div>
                    </section>
                  )
                )}
              </div>
            ) : (
              <div className="empty-state">
                <strong>
                  No recorded classes for this selection.
                </strong>

                <p>
                  This does not confirm that the
                  lecturer is free.
                </p>
              </div>
            )}
          </div>
        </section>
      ) : (
        /* Room search */
        <section className="panel room-panel">
          <div className="detail-heading">
            <div>
              <p className="eyebrow">
                ROOM SEARCH
              </p>
              <h2>
                Find classes by room and day
              </h2>
              <p>
                Search known room occupancy in the
                imported reference sessions.
              </p>
            </div>
          </div>

          <form
            className="room-search"
            onSubmit={(e) => {
              e.preventDefault();
              void findRooms();
            }}
          >
            <label>
              Room code
              <input
                className="field"
                placeholder="e.g. A7 406"
                value={roomCode}
                onChange={(e) =>
                  setRoomCode(e.target.value)
                }
              />
            </label>

            <label>
              Day
              <select
                className="select"
                value={roomDay}
                onChange={(e) =>
                  setRoomDay(e.target.value)
                }
              >
                <option value="ALL">
                  All weekdays
                </option>

                {DAYS.map((day) => (
                  <option
                    key={day}
                    value={day}
                  >
                    {prettyDay(day)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Year of study
              <select
                className="select"
                value={roomYear}
                onChange={(e) =>
                  setRoomYear(e.target.value)
                }
              >
                <option value="ALL">
                  All years
                </option>

                {YEARS.map((year) => (
                  <option
                    key={year}
                    value={year}
                  >
                    Year {year}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="primary-button"
              type="submit"
              disabled={loadingRooms}
            >
              {loadingRooms
                ? "Searching..."
                : "Find sessions"}
            </button>
          </form>

          {roomError && (
            <div className="error">{roomError}</div>
          )}

          {roomSearched &&
            !loadingRooms &&
            (roomSessions.length ? (
              <div className="session-grid">
                {roomSessions.map(
                  (session, index) => (
                    <SessionCard
                      session={session}
                      key={
                        session.id ||
                        session.originalSessionId ||
                        index
                      }
                    />
                  )
                )}
              </div>
            ) : (
              <div className="empty-state">
                <strong>
                  No recorded sessions found.
                </strong>

                <p>
                  The imported dataset is incomplete;
                  this is not a verified free room.
                </p>
              </div>
            ))}

          {!roomSearched && (
            <div className="empty-state">
              Enter a room code and select{" "}
              <strong>Find sessions</strong>.
            </div>
          )}
        </section>
      )}

      <footer>
        UniSchedule AI · Historical timetable reference
        · Not for official scheduling
      </footer>
    </main>
  );
}
