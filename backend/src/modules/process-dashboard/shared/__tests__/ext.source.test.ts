import { describe, expect, it } from "vitest";
import { PdError } from "../../pd.source.js";
import { MAX_EXT_ROWS, buildExtSelect, parseSource, suggestExtMap, verifyExtMap, type ExtSource } from "../ext.source.js";
import { OUTBOUND_FIELDS, effectiveMap, guessConnected, parseOutboundInput, suggestConnected } from "../../outbound/outbound.config.js";
import { ROSTER_FIELDS, SALES_FIELDS, guessStatusClass, parseSalesInput, suggestPrepaid, suggestStatusMap } from "../../sales/sales.config.js";
import { isRealDay, pacing, topBottom } from "../ext.math.js";

const cols = [
  { name: "order_id", dataType: "varchar" }, { name: "order_date", dataType: "datetime" }, { name: "emp_code", dataType: "varchar" }, { name: "order_value", dataType: "decimal" },
  { name: "order_status", dataType: "varchar" }, { name: "payment_method", dataType: "varchar" }, { name: "customer_phone", dataType: "varchar" }, { name: "customer_email", dataType: "varchar" },
  { name: "product_name", dataType: "varchar" }, { name: "weird`col", dataType: "varchar" },
];

describe("verifyExtMap", () => {
  it("resolves spelling, flags missing/sensitive/incompatible/duplicate columns", () => {
    const v = verifyExtMap({ date: "ORDER_DATE", agent_code: "emp_code", amount: "order_value", status: "nope", payment_mode: "customer_phone", product: "order_date", lob: "emp_code" }, cols, SALES_FIELDS, null);
    expect(v.map).toMatchObject({ date: "order_date", agent_code: "emp_code", amount: "order_value" });
    const msgs = v.problems.map((p) => `${p.field}:${p.message}`).join("|");
    expect(msgs).toMatch(/status:Column "nope" does not exist/);
    expect(msgs).toMatch(/payment_mode:.*personal\/financial/);
    expect(msgs).toMatch(/product:.*needs a text column/);
    expect(msgs).toMatch(/lob:.*already mapped to agent_code/);
  });
  it("refuses personal-data columns even by exact name, and unknown fields", () => {
    const v = verifyExtMap({ date: "order_date", agent_code: "customer_email", customer_name: "order_id" }, cols, SALES_FIELDS, null);
    expect(v.problems.some((p) => /personal/.test(p.message))).toBe(true);
    expect(v.problems.some((p) => /Unknown field/.test(p.message))).toBe(true);
  });
  it("requires required fields and validates the filter column", () => {
    const v = verifyExtMap({ amount: "order_value" }, cols, SALES_FIELDS, { column: "product_name", value: "x" });
    expect(v.problems.filter((p) => /must be mapped/.test(p.message)).map((p) => p.field).sort()).toEqual(["agent_code", "date"]);
    expect(v.filterColumn).toBe("product_name");
    expect(verifyExtMap({}, cols, SALES_FIELDS, { column: "customer_phone", value: "x" }).problems.some((p) => p.field === "filter")).toBe(true);
    expect(verifyExtMap({}, cols, SALES_FIELDS, { column: "ghost", value: "x" }).filterColumn).toBeNull();
  });
  it("unsafe column characters are refused", () => {
    expect(verifyExtMap({ date: "order_date", agent_code: "weird`col" }, cols, SALES_FIELDS, null).problems.length).toBeGreaterThan(0);
  });
});

describe("suggestExtMap", () => {
  it("maps synonyms and never suggests a sensitive column", () => {
    const s = suggestExtMap(cols, SALES_FIELDS);
    expect(s.columnMap).toMatchObject({ date: "order_date", agent_code: "emp_code", order_id: "order_id", amount: "order_value", status: "order_status", payment_mode: "payment_method", product: "product_name" });
    expect(Object.values(s.columnMap)).not.toContain("customer_phone");
    expect(suggestExtMap([{ name: "target", dataType: "int" }, { name: "agent_id", dataType: "varchar" }], ROSTER_FIELDS).columnMap).toEqual({ agent_code: "agent_id", target: "target" });
  });
});

