const crypto = require('node:crypto');
const { loadConfig } = require('../config/env');

class AgentClient {
  constructor({ config = loadConfig(), fetchImpl = global.fetch } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.mockRuns = new Map();
  }

  async startRun({ scenarioId, scenarioRevision, disruptionId, caseId, disruption, traceId = null }) {
    if (this.config.useMockClients) {
      return this.mockStartRun({ scenarioId, scenarioRevision, disruptionId, caseId, disruption });
    }

    const url = `${this.config.agentBaseUrl}/agent/runs`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(traceId ? { 'X-Trace-Id': traceId } : {})
        },
        body: JSON.stringify({ scenarioId, scenarioRevision, disruptionId, caseId }),
        signal: controller.signal
      });

      if (!response.ok) {
        const error = new Error(`Agent run dispatch failed with status ${response.status}.`);
        error.status = 503;
        error.code = 'AGENT_UNAVAILABLE';
        throw error;
      }

      const data = await response.json();
      return {
        runId: data.runId,
        status: data.status || 'running',
        isMock: false,
        mode: 'live'
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Agent service dispatch timed out.');
        timeoutError.status = 504;
        timeoutError.code = 'AGENT_TIMEOUT';
        throw timeoutError;
      }
      if (error.status) {
        throw error;
      }
      const depError = new Error('Unable to reach Agent service.');
      depError.status = 503;
      depError.code = 'AGENT_UNAVAILABLE';
      throw depError;
    } finally {
      clearTimeout(timer);
    }
  }

  async getRunResult(runId, { traceId = null } = {}) {
    if (this.config.useMockClients) {
      return this.mockGetRunResult(runId);
    }

    const statusUrl = `${this.config.agentBaseUrl}/agent/runs/${encodeURIComponent(runId)}`;
    const plansUrl = `${this.config.agentBaseUrl}/agent/runs/${encodeURIComponent(runId)}/plans`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const headers = traceId ? { 'X-Trace-Id': traceId } : {};
      const statusRes = await this.fetchImpl(statusUrl, { headers, signal: controller.signal });
      if (!statusRes.ok) {
        const error = new Error(`Failed to fetch Agent run status (${statusRes.status}).`);
        error.status = statusRes.status === 404 ? 404 : 503;
        error.code = statusRes.status === 404 ? 'NOT_FOUND' : 'AGENT_UNAVAILABLE';
        throw error;
      }

      const runData = await statusRes.json();
      if (runData.status !== 'completed') {
        return {
          runId,
          status: runData.status,
          plans: [],
          error: runData.error || null,
          isMock: false
        };
      }

      const plansRes = await this.fetchImpl(plansUrl, { headers, signal: controller.signal });
      const plansData = plansRes.ok ? await plansRes.json() : { plans: [] };
      const plans = Array.isArray(plansData) ? plansData : plansData.plans || [];

      return {
        runId,
        status: plans.length > 0 ? 'completed' : 'no_solution',
        plans,
        error: null,
        isMock: false
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Agent service polling timed out.');
        timeoutError.status = 504;
        timeoutError.code = 'AGENT_TIMEOUT';
        throw timeoutError;
      }
      if (error.status) {
        throw error;
      }
      const depError = new Error('Unable to poll Agent service.');
      depError.status = 503;
      depError.code = 'AGENT_UNAVAILABLE';
      throw depError;
    } finally {
      clearTimeout(timer);
    }
  }

  // Simulated agent run for independent local development and testing.
  mockStartRun({ scenarioId, scenarioRevision, disruptionId, caseId, disruption }) {
    if (
      disruption?.lecturerId === 'SIMULATE_DISPATCH_FAIL' ||
      disruption?.roomId === 'SIMULATE_DISPATCH_FAIL'
    ) {
      const error = new Error('Simulated Agent service dispatch failure.');
      error.status = 503;
      error.code = 'AGENT_UNAVAILABLE';
      throw error;
    }

    const runId = `agent-${crypto.randomUUID().slice(0, 8)}`;
    this.mockRuns.set(runId, {
      runId,
      scenarioId,
      scenarioRevision,
      disruptionId,
      caseId,
      disruption
    });

    return {
      runId,
      status: 'running',
      isMock: true,
      mode: 'mock'
    };
  }

  mockGetRunResult(runId) {
    const run = this.mockRuns.get(runId);
    if (!run) {
      return {
        runId,
        status: 'failed',
        plans: [],
        error: 'Mock agent run record not found.',
        isMock: true
      };
    }

    const marker = run.disruption?.lecturerId || run.disruption?.roomId;

    if (marker === 'SIMULATE_NO_SOLUTION') {
      return {
        runId,
        status: 'no_solution',
        plans: [],
        error: null,
        isMock: true
      };
    }

    if (marker === 'SIMULATE_AGENT_FAIL') {
      return {
        runId,
        status: 'failed',
        plans: [],
        error: 'Simulated agent investigation failure.',
        isMock: true
      };
    }

    const sessionId = run.disruption?.affectedSessionIds?.[0] || 'S001';
    const fromRoomId = run.disruption?.roomId || 'HALL_A';
    const planId = `plan-${crypto.randomUUID().slice(0, 8)}`;
    const candidateId = `candidate-${crypto.randomUUID().slice(0, 8)}`;

    return {
      runId,
      status: 'completed',
      isMock: true,
      error: null,
      plans: [
        {
          recoveryPlanId: planId,
          candidateId,
          scenarioRevision: run.scenarioRevision,
          validationStatus: 'valid',
          validationReference: `mock-validation-${crypto.randomUUID().slice(0, 8)}`,
          isMockValidation: true,
          explanation: `Move ${sessionId} from ${fromRoomId} to an available slot in ROOM_C.`,
          moves: [
            {
              sessionId,
              fromRoomId,
              toRoomId: 'ROOM_C',
              startAt: '2026-11-03T09:00:00+05:30',
              endAt: '2026-11-03T11:00:00+05:30'
            }
          ]
        }
      ]
    };
  }

  clearMockRuns() {
    this.mockRuns.clear();
  }
}

const agentClient = new AgentClient();

module.exports = { AgentClient, agentClient };
