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

import { clearDriveAnalyticsCache, getDriveAnalytics, type DriveAnalytics } from "../he-drive-analytics.service.js";
import { COST_DEFAULTS, costBlock, parseCostRates, prorateSpend, typeCost, type CostRates, type CostUsage } from "../he-cost.js";
import { readCostUsage } from "../he-cost.service.js";
import { SOURCE_TYPES, zeroStages } from "../he-drive-analytics.js";

const NOW = new Date("2026-10-14T06:00:00Z");
const Q = { from: "2026-10-01", to: "2026-10-14" };
const ALL = { all: true } as never;
const zeros = { qualified: 0, emailed: 0, whatsapped: 0, replied: 0, called: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0 };
const srcRow = (sourceType: string, leads: number, extra: object = {}) => ({ sourceType, originId: `o-${sourceType}`, originLabel: sourceType, streamId: null, streamStatus: null, ...zeros, leads, shareOfLeads: 0, shareOfJoined: 0, leadToJoinRate: 0, ...extra });
const head = (id: string, branch = "Pune", day = "2026-10-12") => ({ id, requisition_code: `REQ-${id}`, designation_name: "Agent", branch_name: branch, last_drive: day });
const driveRow = (rid: string, o: Record<string, unknown> = {}) => ({ requisition_id: rid, requisition_code: `REQ-${rid}`, designation_name: "Agent", branch_name: "Pune", id: `d-${rid}`, drive_date: "2026-10-12", status: "active", target_shows: 10, stream_id: null, source_type: null, lined: 20, invited: 15, confirmed: 10, arrived: 6, no_show: 2, declined: 1, ...o });


type Rows = { rates?: unknown[]; spend?: unknown[]; messages?: unknown[]; calls?: unknown[]; fail?: Record<string, string>; noStreamTables?: boolean };
let impl: Rows;
const kindOf = (q: string): string =>
  q.includes("AS lead_rows") ? "persons" : q.includes("param_key LIKE ? AND value = 1") ? "cutoff" : q.includes("FROM he_model_param") ? "rates" : q.includes("FROM meta_campaign WHERE") ? "spend" : q.includes("FROM he_message h") ? "messages" : q.includes("FROM he_call c") ? "calls"
    : q.includes("FROM he_drive d WHERE d.drive_date BETWEEN") ? "discovery" : q.includes("LEFT JOIN he_drive d ON") ? "drives" : "other";
const calls = (k: string) => execute.mock.calls.filter((c) => kindOf(String(c[0])) === k).map((c) => [String(c[0]), (c[1] ?? []) as unknown[]] as const);
const rates = (o: Partial<CostRates> = {}): CostRates => ({ ...COST_DEFAULTS, ...o });
const usage0 = (): CostUsage => ({ adSpend: 0, waConversations: 0, calls: 0, callMinutes: 0, emails: 0 });
const stagesOf = () => ({ meta_live: zeroStages(), meta_old: zeroStages(), he: zeroStages() });
const usagesOf = (live: Partial<CostUsage> = {}) => ({ meta_live: { ...usage0(), ...live }, meta_old: usage0(), he: usage0() });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  clearDriveAnalyticsCache();
  impl = {};
  mode.mockReturnValue("live");
  loadActiveStreams.mockResolvedValue([]);
  getSources.mockResolvedValue({
    byRequisition: [{ requisitionId: "r1", rows: [srcRow("meta_live", 150, { qualified: 60, joined: 3 }), srcRow("meta_old", 30), srcRow("he", 20)] }], partial: false, failedSections: [],
  });
  execute.mockImplementation(async (sql: string, _params: unknown[] = []) => {
    const q = String(sql);
    const k = kindOf(q);
    const code = impl.fail?.[k];
    if (code) throw Object.assign(new Error("SELECT boom"), { code });
    if (impl.noStreamTables && q.includes("requisition_stream") && k !== "discovery") throw Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" });
    if (k === "discovery") return [[head("r1")]];
    if (k === "drives") return [[driveRow("r1", { stream_id: "s1", source_type: "meta_live", arrived: 12 })]];
    // events-based persons read: the same people as the sources and bucket rows above
    if (k === "persons" && Array.isArray(_params) && _params.includes("2026-09-17 00:00:00")) return [[]]; // the previous window's read: no people here
    if (k === "persons") return [[{ requisition_id: "r1", source_type: "meta_live", campaign_id: null, leads: 150, qualified: 0, contacted: 15, invited: 15, confirmed: 10, arrived: 12, selected: 0, joined: 0 }]];
    if (k === "rates") return [impl.rates ?? []];
    if (k === "spend") return [impl.spend ?? []];
    if (k === "messages") return [impl.messages ?? []];
    if (k === "calls") return [impl.calls ?? []];
    return [[]];
  });
});

