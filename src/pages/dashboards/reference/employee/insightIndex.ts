import type { InsightAction, InsightKpi, InsightSeries, InsightTable, RoleInsights } from "../../kit";

export interface TodayRow {
  state: "week_off" | "holiday" | "leave" | "not_started" | "working" | "completed" | "no_punch" | string;
  shift: string | null;
  punchIn: string | null;
  punchOut: string | null;
  holiday: string | null;
}

/** Keyed lookups over the provider payload so layout code never scans arrays inline. */
export function indexInsights(insights: RoleInsights | undefined) {
  const kpis = new Map<string, InsightKpi>((insights?.kpis ?? []).map((k) => [k.key, k]));
  const tables = new Map<string, InsightTable>((insights?.tables ?? []).map((t) => [t.key, t]));
  const series = new Map<string, InsightSeries>((insights?.series ?? []).map((s) => [s.key, s]));
  const today = (tables.get("today")?.rows[0] ?? null) as unknown as TodayRow | null;
  return {
    kpi: (key: string) => kpis.get(key),
    kpis: (keys: string[]) => keys.map((k) => kpis.get(k)).filter((k): k is InsightKpi => Boolean(k)),
    table: (key: string) => tables.get(key),
    series: (key: string) => series.get(key),
    today,
    actions: insights?.actions ?? [],
    signals: insights?.signals ?? [],
    sectionErrors: insights?.sectionErrors ?? {},
    health: insights?.healthScore ?? null,
    healthBasis: insights?.healthBasis ?? null,
  };
}

export type InsightIndex = ReturnType<typeof indexInsights>;

export function greeting(hour: number): string {
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** One-line description of today for the hero subtitle. */
export function todayLine(t: TodayRow | null): string {
  if (!t) return "Your personal dashboard";
  const shift = t.shift ? ` · shift ${t.shift}` : "";
  switch (t.state) {
    case "working": return `Punched in at ${t.punchIn ?? "—"}${shift}`;
    case "completed": return `Day complete · ${t.punchIn ?? "—"} to ${t.punchOut ?? "—"}`;
    case "no_punch": return `No punch recorded yet${shift}`;
    case "not_started": return `Shift not started${shift}`;
    case "holiday": return `Holiday${t.holiday ? `: ${t.holiday}` : ""}`;
    case "week_off": return "Week off today";
    case "leave": return "On approved leave today";
    default: return "Your personal dashboard";
  }
}

export function todayChip(t: TodayRow | null): { value: string; tone: "neutral" | "good" | "bad" | "warn" } {
  switch (t?.state) {
    case "working": return { value: `In ${t.punchIn ?? ""}`.trim(), tone: "good" };
    case "completed": return { value: "Done", tone: "good" };
    case "no_punch": return { value: "No punch", tone: "bad" };
    case "not_started": return { value: t.shift ? t.shift.split(" – ")[0] : "Not started", tone: "neutral" };
    case "holiday": return { value: "Holiday", tone: "good" };
    case "week_off": return { value: "Week off", tone: "neutral" };
    case "leave": return { value: "On leave", tone: "neutral" };
    default: return { value: "—", tone: "neutral" };
  }
}

export function pendingTotal(actions: InsightAction[]): number {
  return actions.reduce((sum, a) => sum + (a.count ?? 0), 0) - actions.filter((a) => a.severity === "info").reduce((sum, a) => sum + (a.count ?? 0), 0);
}
