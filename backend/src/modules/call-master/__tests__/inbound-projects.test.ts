import { beforeEach, describe, expect, it, vi } from "vitest";

const dbExecute = vi.hoisted(() => vi.fn());
const dialerQueryFn = vi.hoisted(() => vi.fn());
const dialerExecute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../db/dialerDb.js", () => ({
  getDialerPool: async () => ({
    getConnection: async () => ({ query: dialerQueryFn, release: () => undefined }),
    execute: dialerExecute,
  }),
}));

import {
  STATIC_PROJECTS, SAFE_DIALER_TABLE_RE, __resetInboundProjectsForTest, getInboundProject, getInboundProjects, invalidateInboundProjects,
  mergeInboundProjects, parseInboundInput, projectKeyFromCode, type InboundConfigRow,
} from "../inbound-projects.js";
import { PROJECTS } from "../inbound.service.js";

/** Frozen copy of the hard-coded list as it was before the loader existed (origin/main inbound.service.ts). Must never drift silently. */
const FROZEN: Array<[string, string, "A" | "B", string[], number, number, boolean, number | undefined]> = [
  ["gnc", "cdr_in_4", "A", ["GNC_Order_Related", "GNC_Product_Quality", "GNC_Other_Queries", "GNC_Product_Info", "GNC_Offer_Order", "GNC_Authentication"], 8, 6, false, undefined],
  ["bellavita", "cdr_in_11_5", "A", ["H_Bellavita_Luxury", "E_Bellavita_Organic", "E_Bellavita_Luxury", "H_Bellavita_Organic", "H_Bevzilla_Complaint", "H_Bevzilla_CC_Agent", "E_Bevzilla_CC_Agent", "H_Bevzilla_Order", "E_Bevzilla_Order", "E_Bevzilla_Complaint", "E_Emb_Existing_Order", "H_Bevzilla_Product", "H_Emb_New_Order", "H_Emb_Existing_Order", "E_Bevzilla_Product", "E_Emb_New_Order",
    // Kenaz/Guzz campaigns added deliberately (tausif-mis 7d02a4ee4): live volume that was never queried.
    "H_Ken_Existing_Order", "E_Ken_Existing_Order", "H_Kenaz_New_Order", "E_Kenaz_New_Order",
    "E_Guzz_New_Order", "E_Guz_Existing_Order", "H_Guz_Existing_Order", "H_Guzz_New_Order"], 14, 12, false, undefined],
  ["clovia", "cdr_in_250", "A", ["Clovia_English", "Clovia_Hindi"], 7, 6, false, undefined],
  ["neemans", "cdr_in_249", "B", ["Neemans_IB"], 10, 10, true, 475],
  ["viega", "cdr_in_249", "B", ["Viega"], 2, 2, false, undefined],
  ["exicom", "cdr_in_9", "B", ["Exicom_TC_Battery", "Exicom_EV_Battery", "EV_Charger833"], 5, 5, false, undefined],
  ["dubangladesh", "cdr_in_4", "B", ["DU_Bangladesh_Bangla", "DU_Bangladesh_Eng", "DU_Bangladesh_Hindi"], 3, 3, false, undefined],
  ["dalmia", "cdr_in_249", "B", ["Dalmia_Hindi", "Dalmia_English", "Dalmia_Kannada", "Dalmia_Tamil", "Dalmia_Bengoli", "Dalmia_Malayalam", "Dalmia_Odiya", "Dalmia_Marathi", "Dalmia_Telugu", "Dalmia_Assamese"], 9, 9, false, undefined],
];

const row = (o: Partial<InboundConfigRow> = {}): InboundConfigRow => ({
  processId: "11111111-1111-1111-1111-111111111111", projectKey: "acme", dialerTable: "cdr_in_77", pattern: "B", campaigns: ["Acme_EN", "Acme_HI"],
  mandate: 5, required: 4, hasFcr: 0, fcrClientId: null, slSeconds: null, enabled: 1, processName: "Acme Support", ...o,
});

