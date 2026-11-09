
package com.unischedule.platform.reference.service;

import com.unischedule.platform.reference.model.ReferenceLecturer;
import com.unischedule.platform.reference.model.ReferenceSession;
import com.unischedule.platform.reference.repository.ReferenceLecturerRepository;
import com.unischedule.platform.reference.repository.ReferenceSessionRepository;

import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

@Service
public class ReferenceDataService {

    private static final Map<String, Integer> DAY_ORDER = Map.of(
            "MONDAY", 1,
            "TUESDAY", 2,
            "WEDNESDAY", 3,
            "THURSDAY", 4,
            "FRIDAY", 5,
            "SATURDAY", 6,
            "SUNDAY", 7
    );

    private final ReferenceLecturerRepository lecturers;
    private final ReferenceSessionRepository sessions;
    private final MongoTemplate mongoTemplate;

    public ReferenceDataService(
            ReferenceLecturerRepository lecturers,
            ReferenceSessionRepository sessions,
            MongoTemplate mongoTemplate) {

        this.lecturers = lecturers;
        this.sessions = sessions;
        this.mongoTemplate = mongoTemplate;
    }

    // Get total imported record counts
    public Map<String, Object> summary() {
        return Map.of(
                "lecturers", lecturers.count(),
                "referenceSessions", sessions.count(),
                "courseAssociations",
                mongoTemplate
                    .getCollection("lecturer_course_assignments")
                    .countDocuments(),
                "officialTimetable", false,
                "description",
                "Historical and user-reported reference data"
        );
    }

    // Search lecturers by name
    public List<ReferenceLecturer> findLecturers(String search) {

        Query query = new Query();

        if (search != null && !search.isBlank()) {

            String safeRegex = Pattern.quote(search.trim());

            query.addCriteria(new Criteria().orOperator(
                    Criteria.where("displayName")
                            .regex(safeRegex, "i"),
                    Criteria.where("name")
                            .regex(safeRegex, "i")
            ));
        }

        query.limit(200);

        return mongoTemplate.find(query, ReferenceLecturer.class)
                .stream()
                .sorted(Comparator.comparing(
                        ReferenceLecturer::displayName,
                        Comparator.nullsLast(
                            String.CASE_INSENSITIVE_ORDER
                        )
                ))
                .toList();
    }

    // Find a lecturer by ID
    public Optional<ReferenceLecturer> findLecturer(
            String lecturerId) {

        return lecturers.findById(lecturerId);
    }

    // Get a lecturer's known weekly sessions
    public List<ReferenceSession> findLecturerSessions(
            String lecturerId) {

        Query query = new Query(
                Criteria.where("reportedLecturerIds")
                        .is(lecturerId)
        );

        return sorted(
                mongoTemplate.find(query, ReferenceSession.class)
        );
    }

    // Search timetable sessions
    public List<ReferenceSession> findSessions(
            String day,
            String roomCode,
            String moduleCode,
            Integer yearOfStudy) {

        Query query = new Query();

        if (day != null && !day.isBlank()) {
            query.addCriteria(
                    Criteria.where("dayOfWeek")
                            .is(day.trim().toUpperCase())
            );
        }

        if (roomCode != null && !roomCode.isBlank()) {
            query.addCriteria(
                    Criteria.where("roomCode")
                            .is(roomCode.trim())
            );
        }

        if (moduleCode != null && !moduleCode.isBlank()) {
            query.addCriteria(
                    Criteria.where("moduleCodes")
                            .is(moduleCode.trim().toUpperCase())
            );
        }

        if (yearOfStudy != null) {
            query.addCriteria(
                    Criteria.where("yearOfStudy")
                            .is(yearOfStudy)
            );
        }

        query.limit(500);

        return sorted(
                mongoTemplate.find(query, ReferenceSession.class)
        );
    }

    // Sort sessions by weekday and start time
    private List<ReferenceSession> sorted(
            List<ReferenceSession> data) {

        return data.stream()
                .sorted(Comparator
                    .comparingInt(
                        (ReferenceSession s) ->
                            DAY_ORDER.getOrDefault(
                                s.dayOfWeek(), 9
                            )
                    )
                    .thenComparing(
                        ReferenceSession::startTime,
                        Comparator.nullsLast(
                            String::compareTo
                        )
                    )
                )
                .toList();
    }
}
