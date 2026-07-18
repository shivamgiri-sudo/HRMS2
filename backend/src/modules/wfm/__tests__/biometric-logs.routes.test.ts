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

    expect(appSource).toContain('app.use("/api/wfm/biometric-logs"');
  });

  it("exposes both self-service and employee-scoped frontend routes", () => {
    const routesSource = readFileSync(
      resolve(process.cwd(), "../src/config/routes/workforce.routes.tsx"),
      "utf8",
    );

    expect(routesSource).toContain('path="/attendance/biometric-logs"');
    expect(routesSource).toContain('path="/attendance/biometric-logs/:employeeId"');
  });
});
