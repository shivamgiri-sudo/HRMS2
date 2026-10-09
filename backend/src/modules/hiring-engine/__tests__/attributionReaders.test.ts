import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const loadActiveStreams = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-drive-plan.service.js", () => ({ getDrivePlan: vi.fn(async () => null), poolRemaining: vi.fn(async () => null) }));
vi.mock("../requisition-stream.service.js", async (orig) => ({ ...(await orig<typeof import("../requisition-stream.service.js")>()), loadActiveStreams, loadStreamsOfType: vi.fn(async () => []) }));

import { getSourcesForRequisitions } from "../he-sources-window.service.js";
import { clearRequisitionSourcesCache, getRequisitionSources } from "../he-requisition-sources.service.js";
import { clearDriveTrendCache, getDriveGroupsDetailed, getDriveTrend, readDriveAggRows } from "../he-drive-trend.service.js";
import { readCostUsage } from "../he-cost.service.js";
import { collectInsightFacts } from "../he-drive-insight-facts.service.js";
import { outcomeReasonCounts } from "../he-outcome-reason.service.js";
import { INSIGHT_DEFAULTS } from "../he-drive-insights.js";
import * as attribution from "../he-source-attribution.js";

// Every statement that returns a source_type for people on drives / messages / calls must type them with the shared rule
// (he-source-attribution.ts): the Meta-origin check and the live-fill check against the cutoff, never a run_label or a bare 'he' default.
const NOW = new Date("2026-10-14T06:00:00Z");
// The build reads the rolling Live Meta cutoff from the clock: pinned to NOW, so the cutoff is 14 Oct - 7 days = 7 Oct 2026.
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });
const W = { from: "2026-10-01", to: "2026-10-14" };
const zeroStage = { leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 };
const grid = () => Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
const typed = (): string[] => execute.mock.calls.map((c) => String(c[0]))
  .filter((q) => /AS source_type/.test(q) && /he_match|he_message|he_call/.test(q));

beforeEach(async () => {
  vi.clearAllMocks();
  clearDriveTrendCache();
  clearRequisitionSourcesCache();
  (await import("../he-source-attribution.service.js").catch(() => ({ clearLiveFromCache: () => undefined }))).clearLiveFromCache?.();
  loadActiveStreams.mockResolvedValue([]);
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM job_requisition WHERE id")) return [[{ branch_name: "Pune", requisition_code: "R", designation_name: "A" }]];
    if (q.includes("DISTINCT d.requisition_id, d.branch_name FROM he_drive d")) return [[{ requisition_id: "r1", branch_name: "Pune" }]];
    return [[]];
  });
});

describe("every source-typed reader uses the shared rule", () => {
  it("covers sources, drive buckets / trend / groups, cost, insight facts and outcome reasons", async () => {
    await getSourcesForRequisitions(["r1"], W);
    await getRequisitionSources("r1", { all: true } as never);
    await readDriveAggRows(["r1"], W.from, W.to);
    await getDriveTrend({ requisitionId: "r1" }, { all: true } as never, NOW);
    await getDriveGroupsDetailed(NOW);
    await readCostUsage(["r1"], W);
    await collectInsightFacts({
      requisitionIds: ["r1"], from: W.from, to: W.to, today: "2026-10-14", windowDays: 14,
      types: { meta_live: { current: { ...zeroStage }, previous: { ...zeroStage } }, meta_old: { current: { ...zeroStage }, previous: { ...zeroStage } }, he: { current: { ...zeroStage }, previous: { ...zeroStage } } },
      agg: [], sources: [], codes: new Map([["r1", "REQ-1"]]), t: { ...INSIGHT_DEFAULTS }, arrivals: { meta_live: grid(), meta_old: grid(), he: grid() }, streams: [], now: NOW,
    } as never, { all: true } as never);
    await outcomeReasonCounts(["r1"], W.from, W.to);
    const all = execute.mock.calls.map((c) => String(c[0]));
    const list = all.filter((q) => /AS tm\b/.test(q));
    expect(list.length).toBeGreaterThanOrEqual(14);
    void attribution;
    for (const q of list) {
      // every typed statement returns the row signals of the shared rule (lead id, Meta credit / drive, activity against the cutoff) ...
      expect(q).toMatch(/AS tl, \(.*\) AS tm, \(.* >= TIMESTAMP '2026-10-07 00:00:00'\) AS tr/s);
      expect(q).not.toContain("run_label IS NOT NULL");
      expect(q).not.toContain("COALESCE(rs.source_type, 'he') AS source_type");
      expect(q).not.toMatch(/qf\.source_type/);
      // ... and never looks the person up itself: that happens once per build in the person facts statement
      expect(q).not.toContain("FROM he_lead_campaign alx WHERE alx.lead_id = al.id");
    }
  });
});
