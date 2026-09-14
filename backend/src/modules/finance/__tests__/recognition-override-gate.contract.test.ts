import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

import { assertMayOverrideRecognition } from "../grn-smart.service.js";
import { resolveEligiblePeriods } from "../grn-period-allocation.service.js";

/**
 * Who may decide which financial period bears a cost.
 *
 * Two overrides were documented as Finance Head / Accounts Head / Super Admin and
 * enforced nowhere on the server:
 *
 *   a custom recognition split, naming the exact share each month carries.
 *   canCustomSplit exists only as a prop on MonthSplitPanel, so the chip was hidden
 *   in the UI while recognitionCustomPercentages was still accepted from the body
 *   and passed straight to saveSplit.
 *
 *   a cross-FY recognition window, moving cost into a financial year the GRN does
 *   not belong to. Permitted by the ruling of 2026-08-12, which replaced the hard
 *   clamp with a warning - but an amber banner is not a control, and the API never
 *   saw it.
 *
 * PUT /:id/allocations admits SMART_WRITE_ROLES, which is six roles including
 * admin, branch_head and branch_admin. Any of them could post either override.
 *
 * The gate is enforced in writePeriodSplits, which both save paths funnel through,
 * before a single row is written.
 */
const at = (rel: string) =>
  new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const SRC = readFileSync(at("../grn-smart.service.ts"), "utf8");
const ROUTES = readFileSync(at("../grn-smart.routes.ts"), "utf8");

const ALLOWED = ["finance_head", "accounts_head", "super_admin"];
// every other role PUT /:id/allocations admits
const REFUSED = ["admin", "branch_head", "branch_admin"];

describe("who may override recognition", () => {
  for (const role of ALLOWED) {
    it(`${role} may override`, () => {
      expect(() => assertMayOverrideRecognition(role, "A custom recognition split")).not.toThrow();
    });
  }

  for (const role of REFUSED) {
    it(`${role} may not, though the route admits them`, () => {
      expect(() => assertMayOverrideRecognition(role, "A custom recognition split")).toThrow(
        /Finance Head, Accounts Head or Super Admin/,
      );
    });
  }

  it("refuses with 403, not a bad request", () => {
    try {
      assertMayOverrideRecognition("branch_admin", "Recognising an invoice across financial years");
      throw new Error("should have refused");
    } catch (error) {
      expect((error as { statusCode?: number }).statusCode).toBe(403);
      expect((error as { code?: string }).code).toBe("RECOGNITION_OVERRIDE_FORBIDDEN");
    }
  });

  it("names which override was refused", () => {
    expect(() =>
      assertMayOverrideRecognition("admin", "Recognising an invoice across financial years"),
    ).toThrow(/Recognising an invoice across financial years/);
  });

  it("treats an unknown or empty role as not permitted", () => {
    for (const role of ["", "employee", "hr", "undefined"]) {
      expect(() => assertMayOverrideRecognition(role, "A custom recognition split")).toThrow();
    }
  });
});

describe("the gate is actually reached before anything is written", () => {
  const body = (() => {
    const start = SRC.indexOf("async function writePeriodSplits");
    expect(start, "writePeriodSplits must exist").toBeGreaterThan(-1);
    const rest = SRC.slice(start);
    const end = rest.indexOf("\n}\n");
    return rest.slice(0, end);
  })();

  it("takes the actor's role", () => {
    expect(body).toMatch(/actorRole: string/);
  });

  it("gates a custom split", () => {
    expect(body).toMatch(/customPercentages[\s\S]{0,120}assertMayOverrideRecognition/);
  });

  it("gates a cross-FY window", () => {
    expect(body).toMatch(/crossFy[\s\S]{0,200}assertMayOverrideRecognition/);
  });

  it("checks before the first saveSplit, not after", () => {
    // saveSplit writes inside the caller's transaction; refusing afterwards would
    // mean rolling back rather than never starting.
    expect(body.indexOf("assertMayOverrideRecognition")).toBeLessThan(
      body.indexOf("grnPeriodAllocationService.saveSplit"),
    );
  });

  it("both save paths pass the role through", () => {
    const calls = SRC.match(/writePeriodSplits\(connection, grnId, grn, input, actorUserId[^)]*\)/g) ?? [];
    expect(calls.length).toBe(2);
    for (const call of calls) expect(call).toContain("actorRole");
  });

  it("the routes report the refusal as 403", () => {
    expect((ROUTES.match(/statusCode\s*\?\?\s*400/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("the cross-FY decision the gate acts on", () => {
  it("a window inside one financial year is not an override", () => {
    const r = resolveEligiblePeriods({
      accountingPeriod: "2026-04",
      startPeriod: "2026-04",
      endPeriod: "2027-03",
    });
    expect(r.crossFy).toBe(false);
  });

  it("a window spilling past March is", () => {
    const r = resolveEligiblePeriods({
      accountingPeriod: "2026-07",
      startPeriod: "2026-07",
      endPeriod: "2027-06",
    });
    expect(r.crossFy).toBe(true);
  });
});