describe("typeCost", () => {
  it("adds ad spend to messaging and divides by each stage", () => {
    const c = typeCost({ adSpend: 3000, waConversations: 200, calls: 50, callMinutes: 120, emails: 300 },
      rates({ "cost.whatsapp_per_conversation": 0.8, "cost.call_per_minute": 0.5, "cost.call_per_call": 1, "cost.email": 0 }),
      { leads: 150, qualified: 60, arrived: 12, joined: 3 });
    expect(c).toMatchObject({ messaging: 270, total: 3270, adSpend: 3000, perLead: 21.8, perQualified: 54.5, perArrival: 272.5, perJoin: 1090 });
  });
  it("gives null per stage when the stage is zero", () => {
    const c = typeCost({ ...usage0(), adSpend: 100 }, rates(), { leads: 0, qualified: 0, arrived: 0, joined: 0 });
    expect(c).toMatchObject({ total: 100, perLead: null, perQualified: null, perArrival: null, perJoin: null });
  });
});

describe("prorateSpend", () => {
  it("spreads the 30-day total over the days in range", () => {
    expect(prorateSpend(3000, "2026-10-14", "2026-10-01", "2026-10-14")).toBe(1400);
  });
  it("is 0 after the sync date, before the period and without a sync date", () => {
    expect(prorateSpend(3000, "2026-10-14", "2026-10-15", "2026-10-20")).toBe(0);
    expect(prorateSpend(3000, "2026-10-14", "2026-08-01", "2026-09-10")).toBe(0);
    expect(prorateSpend(3000, null, "2026-10-01", "2026-10-14")).toBe(0);
  });
  it("counts only the overlapping days and rounds to 2 decimals", () => {
    expect(prorateSpend(100, "2026-10-14", "2026-10-14", "2026-10-20")).toBe(3.33);
  });
});

describe("parseCostRates", () => {
  it("keeps the default for a negative, non-numeric or out-of-range value", () => {
    const r = parseCostRates([{ param_key: "cost.email", value: "-1" }, { param_key: "cost.call_per_call", value: "2.5" }, { param_key: "cost.call_per_minute", value: "1e3" },
      { param_key: "cost.whatsapp_per_conversation", value: "100001" }, { param_key: "cost.unknown", value: "5" }]);
    expect(r).toEqual({ ...COST_DEFAULTS, "cost.call_per_call": 2.5 });
  });
});

describe("costBlock", () => {
  it("is unavailable without rates and spend", () => {
    const b = costBlock(usagesOf(), rates(), stagesOf());
    expect(b).toMatchObject({ available: false, byType: null, ratesConfigured: false });
    expect(b.note).toBe("No cost source yet: no Meta ad spend is synced for these requisitions and no messaging rates are set");
  });
  it("is available on spend alone and says the messaging rates are not set", () => {
    const b = costBlock(usagesOf({ adSpend: 1400 }), rates(), { ...stagesOf(), meta_live: { ...zeroStages(), leads: 100 } });
    expect(b).toMatchObject({ available: true, estimated: true, ratesConfigured: false });
    expect(b.note).toContain("Messaging rates are not set");
    expect(b.byType?.meta_live.perLead).toBe(14);
    expect(b.byType?.he.perLead).toBeNull();
  });
  it("is available on rates alone without the rates-missing sentence", () => {
    const b = costBlock(usagesOf({ emails: 10 }), rates({ "cost.email": 1 }), stagesOf());
    expect(b).toMatchObject({ available: true, ratesConfigured: true });
    expect(b.note).not.toContain("Messaging rates are not set");
    expect(b.note).toContain("Estimated: Meta ad spend is the last 30-day total");
  });
});

