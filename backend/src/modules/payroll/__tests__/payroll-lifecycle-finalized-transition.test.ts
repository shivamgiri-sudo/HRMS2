/**
 * validateTransition() was the one status-comparison site in the payroll module that never got
 * the case-insensitive treatment run-status.ts's isRunClosed() already has. RunStatus/
 * ALLOWED_TRANSITIONS had no 'finalized' entry at all, so validateTransition("FINALIZED", "locked")
 * looked up ALLOWED_TRANSITIONS["FINALIZED"], found undefined, and rejected unconditionally.
 *
 * Live-confirmed 2026-08-14: 51 of 66 production salary_prep_run rows sit in status='FINALIZED'
 * (uppercase, the status payroll actually finishes runs in — see run-status.ts's own docblock),
 * and every one of them was structurally unable to ever reach 'locked' or 'disbursed' through
 * updateRunStatus() or approveRunForDisbursement() — not historical data debt, a live block on
 * the forward path for every run finalized from here on. This is what closed it.
 */
import { describe, it, expect } from "vitest";
import {
  validateTransition,
  isTerminal,
  canEdit,
  getAllowedTransitions,
} from "../payroll-lifecycle.js";

describe("validateTransition recognizes 'finalized', case-insensitively", () => {
  it("allows FINALIZED -> locked (uppercase, matches what the database actually stores)", () => {
    expect(validateTransition("FINALIZED" as any, "locked")).toEqual({ valid: true });
  });

  it("allows finalized -> locked (lowercase, matches the RunStatus type)", () => {
    expect(validateTransition("finalized", "locked")).toEqual({ valid: true });
  });

  it("does NOT allow skipping straight to disbursed — locked remains a required intermediate step", () => {
    const result = validateTransition("FINALIZED" as any, "disbursed");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not allowed/);
  });
});

describe("finalized stays closed to recomputation — no path back to an editable state", () => {
  // Mirrors run-status.ts's CLOSED_RUN_STATUSES, which already treats 'finalized' as closed:
  // rewriting a finalized run's lines is the exact failure mode that docblock warns against,
  // over figures already paid and already filed in a quarterly TDS return.
  it.each(["under_review", "calculated", "calculating", "draft"])(
    "rejects FINALIZED -> %s",
    (target) => {
      const result = validateTransition("FINALIZED" as any, target as any);
      expect(result.valid).toBe(false);
    },
  );

  it("getAllowedTransitions(FINALIZED) is exactly ['locked'] — one forward path, nothing else", () => {
    expect(getAllowedTransitions("FINALIZED" as any)).toEqual(["locked"]);
  });
});

describe("case-insensitivity is now consistent across every exported function, not just validateTransition", () => {
  it("isTerminal treats FINALIZED as non-terminal (it can still reach locked/disbursed)", () => {
    expect(isTerminal("FINALIZED" as any)).toBe(false);
  });

  it("isTerminal still treats DISBURSED (any case) as terminal", () => {
    expect(isTerminal("DISBURSED" as any)).toBe(true);
    expect(isTerminal("disbursed")).toBe(true);
    expect(isTerminal("Disbursed" as any)).toBe(true);
  });

  it("canEdit rejects FINALIZED in any case", () => {
    expect(canEdit("FINALIZED" as any)).toBe(false);
    expect(canEdit("Finalized" as any)).toBe(false);
  });
});

describe("pre-existing transitions are unchanged (no regression)", () => {
  it("approved -> locked -> disbursed still works, exactly as before", () => {
    expect(validateTransition("approved", "locked")).toEqual({ valid: true });
    expect(validateTransition("locked", "disbursed")).toEqual({ valid: true });
  });

  it("draft/calculating/calculated/under_review/cancelled transitions are untouched", () => {
    expect(validateTransition("draft", "calculating")).toEqual({ valid: true });
    expect(validateTransition("calculating", "calculated")).toEqual({ valid: true });
    expect(validateTransition("calculated", "under_review")).toEqual({ valid: true });
    expect(validateTransition("under_review", "approved")).toEqual({ valid: true });
    expect(validateTransition("cancelled", "draft")).toEqual({ valid: true });
  });

  it("disbursed remains terminal — no transition out of it", () => {
    const result = validateTransition("disbursed", "locked" as any);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/terminal/);
  });

  it("a same-status transition is still rejected", () => {
    expect(validateTransition("FINALIZED" as any, "FINALIZED" as any).valid).toBe(false);
    expect(validateTransition("approved", "approved").valid).toBe(false);
  });
});
