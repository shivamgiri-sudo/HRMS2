/**
 * 'processing' is what the mainline calculator writes when a run finishes computing —
 * payrollCalculate.service.ts sets it on success and resets to 'draft' on failure, and
 * payroll-signoff.routes.ts filters its pending-sign-off queue on exactly that value.
 * It is also read by is_draft (payroll.routes.ts), isProvisional, the run-ordering
 * FIELD() list and payroll.secure.routes.ts's status filter.
 *
 * ALLOWED_TRANSITIONS did not contain it. So validateTransition("processing", "approved")
 * looked up an absent key, got undefined, and rejected unconditionally — the real forward
 * path out of the calculator was blocked at the one gate every status change goes through.
 * Live-confirmed 2026-08-15 against mas_hrms: salary_prep_run holds FINALIZED 51,
 * approved 12, processing 2 (2026-06 and 2026-07) and draft 1, so the two most recent
 * runs were structurally unable to advance.
 *
 * Deliberately ONE forward target, approved, mirroring finalized -> locked:
 *
 *  - no processing -> draft. The calculator's own failure reset writes 'draft' directly
 *    in SQL (payrollCalculate.service.ts, guarded by CLOSED_RUN_STATUSES) and never goes
 *    through this map, so it needs nothing here. Exposing it as an API transition would
 *    be a new way to reopen a computed run for editing, which is not what was approved.
 *  - nothing may transition INTO processing. Only the calculator produces that state.
 */
import { describe, it, expect } from "vitest";
import {
  validateTransition,
  isTerminal,
  canEdit,
  getAllowedTransitions,
  type RunStatus,
} from "../payroll-lifecycle.js";

describe("a run left in 'processing' by the calculator can move forward", () => {
  it("allows processing -> approved", () => {
    expect(validateTransition("processing", "approved")).toEqual({ valid: true });
  });

  it("allows it case-insensitively, since the column is varchar and casing is not uniform", () => {
    expect(validateTransition("PROCESSING" as any, "approved")).toEqual({ valid: true });
    expect(validateTransition("Processing" as any, "approved")).toEqual({ valid: true });
  });

  it("offers exactly one forward path — approved, nothing else", () => {
    expect(getAllowedTransitions("processing")).toEqual(["approved"]);
  });
});

describe("processing does not become a new way to reopen or skip ahead", () => {
  it("rejects processing -> draft (the calculator's failure reset does not use this map)", () => {
    expect(validateTransition("processing", "draft").valid).toBe(false);
  });

  it.each(["calculating", "calculated", "under_review", "locked", "disbursed", "cancelled"])(
    "rejects processing -> %s",
    (target) => {
      expect(validateTransition("processing", target as RunStatus).valid).toBe(false);
    },
  );

  it("cannot be entered from any other status — only the calculator writes it", () => {
    const everyStatus: RunStatus[] = [
      "draft", "calculating", "calculated", "under_review",
      "finalized", "approved", "locked", "disbursed", "cancelled", "processing",
    ];
    for (const from of everyStatus) {
      expect(getAllowedTransitions(from)).not.toContain("processing");
    }
  });
});

describe("editing rules for a processing run are unchanged", () => {
  it("still refuses line edits — canEdit stays false, exactly as before this change", () => {
    expect(canEdit("processing")).toBe(false);
    expect(canEdit("PROCESSING" as any)).toBe(false);
  });

  it("is not terminal", () => {
    expect(isTerminal("processing")).toBe(false);
  });
});

describe("no regression to the paths that already worked", () => {
  it("finalized -> locked still works and still cannot skip to disbursed", () => {
    expect(validateTransition("FINALIZED" as any, "locked")).toEqual({ valid: true });
    expect(validateTransition("FINALIZED" as any, "disbursed").valid).toBe(false);
  });

  it("approved -> locked -> disbursed is untouched", () => {
    expect(validateTransition("approved", "locked")).toEqual({ valid: true });
    expect(validateTransition("locked", "disbursed")).toEqual({ valid: true });
  });

  it("disbursed remains terminal", () => {
    expect(validateTransition("disbursed", "locked").reason).toMatch(/terminal/);
  });

  it("the other pre-existing transitions still behave as before", () => {
    expect(validateTransition("draft", "calculating")).toEqual({ valid: true });
    expect(validateTransition("under_review", "approved")).toEqual({ valid: true });
    expect(validateTransition("cancelled", "draft")).toEqual({ valid: true });
    expect(validateTransition("approved", "approved").valid).toBe(false);
  });
});
