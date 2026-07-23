import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routes = readFileSync(
  resolve(process.cwd(), "src/modules/dashboards/dashboard.routes.ts"),
  "utf8",
);
const drilldowns = readFileSync(
  resolve(process.cwd(), "src/modules/dashboards/dashboard-drilldown.service.ts"),
  "utf8",
);
const errorHandler = readFileSync(
  resolve(process.cwd(), "src/middleware/errorHandler.ts"),
  "utf8",
);

describe("dashboard source error semantics", () => {
  it("does not return an empty employee summary when employee mapping is missing", () => {
    expect(routes).toContain("EMPLOYEE_MAPPING_UNAVAILABLE");
    expect(routes).not.toContain(
      "if (!employee) return res.json({ success: true, data: { metrics: {},",
    );
  });

  it("does not convert employee attendance query failure to an empty row", () => {
    const employeeRoute = routes.slice(
      routes.indexOf('router.get("/employee/summary"'),
      routes.indexOf('router.get("/PAYROLL_HR_DASHBOARD/operational-summary"'),
    );

    expect(employeeRoute).not.toContain(".catch(() => [[{}]]");
  });

  it("does not convert shared dashboard endpoint failures to zero or empty arrays", () => {
    const sharedRoutes = routes.slice(routes.indexOf('router.get("/:dashboardCode/summary"'));

    expect(sharedRoutes).not.toMatch(/\.catch\(\(\) => \[\[/);
    expect(sharedRoutes).not.toContain("pending_count: 0, overdue_count: 0");
  });

  it("propagates drilldown source failures instead of returning empty records", () => {
    expect(drilldowns).not.toContain("records: [], note: `Query error:");
    expect(drilldowns).not.toContain(".catch(() => [[]]");
    expect(drilldowns).toContain('errorCode: "SOURCE_UNAVAILABLE"');
  });

  it("preserves dashboard error codes in the shared error envelope", () => {
    expect(errorHandler).toContain("operationalError.errorCode");
  });
});
