
package com.unischedule.platform.reference.repository;

import com.unischedule.platform.reference.model.ReferenceSession;
import org.springframework.data.mongodb.repository.MongoRepository;

public interface ReferenceSessionRepository
        extends MongoRepository<ReferenceSession, String> {
}
