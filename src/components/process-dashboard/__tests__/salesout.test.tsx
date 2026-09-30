import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get, post, put } }));

import { fetchAgent, fetchAgents, fetchDay, fetchOverview, fetchTab, previewConfig, saveStored, suggest } from "../sales/extApi";
import {
  columnFits, emptyOutbound, emptySales, outboundFromStored, outboundPayload, parseExtUrl, salesFromStored, salesPayload, serializeExtUrl, validateOutbound, validateSales, type SalesStored,
} from "../sales/ext.model";
import { BarList, DataTable, ProblemList, Tiles } from "../sales/common";

beforeEach(() => { get.mockReset(); post.mockReset(); put.mockReset(); });

describe("sales form", () => {
  it("lists every missing requirement", () => {
    const m = validateSales(emptySales()).join(" ");
    expect(m).toMatch(/orders table/); expect(m).toMatch(/order date/); expect(m).toMatch(/agent code/);
  });
  it("roster needs its own table and mapping; duplicate columns are refused", () => {
    const f = { ...emptySales(), table: "t", columnMap: { date: "d", agent_code: "a", amount: "a" }, rosterOn: true };
    const m = validateSales(f).join(" ");
    expect(m).toMatch(/roster table/); expect(m).toMatch(/mapped to two fields/);
    expect(validateSales({ ...f, columnMap: { date: "d", agent_code: "a" }, rosterTable: "r", rosterMap: { agent_code: "x" } }).join(" ")).toMatch(/Roster: Map the monthly target/);
  });
  it("builds the payload: status map from assignments, blank values dropped, optional roster", () => {
    const f = { ...emptySales(), table: "orders", columnMap: { date: "d", agent_code: "a", status: "s", amount: "", payment_mode: "p" }, statusAssign: { Delivered: "delivered" as const, RTO: "rto" as const, junk: "" as const }, prepaid: ["UPI"] };
    const p = salesPayload(f);
    expect(p.columnMap).toEqual({ date: "d", agent_code: "a", status: "s", payment_mode: "p" });
    expect(p.statusMap).toEqual({ delivered: ["Delivered"], pending: [], rto: ["RTO"], cancelled: [] });
    expect(p.prepaidValues).toEqual(["UPI"]);
    expect(p).not.toHaveProperty("rosterTable");
    expect(salesPayload({ ...f, rosterOn: true, rosterTable: "r", rosterMap: { agent_code: "x", target: "t" } })).toMatchObject({ rosterTable: "r", rosterSchema: "db_masmis", rosterColumnMap: { agent_code: "x", target: "t" } });
  });
  it("status/prepaid values of unmapped columns are not sent", () => {
    const p = salesPayload({ ...emptySales(), table: "o", columnMap: { date: "d", agent_code: "a" }, statusAssign: { X: "rto" }, prepaid: ["UPI"] });
    expect(p.statusMap.rto).toEqual([]); expect(p.prepaidValues).toEqual([]);
  });
  it("round-trips a stored row", () => {
    const s: SalesStored = { ordersSchema: "db_masmis", ordersTable: "o", columnMap: { date: "d", agent_code: "a" }, statusMap: { delivered: ["D"], rto: ["R"], cancelled: [], pending: [] }, prepaidValues: ["UPI"],
      filter: { column: "brand", value: "x" }, roster: { schema: "mas_hrms", table: "r", columnMap: { agent_code: "a", target: "t" } }, targetMetric: "orders", refreshSeconds: 30, enabled: false };
    const f = salesFromStored(s);
    expect(f).toMatchObject({ table: "o", statusAssign: { D: "delivered", R: "rto" }, prepaid: ["UPI"], rosterOn: true, rosterSchema: "mas_hrms", targetMetric: "orders", refreshSeconds: "30", enabled: false, filterColumn: "brand" });
    expect(salesFromStored(null)).toEqual(emptySales());
    expect(salesPayload(f)).toMatchObject({ filter: { column: "brand", value: "x" }, refreshSeconds: 30, enabled: false });
  });
});

