import { describe, it, expect } from "vitest";
import { validateTransition, isTerminal, canEdit, getAllowedTransitions, type RunStatus } from "../src/modules/payroll/payroll-lifecycle.js";

describe("payroll-lifecycle state machine", () => {
  describe("validateTransition", () => {
    it("allows draft → calculating", () => {
      expect(validateTransition("draft", "calculating")).toEqual({ valid: true });
    });

    it("allows draft → cancelled", () => {
      expect(validateTransition("draft", "cancelled")).toEqual({ valid: true });
    });

    it("allows full happy path: draft → calculating → calculated → under_review → approved → locked → disbursed", () => {
      const path: RunStatus[] = ["draft", "calculating", "calculated", "under_review", "approved", "locked", "disbursed"];
      for (let i = 0; i < path.length - 1; i++) {
        const result = validateTransition(path[i], path[i + 1]);
        expect(result.valid, `${path[i]} → ${path[i + 1]}`).toBe(true);
      }
    });

    it("rejects disbursed → anything", () => {
      const targets: RunStatus[] = ["draft", "calculating", "calculated", "under_review", "approved", "locked", "cancelled"];
      for (const t of targets) {
        const r = validateTransition("disbursed", t);
        expect(r.valid).toBe(false);
        expect(r.reason).toContain("terminal");
      }
    });

    it("rejects locked → draft (skip)", () => {
      const r = validateTransition("locked", "draft");
      expect(r.valid).toBe(false);
      expect(r.reason).toContain("not allowed");
    });

    it("rejects same-status transition", () => {
      const r = validateTransition("draft", "draft");
      expect(r.valid).toBe(false);
      expect(r.reason).toContain("already");
    });

    it("allows rollback: under_review → calculated", () => {
      expect(validateTransition("under_review", "calculated")).toEqual({ valid: true });
    });

    it("allows cancelled → draft (reactivation)", () => {
      expect(validateTransition("cancelled", "draft")).toEqual({ valid: true });
    });
  });

  describe("isTerminal", () => {
    it("disbursed is terminal", () => {
      expect(isTerminal("disbursed")).toBe(true);
    });

    it("locked is not terminal", () => {
      expect(isTerminal("locked")).toBe(false);
    });
  });

  describe("canEdit", () => {
    it("draft is editable", () => {
      expect(canEdit("draft")).toBe(true);
    });

    it("calculating is editable", () => {
      expect(canEdit("calculating")).toBe(true);
    });

    it("approved is not editable", () => {
      expect(canEdit("approved")).toBe(false);
    });

    it("locked is not editable", () => {
      expect(canEdit("locked")).toBe(false);
    });
  });

  describe("getAllowedTransitions", () => {
    it("returns valid targets for draft", () => {
      expect(getAllowedTransitions("draft")).toEqual(["calculating", "cancelled"]);
    });

    it("returns empty for disbursed", () => {
      expect(getAllowedTransitions("disbursed")).toEqual([]);
    });
  });
});
