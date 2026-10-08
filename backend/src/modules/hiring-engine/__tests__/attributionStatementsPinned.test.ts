import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const loadActiveStreams = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../he-drive-plan.service.js", () => ({ getDrivePlan: vi.fn(async () => null), poolRemaining: vi.fn(async () => null) }));
vi.mock("../requisition-stream.service.js", async (orig) => ({ ...(await orig<typeof import("../requisition-stream.service.js")>()), loadActiveStreams, loadStreamsOfType: vi.fn(async () => []) }));

import { getSourcesForRequisitions } from "../he-sources-window.service.js";
import { clearDriveTrendCache, getDriveGroupsDetailed, getDriveTrend, readDriveAggRows } from "../he-drive-trend.service.js";
import { readCostUsage } from "../he-cost.service.js";
import { collectInsightFacts } from "../he-drive-insight-facts.service.js";
import { outcomeReasonCounts } from "../he-outcome-reason.service.js";
import { INSIGHT_DEFAULTS } from "../he-drive-insights.js";

// Pins every statement that types a match / person by source (Live Meta, Old Meta data, Hiring Engine) outside the analytics service
// itself (driveAnalyticsOff pins that one), so a change to the attribution rule shows up here as a deliberate statement change.
const NOW = new Date("2026-10-14T06:00:00Z");
const W = { from: "2026-10-01", to: "2026-10-14" };
const norm = (): Array<[string, unknown]> => execute.mock.calls.map((c) => [String(c[0]).replace(/\s+/g, " ").trim(), c[1]]);
const zeroStage = { leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 };
const grid = () => Array.from({ length: 7 }, () => new Array<number>(24).fill(0));

beforeEach(() => {
  vi.clearAllMocks();
  clearDriveTrendCache();
  loadActiveStreams.mockResolvedValue([]);
  execute.mockImplementation(async (sql: string) => {
    const q = String(sql);
    if (q.includes("FROM job_requisition WHERE id")) return [[{ branch_name: "Pune" }]];
    if (q.includes("SELECT DISTINCT d.requisition_id, d.branch_name FROM he_drive d")) return [[{ requisition_id: "r1", branch_name: "Pune" }]];
    if (q.includes("FROM meta_campaign WHERE requisition_id IN")) return [[{ id: "c9", requisition_id: "r1", campaign_name: "Ad" }]];
    return [[]];
  });
});

describe("source-typed statements (pinned)", () => {
  it("sources window", async () => {
    await getSourcesForRequisitions(["r1"], W);
    expect(norm()).toMatchSnapshot();
  });
  it("drive buckets, drive trend and campaign dashboard groups", async () => {
    await readDriveAggRows(["r1"], W.from, W.to);
    await getDriveTrend({ requisitionId: "r1" }, { all: true } as never, NOW);
    await getDriveGroupsDetailed(NOW);
    expect(norm()).toMatchSnapshot();
  });
  it("cost usage", async () => {
    await readCostUsage(["r1"], W);
    expect(norm()).toMatchSnapshot();
  });
  it("insight facts", async () => {
    await collectInsightFacts({
      requisitionIds: ["r1"], from: W.from, to: W.to, today: "2026-10-14", windowDays: 14,
      types: { meta_live: { current: { ...zeroStage }, previous: { ...zeroStage } }, meta_old: { current: { ...zeroStage }, previous: { ...zeroStage } }, he: { current: { ...zeroStage }, previous: { ...zeroStage } } },
      agg: [], sources: [], codes: new Map([["r1", "REQ-1"]]), t: { ...INSIGHT_DEFAULTS }, arrivals: { meta_live: grid(), meta_old: grid(), he: grid() }, streams: [], now: NOW,
    } as never, { all: true } as never);
    expect(norm()).toMatchSnapshot();
  });
  it("outcome reason counts", async () => {
    await outcomeReasonCounts(["r1"], W.from, W.to);
    expect(norm()).toMatchSnapshot();
  });
});
