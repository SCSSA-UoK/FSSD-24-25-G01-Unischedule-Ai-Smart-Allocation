
package com.unischedule.platform.simulation;

import java.util.List;

public final class SimulationDtos {

    private SimulationDtos() {}

    public record CreateScenarioRequest(
            String name,
            String description,
            String academicYear,
            String semester
    ) {}

    public record MoveSessionRequest(
            String sessionId,
            String dayOfWeek,
            String startTime,
            String endTime,
            String roomCode
    ) {}

    public record PreviewSession(
            String sessionId,
            List<String> moduleCodes,
            String moduleTitle,
            Integer yearOfStudy,
            String dayOfWeek,
            String startTime,
            String endTime,
            String roomCode,
            String group,
            List<String> lecturerNames,
            boolean modified
    ) {}

    public record PreviewResponse(
            String scenarioId,
            String scenarioName,
            String academicYear,
            String semester,
            boolean simulationOnly,
            String warning,
            List<PreviewSession> sessions
    ) {}
}
