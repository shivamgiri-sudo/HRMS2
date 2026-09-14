import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * KPI Studio computes real figures and writes them to kpi_daily_actual, but the
 * insert omitted process_id_at_event and branch_id_at_event -- the two columns
 * every process-scoped dashboard filters on.
 *
 * The failure mode this pins is the nastiest kind: nothing errored. The compute
 * reported success, the row was plainly present in kpi_daily_actual, and the
 * figure simply never appeared on any process dashboard, because the WHERE
 * clause could never match it. Same class as team_leader_id_at_event, which
 * turned out never to be written at all (0 of 84,913 rows).
 */
const source = readFileSync(
  resolve(process.cwd(), "src/modules/kpi/kpi-studio.compute.ts"),
  "utf8",
);
const insertBlock = source.slice(
  source.indexOf("INSERT INTO kpi_daily_actual"),
  source.indexOf("INSERT INTO kpi_studio_computation_log"),
);

describe("kpi-studio compute lineage", () => {
  it("writes process_id_at_event on the actuals it inserts", () => {
    expect(insertBlock).toMatch(/process_id_at_event/);
  });

  it("writes branch_id_at_event too", () => {
    expect(insertBlock).toMatch(/branch_id_at_event/);
  });

  it("keeps the lineage current on re-computation", () => {
    // An employee who moved process must not keep the old lineage on a rerun,
    // so both columns belong in the ON DUPLICATE KEY UPDATE list as well.
    const onDuplicate = insertBlock.slice(insertBlock.indexOf("ON DUPLICATE KEY UPDATE"));
    expect(onDuplicate).toMatch(/process_id_at_event\s*=\s*VALUES/);
    expect(onDuplicate).toMatch(/branch_id_at_event\s*=\s*VALUES/);
  });

  it("sources the lineage from the employee row, not a constant", () => {
    expect(source).toMatch(/processId:\s*employee\.process_id/);
    expect(source).toMatch(/branchId:\s*employee\.branch_id/);
  });
});
