
package com.unischedule.platform.simulation;

import com.unischedule.platform.simulation.SimulationDtos.PreviewSession;
import com.unischedule.platform.simulation.SimulationDtos.PreviewResponse;

import org.springframework.stereotype.Service;

import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@Service
public class SimulationConflictService {

    private final SimulationService simulationService;

    public SimulationConflictService(
            SimulationService simulationService) {
        this.simulationService = simulationService;
    }

    public record Conflict(
            String type,
            String firstSessionId,
            String secondSessionId,
            String dayOfWeek,
            String explanation
    ) {}

    public record ConflictResult(
            String scenarioId,
            boolean simulationOnly,
            boolean roomConflictDetected,
            List<Conflict> roomConflicts,
            List<Conflict> possibleConflicts,
            List<String> warnings
    ) {}

    public ConflictResult check(String scenarioId) {

        PreviewResponse preview =
                simulationService.preview(scenarioId, null);

        List<PreviewSession> sessions = preview.sessions();

        List<Conflict> roomConflicts = new ArrayList<>();
        List<Conflict> possibleConflicts = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        warnings.add(
            "Results use recurring weekday/time data, not dated bookings."
        );
        warnings.add(
            "Student group and lecturer-name matches are possible " +
            "conflicts only, because identities are not fully verified."
        );
        warnings.add(
            "Existing reference timetable conflicts may also appear. " +
            "This endpoint does not identify newly introduced conflicts."
        );

        for (int i = 0; i < sessions.size(); i++) {

            PreviewSession a = sessions.get(i);

            for (int j = i + 1; j < sessions.size(); j++) {

                PreviewSession b = sessions.get(j);

                if (!same(a.dayOfWeek(), b.dayOfWeek())) {
                    continue;
                }

                if (!overlaps(a, b)) {
                    continue;
                }

                String day = a.dayOfWeek();

                // Two sessions using the same room at the same time
                if (same(a.roomCode(), b.roomCode())) {

                    roomConflicts.add(new Conflict(
                            "ROOM_OVERLAP",
                            a.sessionId(),
                            b.sessionId(),
                            day,
                            "Both sessions are assigned to room " +
                            a.roomCode() + " at overlapping times."
                    ));
                }

                // Group names are not authoritative identifiers.
                if (a.yearOfStudy() != null
                        && a.yearOfStudy().equals(b.yearOfStudy())
                        && same(a.group(), b.group())) {

                    possibleConflicts.add(new Conflict(
                            "POSSIBLE_STUDENT_GROUP_OVERLAP",
                            a.sessionId(),
                            b.sessionId(),
                            day,
                            "Sessions appear to share a student group."
                    ));
                }

                // Lecturer names must later be replaced with
                // verified lecturer IDs.
                if (sharesLecturerName(
                        a.lecturerNames(), b.lecturerNames())) {

                    possibleConflicts.add(new Conflict(
                            "POSSIBLE_LECTURER_OVERLAP",
                            a.sessionId(),
                            b.sessionId(),
                            day,
                            "Sessions appear to share a lecturer."
                    ));
                }
            }
        }

        return new ConflictResult(
                scenarioId,
                true,
                !roomConflicts.isEmpty(),
                roomConflicts,
                possibleConflicts,
                warnings
        );
    }

    private boolean overlaps(
            PreviewSession a,
            PreviewSession b) {

        try {
            LocalTime aStart = LocalTime.parse(a.startTime());
            LocalTime aEnd = LocalTime.parse(a.endTime());

            LocalTime bStart = LocalTime.parse(b.startTime());
            LocalTime bEnd = LocalTime.parse(b.endTime());

            if (!aStart.isBefore(aEnd)
                    || !bStart.isBefore(bEnd)) {
                return false;
            }

            return aStart.isBefore(bEnd)
                    && bStart.isBefore(aEnd);

        } catch (DateTimeParseException
                | NullPointerException e) {
            return false;
        }
    }

    private boolean same(String first, String second) {
        String a = normalize(first);
        String b = normalize(second);

        return !a.isEmpty() && a.equals(b);
    }

    private String normalize(String value) {

        if (value == null) {
            return "";
        }

        String normalized = value.trim()
                .replaceAll("\\s+", " ")
                .toUpperCase(Locale.ROOT);

        if (List.of(
                "TBA", "UNKNOWN", "N/A",
                "UNASSIGNED", "-"
        ).contains(normalized)) {
            return "";
        }

        return normalized;
    }

    private boolean sharesLecturerName(
            List<String> first,
            List<String> second) {

        if (first == null || second == null) {
            return false;
        }

        for (String a : first) {
            for (String b : second) {
                if (same(a, b)) {
                    return true;
                }
            }
        }

        return false;
    }
}
