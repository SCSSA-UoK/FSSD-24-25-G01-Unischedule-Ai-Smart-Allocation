
package com.unischedule.platform.model;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

@Document(collection = "timetable_sessions")
public record TimetableSession(

    @Id
    String id,

    String moduleCode,
    String lecturerId,
    String studentGroupId,
    String roomId,
    String dayOfWeek,
    String startTime,
    String endTime,
    int registeredStudents

) {}
