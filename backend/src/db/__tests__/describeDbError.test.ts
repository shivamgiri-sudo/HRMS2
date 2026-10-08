/**
 * A database error description must never throw away the only thing it knows.
 *
 * describeDbError read `code`, `sqlMessage` and `sql` and nothing else, so any error that is
 * not a mysql2 protocol error rendered as the string "UNKNOWN: " — every detail discarded.
 *
 * That is not cosmetic. It is the text the circuit-breaker trip line carries:
 *
 *   [mysql] circuit breaker OPEN after 0 consecutive failure(s); probing again in 40s.
 *   Tripped by: UNKNOWN:
 *
 * On 2026-08-12 the workers logged 5,045 breaker events, blocking report generation, report
 * email delivery and performance ingestion — every one of them attributing the cause to
 * "UNKNOWN: ". A pool exhaustion ("Queue limit reached"), an abort, or a plain Error all land
 * in that branch, so the one line written to explain an outage explained nothing.
 *
 * Same failure shape as the AggregateError whose `message` is the empty string: the obvious
 * field is absent and the code gives up instead of reaching for the next one.
 */
import { describe, it, expect } from "vitest";
import { describeDbError } from "../db-error-classification.js";

describe("describeDbError keeps mysql2 detail when it is there", () => {
  it("renders code, server message and sql", () => {
    const out = describeDbError({
      code: "ER_BAD_FIELD_ERROR",
      sqlMessage: "Unknown column 'nope' in 'field list'",
      sql: "SELECT nope FROM employees",
    });
    expect(out).toContain("ER_BAD_FIELD_ERROR");
    expect(out).toContain("Unknown column");
    expect(out).toContain("SELECT nope FROM employees");
  });
});

describe("describeDbError falls back rather than saying UNKNOWN", () => {
  it("uses message when there is no code or sqlMessage", () => {
    // The pool exhaustion that accompanied the 5,045 breaker trips.
    const out = describeDbError(new Error("Queue limit reached"));
    expect(out).toContain("Queue limit reached");
    expect(out).not.toMatch(/^UNKNOWN:\s*$/);
  });

  it("uses name and errno when the message is empty", () => {
    // Observed for real: AggregateError, code ECONNREFUSED, message "".
    const err = Object.assign(new Error(""), { name: "AggregateError", errno: -4078 });
    const out = describeDbError(err);
    expect(out).toContain("AggregateError");
    expect(out).toContain("-4078");
  });

  it("still prefers code when both code and message exist", () => {
    const out = describeDbError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    expect(out).toContain("ECONNREFUSED");
  });

  it("never renders a bare UNKNOWN with nothing after it", () => {
    // The exact string that made an outage undiagnosable.
    for (const input of [new Error(""), {}, null, undefined, "boom", 42]) {
      expect(describeDbError(input)).not.toMatch(/^UNKNOWN:\s*$/);
    }
  });

  it("describes a non-object throw rather than discarding it", () => {
    expect(describeDbError("connection reset by peer")).toContain("connection reset by peer");
  });
});
