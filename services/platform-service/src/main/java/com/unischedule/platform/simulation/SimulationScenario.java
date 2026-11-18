
package com.unischedule.platform.simulation;

import java.time.Instant;
import java.util.List;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

@Document(collection = "simulation_scenarios")
public record SimulationScenario(
        @Id String id,
        String name,
        String description,
        String academicYear,
        String semester,
        Instant createdAt,
        List<SessionMove> moves
) {
    public record SessionMove(
            String sessionId,
            String dayOfWeek,
            String startTime,
            String endTime,
            String roomCode
    ) {}
}
