/**
 * SBI Card Collections -- daily file readiness (pure calculations, no DB).
 *
 * The client's mail of 24-Sep-2026 puts the daily feed on SFTP: fresh call tables go to the dialer, and a day-end export for BOTH the
 * new flow (MAS_AHM_FLOW_NEW_DDMMYYYY) and the manual flow (MAS_AHM_FLOW_MANUAL_DDMMYYYY) comes back. If automation fails the IT team
 * uploads by hand (the client's "BCP"). This board answers, for every day: did each expected feed arrive, which fresh call tables
 * were in it, and how stale is each source.
 */
import { parseCallTable } from "./sbi-card-dispositions.js";

export type SourceKey = "accountNew" | "accountManual" | "apr" | "dialerMis" | "agentMis" | "penEstimation" | "outcome" | "downtime";
export interface SourceDef { key: SourceKey; label: string; daily: boolean; hint: string }
/** daily = expected every working day; the rest are loaded when they exist (pen estimation per call table, outcome per cycle, downtime per outage). */
export const SOURCES: SourceDef[] = [
  { key: "accountNew", label: "Day-end export, NEW flow", daily: true, hint: "MAS_AHM_FLOW_NEW_DDMMYYYY" },
  { key: "accountManual", label: "Day-end export, MANUAL flow", daily: true, hint: "MAS_AHM_FLOW_MANUAL_DDMMYYYY" },
  { key: "apr", label: "Agent time (APR)", daily: true, hint: "AGENT_TIME*.csv" },
  { key: "dialerMis", label: "Dialer MIS", daily: true, hint: "one sheet per campaign" },
  { key: "agentMis", label: "Agent MIS", daily: true, hint: "per agent per day" },
  { key: "penEstimation", label: "Pen estimation", daily: false, hint: "per call table" },
  { key: "outcome", label: "Outcome (Res / NM / RB)", daily: false, hint: "cycle to date" },
  { key: "downtime", label: "Downtime tracker", daily: false, hint: "only when there was an outage" },
];

/** The fresh CD3 HB call tables the client named (without the site prefix and the DDMMYYYY stamp), as program + tier. */
export const EXPECTED_CALL_TABLES: Array<{ key: string; label: string }> = [
  { key: "CD3|FAT_S|HB", label: "FAT_S_HB" }, { key: "CD3|FAT_S|HB1", label: "FAT_S_HB1" },
  { key: "CD3|Base|HB", label: "HB" }, { key: "CD3|Base|HB1", label: "HB1" },
  { key: "CD3|STAB|HB", label: "STAB_HB" }, { key: "CD3|STAB|HB1", label: "STAB_HB1" },
  { key: "CD3|PTP|HB", label: "PTP_HB" }, { key: "CD3|PTP|HB1", label: "PTP_HB1" },
  { key: "CD3|CTC|HB1", label: "CTC_HB1" },
];

export const tableKey = (callTable: string | null | undefined): string => {
  const p = parseCallTable(callTable);
  return `CD${p.cd ?? "?"}|${p.program}|${p.tier}`;
};

/** "CD2|JO|Standard" -> "CD2 JO"; "CD1|PTP|Low" -> "CD1 PTP (Low)". For humans. */
export const prettyTableKey = (key: string): string => { const [cd, program, tier] = key.split("|"); return `${cd} ${program}${tier && tier !== "Standard" ? ` (${tier})` : ""}`; };

export interface ReadinessInput {
  from: string; to: string;
  /** rows per day per source (0 / absent = nothing loaded) */
  counts: Record<string, Partial<Record<SourceKey, number>>>;
  /** distinct call table names that were in the NEW-flow day-end export of each day */
  tablesByDay: Record<string, string[]>;
  /** the day "now" is, so staleness is measured against it; defaults to `to` */
  asOf?: string;
}
export interface ReadinessDay {
  date: string; cells: Partial<Record<SourceKey, number>>; dailyMissing: SourceKey[]; complete: boolean;
  tables: { found: string[]; missing: string[]; other: string[] } | null;
}
export interface ReadinessOut {
  days: ReadinessDay[];
  freshness: Array<{ key: SourceKey; label: string; daily: boolean; lastDate: string | null; ageDays: number | null; status: "ok" | "stale" | "never"; rows: number }>;
  latest: ReadinessDay | null;
  /** The latest day that has a NEW-flow day-end export: the call-table check is made on that day, not on a day with only an APR. */
  tablesDay: ReadinessDay | null;
  alerts: Array<{ level: "critical" | "warning" | "info"; text: string }>;
  expectedTables: Array<{ key: string; label: string }>;
}

