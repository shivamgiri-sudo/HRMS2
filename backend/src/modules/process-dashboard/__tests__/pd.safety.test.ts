import { describe, expect, it, vi } from "vitest";
import { db } from "../../../db/mysql.js";
import { ALLOWED_SCHEMAS } from "../pd.fields.js";
import { PdError, assertSourceName, buildSelectSql, quoteIdent, verifyColumnMap, withReadOnly } from "../pd.source.js";
import { csvCell } from "../pd.live.js";
import { TtlCache } from "../pd.cache.js";
import { ensureProcessDashboardConfig, parseConfigShape, validateConfigShape } from "../pd.config.service.js";

const cols = [
  { name: "emp_id", dataType: "varchar" }, { name: "report_date", dataType: "date" }, { name: "calls", dataType: "int" }, { name: "Notes", dataType: "text" },
  { name: "mobile_no", dataType: "varchar" }, { name: "bad col", dataType: "int" }, { name: "process_id", dataType: "char" },
];
const good = { category: "sales", aprSchema: "db_masmis", aprTable: "t1", columnMap: { agent_code: "emp_id", date: "report_date", calls: "calls" } };

describe("schema / identifier whitelist", () => {
  it("only db_masmis and mas_hrms", () => {
    expect([...ALLOWED_SCHEMAS]).toEqual(["db_masmis", "mas_hrms"]);
    expect(assertSourceName("db_masmis", "x_apr")).toEqual({ schema: "db_masmis", table: "x_apr" });
    for (const s of ["information_schema", "mysql", "performance_schema", "sys", "db_bill", "MAS_HRMS ", "mas_hrms.x", ""]) expect(() => assertSourceName(s, "t"), s).toThrow(PdError);
  });
  it("rejects injection-shaped and dotted identifiers", () => {
    for (const t of ["a;b", "a`b", "a b", "a.b", "a--", "1; DROP TABLE x", "a'b", "a\nb", ""]) expect(() => assertSourceName("db_masmis", t), t).toThrow(PdError);
    for (const c of ["a`b", "a.b", "x y", ""]) expect(() => quoteIdent(c), c).toThrow();
    expect(quoteIdent("calls_chats")).toBe("`calls_chats`");
  });
  it("refuses credential / payroll tables", () => {
    for (const t of ["payroll_run", "user_password_reset", "auth_token", "employee_bank_details", "salary_slip"]) expect(() => assertSourceName("mas_hrms", t), t).toThrow(/cannot be used/);
  });
});

describe("verifyColumnMap (names resolved through information_schema)", () => {
  it("accepts real columns case-insensitively and returns the real spelling", () => {
    const v = verifyColumnMap({ agent_code: "EMP_ID", date: "Report_Date", calls: "CALLS" }, cols, null);
    expect(v.problems).toEqual([]); expect(v.map).toEqual({ agent_code: "emp_id", date: "report_date", calls: "calls" });
  });
  it("rejects unknown, sensitive, type-incompatible, unsafe, duplicate columns and unknown fields", () => {
    const v = verifyColumnMap({ agent_code: "nope", date: "emp_id", calls: "mobile_no", talk_sec: "bad col", wait_sec: "calls", dispo_sec: "calls", evil: "calls" }, cols, { column: "missing", value: 1 });
    const by = Object.fromEntries(v.problems.map((p) => [p.field, p.message]));
    expect(by.agent_code).toMatch(/does not exist/); expect(by.date).toMatch(/DATE/); expect(by.calls).toMatch(/personal/); expect(by.talk_sec).toMatch(/not supported/);
    expect(by.dispo_sec).toMatch(/already mapped/); expect(by.evil).toMatch(/Unknown canonical/); expect(by.process_filter).toMatch(/does not exist/);
  });
});