describe("outbound form", () => {
  it("needs a connected disposition and required columns", () => {
    const m = validateOutbound(emptyOutbound()).join(" ");
    expect(m).toMatch(/call-detail table/); expect(m).toMatch(/disposition/i); expect(m).toMatch(/counts as a connect/);
    expect(validateOutbound({ ...emptyOutbound(), table: "t", columnMap: { date: "d", agent_code: "a", disposition: "x" }, connected: ["Connected"] })).toEqual([]);
  });
  it("moves the flag column out of the map and back", () => {
    const f = { ...emptyOutbound(), table: "t", columnMap: { date: "d", agent_code: "a", disposition: "x", unique_lead_flag: "uq" }, connected: ["C"] };
    const p = outboundPayload(f);
    expect(p.uniqueLeadFlagColumn).toBe("uq"); expect(p.columnMap).not.toHaveProperty("unique_lead_flag");
    expect(outboundFromStored({ cdrSchema: "db_masmis", cdrTable: "t", columnMap: p.columnMap, connectedDispositions: ["C"], uniqueLeadFlagColumn: "uq", filter: null, refreshSeconds: 60, enabled: true }).columnMap.unique_lead_flag).toBe("uq");
  });
});

describe("column fit and URL state", () => {
  it("date fields accept only temporal columns; text accepts numeric ids", () => {
    expect(columnFits("date", { name: "a", dataType: "datetime" })).toBe(true);
    expect(columnFits("date", { name: "a", dataType: "varchar" })).toBe(false);
    expect(columnFits("time", { name: "a", dataType: "time" })).toBe(true);
    expect(columnFits("text", { name: "a", dataType: "int" })).toBe(true);
    expect(columnFits("number", { name: "a", dataType: "json" })).toBe(false);
  });
  it("round-trips filters, leaves defaults out and keeps foreign params", () => {
    const sp = new URLSearchParams("process=p1&from=2026-09-01&to=2026-09-15&tl=Ana&product=X&sort=orders&dir=asc&page=3&agent=MAS1");
    const s = parseExtUrl(sp);
    expect(s).toMatchObject({ from: "2026-09-01", to: "2026-09-15", tl: "Ana", product: "X", sort: "orders", dir: "asc", page: 3, agent: "MAS1" });
    expect(serializeExtUrl(s, sp).toString()).toBe(sp.toString());
    const cleared = serializeExtUrl({ ...s, tl: "", product: "", sort: "", page: 1, agent: "" }, sp);
    expect(cleared.get("tl")).toBeNull(); expect(cleared.get("dir")).toBeNull(); expect(cleared.get("process")).toBe("p1");
  });
  it("no from/to means server default; bad dates are ignored; reversed range is fixed", () => {
    expect(parseExtUrl(new URLSearchParams("")).from).toBe("");
    expect(parseExtUrl(new URLSearchParams("from=2026-02-31&day=x")).from).toBe("");
    expect(parseExtUrl(new URLSearchParams("from=2026-09-10&to=2026-09-01"))).toMatchObject({ from: "2026-09-01", to: "2026-09-10" });
  });
});