describe("static inbound list regression (existing dashboards must not change)", () => {
  it("STATIC_PROJECTS equals the pre-loader hard-coded list", () => {
    expect(STATIC_PROJECTS.map((p) => [p.key, p.table, p.pattern, p.campaigns, p.mandate, p.required, p.hasFCR, p.fcrClientId])).toEqual(FROZEN);
  });
  it("inbound.service PROJECTS is that same list", () => { expect(PROJECTS).toBe(STATIC_PROJECTS); });
  it("every static table name passes the safe-name rule", () => { for (const p of STATIC_PROJECTS) expect(SAFE_DIALER_TABLE_RE.test(p.table), p.table).toBe(true); });
  it("merge with no DB rows returns the static entries untouched (plus source=static)", () => {
    const m = mergeInboundProjects(STATIC_PROJECTS, [], null);
    expect(m.map(({ source: _s, processId: _p, ...rest }) => rest)).toEqual(STATIC_PROJECTS);
    expect(m.every((p) => p.source === "static")).toBe(true);
  });
  it("ops and insights names/icons/colors are the static ones", () => {
    expect(STATIC_PROJECTS.find((p) => p.key === "gnc")).toMatchObject({ name: "GNC", color: "#2E86C1", clientId: "409" });
    expect(STATIC_PROJECTS.find((p) => p.key === "dalmia")?.clientId).toBeUndefined();
  });
});