describe("buildExtSelect", () => {
  const src: ExtSource = { schema: "db_masmis", table: "orders_x", filter: { column: "brand", value: "a'; DROP TABLE x;--" } };
  const map = { date: "order_date", agent_code: "emp_code", amount: "order_value" };
  it("binds every value, quotes every identifier, limits, and derives the hour from DATETIME", () => {
    const { sql, params } = buildExtSelect(src, map, "brand", cols, { from: "2026-09-01", to: "2026-09-30", agentCode: "MAS1", limit: 100 });
    expect(sql).toMatch(/^SELECT \/\*\+ MAX_EXECUTION_TIME\(20000\) \*\//);
    expect(sql).toContain("FROM `db_masmis`.`orders_x`");
    expect(sql).toContain("HOUR(`order_date`) AS `hour`");
    expect(sql).toMatch(/LIMIT 100$/);
    expect(sql).not.toMatch(/DROP|MAS1|2026-09/);
    expect(params).toEqual(["2026-09-01", "2026-09-30", "MAS1", "a'; DROP TABLE x;--"]);
  });
  it("rejects bad schema, dates, limits and unmapped required fields", () => {
    expect(() => buildExtSelect({ ...src, schema: "mysql" }, map, null, cols, { limit: 1 })).toThrow(PdError);
    expect(() => buildExtSelect(src, map, null, cols, { from: "2026-9-1", limit: 1 })).toThrow(/YYYY-MM-DD/);
    expect(() => buildExtSelect(src, map, null, cols, { limit: MAX_EXT_ROWS + 2 })).toThrow(/limit/i);
    expect(() => buildExtSelect(src, { date: "order_date" }, null, cols, { limit: 1 })).toThrow(/must be mapped/);
    expect(() => buildExtSelect(src, { ...map, agent_code: "a`b" }, null, cols, { limit: 1 })).toThrow();
  });
  it("uses the call_time column for the hour when mapped", () => {
    const { sql } = buildExtSelect({ ...src, filter: null }, { ...map, call_time: "t" }, null, cols, { limit: 1 });
    expect(sql).toContain("HOUR(`t`) AS `hour`");
    expect(sql).not.toContain("HOUR(`order_date`)");
  });
});

describe("parseSource", () => {
  it("whitelists schema, refuses sensitive tables and bad filters", () => {
    expect(parseSource("db_masmis", "orders", { column: "brand", value: 5 }).filter).toEqual({ column: "brand", value: "5" });
    for (const [s, t] of [["mysql", "x"], ["db_masmis", "payroll_run"], ["db_masmis", "a.b"], ["db_masmis", "a;b"]]) expect(() => parseSource(s, t, null)).toThrow(PdError);
    expect(() => parseSource("db_masmis", "orders", { column: "a`b", value: "x" })).toThrow();
    expect(() => parseSource("db_masmis", "orders", { column: "a", value: "" })).toThrow(PdError);
  });
});

describe("parseSalesInput", () => {
  const ok = { ordersSchema: "db_masmis", ordersTable: "orders_x", columnMap: { date: "order_date", agent_code: "emp_code", status: "order_status", payment_mode: "payment_method" },
    statusMap: { delivered: ["Delivered"], rto: ["RTO"] }, prepaidValues: ["UPI"], enabled: true };
  it("accepts a valid draft with defaults", () => {
    const r = parseSalesInput(ok);
    expect(r.problems).toEqual([]);
    expect(r.draft).toMatchObject({ targetMetric: "net_revenue", refreshSeconds: 60, enabled: true, roster: null });
  });
  it("reports overlapping statuses, orphan maps, bad metric, bad roster", () => {
    const r = parseSalesInput({ ...ok, statusMap: { delivered: ["X"], rto: ["x "] }, columnMap: { date: "d" }, targetMetric: "bogus", rosterTable: "r", rosterSchema: "db_masmis", rosterColumnMap: { agent_code: "a" } });
    const m = r.problems.join("|");
    expect(m).toMatch(/both delivered and rto/);
    expect(m).toMatch(/Agent code must be mapped/);
    expect(m).toMatch(/Roster: Monthly target must be mapped/);
    expect(m).toMatch(/targetMetric/);
    expect(m).toMatch(/status values need the order status column/);
  });
  it("rejects unknown map fields (no free-form customer columns)", () => {
    expect(parseSalesInput({ ...ok, columnMap: { ...ok.columnMap, customer_name: "x" } }).problems.join()).toMatch(/unknown columnMap field/);
  });
});

describe("parseOutboundInput", () => {
  const ok = { cdrSchema: "db_masmis", cdrTable: "cdr_x", columnMap: { date: "d", agent_code: "a", disposition: "s" }, connectedDispositions: ["Connected"], uniqueLeadFlagColumn: "uq" };
  it("folds the flag column into the effective map", () => {
    const r = parseOutboundInput(ok);
    expect(r.problems).toEqual([]);
    expect(r.draft.uniqueLeadFlagColumn).toBe("uq");
    expect(effectiveMap(r.draft)).toMatchObject({ unique_lead_flag: "uq", date: "d" });
    expect(OUTBOUND_FIELDS.some((f) => f.key === "unique_lead_flag")).toBe(true);
  });
  it("needs at least one connected disposition and the required columns", () => {
    const r = parseOutboundInput({ ...ok, connectedDispositions: [], columnMap: { date: "d" } });
    expect(r.problems.join("|")).toMatch(/at least one disposition/);
    expect(r.problems.join("|")).toMatch(/Agent code must be mapped/);
  });
});

describe("value suggestions", () => {
  it("classifies statuses; undelivered is RTO-like, not delivered", () => {
    expect(guessStatusClass("Delivered")).toBe("delivered");
    expect(guessStatusClass("Undelivered")).toBe("rto");
    expect(guessStatusClass("RTO Initiated")).toBe("rto");
    expect(guessStatusClass("Cancelled by customer")).toBe("cancelled");
    expect(guessStatusClass("Out for delivery")).toBe("delivered"); // ambiguous on purpose; the admin confirms in the UI
    expect(guessStatusClass("Processing")).toBe("pending");
    expect(guessStatusClass("???")).toBeNull();
    expect(suggestStatusMap(["Delivered", "RTO", "Cancelled", "Pending", "zzz"])).toEqual({ delivered: ["Delivered"], rto: ["RTO"], cancelled: ["Cancelled"], pending: ["Pending"] });
  });
  it("prepaid vs COD", () => {
    expect(suggestPrepaid(["Prepaid", "COD", "UPI", "Cash on Delivery", "Credit Card", "Pay on Delivery"]).sort()).toEqual(["Credit Card", "Prepaid", "UPI"]);
  });
  it("connected dispositions", () => {
    expect(suggestConnected(["Connected", "Sale", "Interested", "Call Back", "No Answer", "Busy", "Switched Off", "Not Interested", "Voicemail", "Answered"]).sort())
      .toEqual(["Answered", "Call Back", "Connected", "Interested", "Not Interested", "Sale"]);
    expect(guessConnected("Not Reachable")).toBe(false);
  });
});

describe("math helpers", () => {
  it("isRealDay rejects impossible dates", () => {
    expect(isRealDay("2026-09-30")).toBe(true);
    for (const d of ["2026-02-31", "2026-13-01", "2026-9-1", "x", null, 5]) expect(isRealDay(d), String(d)).toBe(false);
  });
  it("pacing is null without a target and linear otherwise", () => {
    expect(pacing(0, 10, "2026-09-10")).toBeNull();
    expect(pacing(null, 10, "2026-09-10")).toBeNull();
    const p = pacing(3000, 1500, "2026-09-15")!;
    expect(p).toMatchObject({ attainmentPct: 50, expectedToDate: 1500, pacingPct: 100, projected: 3000, daysInMonth: 30, elapsedDays: 15 });
  });
  it("topBottom excludes nulls and never overlaps", () => {
    const r = topBottom([{ v: 1 }, { v: null }, { v: 3 }, { v: 2 }], (x) => x.v, 2);
    expect(r.top.map((x) => x.v)).toEqual([3, 2]);
    expect(r.bottom.map((x) => x.v)).toEqual([1]);
  });
});
