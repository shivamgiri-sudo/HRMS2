import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("biometric logs route contract", () => {
  it("defines the employee-scoped biometric log endpoint", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "src/modules/wfm/biometric-logs.routes.ts"),
      "utf8",
    );

    expect(routeSource).toContain('"/employee/:employeeId"');
    expect(routeSource).toContain("requireAuth");
  });

  it("mounts the biometric log router under /api/wfm/biometric-logs", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src/app.ts"), "utf8");

    expect(appSource).toMatch(/app\.use\(['"]\/api\/wfm\/biometric-logs['"]/);
  });

  it("exposes both self-service and employee-scoped frontend routes", () => {
    const routesSource = readFileSync(
      resolve(process.cwd(), "../src/config/routes/workforce.routes.tsx"),
      "utf8",
    );

    expect(routesSource).toContain('path="/attendance/biometric-logs"');
    expect(routesSource).toContain('path="/attendance/biometric-logs/:employeeId"');
  });

  it("renders the biometric page inside the standard HRMS dashboard shell", () => {
    const pageSource = readFileSync(
      resolve(process.cwd(), "../src/pages/BiometricPunchLogs.tsx"),
      "utf8",
    );

    expect(pageSource).toContain('import { DashboardLayout }');
    expect(pageSource).toContain("<DashboardLayout>");
  });

  it("uses the read-only NCOSEC connection for current raw punch events", () => {
    const serviceSource = readFileSync(
      resolve(process.cwd(), "src/modules/wfm/biometric-logs.service.ts"),
      "utf8",
    );

    expect(serviceSource).toContain("getNcosecPool");
    expect(serviceSource).toContain("NCOSEC_EVENT_TABLE");
    expect(serviceSource).toContain("employee_external_mapping");
    expect(serviceSource.indexOf("try {")).toBeLessThan(serviceSource.indexOf("await getNcosecPool()"));
    expect(serviceSource).toContain("using synced HRMS data");
  });
});
