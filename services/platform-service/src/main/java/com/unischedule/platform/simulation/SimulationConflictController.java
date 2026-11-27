
package com.unischedule.platform.simulation;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/simulations")
public class SimulationConflictController {

    private final SimulationConflictService service;

    public SimulationConflictController(
            SimulationConflictService service) {
        this.service = service;
    }

    @GetMapping("/{id}/conflicts")
    public SimulationConflictService.ConflictResult check(
            @PathVariable String id) {

        return service.check(id);
    }
}
