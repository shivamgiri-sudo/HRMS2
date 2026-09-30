import { beforeEach, describe, expect, it, vi } from "vitest";

const dbExecute = vi.hoisted(() => vi.fn());
const connQuery = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../db/dialerDb.js", () => ({
  getDialerPool: async () => ({ execute: vi.fn(), getConnection: async () => ({ query: connQuery, release: () => undefined }) }),
}));

import { PdError } from "../pd.source.js";
import { assertDialerTable, getInboundTab, listCandidateTables, previewInbound, saveInboundConfig } from "../pd.inbound.service.js";
import { __resetInboundProjectsForTest } from "../../call-master/inbound-projects.js";

const PID = "11111111-1111-1111-1111-111111111111";
const good = { dialerTable: "cdr_in_77", pattern: "B", campaigns: ["Acme_EN"], mandate: 5, required: 4 };
const dialerSqls = () => connQuery.mock.calls.map((c) => String(c[0]));
const dialerWith = (tables: string[], cols?: string[]) => connQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
  if (/information_schema\.tables/.test(sql)) return [tables.map((t) => ({ table_name: t, table_rows: 10 })), []];
  if (/information_schema\.columns/.test(sql)) return [(cols ?? []).map((c) => ({ table_name: tables[0], column_name: c })), []];
  void params;
  return [[], []];
});

beforeEach(() => { __resetInboundProjectsForTest(); dbExecute.mockReset(); connQuery.mockReset(); });

describe("assertDialerTable (identifier safety)", () => {
  it.each(["cdr_in_4; DROP TABLE x", "cdr_in_4`", "mysql.user", "information_schema.tables", "cdr_in_", "x".repeat(70), "", "cdr_in_4 UNION SELECT 1"])("refuses %j without running any SQL", async (t) => {
    await expect(assertDialerTable(t)).rejects.toMatchObject({ code: "BAD_IDENTIFIER", status: 400 });
    expect(connQuery).not.toHaveBeenCalled();
  });
  it("refuses a well-formed but unknown table (after one fresh lookup)", async () => {
    dialerWith(["cdr_in_4"]);
    await expect(assertDialerTable("cdr_in_99")).rejects.toMatchObject({ code: "TABLE_NOT_FOUND", status: 404 });
  });
  it("accepts a table the dialer's information_schema lists", async () => {
    dialerWith(["cdr_in_77", "cdr_in_4"]);
    await expect(assertDialerTable("cdr_in_77")).resolves.toBe("cdr_in_77");
  });
  it("503s when the dialer cannot be read", async () => {
    connQuery.mockRejectedValue(new Error("down"));
    await expect(assertDialerTable("cdr_in_4")).rejects.toMatchObject({ code: "DIALER_UNAVAILABLE", status: 503 });
  });
});

