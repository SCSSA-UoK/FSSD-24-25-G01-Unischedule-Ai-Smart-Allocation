
package com.unischedule.platform.reference.repository;

import com.unischedule.platform.reference.model.ReferenceLecturer;
import org.springframework.data.mongodb.repository.MongoRepository;

public interface ReferenceLecturerRepository
        extends MongoRepository<ReferenceLecturer, String> {
}