describe("buildSelectSql", () => {
  const map = { agent_code: "emp_id", date: "report_date", calls: "calls" };
  it("quotes names, binds values, always LIMITs", () => {
    const { sql, params } = buildSelectSql({ aprSchema: "db_masmis", aprTable: "t1" }, map, "process_id", { column: "process_id", value: "x'; DROP TABLE t1;--" }, { from: "2026-09-01", to: "2026-09-30", agentCode: "A1' OR '1'='1", limit: 100 });
    expect(sql).toContain("FROM `db_masmis`.`t1`"); expect(sql).toMatch(/LIMIT 100$/); expect(sql).not.toContain("DROP"); expect(sql).not.toContain("A1");
    expect(params).toEqual(["2026-09-01", "2026-09-30", "A1' OR '1'='1", "x'; DROP TABLE t1;--"]);
    expect(sql).toMatch(/^SELECT \/\*\+ MAX_EXECUTION_TIME/);
  });
  it("refuses bad dates, bad limits, missing required mapping, bad schema", () => {
    const b = (o: object, m = map, s = "db_masmis") => () => buildSelectSql({ aprSchema: s, aprTable: "t1" }, m, null, null, { limit: 10, ...o });
    expect(b({ from: "2026-9-1" })).toThrow(/YYYY-MM-DD/); expect(b({ to: "x'" })).toThrow(); expect(b({ limit: 0 })).toThrow(); expect(b({ limit: 10_000_000 })).toThrow();
    expect(b({}, { calls: "calls" } as never)).toThrow(/mapped/); expect(b({}, map, "mysql")).toThrow(PdError);
  });
  it("is SELECT-only", () => {
    const { sql } = buildSelectSql({ aprSchema: "mas_hrms", aprTable: "t1" }, map, null, null, { limit: 5 });
    expect(sql).toMatch(/^SELECT /); expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
  });
});

describe("withReadOnly", () => {
  it("opens START TRANSACTION READ ONLY first, always rolls back and releases", async () => {
    const conn = await db.getConnection();
    const q = conn.query as ReturnType<typeof vi.fn>; q.mockClear();
    await expect(withReadOnly(async (c) => { await c.query("SELECT 1"); throw new Error("boom"); })).rejects.toThrow("boom");
    const stmts = q.mock.calls.map((c) => String(c[0]));
    expect(stmts.indexOf("START TRANSACTION READ ONLY")).toBeGreaterThanOrEqual(0);
    expect(stmts.indexOf("START TRANSACTION READ ONLY")).toBeLessThan(stmts.indexOf("SELECT 1"));
    expect(stmts[stmts.length - 1]).toBe("ROLLBACK");
    expect(conn.release as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });
});

describe("config validation", () => {
  it("accepts a good config", () => { const d = validateConfigShape(good); expect(d.refreshSeconds).toBe(60); expect(d.timeUnit).toBe("sec"); expect(d.enabled).toBe(false); });
  it("collects every problem", () => {
    const { problems } = parseConfigShape({ category: "bogus", aprSchema: "mysql", aprTable: "a b", columnMap: { date: "d", zzz: "c" }, timeUnit: "min", refreshSeconds: 2, processFilter: { column: "x`", value: {} } });
    const all = problems.join(" | ");
    for (const s of [/category must be/, /Schema must be/, /unknown canonical field "zzz"/, /required field agent_code/, /timeUnit must be/, /refreshSeconds/, /processFilter/]) expect(all).toMatch(s);
  });
  it("cannot enable an unconfigured category; blank mapping = unmapped", () => {
    expect(() => validateConfigShape({ ...good, category: "unconfigured", enabled: true })).toThrow(/choose a category/);
    expect(validateConfigShape({ ...good, columnMap: { ...good.columnMap, calls: "  " } }).columnMap.calls).toBeUndefined();
  });
  it("refuses dotted / over-long / injected column names", () => {
    expect(() => validateConfigShape({ ...good, columnMap: { ...good.columnMap, calls: "a.b" } })).toThrow();
    expect(() => validateConfigShape({ ...good, columnMap: { ...good.columnMap, calls: "x`;--" } })).toThrow();
  });
});

describe("ensureProcessDashboardConfig", () => {
  it("never throws into the cost-centre flow", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("table missing"));
    await expect(ensureProcessDashboardConfig("11111111-1111-1111-1111-111111111111")).resolves.toBe(false);
    await expect(ensureProcessDashboardConfig(null)).resolves.toBe(false);
  });
});

describe("csv + cache", () => {
  it("csvCell quotes and neutralises formulas but leaves numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)"); expect(csvCell("+1")).toBe("'+1"); expect(csvCell(-3.5)).toBe("-3.5"); expect(csvCell(null)).toBe("");
    expect(csvCell("a,b")).toBe('"a,b"'); expect(csvCell(NaN)).toBe("");
  });
  it("TtlCache expires, evicts, dedups and invalidates by prefix", async () => {
    vi.useFakeTimers();
    const c = new TtlCache(1000, 2);
    c.set("p1|a", 1); c.set("p1|b", 2); c.set("p2|c", 3);
    expect(c.size).toBe(2); expect(c.get("p1|a")).toBeUndefined();
    c.invalidate("p2|"); expect(c.get("p2|c")).toBeUndefined();
    c.set("k", 1); vi.advanceTimersByTime(1500); expect(c.get("k")).toBeUndefined();
    vi.useRealTimers();
    let n = 0; const load = async () => { n++; return 7; };
    await Promise.all([c.wrap("z", load), c.wrap("z", load)]); expect(n).toBe(1);
  });
});
