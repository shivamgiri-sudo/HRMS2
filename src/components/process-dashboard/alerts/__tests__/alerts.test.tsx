import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describeRule, isAnomaly, unitHint, when } from "../alertUi";
import { SeverityBadge } from "../SeverityBadge";
import { AlertsTab } from "../AlertsTab";
import { AlertsChip } from "../AlertsChip";
import type { MetricChoice } from "../api";

const metrics: MetricChoice[] = [
  { key: "aht", label: "AHT", kind: "kpi", unit: "seconds", direction: "lower", available: true },
  { key: "utilization", label: "Utilization", kind: "kpi", unit: "percent", available: true },
  { key: "anomaly:login_drop", label: "Login drop (agents)", kind: "anomaly", available: true },
];

describe("describeRule", () => {
  it("reads as a sentence with unit-aware threshold, window and streak", () => {
    expect(describeRule({ metricKey: "aht", comparator: "gt", threshold: 420, windowDays: 1, consecutiveDays: 2 }, metrics)).toBe("AHT is above 7m 00s for 2 days in a row");
    expect(describeRule({ metricKey: "utilization", comparator: "lt", threshold: 60, windowDays: 3, consecutiveDays: 1 }, metrics)).toBe("Utilization is below 60% (3-day window)");
  });
  it("anomaly rules describe the agent count", () => {
    expect(describeRule({ metricKey: "anomaly:login_drop", comparator: "gte", threshold: 1, windowDays: 1, consecutiveDays: 1 }, metrics)).toContain("at least 1 agent flagged");
    expect(isAnomaly("anomaly:any")).toBe(true); expect(isAnomaly("aht")).toBe(false);
  });
  it("helpers tolerate missing data", () => { expect(unitHint(undefined)).toBe(""); expect(unitHint("percent")).toBe("%"); expect(when(null)).toBe("—"); expect(when("not a date")).toBe("—"); });
});

describe("SeverityBadge", () => { it("carries the severity as text, not colour alone", () => { expect(renderToStaticMarkup(<SeverityBadge s="critical" />)).toContain("Critical"); }); });

const wrap = (node: React.ReactNode) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={["/p?view=alerts&tl=x"]}>{node}</MemoryRouter></QueryClientProvider>);

describe("AlertsTab", () => {
  const html = wrap(<AlertsTab processId="11111111-1111-1111-1111-111111111111" config={{ processId: "p", processCode: "C", processName: "Dalmia", category: "support_inbound", label: "Dalmia Support", enabled: true, configured: true, refreshSeconds: 60 }} />);
  it("has a labelled tablist with Events / Rules / Digests and a way back that keeps other filters", () => {
    expect(html).toContain('role="tablist"'); expect(html).toContain("Events"); expect(html).toContain("Rules"); expect(html).toContain("Digests");
    expect(html).toContain('aria-selected="true"'); expect(html).toContain("Back to dashboard"); expect(html).toContain("tl=x"); expect(html).not.toContain("view=alerts");
  });
  it("names the process and has a single h1", () => { expect(html).toContain("Dalmia Support"); expect((html.match(/<h1/g) ?? []).length).toBe(1); });
});

describe("AlertsChip", () => { it("renders a link with an accessible name even before data loads", () => { expect(wrap(<AlertsChip processId="p" />)).toContain('aria-label="Alerts: none open"'); }); });
