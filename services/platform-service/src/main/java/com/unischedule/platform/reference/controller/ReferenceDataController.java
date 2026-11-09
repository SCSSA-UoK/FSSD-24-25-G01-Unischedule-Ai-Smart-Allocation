
package com.unischedule.platform.reference.controller;

import com.unischedule.platform.reference.model.ReferenceLecturer;
import com.unischedule.platform.reference.model.ReferenceSession;
import com.unischedule.platform.reference.service.ReferenceDataService;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
public class ReferenceDataController {

    private final ReferenceDataService service;

    public ReferenceDataController(
            ReferenceDataService service) {

        this.service = service;
    }

    // Check imported data status
    @GetMapping("/api/reference-data/status")
    public Map<String, Object> status() {
        return service.summary();
    }

    // List or search lecturers
    @GetMapping("/api/lecturers")
    public List<ReferenceLecturer> lecturers(
            @RequestParam(required = false) String search) {

        return service.findLecturers(search);
    }

    // Get a particular lecturer's timetable
    @GetMapping("/api/lecturers/{id}/timetable")
    public ResponseEntity<LecturerTimetable> lecturerTimetable(
            @PathVariable String id) {

        return service.findLecturer(id)
                .map(lecturer ->
                    ResponseEntity.ok(
                        new LecturerTimetable(
                            lecturer,
                            service.findLecturerSessions(id),
                            "Collected weekly sessions only. " +
                            "Full lecturer availability is not verified."
                        )
                    )
                )
                .orElseGet(() ->
                    ResponseEntity.notFound().build()
                );
    }

    // Search sessions by day, room, module, year
    @GetMapping("/api/reference-sessions")
    public List<ReferenceSession> sessions(
            @RequestParam(required = false) String day,
            @RequestParam(required = false) String roomCode,
            @RequestParam(required = false) String moduleCode,
            @RequestParam(required = false) Integer yearOfStudy) {

        return service.findSessions(
                day,
                roomCode,
                moduleCode,
                yearOfStudy
        );
    }

    // View all known sessions in a room
    @GetMapping("/api/rooms/{roomCode}/schedule")
    public List<ReferenceSession> roomSchedule(
            @PathVariable String roomCode,
            @RequestParam(required = false) String day) {

        return service.findSessions(
                day,
                roomCode,
                null,
                null
        );
    }

    // Response structure for lecturer timetable
    public record LecturerTimetable(
            ReferenceLecturer lecturer,
            List<ReferenceSession> sessions,
            String caution
    ) {}
}
