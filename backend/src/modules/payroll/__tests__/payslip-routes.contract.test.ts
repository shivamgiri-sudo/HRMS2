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

  it("stores tax proofs using the live employee_documents schema and scopes them by year", () => {
    expect(routeSource).toContain("const documentType = `tax_declaration_${year}`");
    expect(routeSource).toContain("doc_type, doc_category, doc_name");
    expect(routeSource).toContain("WHERE employee_id = ? AND doc_type = ?");
    expect(routeSource).not.toContain("uploaded_by, metadata_json");
    expect(routeSource).not.toContain("metadata_json LIKE");
  });

  it("resolves the self alias before tax document reads and uploads", () => {
    expect(routeSource.match(/if \(employeeId === "me"\)/g)).toHaveLength(2);
    expect(routeSource).toContain('employeeId = callerEmp.id');
  });

  it("normalizes the live location-master collation in self-service payslip joins", () => {
    expect(routeSource).toContain(
      "loc.id COLLATE utf8mb4_unicode_ci = e.location_id",
    );
    expect(routeSource).not.toContain(
      "LEFT JOIN location_master loc ON loc.id = e.location_id",
    );
  });
});
