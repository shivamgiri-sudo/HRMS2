import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KpiTiles } from "../KpiTiles";
import { Drawer } from "../Drawer";
import { Sparkline } from "../ui";
import { resolveColumns, guessUnit } from "../AgentsTable";
import { emptyForm, toConfigPayload, validateSetup } from "../canonicalFields";

describe("KpiTiles", () => {
  const html = renderToStaticMarkup(<KpiTiles loading={false} activeKey="aht" onSelect={() => undefined}
    kpis={[{ key: "aht", label: "AHT", unit: "seconds", direction: "lower", value: 300, deltaPct: 5, status: "bad", target: 280 },
      { key: "calls", label: "Calls", value: null, status: "nodata" }]} />);
  it("tiles are real buttons with state and a full spoken label", () => {
    expect(html).toContain('<button type="button"'); expect(html).toContain('aria-pressed="true"'); expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Up 5.0% versus previous period, unfavourable");
  });
  it("shows delta and status as text, not colour alone", () => {
    expect(html).toContain("+5.0% vs prev"); expect(html).toContain("Off target"); expect(html).toContain("No data");
  });
  it("has visible keyboard focus styling", () => expect(html).toContain("focus-visible:ring-2"));
  it("renders a reserved skeleton while loading", () => {
    expect(renderToStaticMarkup(<KpiTiles loading kpis={undefined} activeKey="" onSelect={() => undefined} />)).toContain("animate-pulse");
  });
});

describe("Drawer", () => {
  const html = renderToStaticMarkup(<Drawer title="Agent A" onClose={() => undefined}><p>body</p></Drawer>);
  it("is a labelled modal dialog with a 44px close button", () => {
    expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"'); expect(html).toContain("aria-labelledby");
    expect(html).toContain('aria-label="Close panel"'); expect(html).toContain("h-11 w-11");
  });
});

describe("Sparkline", () => {
  it("is decorative", () => expect(renderToStaticMarkup(<Sparkline points={[{ date: "a", value: 1 }, { date: "b", value: 3 }]} />)).toContain('aria-hidden="true"'));
  it("falls back to a dash with under two points", () => expect(renderToStaticMarkup(<Sparkline points={[]} />)).toContain("—"));
});

describe("resolveColumns", () => {
  it("accepts profile columns as strings and borrows label/unit from KPIs", () => {
    const cols = resolveColumns({ kpis: [{ key: "aht", label: "AHT", unit: "seconds", value: 1 }], categoryProfile: { columns: ["aht", "login_hours", "connect_rate"] } });
    expect(cols).toEqual([{ key: "aht", label: "AHT", unit: "seconds" }, { key: "login_hours", label: "Login hours", unit: "hours" }, { key: "connect_rate", label: "Connect rate", unit: "percent" }]);
  });
  it("falls back to the KPI list when the profile lists none", () => expect(resolveColumns({ kpis: [{ key: "x", label: "X", value: 1 }] })).toHaveLength(1));
  it("guessUnit", () => { expect(guessUnit("amount")).toBe("currency"); expect(guessUnit("calls")).toBeUndefined(); });
});

describe("setup validation", () => {
  it("explains every missing requirement", () => {
    const msgs = validateSetup(emptyForm());
    expect(msgs.join(" ")).toMatch(/Choose a process/); expect(msgs.join(" ")).toMatch(/category/); expect(msgs.join(" ")).toMatch(/APR table/);
    expect(msgs.join(" ")).toMatch(/"Agent code" \(required\)/); expect(msgs.join(" ")).toMatch(/"Date" \(required\)/);
  });
  it("rejects a column mapped twice, half a filter, and a bad refresh", () => {
    const f = { ...emptyForm("p1"), category: "sales", aprTable: "t", columnMap: { agent_code: "a", date: "a" }, filterColumn: "c", refreshSeconds: 2 };
    const m = validateSetup(f).join(" ");
    expect(m).toMatch(/mapped to both/); expect(m).toMatch(/both a column and a value/); expect(m).toMatch(/between 10 and 3600/);
  });
  it("passes a complete form and drops blank mappings from the payload", () => {
    const f = { ...emptyForm("p1"), category: "sales", aprTable: "t", columnMap: { agent_code: "a", date: "d", calls: "" } };
    expect(validateSetup(f)).toEqual([]);
    expect(toConfigPayload(f).columnMap).toEqual({ agent_code: "a", date: "d" });
    expect(toConfigPayload(f).processFilter).toBeNull();
  });
});