describe("readCostUsage", () => {
  const W = { from: "2026-10-01", to: "2026-10-14" };
  it("reads messages with the requisition ids, the distinct person-day count and the IST window", async () => {
    await readCostUsage(["r1"], W);
    const [sql, params] = calls("messages")[0];
    expect(sql).toContain("h.requisition_id IN (");
    // one row per person signals, channel and (hashed mobile, day): the person-days are counted distinct per type in JS
    expect(sql).toContain("MD5(h.mobile10) AS mk, DATE(h.created_at) AS dy, COUNT(DISTINCT h.id) AS msgs");
    expect(sql).toContain("h.direction = 'out'");
    expect(params).toEqual(["r1", "2026-10-01 00:00:00", "2026-10-15 00:00:00"]);
  });
  it("counts a WhatsApp conversation (person and IST day) once per type however many signal rows carry it", async () => {
    impl.messages = [
      { tl: "l1", tm: 0, tr: 0, channel: "whatsapp", mk: "a", dy: "2026-10-05", msgs: 2 },
      { tl: "l1", tm: 1, tr: 0, channel: "whatsapp", mk: "a", dy: "2026-10-05", msgs: 1 }, // the same person-day on a Meta drive
      { tl: "l1", tm: 0, tr: 0, channel: "whatsapp", mk: "a", dy: "2026-10-06", msgs: 1 },
      { tl: "l1", tm: 0, tr: 0, channel: "email", mk: "a", dy: "2026-10-05", msgs: 3 },
    ];
    const r = await readCostUsage(["r1"], W);
    expect(r.usage.he).toMatchObject({ waConversations: 2, emails: 3 }); // l1 has no person facts here: the tm = 0 rows are Hiring Engine
    expect(r.usage.meta_old).toMatchObject({ waConversations: 1 });
  });
  it("reads spend by requisition and rates by key prefix", async () => {
    await readCostUsage(["r1"], W);
    expect(calls("spend")[0][0]).toContain("requisition_id IN (");
    expect(calls("rates")[0][0]).toContain("LIKE 'cost.%'");
  });
  it("retries the messages and calls without the stream joins when the stream tables are missing", async () => {
    impl.noStreamTables = true;
    impl.messages = [{ source_type: "he", channel: "email", persons_days: 2, msgs: 3 }];
    const r = await readCostUsage(["r1"], W);
    expect(calls("messages").some(([q]) => !q.includes("requisition_stream"))).toBe(true);
    expect(r.failedSections).toEqual([]);
    expect(r.usage.he.emails).toBe(3);
  });
  it("counts WhatsApp as person-days and email as messages, per credited type", async () => {
    impl.messages = [
      { source_type: "meta_live", channel: "whatsapp", persons_days: 40, msgs: 90 },
      { source_type: "meta_live", channel: "email", persons_days: 30, msgs: 35 },
      { source_type: "weird", channel: "email", persons_days: 1, msgs: 1 },
    ];
    impl.calls = [{ source_type: "he", calls: 4, minutes: 9 }];
    const r = await readCostUsage(["r1"], W);
    expect(r.usage.meta_live).toMatchObject({ waConversations: 40, emails: 35 });
    expect(r.usage.he).toMatchObject({ calls: 4, callMinutes: 9 });
  });
  it("prorates each campaign by its own sync date and gives spend to Live Meta only", async () => {
    impl.spend = [{ id: "c1", spend_inr: 3000, last_synced_at: "2026-10-14 08:00:00" }, { id: "c2", spend_inr: 3000, last_synced_at: null }];
    const r = await readCostUsage(["r1"], W);
    expect(r.usage.meta_live.adSpend).toBe(1400);
    expect(r.usage.meta_old.adSpend).toBe(0);
  });
  it("batches 200 ids per statement", async () => {
    await readCostUsage(Array.from({ length: 450 }, (_, i) => `r${i}`), W);
    expect(calls("messages")).toHaveLength(3);
    expect(calls("rates")).toHaveLength(1);
  });
  it("never throws: a failed section is named and counts 0", async () => {
    impl.fail = { messages: "ER_BAD_FIELD_ERROR", spend: "ER_LOCK_DEADLOCK" };
    const r = await readCostUsage(["r1"], W);
    expect(r.failedSections.sort()).toEqual(["cost:messages", "cost:spend"]);
    expect(r.usage.meta_live).toEqual(usage0());
  });
});

describe("drive analytics with HE_COST_PER_SOURCE", () => {
  const run = async (): Promise<DriveAnalytics> => (await getDriveAnalytics(Q, ALL, NOW)) as DriveAnalytics;
  it("fills the cost block from the usage and the stage counts", async () => {
    vi.stubEnv("HE_COST_PER_SOURCE", "true");
    impl.spend = [{ id: "c1", spend_inr: 3000, last_synced_at: "2026-10-14 08:00:00" }];
    const r = await run();
    const c = r.cost as Extract<DriveAnalytics["cost"], { byType: unknown }>;
    expect(c.available).toBe(true);
    expect(c.byType?.meta_live.adSpend).toBe(1400);
    expect(c.byType?.meta_old.adSpend).toBe(0);
    expect(c.byType?.he.adSpend).toBe(0);
    expect(c.byType?.meta_live.perLead).toBe(9.33);
    expect(c.byType?.meta_live.perArrival).toBe(116.67);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });
  it("reports unavailable with nothing to count, and flags a failed cost section as partial", async () => {
    vi.stubEnv("HE_COST_PER_SOURCE", "true");
    expect((await run()).cost).toMatchObject({ available: false, byType: null });
    clearDriveAnalyticsCache();
    impl.fail = { calls: "ER_BAD_FIELD_ERROR" };
    const r = await run();
    expect(r.partial).toBe(true);
    expect(r.failedSections).toContain("cost:calls");
  });
  it("keeps the placeholder and issues no cost statement while the switch is off", async () => {
    impl.spend = [{ id: "c1", spend_inr: 3000, last_synced_at: "2026-10-14 08:00:00" }];
    const r = await run();
    expect(r.cost).toEqual({ available: false, note: "Cost per source arrives with Plan 5" });
    for (const k of ["rates", "spend", "messages", "calls"]) expect(calls(k)).toHaveLength(0);
  });
  it("treats any value other than true as off", async () => {
    vi.stubEnv("HE_COST_PER_SOURCE", "1");
    expect((await run()).cost).toEqual({ available: false, note: "Cost per source arrives with Plan 5" });
  });
  it("lists the source types in a fixed order", () => { expect(SOURCE_TYPES).toEqual(["meta_live", "meta_old", "he"]); });
});
