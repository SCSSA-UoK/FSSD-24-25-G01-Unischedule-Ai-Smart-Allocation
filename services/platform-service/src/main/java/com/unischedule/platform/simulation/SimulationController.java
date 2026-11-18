
package com.unischedule.platform.simulation;

import com.unischedule.platform.simulation.SimulationDtos.CreateScenarioRequest;
import com.unischedule.platform.simulation.SimulationDtos.MoveSessionRequest;
import com.unischedule.platform.simulation.SimulationDtos.PreviewResponse;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/simulations")
public class SimulationController {

    private final SimulationService service;

    public SimulationController(
            SimulationService service) {
        this.service = service;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SimulationScenario create(
            @RequestBody CreateScenarioRequest request) {
        return service.create(request);
    }

    @GetMapping
    public List<SimulationScenario> list() {
        return service.list();
    }

    @GetMapping("/{id}")
    public SimulationScenario get(
            @PathVariable String id) {
        return service.get(id);
    }

    @PostMapping("/{id}/moves")
    public SimulationScenario move(
            @PathVariable String id,
            @RequestBody MoveSessionRequest request) {
        return service.move(id, request);
    }

    @GetMapping("/{id}/preview")
    public PreviewResponse preview(
            @PathVariable String id,
            @RequestParam(required = false) String day) {
        return service.preview(id, day);
    }

    @DeleteMapping("/{id}/moves/{sessionId}")
    public SimulationScenario removeMove(
            @PathVariable String id,
            @PathVariable String sessionId) {
        return service.removeMove(id, sessionId);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @PathVariable String id) {
        service.delete(id);
    }
}
