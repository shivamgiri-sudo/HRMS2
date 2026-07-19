import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("attendance hub contracts", () => {
  const routesSource = readFileSync(
    resolve(process.cwd(), "src/modules/employees/employee.routes.ts"),
    "utf8",
  );
  const hooksSource = readFileSync(
    resolve(process.cwd(), "../src/hooks/useAttendanceHub.ts"),
    "utf8",
  );

  it("keeps /employees/me compatible with schemas lacking a stored compliance flag", () => {
    expect(routesSource).not.toContain("e.official_email_compliant");
    expect(routesSource).toContain("isOfficialEmail");
  });

  it("serves scoped, database-backed dependent filter options", () => {
    expect(routesSource).toContain('"/hr-hub/filter-options"');
    expect(routesSource).toContain("branch_master");
    expect(routesSource).toContain("process_master");
    expect(routesSource).toContain("designation_master");
    expect(routesSource).toContain('"payroll_head", "payroll_admin"');
    expect(hooksSource).toContain("/api/employees/hr-hub/filter-options");
    expect(hooksSource).not.toContain('"/api/branches"');
    expect(hooksSource).not.toContain('"/api/process"');
    expect(hooksSource).not.toContain('"/api/designations"');
  });

  it("aggregates monthly attendance once instead of per employee", () => {
    expect(routesSource).toContain("GROUP BY employee_id");
    expect(routesSource).not.toContain(
      "(SELECT COUNT(*) FROM attendance_daily_record adr",
    );
  });
});
