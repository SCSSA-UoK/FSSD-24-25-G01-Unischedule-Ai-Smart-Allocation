
package com.unischedule.platform.simulation;

import org.springframework.data.mongodb.repository.MongoRepository;

public interface SimulationRepository
        extends MongoRepository<SimulationScenario, String> {
}
