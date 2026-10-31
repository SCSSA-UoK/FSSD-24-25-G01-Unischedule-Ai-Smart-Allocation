
package com.unischedule.platform.repository;

import com.unischedule.platform.model.TimetableSession;
import org.springframework.data.mongodb.repository.MongoRepository;

public interface TimetableRepository
        extends MongoRepository<TimetableSession, String> {
}
