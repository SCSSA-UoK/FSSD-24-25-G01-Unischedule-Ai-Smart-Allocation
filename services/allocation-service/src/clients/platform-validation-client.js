const { AllocationInputError } = require('../validation/allocation-input');
const { parseValidationProposal, parseValidationResponse } = require('../validation/platform-validation');

class PlatformValidationClient {
  #baseUrl;
  #serviceToken;
  #timeoutMs;
  #fetch;

  constructor({ baseUrl, serviceToken, timeoutMs = 5000, fetchImpl = fetch }) {
    let url;
    try { url = new URL(baseUrl); } catch { throw new Error('Platform validation URL is invalid.'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))
        || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Platform validation requires an HTTPS origin or a local HTTP origin.');
    }
    if (typeof serviceToken !== 'string' || !/^[^\s\x00-\x1f\x7f]+$/.test(serviceToken)) {
      throw new Error('A Platform validation service token is required.');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
      throw new Error('Platform validation timeout must be an integer from 1 to 10000.');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('A fetch function is required.');
    this.#baseUrl = url;
    this.#serviceToken = serviceToken;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
  }

  get source() { return 'platform'; }

  async validateProposal(rawProposal, { signal } = {}) {
    const proposal = parseValidationProposal(rawProposal);
    const controller = new AbortController();
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timer;
    const timeout = () => new AllocationInputError(504, 'PLATFORM_VALIDATION_TIMEOUT', 'Platform validation timed out.');
    try {
      return await Promise.race([
        (async () => {
          if (combinedSignal.aborted) throw timeout();
          const url = new URL(`/api/scenarios/${proposal.scenarioId}/validate`, this.#baseUrl);
          const response = await this.#fetch(url, {
            method: 'POST', redirect: 'error', signal: combinedSignal,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#serviceToken}` },
            body: JSON.stringify(proposal),
          });
          if (response.status === 401 || response.status === 403) {
            throw new AllocationInputError(503, 'PLATFORM_AUTH_FAILED', 'Platform validation credentials were not accepted.');
          }
          if (response.status === 404 || response.status === 501) {
            throw new AllocationInputError(503, 'PLATFORM_VALIDATION_UNAVAILABLE', 'The Platform validation endpoint is unavailable.');
          }
          if (response.status === 409) {
            throw new AllocationInputError(409, 'STALE_SCENARIO', 'Reload the scenario before requesting validation.');
          }
          if (response.status !== 200) {
            throw new AllocationInputError(503, 'PLATFORM_UNAVAILABLE', 'Platform validation is unavailable.');
          }
          if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
            throw new AllocationInputError(502, 'PLATFORM_INVALID_RESPONSE', 'Platform returned unusable validation evidence.');
          }
          let body;
          try { body = await response.json(); } catch {
            if (combinedSignal.aborted) throw timeout();
            throw new AllocationInputError(502, 'PLATFORM_INVALID_RESPONSE', 'Platform returned unusable validation evidence.');
          }
          if (combinedSignal.aborted) throw timeout();
          return parseValidationResponse(body, proposal);
        })(),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(timeout()); }, this.#timeoutMs);
        }),
      ]);
    } catch (error) {
      if (combinedSignal.aborted) throw timeout();
      if (error instanceof AllocationInputError) throw error;
      throw new AllocationInputError(503, 'PLATFORM_UNAVAILABLE', 'Platform validation is unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }
}

function createValidationClientFromEnv(env = process.env) {
  if (env.PLATFORM_VALIDATION_BASE_URL === undefined) return undefined;
  const timeoutValue = String(env.PLATFORM_VALIDATION_TIMEOUT_MS ?? '5000');
  if (!/^\d+$/.test(timeoutValue)) throw new Error('Platform validation timeout must be an integer from 1 to 10000.');
  return new PlatformValidationClient({
    baseUrl: env.PLATFORM_VALIDATION_BASE_URL,
    serviceToken: env.PLATFORM_VALIDATION_TOKEN,
    timeoutMs: Number(timeoutValue),
  });
}

module.exports = { PlatformValidationClient, createValidationClientFromEnv };
