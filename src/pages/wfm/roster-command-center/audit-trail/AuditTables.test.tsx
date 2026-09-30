import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RunsTable, TrailsTable } from "./AuditTables";
import { Pager } from "./tableParts";
import type { AuditTrail, GenerationRun } from "./auditModel";

const trail: AuditTrail = {
  id: "a1", date: "2026-09-03", changeType: "Manual Override", changeTypeCode: "manual_override", reason: "Cover for leave", ruleApplied: "x",
  isOverride: true, isEngineError: false, timestamp: "2026-09-02 09:05:00", cycleId: "c1", runId: null,
  employee: { id: "e1", code: "MAS001", name: "Asha Rao" }, processName: "Support", branchName: "Pune", shiftName: null, changedBy: "PM Pat", runType: null,
};
const run: GenerationRun = {
  id: "r1", cycleId: "c1", processName: "Support", branchName: null, runType: "manual_trigger", status: "partial",
  stats: { employeesProcessed: 1200, assignmentsCreated: 8400, weekoffsAllocated: 1200, conflictsFound: 3 },
  weekStart: "2026-09-07", weekEnd: "2026-09-13", startedAt: "2026-09-01 10:00:00", completedAt: "2026-09-01 10:00:00", duration: 0, triggeredBy: "PM Pat",
};

describe("audit tables", () => {
  it("renders DD/MM/YYYY dates, status pill label, manual marker and an accessible row", () => {
    const html = renderToStaticMarkup(<TrailsTable rows={[trail]} onOpen={() => {}} />);
    expect(html).toContain("03/09/2026");
    expect(html).toContain("02/09/2026 09:05");
    expect(html).toContain("Manual Override");
    expect(html).toContain("(manual)");
    expect(html).toContain('aria-sort="descending"'); // default sort: recorded desc
    expect(html).toContain('tabindex="0"');
  });
  it("renders runs with Indian grouping, week range and a 0s duration (not 'Running')", () => {
    const html = renderToStaticMarkup(<RunsTable rows={[run]} onOpen={() => {}} />);
    expect(html).toContain("8,400");
    expect(html).toContain("07/09/2026 - 13/09/2026");
    expect(html).toContain("All branches");
    expect(html).toContain(">0s<");
    expect(html).not.toContain("Running");
  });
  it("pager disables prev on first page and next on last", () => {
    const first = renderToStaticMarkup(<Pager offset={0} count={50} total={50} pageSize={50} onPage={() => {}} />);
    expect(first).toContain("Showing 1-50 of 50");
    expect((first.match(/disabled=""/g) ?? []).length).toBe(2);
  });
});
