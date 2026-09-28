import { formatINR } from "./DashboardKit";
import { fmtN, secToHms, type HPOverviewValues } from "./housingPremiumShared";

/** One row per metric the Housing Premium Outbound dashboard shows -- the same
 * definitions (and wording) the backend service header documents, kept here so
 * the KPI tiles, tables and the drill-down drawer never disagree on a label,
 * a format or what a number means. */
export type MetricKey = keyof HPOverviewValues;
export type MetricFmt = "count" | "pct" | "inr" | "dec" | "hms";

export interface MetricDef {
  key: MetricKey;
  label: string;
  fmt: MetricFmt;
  help: string;
  /** For the previous-period arrow: is a rise good news? Omit to show no arrow. */
  goodWhenUp?: boolean;
}

export const METRICS: MetricDef[] = [
  { key: "totalCalls", label: "Total Calls", fmt: "count", goodWhenUp: true, help: "Connected + Not Connected calls in the CDR." },
  { key: "connected", label: "Connected Calls", fmt: "count", goodWhenUp: true, help: "CDR calls with status 'Answered'." },
  { key: "notConnected", label: "Not Connected Calls", fmt: "count", goodWhenUp: false, help: "CDR calls with status 'No Answered'." },
  { key: "uniqueConnected", label: "Unique Connected", fmt: "count", goodWhenUp: true, help: "Answered calls flagged unique_count = 1 in the CDR (first call from that phone number that day)." },
  { key: "connectedPct", label: "Connected %", fmt: "pct", goodWhenUp: true, help: "Connected Calls ÷ Total Calls." },
  { key: "target", label: "Target", fmt: "inr", help: "Sum of the roster's monthly target for Active agents (a single agent's own target when filtered to one). Day and week columns are the monthly target prorated by days." },
  { key: "revenue", label: "Revenue Achieved", fmt: "inr", goodWhenUp: true, help: "Sum of pre_sale.amount for the period." },
  { key: "saleCount", label: "Sale Count", fmt: "count", goodWhenUp: true, help: "Number of pre_sale orders in the period." },
  { key: "achievedPct", label: "Ach%", fmt: "pct", help: "Revenue Achieved ÷ Target." },
  { key: "aov", label: "AOV", fmt: "inr", goodWhenUp: true, help: "Revenue Achieved ÷ Sale Count." },
  { key: "presentCount", label: "Present Count", fmt: "count", help: "CDR rows flagged call_count = 1 -- an agent's first call of the day -- i.e. agent-days present." },
  { key: "perAgentDialCount", label: "Per Agent Dial Count", fmt: "count", help: "Total Calls ÷ Present Count." },
  { key: "avgSalePerAgent", label: "Avg. Sale Count per Agent", fmt: "dec", help: "Sale Count ÷ Present Count." },
  { key: "avgTalkPerAgentSec", label: "Avg. Talk Time", fmt: "hms", help: "Total talk time ÷ Present Count -- average talk time per agent per day." },
];
export const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

export function fmtMetric(value: number | undefined, fmt: MetricFmt): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  switch (fmt) {
    case "count": return fmtN(value);
    case "pct": return `${Math.round(value * 10) / 10}%`;
    case "inr": return formatINR(value);
    case "dec": return String(Math.round(value * 10) / 10);
    case "hms": return value > 0 ? secToHms(value) : "—";
  }
}

/** Percent change of `cur` against `prev`, or null when there is nothing to compare against. */
export function changePct(cur: number, prev: number | undefined): number | null {
  if (prev === undefined || !(prev > 0)) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

/* ------------------------------ date helpers ------------------------------ */

export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function diffDaysISO(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
/** The equal-length window immediately before [from, to]. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const len = diffDaysISO(from, to) + 1;
  const prevTo = addDaysISO(from, -1);
  return { from: addDaysISO(prevTo, -(len - 1)), to: prevTo };
}
