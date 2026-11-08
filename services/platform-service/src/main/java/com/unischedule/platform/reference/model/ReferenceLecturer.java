
package com.unischedule.platform.reference.model;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

@Document(collection = "lecturers")
public record ReferenceLecturer(
        @Id String id,
        String name,
        String displayName,
        String departmentCode,
        String departmentName,
        String designation,
        String email,
        Boolean directoryListed,
        Boolean probationary,
        String availabilityStatus,
        Boolean teachingAssignmentsVerified
) {}
