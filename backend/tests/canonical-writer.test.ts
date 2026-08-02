import { describe, it, expect } from "vitest";
import { mayWriteTable, CANONICAL_WRITERS } from "../src/modules/integration-hub/canonical-writer.js";

/**
 * integration_biometric_daily is unique on
 * (integration_key, source_table, employee_code, activity_date).
 *
 * That key is the trap: two DIFFERENT connectors writing the same employee on
 * the same date do not collide, they sit side by side. Biometric data already
 * flows under 'cosec_sqlserver' (34,620 rows, current to today) and the disabled
 * `cosec_biometric` schedule is mapped to the same source table. Enabling it
 * would not error — it would silently double every punch count, because the
 * consumers aggregate this table without filtering integration_key.
 */

describe("who may write a shared destination", () => {
  it("lets the canonical writer through", () => {
    expect(mayWriteTable("integration_biometric_daily", "cosec_sqlserver")).toEqual({ allowed: true });
  });

  it("refuses the connector that would duplicate live biometric data", () => {
    // The specific, live risk this guard exists for.
    const verdict = mayWriteTable("integration_biometric_daily", "cosec_biometric");
    expect(verdict.allowed).toBe(false);
    expect((verdict as { reason: string }).reason).toMatch(/double-count/);
  });

  it("refuses any other newcomer to that table too", () => {
    // Not a denylist of one known connector — anything that is not canonical is
    // refused, including something added next year by someone who never read
    // this file.
    for (const key of ["Cosec", "cosec_mysql", "something_new"]) {
      expect(mayWriteTable("integration_biometric_daily", key).allowed).toBe(false);
    }
  });

  it("leaves genuinely multi-source tables alone", () => {
    // dialer_1 and dialer_2 cover different campaigns and their consumers do
    // scope by key, so guarding these would break working ingestion.
    expect(mayWriteTable("dialer_session_log", "dialer_1").allowed).toBe(true);
    expect(mayWriteTable("dialer_session_log", "dialer_2").allowed).toBe(true);
    expect(mayWriteTable("integration_call_daily", "dialer_1").allowed).toBe(true);
  });

  it("says what to do instead of only saying no", () => {
    // A refusal someone cannot act on gets worked around.
    const verdict = mayWriteTable("integration_biometric_daily", "cosec_biometric");
    expect((verdict as { reason: string }).reason).toMatch(/retire the incumbent writer first/);
  });

  it("guards exactly one table today, deliberately", () => {
    // If this grows, it should be a decision someone made — not drift.
    expect(Object.keys(CANONICAL_WRITERS)).toEqual(["integration_biometric_daily"]);
    expect(CANONICAL_WRITERS.integration_biometric_daily).toBe("cosec_sqlserver");
  });
});
