
package com.unischedule.platform.reference.model;

import java.util.List;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

@Document(collection = "reference_sessions")
public record ReferenceSession(
        @Id String id,
        String originalSessionId,
        String academicYear,
        String semester,
        Integer yearOfStudy,
        String dayOfWeek,
        String startTime,
        String endTime,
        String roomCode,
        List<String> moduleCodes,
        String moduleTitle,
        String sessionType,
        String group,
        List<String> reportedLecturerIds,
        List<String> reportedLecturerNames,
        String lecturerAssignmentStatus,
        Boolean roomOccupancyKnown,
        Boolean studentGroupsVerified,
        String sourceFile,
        String sourceRevision,
        String sourceNotes,
        Boolean simulationOnly,
        Boolean facultyAuthorizedForLiveUse
) {}
