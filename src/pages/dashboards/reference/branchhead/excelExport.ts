/**
 * "Download Excel" for the Branch Head Health page: one workbook for one branch, built only
 * from the overview payload the page is showing (no extra API call), via the shared
 * dashboard Excel helper. Headcount movement process-wise carries each process's LOB split.
 */
import type { BranchHeadHealthPayload, BranchOverview } from "../../../../../backend/src/modules/branch-head-health/types";
import { exportDashboardToExcel, type ExcelSheetSpec } from "@/lib/dashboardExcelExport";
import type { PeopleData } from "./panelTypes";

type Cell = string | number | null;
type Row = Record<string, Cell>;
type BranchEntry = BranchHeadHealthPayload["branches"][number];

const WORDS: Record<string, string> = { pct: "%", mtd: "MTD", hc: "HC", op: "OP", grn: "GRN", grns: "GRNs", gst: "GST", lob: "LOB", ats: "ATS", sla: "SLA", id: "ID", lwd: "LWD", ebitda: "EBITDA" };

/** "attritionMtdPct" -> "Attrition MTD %". */
export function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").split(/\s+/).filter(Boolean);
  return words.map((w, i) => WORDS[w.toLowerCase()] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toLowerCase())).join(" ");
}

const isPlain = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);
const scalar = (v: unknown): Cell => (v == null ? null : typeof v === "number" ? (Number.isFinite(v) ? v : null) : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));

/** One table row from an object: nested objects become "Parent · child" columns, nested lists their items joined. */
function flatRow(o: Record<string, unknown>, prefix = ""): Row {
  return Object.entries(o).reduce<Row>((row, [k, v]) => {
    const label = prefix ? `${prefix} · ${humanize(k)}` : humanize(k);
    if (isPlain(v)) return { ...row, ...flatRow(v, label) };
    if (Array.isArray(v)) return { ...row, [label]: v.map((x) => (isPlain(x) ? Object.values(x).map(scalar).join(" ") : scalar(x))).join(", ") };
    return { ...row, [label]: scalar(v) };
  }, {});
}

/** Rows with the union of every row's columns, so a sparse first row does not drop columns. */
function uniform(rows: Row[]): Row[] {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
}

/**
 * A section as sheets: its single values on one "Field / Value" sheet (nested objects prefixed),
 * each list of records on its own sheet. Keys in `skip` are left out (built elsewhere).
 */
export function sectionSheets(title: string, data: unknown, skip: string[] = []): ExcelSheetSpec[] {
  const fields: Row[] = [];
  const lists: ExcelSheetSpec[] = [];
  const walk = (o: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      if (!prefix && skip.includes(k)) continue;
      const label = prefix ? `${prefix} · ${humanize(k)}` : humanize(k);
      if (isPlain(v)) walk(v, label);
      else if (Array.isArray(v) && v.some(isPlain)) {
        lists.push({ name: `${title} - ${label}`, title: `${title}: ${label}`, rows: uniform(v.filter(isPlain).map((x) => flatRow(x))) });
      } else if (Array.isArray(v)) fields.push({ Field: label, Value: v.map(scalar).join(", ") });
      else fields.push({ Field: label, Value: scalar(v) });
    }
  };
  if (Array.isArray(data)) return data.some(isPlain) ? [{ name: title, title, rows: uniform(data.filter(isPlain).map((x) => flatRow(x))) }] : [];
  if (isPlain(data)) walk(data, "");
  return [{ name: title, title, rows: fields }, ...lists];
}