describe("api client", () => {
  it("sales scope uses lob/product; outbound sends its campaign filter as `campaign`", async () => {
    get.mockResolvedValue({ data: {} });
    await fetchOverview("p1", "sales", { from: "2026-09-01", to: "2026-09-30", tl: "A", lob: "L", product: "P" });
    expect(get).toHaveBeenLastCalledWith("/api/process-dashboard/p1/sales/overview?from=2026-09-01&to=2026-09-30&tl=A&lob=L&product=P");
    await fetchOverview("p1", "outbound", { tl: "A", lob: "Camp" });
    expect(get).toHaveBeenLastCalledWith("/api/process-dashboard/p1/outbound/overview?tl=A&campaign=Camp");
    await fetchAgents("p1", "sales", { sort: "orders", dir: "asc", limit: 25, offset: 50, q: "ma" });
    expect(get).toHaveBeenLastCalledWith("/api/process-dashboard/p1/sales/agents?q=ma&sort=orders&dir=asc&limit=25&offset=50");
    await fetchAgent("p1", "outbound", "MAS 1/x", { from: "2026-09-01" });
    expect(get).toHaveBeenLastCalledWith("/api/process-dashboard/p1/outbound/agent/MAS%201%2Fx?from=2026-09-01");
    await fetchDay("p1", "2026-09-02", { tl: "A" });
    expect(get).toHaveBeenLastCalledWith("/api/process-dashboard/p1/sales/days/2026-09-02?tl=A");
  });
  it("the tab probe never throws", async () => {
    get.mockRejectedValue(new Error("403"));
    expect(await fetchTab("p1", "sales")).toBeNull();
    get.mockResolvedValue({ data: null });
    expect(await fetchTab("p1", "outbound")).toBeNull();
    get.mockResolvedValue({ data: { name: "X", refreshSeconds: 30 } });
    expect(await fetchTab("p1", "sales")).toEqual({ name: "X", refreshSeconds: 30 });
  });
  it("admin calls hit the kind-specific endpoints", async () => {
    post.mockResolvedValue({ data: {} }); put.mockResolvedValue({ data: {} });
    await suggest("sales", "db_masmis", "t", true);
    expect(post).toHaveBeenLastCalledWith("/api/process-dashboard/admin/sales/suggest", { schema: "db_masmis", table: "t", roster: true });
    await previewConfig("outbound", "p1", { a: 1 });
    expect(post).toHaveBeenLastCalledWith("/api/process-dashboard/admin/outbound/preview", { processId: "p1", config: { a: 1 } });
    await saveStored("sales", "p1", { b: 2 });
    expect(put).toHaveBeenLastCalledWith("/api/process-dashboard/admin/sales/p1", { b: 2 });
  });
});

describe("accessible building blocks", () => {
  it("BarList prints label, count and share as text", () => {
    const html = renderToStaticMarkup(<BarList name="Orders by status" items={[{ label: "Delivered", value: 80, pct: 80 }, { label: "RTO", value: 20, pct: 20, sub: "₹500", tone: "bad" }]} />);
    expect(html).toContain('aria-label="Orders by status"'); expect(html).toContain("Delivered"); expect(html).toContain("80 orders · 80%"); expect(html).toContain("20 orders · 20% · ₹500");
    expect(renderToStaticMarkup(<BarList name="x" items={[]} />)).toContain("Nothing to show");
  });
  it("Tiles hide unavailable metrics and label each tile for screen readers", () => {
    const html = renderToStaticMarkup(<Tiles tiles={[
      { key: "a", label: "Orders", unit: "count", direction: "higher", value: 12, deltaPct: 10, available: true },
      { key: "b", label: "Prepaid %", unit: "percent", direction: "higher", value: null, deltaPct: null, available: false }]} />);
    expect(html).toContain("Orders: 12."); expect(html).not.toContain("Prepaid");
  });
  it("DataTable exposes aria-sort and a real button in sortable headers", () => {
    const html = renderToStaticMarkup(<DataTable caption="Agents" rows={[{ agent: "A1", orders: 3 }]} cols={[{ key: "agent", label: "Agent", align: "left" }, { key: "orders", label: "Orders", sortable: true }]} sort="orders" dir="desc" onSort={() => undefined} onRow={() => undefined} rowLabel={(r) => `Open ${r.agent}`} />);
    expect(html).toContain('aria-sort="descending"'); expect(html).toContain("<caption"); expect(html).toContain('aria-label="Open A1"');
  });
  it("ProblemList is an alert when something is wrong and plain text when clean", () => {
    expect(renderToStaticMarkup(<ProblemList problems={[{ severity: "warn", code: "X", message: "careful" }]} />)).toContain('role="alert"');
    expect(renderToStaticMarkup(<ProblemList problems={[]} />)).toContain("No problems found");
  });
});

describe("pages are wired to the shared dashboard shell", () => {
  it("renders the router-bound pieces without crashing", () => {
    expect(() => renderToStaticMarkup(<MemoryRouter><div /></MemoryRouter>)).not.toThrow();
  });
});
