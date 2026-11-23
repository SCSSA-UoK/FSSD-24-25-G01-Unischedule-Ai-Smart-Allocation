const crypto = require('node:crypto');
const { loadConfig } = require('../config/env');

class PlatformClient {
  constructor({ config = loadConfig(), fetchImpl = global.fetch } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async registerConstraint({ scenarioId, scenarioRevision, disruption, traceId = null }) {
    if (this.config.useMockClients) {
      return this.mockRegisterConstraint({ scenarioRevision, disruption });
    }

    const url = `${this.config.platformBaseUrl}/api/scenarios/${encodeURIComponent(scenarioId)}/constraints`;
    const body = {
      type: disruption.type,
      lecturerId: disruption.lecturerId,
      roomId: disruption.roomId,
      startAt: disruption.startAt,
      endAt: disruption.endAt,
      disruptionId: disruption.disruptionId,
      scenarioRevision
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(traceId ? { 'X-Trace-Id': traceId } : {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const error = new Error(`Platform constraint sync failed with status ${response.status}.`);
        error.status = response.status === 409 ? 409 : 503;
        error.code = response.status === 409 ? 'STALE_SCENARIO' : 'PLATFORM_UNAVAILABLE';
        throw error;
      }

      const data = await response.json();
      return {
        constraintId: data.constraintId,
        scenarioRevision: data.scenarioRevision,
        isMock: false,
        mode: 'live'
      };
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error('Platform constraint sync timed out.');
        timeoutError.status = 504;
        timeoutError.code = 'PLATFORM_TIMEOUT';
        throw timeoutError;
      }
      if (error.status) {
        throw error;
      }
      const depError = new Error('Unable to reach Platform service for constraint sync.');
      depError.status = 503;
      depError.code = 'PLATFORM_UNAVAILABLE';
      throw depError;
    } finally {
      clearTimeout(timer);
    }
  }

  // Simulated constraint registration for independent local development.
  mockRegisterConstraint({ scenarioRevision, disruption }) {
    if (disruption.lecturerId === 'SIMULATE_SYNC_FAIL' || disruption.roomId === 'SIMULATE_SYNC_FAIL') {
      const error = new Error('Simulated platform constraint sync failure.');
      error.status = 503;
      error.code = 'CONSTRAINT_SYNC_FAILED';
      throw error;
    }

    return {
      constraintId: `mock-constraint-${crypto.randomUUID().slice(0, 8)}`,
      scenarioRevision: scenarioRevision + 1,
      isMock: true,
      mode: 'mock'
    };
  }
}

const platformClient = new PlatformClient();

module.exports = { PlatformClient, platformClient };
