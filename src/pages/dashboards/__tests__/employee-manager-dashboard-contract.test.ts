import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const referenceDashboard = readFileSync(
  resolve(process.cwd(), "src/pages/dashboards/ReferenceRoleDashboard.tsx"),
  "utf8",
);
const attendanceWidget = readFileSync(
  resolve(process.cwd(), "src/components/dashboard/widgets/MyAttendanceWidget.tsx"),
  "utf8",
);

describe("employee and manager dashboard contracts", () => {
  it("loads the management summary, insights, and accountability within the manager route", () => {
    expect(referenceDashboard).toContain("/good-bad-insights");
    expect(referenceDashboard).toContain("/owner-accountability");
    expect(referenceDashboard).toContain('variant === "manager"');
  });

  it("keeps employee attendance failures visible and consumes the API halfDay key", () => {
    expect(attendanceWidget).toContain("isError");
    expect(attendanceWidget).toContain("attDetail.halfDay");
    expect(attendanceWidget).not.toContain("attDetail.present ?? 0");
    expect(attendanceWidget).not.toContain("typeof attValue === \"number\" ? attValue : 0");
  });
});