describe("mergeInboundProjects", () => {
  const tables = new Set(["cdr_in_77", "cdr_in_4", "cdr_in_249"]);
  it("adds a DB-only project after the static ones", () => {
    const m = mergeInboundProjects(STATIC_PROJECTS, [row()], tables);
    expect(m).toHaveLength(STATIC_PROJECTS.length + 1);
    expect(m.at(-1)).toMatchObject({ key: "acme", name: "Acme Support", table: "cdr_in_77", pattern: "B", source: "db", campaigns: ["Acme_EN", "Acme_HI"], mandate: 5, required: 4, hasFCR: false });
  });
  it("DB wins over a static entry of the same key, keeping name/icon/color", () => {
    const m = mergeInboundProjects(STATIC_PROJECTS, [row({ projectKey: "gnc", dialerTable: "cdr_in_77", campaigns: ["X"], mandate: 99, slSeconds: 45 })], tables);
    const g = m.find((p) => p.key === "gnc")!;
    expect(g).toMatchObject({ name: "GNC", color: "#2E86C1", table: "cdr_in_77", campaigns: ["X"], mandate: 99, slSeconds: 45, source: "db" });
    expect(m.indexOf(g)).toBe(0);
  });
  it("a disabled row is ignored (static keeps serving)", () => {
    const m = mergeInboundProjects(STATIC_PROJECTS, [row({ projectKey: "gnc", enabled: 0, campaigns: ["X"] })], tables);
    expect(m.find((p) => p.key === "gnc")).toMatchObject({ source: "static", campaigns: STATIC_PROJECTS[0].campaigns });
    expect(mergeInboundProjects(STATIC_PROJECTS, [row({ enabled: 0 })], tables)).toHaveLength(STATIC_PROJECTS.length);
  });
  it.each([
    "cdr_in_4; DROP TABLE x", "cdr_in_4 ", "cdr_in_4`", "cdr_in_", "CDR_IN_4", "mysql.user", "cdr_in_4.x", "dialer_db.cdr_in_4", "cdr_in_4 OR 1=1", "cdr_in_4\n", "../cdr_in_4", "cdr_in_4--", "cdr_in_a", "data_master_in", "",
  ])("rejects malicious/odd table name %j", (t) => {
    const skipped: string[] = [];
    const m = mergeInboundProjects(STATIC_PROJECTS, [row({ dialerTable: t })], new Set([t, "cdr_in_77"]), (_r, why) => skipped.push(why));
    expect(m).toHaveLength(STATIC_PROJECTS.length);
    expect(skipped).toHaveLength(1);
  });
  it("rejects a well-formed table the dialer does not have", () => {
    const skipped: string[] = [];
    const m = mergeInboundProjects(STATIC_PROJECTS, [row({ dialerTable: "cdr_in_9999" })], tables, (_r, why) => skipped.push(why));
    expect(m).toHaveLength(STATIC_PROJECTS.length);
    expect(skipped[0]).toMatch(/does not exist/);
  });
  it("cannot verify (dialer unreachable): DB-only rejected, but a row on the static entry's own table is kept", () => {
    expect(mergeInboundProjects(STATIC_PROJECTS, [row()], null)).toHaveLength(STATIC_PROJECTS.length);
    const same = mergeInboundProjects(STATIC_PROJECTS, [row({ projectKey: "gnc", dialerTable: "cdr_in_4", campaigns: ["GNC_Order_Related"] })], null);
    expect(same.find((p) => p.key === "gnc")).toMatchObject({ source: "db", campaigns: ["GNC_Order_Related"] });
    const moved = mergeInboundProjects(STATIC_PROJECTS, [row({ projectKey: "gnc", dialerTable: "cdr_in_77" })], null);
    expect(moved.find((p) => p.key === "gnc")?.source).toBe("static");
  });
  it("rejects unsafe keys, duplicate keys, bad campaigns and bad pattern", () => {
    const bad = [row({ projectKey: "a b" }), row({ projectKey: "X" }), row({ campaigns: "not json" }), row({ campaigns: [] }), row({ campaigns: [1] }), row({ pattern: "C" }), row({ slSeconds: -3 })];
    expect(mergeInboundProjects(STATIC_PROJECTS, bad, tables)).toHaveLength(STATIC_PROJECTS.length);
    const dup = mergeInboundProjects(STATIC_PROJECTS, [row(), row({ processId: "22222222-2222-2222-2222-222222222222" })], tables);
    expect(dup.filter((p) => p.key === "acme")).toHaveLength(1);
  });
  it("accepts campaigns delivered as a JSON string (mysql2 without JSON parsing)", () => {
    const m = mergeInboundProjects(STATIC_PROJECTS, [row({ campaigns: JSON.stringify(["A1", "A2"]) })], tables);
    expect(m.at(-1)?.campaigns).toEqual(["A1", "A2"]);
  });
});

describe("parseInboundInput", () => {
  const ok = { dialerTable: "cdr_in_12", pattern: "A", campaigns: [" C1 ", "C1", "C2"], mandate: "8", required: 6 };
  it("normalises a good payload", () => {
    const { draft, problems } = parseInboundInput(ok);
    expect(problems).toEqual([]);
    expect(draft).toMatchObject({ dialerTable: "cdr_in_12", pattern: "A", campaigns: ["C1", "C2"], mandate: 8, required: 6, hasFcr: false, enabled: true, slSeconds: null });
  });
  it("collects every problem", () => {
    const { problems } = parseInboundInput({ dialerTable: "x; drop", pattern: "Z", campaigns: [], mandate: -1, hasFcr: true, slSeconds: 99999 });
    expect(problems.join("|")).toMatch(/dialerTable/); expect(problems.join("|")).toMatch(/pattern/); expect(problems.join("|")).toMatch(/campaign/);
    expect(problems.join("|")).toMatch(/mandate/); expect(problems.join("|")).toMatch(/fcrClientId/); expect(problems.join("|")).toMatch(/slSeconds/);
  });
  it("limits campaign count and length", () => {
    expect(parseInboundInput({ ...ok, campaigns: Array.from({ length: 201 }, (_, i) => `c${i}`) }).problems.join()).toMatch(/too many/);
    expect(parseInboundInput({ ...ok, campaigns: ["x".repeat(101)] }).problems.join()).toMatch(/too long/);
  });
  it("derives a safe project key from a process code", () => {
    expect(projectKeyFromCode("ACME-Support_2", "id")).toBe("acmesupport2");
    expect(projectKeyFromCode("---", "AB-CD-12")).toBe("pabcd12");
  });
});

