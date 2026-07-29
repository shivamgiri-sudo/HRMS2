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

export function recordCircuitBreakerFailure(
  state: CircuitBreakerState,
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
  now = Date.now(),
): CircuitBreakerState {
  if (state.status === "half-open") {
    return {
      ...state,
      status: "open",
      lastFailure: now,
      nextProbeTime: now + config.recoveryTimeMs,
    };
  }

  const failures = state.failures + 1;
  return {
    ...state,
    failures,
    lastFailure: now,
    status: failures >= config.failureThreshold ? "open" : state.status,
    nextProbeTime: failures >= config.failureThreshold ? now + config.recoveryTimeMs : state.nextProbeTime,
  };
}
