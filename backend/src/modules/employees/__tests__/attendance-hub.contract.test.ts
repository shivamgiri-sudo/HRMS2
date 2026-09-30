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
    expect(routesSource).not.toContain("e.personal_mobile");
    expect(routesSource).not.toContain("e.address,");
    expect(routesSource).not.toContain("e.status,");
    expect(routesSource).not.toContain("e.hire_date");
    expect(routesSource).not.toContain("e.is_manager");
    expect(routesSource).not.toContain("e.emergency_contact_name");
    // address1 is the real, populated column (see fieldOwnership.ts's address_line1 entry);
    // address_line1 was a near-empty column that only this route used to read, so /employees/me
    // now sources both the "address" and "address_line1" wire fields from address1.
    expect(routesSource).toContain("e.address1 AS address");
    expect(routesSource).toContain("e.employment_status AS status");
    expect(routesSource).toContain("e.date_of_joining AS hire_date");
    expect(routesSource).toContain("isOfficialEmail");
  });

  it("serves scoped, database-backed dependent filter options", () => {
    expect(routesSource).toContain('"/hr-hub/filter-options"');
    expect(routesSource).toContain("branch_master");
    expect(routesSource).toContain("process_master");
    expect(routesSource).toContain("designation_master");
    // The route's own role gate, whatever the formatter does with its line breaks.
    const gate = routesSource.match(
      /"\/hr-hub\/filter-options",\s*requireRole\(([\s\S]*?)\),\s*h\(/,
    );
    expect(gate, "role gate on /hr-hub/filter-options not found").toBeTruthy();
    const gateRoles = gate![1].match(/"[a-z_]+"/g) ?? [];
    expect(gateRoles).toContain('"payroll_head"');
    expect(gateRoles).toContain('"payroll_admin"');
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
