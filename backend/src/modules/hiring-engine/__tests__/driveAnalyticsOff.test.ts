import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const loadActiveStreams = vi.hoisted(() => vi.fn());
const getSources = vi.hoisted(() => vi.fn());
const mode = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../requisition-stream.service.js", async (orig) => ({ ...(await orig<typeof import("../requisition-stream.service.js")>()), loadActiveStreams }));
vi.mock("../he-sources-window.service.js", () => ({ getSourcesForRequisitions: getSources }));
vi.mock("../qualified-followup.schedule.js", () => ({ followupMode: mode }));
vi.mock("../he-drive-insight-facts.service.js", () => ({ collectInsightFacts: async () => ({ facts: { today: "2026-10-14", windowDays: 14 }, failedSections: [] }) }));
vi.mock("../he-insight-params.service.js", async () => ({ loadInsightThresholds: async () => ({ ...(await import("../he-drive-insights.js")).INSIGHT_DEFAULTS }) }));

import { clearDriveAnalyticsCache, getDriveAnalytics } from "../he-drive-analytics.service.js";

// Pins today's drive analytics output and statement list (one requisition fed by all three types) so HE_COST_PER_SOURCE off stays byte-identical.
const NOW = new Date("2026-10-14T06:00:00Z");
const Q = { from: "2026-10-01", to: "2026-10-14" };
const ALL = { all: true } as never;
const zeros = { qualified: 0, emailed: 0, whatsapped: 0, replied: 0, called: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 };
const srcRow = (sourceType: string, leads: number, extra: object = {}) => ({ sourceType, originId: `o-${sourceType}`, originLabel: sourceType, streamId: null, streamStatus: null, ...zeros, leads, shareOfLeads: 0, shareOfJoined: 0, leadToJoinRate: 0, ...extra });
const head = (id: string, branch = "Pune", day = "2026-10-12") => ({ id, requisition_code: `REQ-${id}`, designation_name: "Agent", branch_name: branch, last_drive: day });
const driveRow = (rid: string, o: Record<string, unknown> = {}) => ({ requisition_id: rid, requisition_code: `REQ-${rid}`, designation_name: "Agent", branch_name: "Pune", id: `d-${rid}`, drive_date: "2026-10-12", status: "active", target_shows: 10, stream_id: null, source_type: null, lined: 20, invited: 15, confirmed: 10, arrived: 6, no_show: 2, declined: 1, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  clearDriveAnalyticsCache();
  mode.mockReturnValue("live");
  loadActiveStreams.mockResolvedValue([]);
  getSources.mockResolvedValue({
    byRequisition: [{ requisitionId: "r1", rows: [srcRow("meta_live", 60, { qualified: 40, joined: 3 }), srcRow("meta_old", 30), srcRow("he", 20)] }], partial: false, failedSections: [],
  });
  execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const q = String(sql);
    // The events-based persons read (added with the attribution fix) answers the same people the drive buckets below hold, so the
    // recorded output stays the same: on real data events only add people (closed drives, deleted matches, no-show after confirming).
    if (q.includes("AS contacted")) {
      if (!params.includes("2026-10-15 00:00:00")) return [[]]; // the previous window has no drive (the bucket rows are dated 2026-10-12)
      const p = (source_type: string, leads: number, invited: number, confirmed: number, arrived: number) =>
        ({ requisition_id: "r1", source_type, campaign_id: null, leads, qualified: 0, contacted: invited, invited, confirmed, arrived, selected: 0, joined: 0 });
      return [[p("meta_live", 60, 6, 4, 2), p("meta_old", 30, 4, 3, 1), p("he", 20, 15, 10, 6)]];
    }
    if (q.includes("FROM he_drive d WHERE d.drive_date BETWEEN")) return [[head("r1")]];
    if (q.includes("LEFT JOIN he_drive d ON")) {
      return [[driveRow("r1"), driveRow("r1", { stream_id: "s1", source_type: "meta_live", lined: 8, invited: 6, confirmed: 4, arrived: 2 }),
        driveRow("r1", { stream_id: "s2", source_type: "meta_old", lined: 5, invited: 4, confirmed: 3, arrived: 1 })]];
    }
    return [[]];
  });
});

describe("drive analytics with the plan 5 switches off", () => {
  it("matches the recorded output and statement list", async () => {
    const r = (await getDriveAnalytics(Q, ALL, NOW)) as unknown as Record<string, unknown>;
    expect(JSON.parse(JSON.stringify({ ...r, generatedAt: "T" }))).toMatchSnapshot("output");
    expect(execute.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " ").trim()).sort()).toMatchSnapshot("statements");
  });
});
