import { describe, expect, it } from "vitest";
import { agentRows, classifyStatus, computeKpis, dailyTrend, funnel, groupBy, normalizeOrders, rankAgents, teamPacing, type Caps, type StatusMap } from "../sales.metrics.js";

const caps: Caps = { amount: true, status: true, payment: true, product: true, lob: true, tl: true, orderId: true };
const sm: StatusMap = { delivered: ["Delivered"], rto: ["RTO", "Returned"], cancelled: ["Cancelled"], pending: ["Pending", "Confirmed"] };
const raw = (o: Record<string, unknown>) => ({ date: "2026-09-02", agent_code: "a1", order_id: "x", amount: "100", status: "Delivered", payment_mode: "Prepaid", product: "P", lob: "L", tl_name: "T", ...o });
const mk = (rows: Array<Record<string, unknown>>) => normalizeOrders(rows, sm, ["prepaid", "UPI"], caps);

describe("classifyStatus", () => {
  it("is case/space-insensitive and sends unknown and blank to other", () => {
    expect(classifyStatus(" returned ", sm)).toBe("rto");
    expect(classifyStatus("shipped", sm)).toBe("other");
    expect(classifyStatus(null, sm)).toBe("other");
  });
});

describe("normalizeOrders", () => {
  it("drops repeated order ids, counts bad amounts and lists unmapped statuses", () => {
    const n = mk([raw({ order_id: "1" }), raw({ order_id: "1" }), raw({ order_id: "2", amount: "abc", status: "Shipped" }), raw({ order_id: "3", agent_code: "" })]);
    expect(n.rows).toHaveLength(2);
    expect(n.duplicateOrders).toBe(1);
    expect(n.badAmounts).toBe(1);
    expect(n.unmappedStatuses).toEqual([{ value: "Shipped", orders: 1 }]);
    expect(n.rows[0].agent).toBe("A1");
  });
  it("prepaid is null without a payment mode", () => {
    expect(mk([raw({ payment_mode: "" })]).rows[0].prepaid).toBeNull();
    expect(mk([raw({ payment_mode: "COD" })]).rows[0].prepaid).toBe(false);
  });
});

describe("computeKpis", () => {
  const rows = mk([
    raw({ order_id: "1", amount: "100", status: "Delivered", payment_mode: "Prepaid" }),
    raw({ order_id: "2", amount: "200", status: "RTO", payment_mode: "COD" }),
    raw({ order_id: "3", amount: "300", status: "Cancelled", payment_mode: "UPI" }),
    raw({ order_id: "4", amount: "400", status: "Pending", payment_mode: "COD" }),
  ]).rows;
  it("computes revenue, AOV and status shares", () => {
    const k = computeKpis(rows, caps, 40);
    expect(k.orders).toBe(4);
    expect(k.grossRevenue).toBe(1000);
    expect(k.netRevenue).toBe(500);
    expect(k.netOrders).toBe(2);
    expect(k.aov).toBe(250);
    expect(k.prepaidPct).toBe(50);
    expect(k.rtoPct).toBe(25);
    expect(k.cancellationPct).toBe(25);
    expect(k.deliveredPct).toBe(25);
    expect(k.pendingPct).toBe(25);
    expect(k.conversionPct).toBe(10);
  });
  it("zero denominators are null, not 0", () => {
    const k = computeKpis([], caps, 0);
    expect(k.orders).toBe(0);
    expect(k.aov).toBeNull();
    expect(k.rtoPct).toBeNull();
    expect(k.prepaidPct).toBeNull();
    expect(k.conversionPct).toBeNull();
    expect(k.grossRevenue).toBe(0);
  });
  it("unmapped columns give null rather than zero", () => {
    const c2: Caps = { ...caps, amount: false, status: false, payment: false };
    const k = computeKpis(rows, c2);
    expect(k.grossRevenue).toBeNull();
    expect(k.aov).toBeNull();
    expect(k.rtoPct).toBeNull();
    expect(k.prepaidPct).toBeNull();
    expect(k.netOrders).toBe(4);
  });
  it("no calls -> conversion null", () => { expect(computeKpis(rows, caps, null).conversionPct).toBeNull(); });
  it("funnel shares add to 100", () => {
    const f = funnel(rows, caps);
    expect(f.find((s) => s.status === "rto")).toMatchObject({ orders: 1, revenue: 200, pct: 25 });
    expect(f.reduce((a, s) => a + (s.pct ?? 0), 0)).toBe(100);
  });
  it("funnel empty when status not mapped", () => { expect(funnel(rows, { ...caps, status: false })).toEqual([]); });
});

describe("trend, groups, agents, pacing", () => {
  const rows = mk([
    raw({ order_id: "1", date: "2026-09-01", agent_code: "A1", amount: "100", tl_name: "T1", product: "X" }),
    raw({ order_id: "2", date: "2026-09-01", agent_code: "A2", amount: "50", tl_name: "T2", product: "Y", status: "RTO" }),
    raw({ order_id: "3", date: "2026-09-03", agent_code: "A1", amount: "300", tl_name: "T1", product: "X" }),
  ]).rows;
  it("daily trend sorted", () => {
    const d = dailyTrend(rows, caps);
    expect(d.map((x) => x.date)).toEqual(["2026-09-01", "2026-09-03"]);
    expect(d[0].orders).toBe(2);
    expect(d[0].netRevenue).toBe(100);
  });
  it("groups by key with Unassigned fallback", () => {
    const g = groupBy(rows, caps, (r) => r.product);
    expect(g[0]).toMatchObject({ key: "X", orders: 2, netRevenue: 400 });
    expect(groupBy([{ ...rows[0], product: null }], caps, (r) => r.product)[0].key).toBe("Unassigned");
  });
  it("agent rows include roster-only agents and target attainment/pacing", () => {
    const roster = [{ agent: "A1", tl: "T1", target: 800 }, { agent: "A2", tl: null, target: 0 }, { agent: "A9", tl: "T9", target: 500 }];
    const a = agentRows(rows, rows, roster, caps, "net_revenue", "2026-09-10");
    const a1 = a.find((r) => r.agent === "A1")!;
    expect(a1.achieved).toBe(400);
    expect(a1.attainmentPct).toBe(50);
    expect(a1.pacingPct).toBe(150); // expected 800*10/30 = 266.67
    expect(a1.projectedAttainmentPct).toBe(150);
    const a9 = a.find((r) => r.agent === "A9")!;
    expect(a9.orders).toBe(0);
    expect(a9.attainmentPct).toBe(0);
    expect(a9.tl).toBe("T9");
    expect(a.find((r) => r.agent === "A2")!.attainmentPct).toBeNull(); // zero target => null
  });
  it("team pacing sums targets of agents with a target", () => {
    const p = teamPacing(rows, [{ agent: "A1", tl: null, target: 600 }, { agent: "A2", tl: null, target: 600 }], caps, "net_revenue", "2026-09-15")!;
    expect(p.target).toBe(1200);
    expect(p.achieved).toBe(400);
    expect(p.expectedToDate).toBe(600);
    expect(p.pacingPct).toBe(66.67);
    expect(teamPacing(rows, [], caps, "orders", "2026-09-15")).toBeNull();
  });
  it("ranking splits top and bottom without overlap", () => {
    const r = rankAgents(agentRows(rows, rows, [], caps, "orders", "2026-09-10"), 5);
    expect(r.top.map((x) => x.agent)).toEqual(["A1", "A2"]);
    expect(r.bottom).toEqual([]);
  });
});
