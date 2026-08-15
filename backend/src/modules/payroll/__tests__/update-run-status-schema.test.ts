/**
 * updateRunStatusSchema accepted "processing" and "reviewed" as TARGET statuses. No
 * transition in payroll-lifecycle.ts targets either, so both passed validation and then
 * failed in the service - a 500 where a 400 was the truth.
 *
 * "reviewed" is never written to salary_prep_run anywhere in the codebase (the sole
 * writer of that value targets kpi_score_period, a different module), yet it is what the
 * "Mark as Processed" buttons in Payroll.tsx send. "processing" is written only by the
 * calculator, directly, never through this endpoint.
 *
 * Narrowing disables no working flow - neither value could ever have succeeded. It is
 * strictly about the API describing what it can do.
 */
import { describe, it, expect } from "vitest";
import { updateRunStatusSchema } from "../payroll.validation.js";
import { getAllowedTransitions } from "../payroll-lifecycle.js";
import type { RunStatus } from "../payroll-lifecycle.js";

const ACCEPTED = ["approved", "locked", "disbursed"] as const;

describe("updateRunStatusSchema accepts only reachable target statuses", () => {
  it.each(ACCEPTED)("accepts %s", (status) => {
    expect(updateRunStatusSchema.safeParse({ status }).success).toBe(true);
  });

  it.each(["processing", "reviewed"])(
    "rejects %s — nothing can transition into it, so it must fail at the schema, not the service",
    (status) => {
      expect(updateRunStatusSchema.safeParse({ status }).success).toBe(false);
    },
  );

  it("still accepts the optional disbursedAt alongside a valid status", () => {
    expect(
      updateRunStatusSchema.safeParse({ status: "disbursed", disbursedAt: "2026-08-15" }).success,
    ).toBe(true);
  });
});

describe("the schema and the lifecycle agree on what is reachable", () => {
  it("every accepted status is the target of at least one real transition", () => {
    const everyStatus: RunStatus[] = [
      "draft", "calculating", "calculated", "under_review",
      "processing", "finalized", "approved", "locked", "disbursed", "cancelled",
    ];
    const reachable = new Set(everyStatus.flatMap((s) => getAllowedTransitions(s)));

    for (const status of ACCEPTED) {
      expect(reachable.has(status as RunStatus)).toBe(true);
    }
  });

  it("no accepted status is one the lifecycle cannot reach", () => {
    const everyStatus: RunStatus[] = [
      "draft", "calculating", "calculated", "under_review",
      "processing", "finalized", "approved", "locked", "disbursed", "cancelled",
    ];
    const reachable = new Set(everyStatus.flatMap((s) => getAllowedTransitions(s)));

    // 'processing' is deliberately absent: only the calculator writes it, directly.
    expect(reachable.has("processing")).toBe(false);
  });
});