describe("previewInbound / saveInboundConfig never reach SQL with an unsafe table", () => {
  it("preview rejects injection-shaped tables before touching the dialer", async () => {
    await expect(previewInbound(PID, { ...good, dialerTable: "cdr_in_4; DROP TABLE t" })).rejects.toBeInstanceOf(PdError);
    expect(connQuery).not.toHaveBeenCalled();
  });
  it("save rejects bad input (400), unknown process (404), unknown table (404) and incomplete tables (400)", async () => {
    await expect(saveInboundConfig("u", PID, { ...good, campaigns: [] })).rejects.toMatchObject({ status: 400 });
    dbExecute.mockResolvedValueOnce([[], []]);
    await expect(saveInboundConfig("u", PID, good)).rejects.toMatchObject({ code: "PROCESS_NOT_FOUND" });
    dbExecute.mockResolvedValue([[{ id: PID, process_code: "ACME" }], []]);
    dialerWith(["cdr_in_4"]);
    await expect(saveInboundConfig("u", PID, good)).rejects.toMatchObject({ code: "TABLE_NOT_FOUND" });
    dialerWith(["cdr_in_77"], ["id", "CallDate"]);
    await expect(saveInboundConfig("u", PID, good)).rejects.toMatchObject({ code: "TABLE_INCOMPLETE" });
  });
  it("save upserts with bound values, a key derived from the process code, and never writes the dialer", async () => {
    const all = ["id", "CallDate", "Time", "HoursSlot", "AgentId", "AgentName", "CampaignName", "PhoneNumber", "Disposition", "DisconnBy", "CallDurationSecond", "QueueDuration", "HoldTime", "Talkduration", "Acwduration", "CallTransferId"];
    dialerWith(["cdr_in_77"], all);
    const stored = { process_id: PID, project_key: "acme", dialer_table: "cdr_in_77", pattern: "B", campaigns: '["Acme_EN"]', mandate: 5, required: 4, has_fcr: 0, fcr_client_id: null, sl_seconds: null, enabled: 1, updated_at: null };
    let inserted = false;
    dbExecute.mockImplementation(async (sql: string) => {
      if (/FROM process_master/.test(sql)) return [[{ id: PID, process_code: "ACME" }], []];
      if (/^\s*INSERT INTO process_inbound_config/.test(sql)) { inserted = true; return [{}, []]; }
      if (/WHERE process_id = \?/.test(sql)) return [inserted ? [stored] : [], []];
      if (/WHERE project_key = \?/.test(sql)) return [[], []];
      return [[], []];
    });
    const out = await saveInboundConfig("u1", PID, good);
    expect(out).toMatchObject({ projectKey: "acme", dialerTable: "cdr_in_77", campaigns: ["Acme_EN"] });
    const ins = dbExecute.mock.calls.find((c) => /INSERT INTO process_inbound_config/.test(String(c[0])))!;
    expect(ins[1]).toEqual(expect.arrayContaining([PID, "acme", "cdr_in_77", "B", '["Acme_EN"]', "u1"]));
    expect(dialerSqls().every((s) => /^\s*(SELECT|START TRANSACTION READ ONLY|ROLLBACK)/i.test(s))).toBe(true);
  });
  it("preview on a verified table only issues SELECTs in a READ ONLY transaction, binds campaigns, masks phones", async () => {
    connQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/information_schema\.tables/.test(sql)) return [[{ table_name: "cdr_in_77" }], []];
      if (/GROUP BY CampaignName/.test(sql)) return [[{ c: "Acme_EN", n: 5, last_call: "2026-09-29" }], []];
      if (/DisconnBy = 'HOLDTIME'/.test(sql)) return [[{ n: 0 }], []];
      if (/COUNT\(\*\) AS offered/.test(sql)) { expect(params).toEqual([["Acme_EN"]]); return [[{ offered: 5, answered: 3, d0: "2026-09-01", d1: "2026-09-29" }], []]; }
      if (/ORDER BY CallDate DESC/.test(sql)) return [[{ date: "2026-09-29", phone: "9876543210" }], []];
      return [[], []];
    });
    const r = await previewInbound(PID, good);
    expect(r.detectedPattern.pattern).toBe("B");
    expect(r.totals).toMatchObject({ offered: 5, answered: 3, abandoned: 2 });
    expect(r.sample[0].phone).toBe("••••••3210");
    expect(dialerSqls()[0]).toMatch(/START TRANSACTION READ ONLY/);
    for (const s of dialerSqls()) expect(s).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  });
});

describe("candidates and viewer tab", () => {
  it("lists only cdr_in tables with completeness and who uses them", async () => {
    connQuery.mockImplementation(async (sql: string) => {
      if (/information_schema\.tables/.test(sql) && /LIKE/.test(sql)) return [[{ table_name: "cdr_in_4" }, { table_name: "cdr_in_77" }], []];
      if (/information_schema\.tables/.test(sql)) return [[{ table_name: "cdr_in_4", table_rows: 9 }, { table_name: "cdr_in_77", table_rows: null }], []];
      return [[{ table_name: "cdr_in_4", column_name: "id" }], []];
    });
    dbExecute.mockResolvedValue([[], []]);
    const r = await listCandidateTables();
    expect(r.map((x) => x.table)).toEqual(["cdr_in_4", "cdr_in_77"]);
    expect(r[0]).toMatchObject({ complete: false, usedBy: ["dubangladesh", "gnc"] });
    expect(r[1].rows).toBeNull();
  });
  it("getInboundTab is null without an enabled config", async () => {
    dbExecute.mockResolvedValue([[], []]);
    expect(await getInboundTab(PID)).toBeNull();
  });
});
