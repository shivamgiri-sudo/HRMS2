/** /drive-analytics carries the confirmed-by-channel split and the response rate per channel (additive fields, own section). */
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const readResponseStats = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../requisition-stream.service.js", async (orig) => ({ ...(await orig<typeof import("../requisition-stream.service.js")>()), loadActiveStreams: vi.fn(async () => []) }));
vi.mock("../he-sources-window.service.js", () => ({ getSourcesForRequisitions: vi.fn(async () => ({ byRequisition: [], previousStages: [], partial: false, failedSections: [] })) }));
vi.mock("../qualified-followup.schedule.js", () => ({ followupMode: () => "live" }));
vi.mock("../he-drive-insight-facts.service.js", () => ({ collectInsightFacts: async () => ({ facts: { today: "2026-10-14", windowDays: 14 }, failedSections: [] }) }));
vi.mock("../he-insight-params.service.js", async () => ({ loadInsightThresholds: async () => ({ ...(await import("../he-drive-insights.js")).INSIGHT_DEFAULTS }) }));
vi.mock("../he-response-stats.service.js", () => ({ readResponseStats }));

import { clearDriveAnalyticsCache, getDriveAnalytics } from "../he-drive-analytics.service.js";

const NOW = new Date("2026-10-14T06:00:00Z");
const Q = { from: "2026-10-01", to: "2026-10-14" };
const ALL = { all: true } as never;
const zeroRate = { email: { contacted: 0, responded: 0 }, whatsapp: { contacted: 0, responded: 0 }, voice_bot: { contacted: 0, responded: 0 } };
const via = { email: 0, web: 0, whatsapp: 0, voice_bot: 0, call_file: 0, hr: 0, unknown: 0 };
const stats = {
  confirmedByChannel: { meta_live: { ...via, whatsapp: 3, web: 1 }, meta_old: { ...via }, he: { ...via, hr: 1 } },
  responseRate: { meta_live: { ...zeroRate, whatsapp: { contacted: 10, responded: 4 } }, meta_old: zeroRate, he: zeroRate },
};

beforeEach(() => {
  vi.clearAllMocks();
  clearDriveAnalyticsCache();
  readResponseStats.mockResolvedValue(stats);
  execute.mockImplementation(async (sql: string) => (String(sql).includes("FROM he_drive d WHERE d.drive_date BETWEEN")
    ? [[{ id: "r1", requisition_code: "REQ-r1", designation_name: "Agent", branch_name: "Pune", last_drive: "2026-10-12" }]] : [[]]));
});

describe("E8: the responses section never competes with the core sections for the read slots", () => {
  it("starts only after every core section has finished", async () => {
    const { getSourcesForRequisitions } = await import("../he-sources-window.service.js");
    const order: string[] = [];
    vi.mocked(getSourcesForRequisitions).mockImplementationOnce((async () => { await new Promise((r) => setTimeout(r, 20)); order.push("sources done"); return { byRequisition: [], previousStages: [], partial: false, failedSections: [] }; }) as never);
    readResponseStats.mockImplementationOnce(async () => { order.push("responses start"); return stats; });
    await getDriveAnalytics(Q, ALL, NOW);
    expect(order).toEqual(["sources done", "responses start"]);
  });
});

describe("drive analytics: responses", () => {
  it("adds confirmedByChannel and responseRate for the requisitions of the build and the window", async () => {
    const r = (await getDriveAnalytics(Q, ALL, NOW)) as unknown as Record<string, unknown>;
    expect(r.confirmedByChannel).toEqual(stats.confirmedByChannel);
    expect(r.responseRate).toEqual(stats.responseRate);
    expect(readResponseStats.mock.calls[0][0]).toEqual(["r1"]);
    expect(readResponseStats.mock.calls[0][1]).toMatchObject({ from: "2026-10-01", to: "2026-10-14" });
    expect(r.partial).toBe(false);
  });
  it("a failed responses read flags its own section; both fields are null and the rest stays", async () => {
    readResponseStats.mockRejectedValue(Object.assign(new Error("boom"), { code: "ER_LOCK_WAIT_TIMEOUT" }));
    const r = (await getDriveAnalytics(Q, ALL, NOW)) as unknown as Record<string, unknown>;
    expect(r.confirmedByChannel).toBeNull();
    expect(r.responseRate).toBeNull();
    expect(r.failedSections).toContain("responses");
    expect(r.requisitionCount).toBe(1);
  });
  it("no requisitions in scope: no read, empty splits", async () => {
    execute.mockImplementation(async () => [[]]);
    const r = (await getDriveAnalytics(Q, ALL, NOW)) as unknown as Record<string, unknown>;
    expect(readResponseStats).not.toHaveBeenCalled();
    expect(r.confirmedByChannel).toBeNull();
    expect(r.responseRate).toBeNull();
    expect(r.partial).toBe(false);
  });
});