const dayDiff = (a: string, b: string): number => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

export function buildReadiness(inp: ReadinessInput): ReadinessOut {
  const asOf = inp.asOf ?? inp.to;
  const dates = Object.keys(inp.counts).filter((d) => d >= inp.from && d <= inp.to && Object.values(inp.counts[d]!).some((n) => (n ?? 0) > 0)).sort();
  const dailyKeys = SOURCES.filter((s) => s.daily).map((s) => s.key);
  const days: ReadinessDay[] = dates.map((date) => {
    const cells = inp.counts[date]!;
    const dailyMissing = dailyKeys.filter((k) => !(cells[k] && cells[k]! > 0));
    const names = inp.tablesByDay[date];
    let tables: ReadinessDay["tables"] = null;
    if (names && names.length > 0) {
      const keys = new Set(names.map(tableKey));
      const expected = new Set(EXPECTED_CALL_TABLES.map((t) => t.key));
      tables = {
        found: EXPECTED_CALL_TABLES.filter((t) => keys.has(t.key)).map((t) => t.label),
        missing: EXPECTED_CALL_TABLES.filter((t) => !keys.has(t.key)).map((t) => t.label),
        other: [...keys].filter((k) => !expected.has(k)).sort().map(prettyTableKey),
      };
    }
    return { date, cells, dailyMissing, complete: dailyMissing.length === 0, tables };
  });

  const freshness = SOURCES.map((s) => {
    const withData = dates.filter((d) => (inp.counts[d]![s.key] ?? 0) > 0);
    const lastDate = withData[withData.length - 1] ?? null;
    const ageDays = lastDate ? Math.max(0, dayDiff(asOf, lastDate)) : null;
    const rows = withData.reduce((n, d) => n + (inp.counts[d]![s.key] ?? 0), 0);
    const status: "ok" | "stale" | "never" = !lastDate ? "never" : s.daily && ageDays! > 1 ? "stale" : "ok";
    return { key: s.key, label: s.label, daily: s.daily, lastDate, ageDays, status, rows };
  });

  const latest = days[days.length - 1] ?? null;
  const tablesDay = [...days].reverse().find((d) => d.tables !== null) ?? null;
  const alerts: ReadinessOut["alerts"] = [];
  if (!latest) alerts.push({ level: "info", text: "No files loaded in this range." });
  else {
    const label = (k: SourceKey) => SOURCES.find((s) => s.key === k)!.label;
    if (latest.dailyMissing.length > 0) alerts.push({ level: "critical", text: `${latest.date}: missing ${latest.dailyMissing.map(label).join(", ")}. If SFTP automation failed, the IT team uploads by hand (the client's BCP).` });
  }
  if (tablesDay?.tables) {
    const t = tablesDay.tables;
    if (t.missing.length > 0) alerts.push({ level: "critical", text: `${tablesDay.date}: ${t.missing.length} of ${EXPECTED_CALL_TABLES.length} fresh CD3 HB call tables are not in the NEW-flow export (${t.missing.join(", ")}).` });
    if (t.found.length === EXPECTED_CALL_TABLES.length) alerts.push({ level: "info", text: `${tablesDay.date}: all ${EXPECTED_CALL_TABLES.length} fresh CD3 HB call tables are present.` });
    if (t.other.length > 0) alerts.push({ level: "info", text: `${tablesDay.date}: tables outside the client's fresh CD3 HB list were also loaded (${t.other.join(", ")}).` });
  }
  for (const f of freshness) if (f.daily && f.status === "stale") alerts.push({ level: "warning", text: `${f.label}: last loaded ${f.lastDate} (${f.ageDays} days before ${asOf}).` });
  const order = { critical: 0, warning: 1, info: 2 } as const;
  alerts.sort((a, b) => order[a.level] - order[b.level]);
  return { days, freshness, latest, tablesDay, alerts, expectedTables: EXPECTED_CALL_TABLES };
}
