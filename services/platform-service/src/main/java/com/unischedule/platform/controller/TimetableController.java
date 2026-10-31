
package com.unischedule.platform.controller;

import com.unischedule.platform.model.TimetableSession;
import com.unischedule.platform.service.TimetableService;

import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import java.util.List;

@RestController
@RequestMapping("/api/timetables")
public class TimetableController {

    private final TimetableService service;

    public TimetableController(TimetableService service) {
        this.service = service;
    }

    @GetMapping
    public List<TimetableSession> getAll() {
        return service.getAll();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public TimetableSession create(
            @RequestBody TimetableSession session) {
        return service.save(session);
    }
}
