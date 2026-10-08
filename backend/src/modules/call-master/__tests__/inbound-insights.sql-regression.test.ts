import { beforeEach, describe, expect, it, vi } from "vitest";

const dbExecute = vi.hoisted(() => vi.fn());
const poolExecute = vi.hoisted(() => vi.fn());
const connQuery = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../db/dialerDb.js", () => ({
  getDialerPool: async () => ({ execute: poolExecute, getConnection: async () => ({ query: connQuery, release: () => undefined }) }),
}));

import { getInboundInsights, isInsightProjectAsync } from "../inbound-insights.service.js";
import { __resetInboundProjectsForTest, STATIC_PROJECTS } from "../inbound-projects.js";

const range = { startDate: "2026-09-01", endDate: "2026-09-03" };
const cdrSql = () => poolExecute.mock.calls.map((c) => c[0] as string).find((s) => /FROM dialer_db\.cdr_in_/.test(s))!;

beforeEach(() => {
  __resetInboundProjectsForTest(); dbExecute.mockReset(); poolExecute.mockReset(); connQuery.mockReset();
  poolExecute.mockResolvedValue([[], []]);
});

describe("inbound insights SQL for the static projects is unchanged", () => {
  it.each(STATIC_PROJECTS.map((p) => [p.key, p.table, p.pattern, p.campaigns] as const))("%s reads dialer_db.%s with its own campaigns bound", async (key, table, pattern, campaigns) => {
    dbExecute.mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" })); // pre-migration DB: pure static
    await getInboundInsights(key, range);
    const call = poolExecute.mock.calls.find((c) => /FROM dialer_db\.cdr_in_/.test(c[0] as string))!;
    const sql = call[0] as string;
    expect(sql).toContain(`FROM dialer_db.${table}\n`);
    expect(sql).toContain(`CampaignName IN (${campaigns.map(() => "?").join(",")})`);
    expect(sql.includes("AND DisconnBy != 'HOLDTIME'")).toBe(pattern === "A");
    expect(call[1]).toEqual([range.startDate, range.endDate, ...campaigns]);
  });
  it("service-level threshold defaults: 20s pattern A, 30s pattern B", async () => {
    dbExecute.mockRejectedValue(new Error("x"));
    expect((await getInboundInsights("gnc", range)).headline.slThresholdSec).toBe(20);
    expect((await getInboundInsights("exicom", range)).headline.slThresholdSec).toBe(30);
  });
  it("seeded DB rows identical to the static entry produce byte-identical SQL and params", async () => {
    dbExecute.mockRejectedValue(new Error("x"));
    await getInboundInsights("clovia", range);
    const staticCall = poolExecute.mock.calls[0];
    __resetInboundProjectsForTest(); poolExecute.mockClear();
    const c = STATIC_PROJECTS.find((p) => p.key === "clovia")!;
    dbExecute.mockResolvedValue([[{ process_id: "p", project_key: "clovia", dialer_table: c.table, pattern: c.pattern, campaigns: JSON.stringify(c.campaigns), mandate: c.mandate, required: c.required, has_fcr: 0, fcr_client_id: null, sl_seconds: null, enabled: 1, process_name: "Clovia" }], []]);
    connQuery.mockResolvedValue([[], []]);
    await getInboundInsights("clovia", range);
    expect(poolExecute.mock.calls[0]).toEqual(staticCall);
  });
});

describe("DB-registered project", () => {
  const dbRow = { process_id: "p9", project_key: "acme", dialer_table: "cdr_in_77", pattern: "B", campaigns: ["Acme_EN"], mandate: 3, required: 3, has_fcr: 0, fcr_client_id: null, sl_seconds: 15, enabled: 1, process_name: "Acme Support" };
  it("is served from its verified table with its campaigns and SL threshold", async () => {
    dbExecute.mockResolvedValue([[dbRow], []]);
    connQuery.mockImplementation(async (sql: string) => [/information_schema/.test(sql) ? [{ table_name: "cdr_in_77" }] : [], []]);
    expect(await isInsightProjectAsync("acme")).toBe(true);
    const d = await getInboundInsights("acme", range);
    expect(cdrSql()).toContain("FROM dialer_db.cdr_in_77\n");
    expect(d.headline.slThresholdSec).toBe(15);
    expect(d.project).toMatchObject({ key: "acme", name: "Acme Support", campaigns: ["Acme_EN"] });
  });
  it("is unknown when its table is not in the dialer's information_schema, and nothing is queried", async () => {
    dbExecute.mockResolvedValue([[{ ...dbRow, dialer_table: "cdr_in_88" }], []]);
    connQuery.mockImplementation(async (sql: string) => [/information_schema/.test(sql) ? [{ table_name: "cdr_in_77" }] : [], []]);
    expect(await isInsightProjectAsync("acme")).toBe(false);
    await expect(getInboundInsights("acme", range)).rejects.toThrow(/not available/);
    expect(poolExecute).not.toHaveBeenCalled();
  });
});
