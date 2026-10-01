import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf-8");

describe("decision paths notify affected employees", () => {
  it("swap review notifies requester and counterpart", () => {
    const s = read("../../wfm-extensions/wfm-ext.service.ts");
    expect(s).toContain("import { notifyRosterRequest }");
    expect(s).toMatch(/notifyRosterRequest\(\s*\{\s*employeeIds: \[[^\]]*requester_emp_id[^\]]*swap_with_emp_id/s);
  });
  it("week-off realign, force-approve and reject-request notify", () => {
    // The handlers delegate to weekoff-review.service.ts, which owns the notify calls.
    const s = read("../../wfm/weekoff-review.service.ts");
    expect(s).toContain("import { notifyWeekoffDecision }");
    expect((s.match(/notifyWeekoffDecision\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it("dispute resolution notifies the assignment's employee", () => {
    const s = read("../../roster/roster.governance.routes.ts");
    expect(s).toContain("import { notifyRosterRequest }");
    expect(s).toMatch(/notifyRosterRequest\(\s*\{\s*employeeIds: \[assignment\.employee_id\]/s);
  });
});
