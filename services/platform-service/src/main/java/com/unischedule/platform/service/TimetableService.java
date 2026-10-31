
package com.unischedule.platform.service;

import com.unischedule.platform.model.TimetableSession;
import com.unischedule.platform.repository.TimetableRepository;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class TimetableService {

    private final TimetableRepository repository;

    public TimetableService(TimetableRepository repository) {
        this.repository = repository;
    }

    public List<TimetableSession> getAll() {
        return repository.findAll();
    }

    public TimetableSession save(TimetableSession input) {
        TimetableSession session = new TimetableSession(
            null,
            input.moduleCode(),
            input.lecturerId(),
            input.studentGroupId(),
            input.roomId(),
            input.dayOfWeek(),
            input.startTime(),
            input.endTime(),
            input.registeredStudents()
        );

        return repository.save(session);
    }
}
