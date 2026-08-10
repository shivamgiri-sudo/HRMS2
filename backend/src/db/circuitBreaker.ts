export interface CircuitBreakerState {
  status: "closed" | "open" | "half-open";
  failures: number;
  lastFailure: number;
  nextProbeTime: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeMs: number;
  halfOpenSuccessThreshold: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeMs: 30000,
  halfOpenSuccessThreshold: 2,
};

export const initialCircuitBreakerState = (): CircuitBreakerState => ({
  status: "closed",
  failures: 0,
  lastFailure: 0,
  nextProbeTime: 0,
});

export function checkCircuitBreakerState(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
  now = Date.now(),
): CircuitBreakerState {
  if (state.status !== "open") return state;
  if (now < state.nextProbeTime) return state;
  return { ...state, status: "half-open", failures: 0 };
}

export function recordCircuitBreakerSuccess(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
): CircuitBreakerState {
  if (state.status === "half-open") {
    const failures = state.failures + 1;
    if (failures >= config.halfOpenSuccessThreshold) {
      return initialCircuitBreakerState();
    }
    return { ...state, failures };
  }
  if (state.status === "closed" && state.failures > 0) {
    return { ...state, failures: 0 };
  }
  return state;
}

/**
 * `jitterMs` is added to the reopen delay, and is an INPUT rather than a Math.random()
 * call inside this function on purpose: every function in this module is pure and takes
 * `now` explicitly, which is what makes the breaker testable. The caller supplies the
 * randomness (see recordFailure in db/mysql.ts); tests pass nothing and keep the exact
 * `now + recoveryTimeMs` they already assert against.
 *
 * Why it exists: a fixed recovery delay can resonate with a fixed caller cadence. In
 * production on 2026-08-08 the workers polled every 30s and recoveryTimeMs was also
 * 30000, so the half-open probe landed on the very next burst every time and the breaker
 * reopened indefinitely — scheduled jobs stayed down until the pool was resized. Jitter
 * makes the probe drift off the burst so the breaker can find a quiet moment on its own.
 */
export function recordCircuitBreakerFailure(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
  now = Date.now(),
  jitterMs = 0,
): CircuitBreakerState {
  if (state.status === "half-open") {
    return {
      ...state,
      status: "open",
      lastFailure: now,
      nextProbeTime: now + config.recoveryTimeMs + jitterMs,
    };
  }

  const failures = state.failures + 1;
  return {
    ...state,
    failures,
    lastFailure: now,
    status: failures >= config.failureThreshold ? "open" : state.status,
    nextProbeTime:
      failures >= config.failureThreshold ? now + config.recoveryTimeMs + jitterMs : state.nextProbeTime,
  };
}
