import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/**
 * notifyLastWorkingDayApproaching's own doc comment explicitly says it wants to report
 * `null` ("cannot be read") rather than `0` ("all clear") when the clearance count is
 * unavailable — but that only guards against a THROWN error. Reading exit_clearance_checklist
 * (an abandoned table, 0 live rows) doesn't throw; the query just succeeds and matches
 * nothing, so `pending` was silently 0 for every exiting employee, the exact false-"all
 * clear" signal the comment says it wants to avoid. Fixed 2026-08-19 to read
 * exit_clearance_task (24 live rows, clearance_area instead of the old department column).
 *
 * Same class of bug as dead-source-tables.contract.test.ts's clearance-status-register
 * checks (screen route + export executor) — this is the third, independent code path that
 * had drifted onto the same empty table.
 */
describe("exit.notifications: last-working-day clearance count reads the live table", () => {
  const src = read("src/modules/exit/exit.notifications.ts");
  const start = src.indexOf("export async function notifyLastWorkingDayApproaching");
  const fn = src.slice(start, src.indexOf("\nexport async function", start + 1));

  it("function exists and is found", () => {
    expect(start, "notifyLastWorkingDayApproaching not found").toBeGreaterThan(-1);
  });

  it("reads exit_clearance_task, not the empty exit_clearance_checklist", () => {
    expect(fn).toContain("FROM exit_clearance_task");
    expect(fn).not.toContain("exit_clearance_checklist");
  });

  it("groups by clearance_area, the exit_clearance_task column (not the old department column)", () => {
    expect(fn).toContain("clearance_area");
    expect(fn).not.toMatch(/GROUP_CONCAT\(DISTINCT department\b/);
  });
});
