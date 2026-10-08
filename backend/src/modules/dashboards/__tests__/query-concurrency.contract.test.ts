import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = readFileSync(new URL("../dashboard.routes.ts", import.meta.url), "utf8");

/**
 * The payroll operational-summary panels and the /filters lookups are independent
 * reads; they must be started together (each serial statement is a remote round trip).
 * The panels already swallow their own failures via panel(), so Promise.all cannot
 * turn one missing panel into a failed request.
 */
describe("dashboard routes issue independent reads concurrently", () => {
  it("payroll panels start together and are awaited in a single Promise.all", () => {
    expect(routes).toContain("const disbursementP = currentRun ? panel(");
    expect(routes).toContain("const branchReadinessP = currentRun ? panel(");
    expect(routes).toContain("const payslipsP = currentRun ? panel(");
    expect(routes).toContain(
      "const [disbursement, branchReadiness, payslips] = await Promise.all([disbursementP, branchReadinessP, payslipsP]);",
    );
    expect(routes).not.toMatch(/=\s*currentRun \? await panel\(/);
  });

  it("/filters fetches branches and processes together", () => {
    const body = routes.slice(routes.indexOf('router.get("/:dashboardCode/filters"'), routes.indexOf('router.get("/:dashboardCode/root-causes"'));
    expect(body).toContain("const [[branches], [processes]] = await Promise.all([");
  });
});