describe("getInboundProjects loader", () => {
  beforeEach(() => { __resetInboundProjectsForTest(); dbExecute.mockReset(); dialerQueryFn.mockReset(); });
  const dialerHas = (...t: string[]) => dialerQueryFn.mockImplementation(async (sql: string) => {
    if (/information_schema/.test(sql)) return [t.map((x) => ({ table_name: x })), []];
    return [[], []];
  });

  it("serves the static list when process_inbound_config cannot be read (migration not run)", async () => {
    dbExecute.mockRejectedValue(Object.assign(new Error("no table"), { code: "ER_NO_SUCH_TABLE" }));
    const list = await getInboundProjects();
    expect(list.map((p) => p.key)).toEqual(STATIC_PROJECTS.map((p) => p.key));
    expect(dialerQueryFn).not.toHaveBeenCalled();
  });
  it("merges a verified DB row, caches it, and invalidate() reloads", async () => {
    dbExecute.mockResolvedValue([[{ process_id: "p1", project_key: "acme", dialer_table: "cdr_in_77", pattern: "B", campaigns: ["A"], mandate: 1, required: 1, has_fcr: 0, fcr_client_id: null, sl_seconds: 25, enabled: 1, process_name: "Acme" }], []]);
    dialerHas("cdr_in_77");
    expect((await getInboundProject("acme"))).toMatchObject({ table: "cdr_in_77", slSeconds: 25, source: "db", processId: "p1" });
    await getInboundProjects();
    expect(dbExecute).toHaveBeenCalledTimes(1);
    invalidateInboundProjects();
    await getInboundProjects();
    expect(dbExecute).toHaveBeenCalledTimes(2);
  });
  it("drops a DB row whose table is not in the dialer's information_schema", async () => {
    dbExecute.mockResolvedValue([[{ process_id: "p1", project_key: "acme", dialer_table: "cdr_in_77", pattern: "B", campaigns: ["A"], mandate: 1, required: 1, has_fcr: 0, fcr_client_id: null, sl_seconds: null, enabled: 1, process_name: "Acme" }], []]);
    dialerHas("cdr_in_4");
    expect(await getInboundProject("acme")).toBeUndefined();
    expect((await getInboundProjects()).length).toBe(STATIC_PROJECTS.length);
  });
  it("includeDbOnly=false hides DB-only projects but keeps static ones (with overrides)", async () => {
    dbExecute.mockResolvedValue([[
      { process_id: "p1", project_key: "acme", dialer_table: "cdr_in_77", pattern: "B", campaigns: ["A"], mandate: 1, required: 1, has_fcr: 0, fcr_client_id: null, sl_seconds: null, enabled: 1, process_name: "Acme" },
      { process_id: "p2", project_key: "gnc", dialer_table: "cdr_in_77", pattern: "A", campaigns: ["Z"], mandate: 1, required: 1, has_fcr: 0, fcr_client_id: null, sl_seconds: null, enabled: 1, process_name: "GNC" },
    ], []]);
    dialerHas("cdr_in_77");
    const list = await getInboundProjects({ includeDbOnly: false });
    expect(list.map((p) => p.key)).toEqual(STATIC_PROJECTS.map((p) => p.key));
    expect(list.find((p) => p.key === "gnc")?.campaigns).toEqual(["Z"]);
  });
  it("rejects a non-safe key lookup without touching the DB", async () => {
    expect(await getInboundProject("gnc; DROP")).toBeUndefined();
    expect(dbExecute).not.toHaveBeenCalled();
  });
});
