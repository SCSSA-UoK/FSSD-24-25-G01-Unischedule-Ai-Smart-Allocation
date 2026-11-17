
package com.unischedule.platform.simulation;

import com.unischedule.platform.reference.model.ReferenceSession;
import com.unischedule.platform.reference.repository.ReferenceSessionRepository;

import com.unischedule.platform.simulation.SimulationDtos.CreateScenarioRequest;
import com.unischedule.platform.simulation.SimulationDtos.MoveSessionRequest;
import com.unischedule.platform.simulation.SimulationDtos.PreviewResponse;
import com.unischedule.platform.simulation.SimulationDtos.PreviewSession;

import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Service
public class SimulationService {

    private static final List<String> DAYS = List.of(
            "MONDAY", "TUESDAY", "WEDNESDAY",
            "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"
    );

    private final SimulationRepository scenarios;
    private final ReferenceSessionRepository references;
    private final MongoTemplate mongoTemplate;

    public SimulationService(
            SimulationRepository scenarios,
            ReferenceSessionRepository references,
            MongoTemplate mongoTemplate) {

        this.scenarios = scenarios;
        this.references = references;
        this.mongoTemplate = mongoTemplate;
    }

    // Create a simulation scenario
    public SimulationScenario create(
            CreateScenarioRequest request) {

        if (request == null) {
            throw badRequest("Request body is required");
        }

        String name = required(request.name(), "name");
        String academicYear = required(
                request.academicYear(), "academicYear");
        String semester = required(
                request.semester(), "semester");

        if (!mongoTemplate.exists(
                sourceQuery(academicYear, semester),
                ReferenceSession.class)) {

            throw badRequest(
                    "No timetable sessions found for this " +
                    "academic year and semester"
            );
        }

        SimulationScenario scenario = new SimulationScenario(
                UUID.randomUUID().toString(),
                name,
                request.description(),
                academicYear,
                semester,
                Instant.now(),
                List.of()
        );

        return scenarios.save(scenario);
    }

    // List all simulations
    public List<SimulationScenario> list() {

        return scenarios.findAll()
                .stream()
                .sorted(
                        Comparator.comparing(
                                SimulationScenario::createdAt,
                                Comparator.nullsLast(
                                        Comparator.reverseOrder()
                                )
                        )
                )
                .toList();
    }

    // Get a simulation
    public SimulationScenario get(String id) {

        return scenarios.findById(id)
                .orElseThrow(() ->
                        new ResponseStatusException(
                                HttpStatus.NOT_FOUND,
                                "Simulation not found"
                        )
                );
    }

    // Move a session inside a simulation only
    public SimulationScenario move(
            String scenarioId,
            MoveSessionRequest request) {

        if (request == null) {
            throw badRequest("Request body is required");
        }

        SimulationScenario scenario = get(scenarioId);

        String sessionId = required(
                request.sessionId(), "sessionId");

        ReferenceSession original = references
                .findById(sessionId)
                .orElseThrow(() ->
                        new ResponseStatusException(
                                HttpStatus.NOT_FOUND,
                                "Reference session not found"
                        )
                );

        // Prevent mixing different academic periods
        if (!scenario.academicYear().equalsIgnoreCase(
                original.academicYear() == null
                        ? "" : original.academicYear()
        ) || !scenario.semester().equalsIgnoreCase(
                original.semester() == null
                        ? "" : original.semester()
        )) {

            throw badRequest(
                    "Session belongs to a different academic period"
            );
        }

        String day = validDay(request.dayOfWeek());

        LocalTime start = parseTime(
                request.startTime(), "startTime");

        LocalTime end = parseTime(
                request.endTime(), "endTime");

        if (!start.isBefore(end)) {
            throw badRequest(
                    "End time must be after start time"
            );
        }

        String room = required(
                request.roomCode(), "roomCode")
                .replaceAll("\\s+", " ")
                .toUpperCase(Locale.ROOT);

        SimulationScenario.SessionMove newMove =
                new SimulationScenario.SessionMove(
                        sessionId,
                        day,
                        start.toString(),
                        end.toString(),
                        room
                );

        // Replace any earlier move for this session
        List<SimulationScenario.SessionMove> moves =
                new ArrayList<>(
                        scenario.moves() == null
                                ? List.of()
                                : scenario.moves()
                );

        moves.removeIf(
                move -> move.sessionId().equals(sessionId)
        );

        moves.add(newMove);

        return scenarios.save(
                withMoves(scenario, moves)
        );
    }

