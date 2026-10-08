/**
 * When the DB circuit breaker opens, the log must say WHY.
 *
 * It did not. withTransientRetry logs only isSchemaOrLogicDbError, and those
 * never trip the breaker — the errors that do (connection pressure, transient)
 * went to recordFailure() and were swallowed. Production on 2026-08-08 showed
 * 241 "Database circuit breaker open" lines between 20:00 and 21:10, reported by
 * eight different workers, with ZERO underlying errors anywhere in the log.
 * Grepping for ETIMEDOUT / ECONNREFUSED / ECONNRESET / "Too many connections"
 * returned nothing, which reads as "there was no cause" rather than the truth,
 * "the cause was never printed" — and left the single largest error class in the
 * system undiagnosable.
 *
 * These tests exercise the breaker state machine directly (db/mysql.ts opens a
 * real pool on import) and assert the two properties the logging has to have:
 * it fires exactly on the transition into `open`, and not on every failure.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  initialCircuitBreakerState,
  recordCircuitBreakerFailure,
  recordCircuitBreakerSuccess,
  type CircuitBreakerState,
} from "../circuitBreaker.js";

const CONFIG = DEFAULT_CIRCUIT_BREAKER_CONFIG;

/** Mirrors recordFailure() in db/mysql.ts: log only on the entry into `open`. */
function recordFailureWithLog(
  state: CircuitBreakerState,
  error: unknown,
  log: string[],
  now = Date.now(),
): CircuitBreakerState {
  const previous = state.status;
  const next = recordCircuitBreakerFailure(state, CONFIG, now);
  if (next.status === "open" && previous !== "open") {
    log.push(`OPEN after ${next.failures}: ${(error as { code?: string })?.code ?? "unknown"}`);
  }
  return next;
}

describe("circuit breaker cause logging", () => {
  it("logs exactly once, naming the error that tipped it", () => {
    const log: string[] = [];
    let state = initialCircuitBreakerState();

    for (let i = 0; i < CONFIG.failureThreshold; i += 1) {
      state = recordFailureWithLog(state, { code: "ETIMEDOUT" }, log);
    }

    expect(state.status).toBe("open");
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("ETIMEDOUT");
    expect(log[0]).toContain(`OPEN after ${CONFIG.failureThreshold}`);
  });

  it("stays silent while the breaker is still closed", () => {
    const log: string[] = [];
    let state = initialCircuitBreakerState();

    for (let i = 0; i < CONFIG.failureThreshold - 1; i += 1) {
      state = recordFailureWithLog(state, { code: "ECONNRESET" }, log);
    }

    expect(state.status).toBe("closed");
    expect(log, "a failure below the threshold is not yet news").toHaveLength(0);
  });

  it("does not re-log on every failure once already open", () => {
    // The reason this is transition-only: when the database is unreachable every
    // query fails, and one line per failure buries the line that matters.
    const log: string[] = [];
    let state = initialCircuitBreakerState();

    for (let i = 0; i < CONFIG.failureThreshold + 50; i += 1) {
      state = recordFailureWithLog(state, { code: "ETIMEDOUT" }, log);
    }

    expect(state.status).toBe("open");
    expect(log, "one opening, one line — not 55").toHaveLength(1);
  });

  it("logs again if it recovers and then re-opens", () => {
    // A second outage is a separate event and must be reported as one.
    const log: string[] = [];
    let state = initialCircuitBreakerState();

    for (let i = 0; i < CONFIG.failureThreshold; i += 1) {
      state = recordFailureWithLog(state, { code: "ETIMEDOUT" }, log);
    }
    // Recover: half-open, then enough successes to close.
    state = { ...state, status: "half-open", failures: 0 };
    for (let i = 0; i < CONFIG.halfOpenSuccessThreshold; i += 1) {
      state = recordCircuitBreakerSuccess(state, CONFIG);
    }
    expect(state.status).toBe("closed");

    for (let i = 0; i < CONFIG.failureThreshold; i += 1) {
      state = recordFailureWithLog(state, { code: "ER_CON_COUNT_ERROR" }, log);
    }

    expect(log).toHaveLength(2);
    expect(log[1]).toContain("ER_CON_COUNT_ERROR");
  });

  it("a single failure from half-open re-opens and is reported", () => {
    const log: string[] = [];
    let state: CircuitBreakerState = {
      status: "half-open",
      failures: 0,
      lastFailure: 0,
      nextProbeTime: 0,
    };

    state = recordFailureWithLog(state, { code: "PROTOCOL_CONNECTION_LOST" }, log);

    expect(state.status).toBe("open");
    expect(log).toHaveLength(1);
    expect(log[0]).toContain("PROTOCOL_CONNECTION_LOST");
  });
});
