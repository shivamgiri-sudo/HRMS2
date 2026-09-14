/**
 * POST /lines/:lineId/manual-adjustment used to tell the caller "recalculate
 * the payroll run to apply final net pay" — false. salary_prep_line_adjustment
 * (what addManualAdjustment writes to) is never read by
 * payroll/payrollCalculate.service.ts, the only calculation engine actually
 * wired to POST /runs/:id/calculate. The only reader of that table is
 * payroll-compliance/payrollCalculate.service.ts, which is dead code — see
 * dead-payroll-engine.test.ts, which holds that quarantine in place.
 *
 * Root-caused 2026-08-14. Live-verified: 0 rows in salary_prep_line_adjustment
 * in production, so this had not yet cost anyone real money — but a preparer
 * who used the documented, sanctioned workflow, saw this message, and moved
 * on would reasonably have believed the correction was in effect.
 *
 * These are source-level assertions (matching this codebase's own convention,
 * e.g. variance-canonical-run.test.ts, dead-payroll-engine.test.ts) rather
 * than a full route-handler execution: the point being pinned is the CLAIM
 * the response text makes, and the fact this table really is unread by the
 * live engine — both are verifiable from source without spinning up the
 * route's DB/auth dependencies.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE_SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll-compliance/payrollCompliance.routes.ts"),
  "utf8",
);
const LIVE_ENGINE_SOURCE = readFileSync(
  resolve(process.cwd(), "src/modules/payroll/payrollCalculate.service.ts"),
  "utf8",
);

describe("the manual-adjustment endpoint no longer claims to affect net pay", () => {
  it("does not tell the caller recalculating will apply the adjustment", () => {
    const routeStart = ROUTE_SOURCE.indexOf('router.post("/lines/:lineId/manual-adjustment"');
    expect(routeStart).toBeGreaterThan(-1);
    const routeBlock = ROUTE_SOURCE.slice(routeStart, routeStart + 3000);
    // The exact false claim this fix removes.
    expect(routeBlock).not.toMatch(/Recalculate the payroll run to apply final net pay/);
  });

  it("explicitly discloses that no current calculation path applies it", () => {
    const routeStart = ROUTE_SOURCE.indexOf('router.post("/lines/:lineId/manual-adjustment"');
    const routeBlock = ROUTE_SOURCE.slice(routeStart, routeStart + 3000);
    expect(routeBlock).toMatch(/NOT applied to net pay/);
  });

  it("still saves and audits the adjustment — the record itself is real, only the claim about its effect changed", () => {
    const routeStart = ROUTE_SOURCE.indexOf('router.post("/lines/:lineId/manual-adjustment"');
    const routeBlock = ROUTE_SOURCE.slice(routeStart, routeStart + 3000);
    expect(routeBlock).toMatch(/payrollComplianceService\.addManualAdjustment/);
    expect(routeBlock).toMatch(/success: true/);
  });

  // Reinforces the premise the corrected message relies on: this really is
  // true today, not merely asserted. If a future change wires this table
  // into the live engine, this test (not just the message) should be the
  // thing that forces the message to be revisited.
  it("confirms salary_prep_line_adjustment is genuinely unread by the live calculation engine", () => {
    expect(LIVE_ENGINE_SOURCE).not.toMatch(/salary_prep_line_adjustment/);
  });
});