    // Undo a proposed movement
    public SimulationScenario removeMove(
            String scenarioId,
            String sessionId) {

        SimulationScenario scenario = get(scenarioId);

        List<SimulationScenario.SessionMove> moves =
                new ArrayList<>(
                        scenario.moves() == null
                                ? List.of()
                                : scenario.moves()
                );

        boolean removed = moves.removeIf(
                move -> move.sessionId().equals(sessionId)
        );

        if (!removed) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND,
                    "Session movement not found"
            );
        }

        return scenarios.save(
                withMoves(scenario, moves)
        );
    }

    // Preview timetable with simulated changes
    public PreviewResponse preview(
            String scenarioId,
            String dayFilter) {

        SimulationScenario scenario = get(scenarioId);

        String selectedDay =
                dayFilter == null || dayFilter.isBlank()
                        ? null
                        : validDay(dayFilter);

        Map<String, SimulationScenario.SessionMove> moves =
                new HashMap<>();

        if (scenario.moves() != null) {
            for (SimulationScenario.SessionMove move
                    : scenario.moves()) {

                moves.put(move.sessionId(), move);
            }
        }

        // Only reads original sessions
        List<ReferenceSession> originalSessions =
                mongoTemplate.find(
                        sourceQuery(
                                scenario.academicYear(),
                                scenario.semester()
                        ),
                        ReferenceSession.class
                );

        List<PreviewSession> previewSessions =
                originalSessions.stream()
                        .map(original -> {

                            SimulationScenario.SessionMove move =
                                    moves.get(original.id());

                            boolean modified = move != null;

                            return new PreviewSession(
                                    original.id(),
                                    original.moduleCodes(),
                                    original.moduleTitle(),
                                    original.yearOfStudy(),

                                    modified
                                            ? move.dayOfWeek()
                                            : original.dayOfWeek(),

                                    modified
                                            ? move.startTime()
                                            : original.startTime(),

                                    modified
                                            ? move.endTime()
                                            : original.endTime(),

                                    modified
                                            ? move.roomCode()
                                            : original.roomCode(),

                                    original.group(),
                                    original.reportedLecturerNames(),
                                    modified
                            );
                        })
                        .filter(session ->
                                selectedDay == null ||
                                selectedDay.equalsIgnoreCase(
                                        session.dayOfWeek() == null
                                                ? ""
                                                : session.dayOfWeek()
                                )
                        )
                        .sorted(
                                Comparator
                                        .comparingInt(
                                                (PreviewSession s) ->
                                                        dayRank(s.dayOfWeek())
                                        )
                                        .thenComparing(
                                                s -> s.startTime() == null
                                                        ? ""
                                                        : s.startTime()
                                        )
                        )
                        .toList();

        return new PreviewResponse(
                scenario.id(),
                scenario.name(),
                scenario.academicYear(),
                scenario.semester(),
                true,
                "Simulation only. Changes are not validated " +
                "for conflicts or lecturer availability.",
                previewSessions
        );
    }

    // Delete a simulation, not original timetable data
    public void delete(String scenarioId) {

        SimulationScenario scenario = get(scenarioId);
        scenarios.deleteById(scenario.id());
    }

    private SimulationScenario withMoves(
            SimulationScenario original,
            List<SimulationScenario.SessionMove> moves) {

        return new SimulationScenario(
                original.id(),
                original.name(),
                original.description(),
                original.academicYear(),
                original.semester(),
                original.createdAt(),
                List.copyOf(moves)
        );
    }

    private Query sourceQuery(
            String academicYear,
            String semester) {

        return Query.query(
                Criteria.where("academicYear")
                        .is(academicYear)
                        .and("semester")
                        .is(semester)
        );
    }

    private String required(
            String value,
            String field) {

        if (value == null || value.isBlank()) {
            throw badRequest(field + " is required");
        }

        return value.trim();
    }

    private String validDay(String value) {

        String day = required(
                value, "dayOfWeek")
                .toUpperCase(Locale.ROOT);

        if (!DAYS.contains(day)) {
            throw badRequest("Invalid weekday");
        }

        return day;
    }

    private LocalTime parseTime(
            String value,
            String field) {

        String time = required(value, field);

        if (!time.matches("\\d{2}:\\d{2}")) {
            throw badRequest(
                    field + " must use HH:mm format"
            );
        }

        try {
            return LocalTime.parse(time);

        } catch (DateTimeParseException ex) {
            throw badRequest(
                    field + " contains an invalid time"
            );
        }
    }

    private int dayRank(String day) {

        int index = DAYS.indexOf(
                day == null
                        ? ""
                        : day.toUpperCase(Locale.ROOT)
        );

        return index < 0 ? 99 : index;
    }

    private ResponseStatusException badRequest(
            String message) {

        return new ResponseStatusException(
                HttpStatus.BAD_REQUEST,
                message
        );
    }
}
