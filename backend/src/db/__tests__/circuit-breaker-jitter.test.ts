import { describe, it, expect } from "vitest";
import {
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  initialCircuitBreakerState,
  recordCircuitBreakerFailure,
  type CircuitBreakerState,
} from "../circuitBreaker.js";

/**
 * A fixed reopen delay can resonate with a fixed caller cadence. That is not theoretical:
 * on 2026-08-08 the workers polled every 30s while recoveryTimeMs was also 30000, so every
 * half-open probe landed on the next burst, failed, and reopened the breaker — for hours,
 * across restarts, with all scheduled jobs down.
 *
 * The jitter is an argument rather than a Math.random() call inside circuitBreaker.ts, so
 * the module stays pure and these assertions can be exact.
 */
const CONFIG = DEFAULT_CIRCUIT_BREAKER_CONFIG;
const NOW = 1_000_000;

function openedState(now: number, jitterMs?: number): CircuitBreakerState {
  let state = initialCircuitBreakerState();
  for (let i = 0; i < CONFIG.failureThreshold; i++) {
    state = recordCircuitBreakerFailure(state, CONFIG, now, jitterMs);
  }
  return state;
}

describe("circuit breaker reopen jitter", () => {
  it("defaults to the exact nominal delay, so existing callers and tests are unchanged", () => {
    const state = openedState(NOW);
    expect(state.status).toBe("open");
    expect(state.nextProbeTime).toBe(NOW + CONFIG.recoveryTimeMs);
  });

  it("adds the supplied jitter to the probe time when the breaker trips", () => {
    const state = openedState(NOW, 7_000);
    expect(state.status).toBe("open");
    expect(state.nextProbeTime).toBe(NOW + CONFIG.recoveryTimeMs + 7_000);
  });

  it("also jitters the reopen after a failed half-open probe — the path that resonated", () => {
    // A half-open probe that fails is what kept landing on the workers' burst.
    const halfOpen: CircuitBreakerState = {
      status: "half-open",
      failures: 0,
      lastFailure: NOW - CONFIG.recoveryTimeMs,
      nextProbeTime: NOW,
    };
    const reopened = recordCircuitBreakerFailure(halfOpen, CONFIG, NOW, 4_500);
    expect(reopened.status).toBe("open");
    expect(reopened.nextProbeTime).toBe(NOW + CONFIG.recoveryTimeMs + 4_500);
  });

  it("never probes earlier than the nominal delay, so jitter can only add headroom", () => {
    for (const jitter of [0, 1, 5_000, 12_000]) {
      const state = openedState(NOW, jitter);
      expect(state.nextProbeTime).toBeGreaterThanOrEqual(NOW + CONFIG.recoveryTimeMs);
    }
  });

  it("keeps a jittered delay inside the +40% band the caller applies", () => {
    // db/mysql.ts uses Math.random() * recoveryTimeMs * 0.4; assert the band it can produce
    // stays bounded, so a probe cannot drift arbitrarily far out.
    const maxJitter = Math.floor(CONFIG.recoveryTimeMs * 0.4);
    const state = openedState(NOW, maxJitter);
    expect(state.nextProbeTime - NOW).toBeLessThanOrEqual(CONFIG.recoveryTimeMs * 1.4);
  });
});