const nz = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** Headcount movement process-wise: each process row, its LOB rows indented under it, then the total. */
export function headcountProcessRows(d: PeopleData): Row[] {
  const rows = d.byProcess ?? [];
  const body = rows.flatMap((r): Row[] => [
    {
      "Process / LOB": r.process, Active: nz(r.active), "Mandate seats": r.mandateSeats ?? null,
      "Active vs mandate": r.mandateGap ?? null, "Joined today": nz(r.joinedToday), "Joined MTD": nz(r.joinedMtd),
      "Left today": nz(r.leftToday), "Left MTD": nz(r.leftMtd), "Net MTD": nz(r.netMtd), "Attrition MTD %": r.attritionMtdPct ?? null,
    },
    ...(r.lobs ?? []).map((l): Row => ({
      "Process / LOB": `    LOB: ${l.lob}`, Active: nz(l.active), "Mandate seats": null, "Active vs mandate": null, "Joined today": null,
      "Joined MTD": null, "Left today": null, "Left MTD": null, "Net MTD": null, "Attrition MTD %": null,
    })),
  ]);
  const total: Row = {
    "Process / LOB": "Total", Active: nz(d.totalActive), "Mandate seats": d.mandateSeatsTotal ?? null, "Active vs mandate": null,
    "Joined today": nz(d.joinedToday), "Joined MTD": nz(d.joinedMtd), "Left today": nz(d.leftToday), "Left MTD": nz(d.leftMtd),
    "Net MTD": nz(d.netMtd), "Attrition MTD %": d.attritionMtdPct ?? null,
  };
  return rows.length ? [...body, total] : [];
}

/** Overview keys -> sheet titles, in the page's tab order. People is built by hand first. */
const SECTIONS: Array<[keyof BranchOverview, string]> = [
  ["attendance", "Attendance"], ["attrition", "Attrition"], ["finance", "Finance"], ["processPnl", "Process P&L"],
  ["hiring", "Hiring"], ["backlogs", "Backlogs"], ["operations", "Operations"], ["quality", "Quality"],
  ["callmaster", "Callmaster"], ["leaderboard", "Manager leaderboard"],
];

type Section = { status: string; data: unknown; message?: string } | undefined;
const okData = (s: Section) => (s && s.status === "ok" && s.data != null ? s.data : null);

/** Every sheet of the workbook for one branch. */
export function branchHealthSheets({ branch, overview, score }: BranchEntry): ExcelSheetSpec[] {
  const head = `${branch.branchName} (${branch.branchCode}) — ${overview.date}`;
  const sectionStatus = (key: keyof BranchOverview, title: string): Row => {
    const s = overview[key] as Section;
    return { Field: `${title} section`, Value: s ? (s.status === "ok" ? "Loaded" : s.message ? `${s.status}: ${s.message}` : s.status) : "Not available" };
  };
  const summary: Row[] = [
    { Field: "Branch", Value: branch.branchName }, { Field: "Branch code", Value: branch.branchCode },
    { Field: "Date", Value: overview.date }, { Field: "Status", Value: overview.status },
    { Field: "Health score", Value: score ? score.score : null },
    ...(score?.pillars ?? []).map((p): Row => ({ Field: `Score · ${humanize(p.key)} (weight ${p.weight})`, Value: p.score })),
    sectionStatus("people", "Headcount"),
    ...SECTIONS.map(([k, t]) => sectionStatus(k, t)),
  ];
  const people = okData(overview.people as Section) as PeopleData | null;
  const peopleSheets: ExcelSheetSpec[] = people ? [
    { name: "Headcount process-wise", title: `Headcount movement — process-wise, with LOB split · ${head}`, rows: headcountProcessRows(people) },
    { name: "Headcount LOB-wise", title: `Active headcount by LOB · ${head}`, rows: (people.byLob ?? []).map((l) => ({ LOB: l.lob, Active: nz(l.active) })) },
    ...sectionSheets("Headcount", people, ["byProcess", "byLob"]),
  ] : [];
  return [
    { name: "Summary", title: `Branch Health Report · ${head}`, rows: summary },
    { name: "Attention", title: `Needs attention · ${head}`, rows: overview.attention.map((a) => ({ Severity: a.severity, Item: a.label, Detail: a.detail })) },
    { name: "Wins", title: `Positives · ${head}`, rows: overview.positives.map((p) => ({ Item: p.label, Detail: p.detail })) },
    ...peopleSheets,
    ...SECTIONS.flatMap(([k, t]) => {
      const d = okData(overview[k] as Section);
      return d == null ? [] : sectionSheets(t, d);
    }),
  ];
}

/** Downloads the workbook, e.g. branch-health-report_NOIDA-2_2026-10-17_<today>.xlsx. */
export function downloadBranchHealthExcel(entry: BranchEntry): void {
  const safe = entry.branch.branchName.replace(/[^a-zA-Z0-9-]+/g, "_");
  exportDashboardToExcel(`branch-health-report_${safe}_${entry.overview.date}`, branchHealthSheets(entry));
}
