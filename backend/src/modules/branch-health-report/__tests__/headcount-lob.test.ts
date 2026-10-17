import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn(async (_sql: string, _params?: unknown[]): Promise<unknown[]> => [[]]);
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (sql: string, params?: unknown[]) => execute(sql, params) } }));

import { fetchAllBranchHealthData, fetchHeadcountMovement } from "../query.js";
import { buildBranchHealthReport } from "../metrics.js";
import { renderEmail } from "../template.js";

const ACTIVE_BY_PROCESS_LOB = [
  { process: "Alpha Voice", lob: "Banking", cnt: 30 },
  { process: "Alpha Voice", lob: "Telecom", cnt: 45 },
  { process: "Alpha Voice", lob: "Unassigned", cnt: 5 },
  { process: "Beta Chat", lob: "Banking", cnt: 12 },
];

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => (/GROUP BY process, lob/.test(sql) ? [ACTIVE_BY_PROCESS_LOB] : [[]]));
});

describe("headcount movement, process-wise LOB split", () => {
  it("sums each process's LOB rows into its active count and lists the LOBs largest first", async () => {
    const hc = await fetchHeadcountMovement("b1", "2026-10-17");
    expect(hc.totalActive).toBe(92);
    const alpha = hc.byProcess.find((r) => r.process === "Alpha Voice");
    expect(alpha?.active).toBe(80);
    expect(alpha?.lobs).toEqual([{ lob: "Telecom", active: 45 }, { lob: "Banking", active: 30 }, { lob: "Unassigned", active: 5 }]);
    expect(hc.byProcess.find((r) => r.process === "Beta Chat")?.lobs).toEqual([{ lob: "Banking", active: 12 }]);
    for (const r of hc.byProcess) expect((r.lobs ?? []).reduce((n, l) => n + l.active, 0)).toBe(r.active);
  });

  it("the active-headcount query counts active employees of the branch only", async () => {
    await fetchHeadcountMovement("b1", "2026-10-17");
    const call = execute.mock.calls.find(([sql]) => /GROUP BY process, lob/.test(sql));
    expect(call?.[0]).toMatch(/e\.branch_id = \? AND e\.active_status = 1/);
    expect(call?.[0]).toMatch(/LEFT JOIN lob_master lm ON lm\.id = e\.lob_id/);
    expect((call?.[1] as unknown[]).at(-1)).toBe("b1");
  });

  it("the email shows the LOB rows indented under their process", async () => {
    execute.mockImplementation(async () => [[]]);
    const full: any = await fetchAllBranchHealthData("Nowhere", "2026-10-17");
    const headcount = {
      ...full.headcount, totalActive: 80,
      byProcess: [{ process: "Alpha Voice", active: 80, joinedToday: 0, joinedMtd: 0, leftToday: 0, leftMtd: 0, mandateSeats: null, mandateSource: null,
        lobs: [{ lob: "Telecom", active: 45 }, { lob: "Banking & <Cards>", active: 35 }] }],
    };
    const report = buildBranchHealthReport("NOIDA-2", "2026-10-17", { ...full, branchId: "b1", headcount });
    const html = renderEmail(report, { generatedAt: "now" });
    const section = html.slice(html.indexOf("HEADCOUNT MOVEMENT"));
    expect(section).toContain("LOB: Telecom");
    expect(section).toContain("LOB: Banking &amp; &lt;Cards&gt;");
    expect(section.indexOf("Alpha Voice")).toBeLessThan(section.indexOf("LOB: Telecom"));
    expect(section.indexOf("LOB: Telecom")).toBeLessThan(section.indexOf("LOB: Banking"));
  });
});
