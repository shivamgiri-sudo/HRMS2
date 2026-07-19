import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("payslip display routes", () => {
  const routeSource = readFileSync(
    resolve(process.cwd(), "src/modules/payroll/payroll.routes.ts"),
    "utf8",
  );

  it("uses a clamped SQL literal for history limits on MySQL", () => {
    expect(routeSource).toContain("Number.isFinite(requestedLimit)");
    expect(routeSource).toContain("Math.trunc(requestedLimit)");
    expect(routeSource).toContain("LIMIT ${limit}");
    expect(routeSource).not.toContain("ORDER BY spr.run_month DESC\n      LIMIT ?");
  });

  it("allows established payroll administration roles to expand details", () => {
    expect(routeSource).toContain(
      'hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll", "payroll_head", "payroll_admin")',
    );
  });
});
