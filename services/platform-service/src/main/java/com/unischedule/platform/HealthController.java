
package com.unischedule.platform;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

    @GetMapping("/api/health")
    public Map<String, String> health() {
        return Map.of(
            "service", "UniSchedule AI Platform",
            "status", "UP",
            "message", "Spring Boot is working!"
        );
    }
}
