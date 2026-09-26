import { Fragment, useState, type ComponentType, type ReactNode } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Download, FileText, FileSpreadsheet, Layers, Loader2 } from "lucide-react";
import { getAuthToken } from "@/lib/hrmsApi";
import { apiUrl } from "@/lib/apiBase";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/**
 * Shared visual language for Process Performance V2's per-company live
 * dashboards (GncSaleDashboard, GncInboundDashboard, ...) -- extracted out
 * of GncSaleDashboard so the Sale and Inbound dashboards read as one
 * cohesive product instead of two independently-styled pages. Pure
 * presentation + date helpers, no data-fetching or business logic.
 */

/** Local YYYY-MM-DD, deliberately NOT via toISOString(): that converts
 * through UTC and rolls the date back a day for a viewer ahead of UTC
 * (e.g. IST, UTC+5:30) — midnight local time becomes the previous day's
 * evening in UTC. */
export function localDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 1st of the current month .. today — the default range every Process
 * Performance V2 dashboard opens to, kept in sync with each backend's own
 * from/to fallback so the pickers show what's actually being queried on
 * first load. */
export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const from = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = localDateStr(now);
  return { from, to };
}

/** Last 7 days .. today — used by call-volume dashboards where a full
 * month of daily rows is too dense for a first paint. */
export function last7DaysRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 6);
  return { from: localDateStr(from), to: localDateStr(now) };
}

export const formatINR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

export const formatShortDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

export const formatDDMMYYYY = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

export function Spinner({ tone = "emerald" }: { tone?: "emerald" | "blue" }) {
  const ring = tone === "blue" ? "border-t-blue-600" : "border-t-emerald-600";
  return (
    <div className="flex items-center justify-center py-20">
      <div className={`h-9 w-9 animate-spin rounded-full border-[3px] border-slate-100 ${ring}`} />
    </div>
  );
}

/** Tone recipe per KPI domain — icon badge, value color, top accent bar and
 * soft card wash — following this app's frozen HRMS tone-color system
 * (icon bg ~10% tint, bold value text, matching border) rather than one
 * flat card style repeated per tile. */
export const KPI_TONES = {
  sky:     { badge: "bg-sky-100 text-sky-600",         value: "text-sky-700",     accent: "bg-sky-500",     wash: "from-sky-50/80" },
  emerald: { badge: "bg-emerald-100 text-emerald-600", value: "text-emerald-700", accent: "bg-emerald-500", wash: "from-emerald-50/80" },
  teal:    { badge: "bg-teal-100 text-teal-600",       value: "text-teal-700",    accent: "bg-teal-500",    wash: "from-teal-50/80" },
  amber:   { badge: "bg-amber-100 text-amber-600",     value: "text-amber-700",   accent: "bg-amber-500",   wash: "from-amber-50/80" },
  violet:  { badge: "bg-violet-100 text-violet-600",   value: "text-violet-700",  accent: "bg-violet-500",  wash: "from-violet-50/80" },
  indigo:  { badge: "bg-indigo-100 text-indigo-600",   value: "text-indigo-700",  accent: "bg-indigo-500",  wash: "from-indigo-50/80" },
  rose:    { badge: "bg-rose-100 text-rose-600",       value: "text-rose-700",    accent: "bg-rose-500",    wash: "from-rose-50/80" },
  cyan:    { badge: "bg-cyan-100 text-cyan-600",       value: "text-cyan-700",    accent: "bg-cyan-500",    wash: "from-cyan-50/80" },
  red:     { badge: "bg-red-100 text-red-600",         value: "text-red-700",     accent: "bg-red-500",     wash: "from-red-50/80" },
  blue:    { badge: "bg-blue-100 text-blue-600",       value: "text-blue-700",    accent: "bg-blue-500",    wash: "from-blue-50/80" },
} as const;
export type KpiTone = keyof typeof KPI_TONES;

/** Compact, horizontal KPI tile -- icon left, value+label right, one thin
 * accent stripe instead of a full-width bar. Roughly half the height of the
 * old stacked layout, so a row of 6-8 of these leaves far more of the page
 * visible without scrolling. Shared by every Process Performance V2
 * dashboard, so this one definition sets the density everywhere. */
export function KpiCard({
  icon: Icon, label, value, sub, tone, onClick,
}: {
  icon: ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tone: KpiTone;
  /** Optional -- when set, the card becomes a button (e.g. to open a "View details" drawer). Omitted by every existing caller, so this is a no-op for them. */
  onClick?: () => void;
}) {
  const t = KPI_TONES[tone];
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`group relative flex w-full items-center gap-2.5 overflow-hidden rounded-xl border border-slate-100 bg-white py-2 pl-3 pr-2.5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${t.accent}`} />
      <div className={`absolute inset-0 bg-gradient-to-br ${t.wash} to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100`} />
      <span className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${t.badge}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="relative min-w-0">
        <p className={`truncate text-[15px] font-bold leading-tight tracking-tight ${t.value}`}>{value}</p>
        <p className="truncate text-[10px] font-medium leading-tight text-slate-500">{label}</p>
        {sub && <p className="truncate text-[9px] leading-tight text-slate-400">{sub}</p>}
      </div>
    </Tag>
  );
}

/** Section card shell shared by every chart/table block — replaces a plain
 * white box with the app's glass-card convention (soft border, translucent
 * fill, hover lift) and a consistent icon+title header row. */
export function SectionCard({
  icon: Icon, title, tone = "slate", children, footnote, action,
}: {
  icon: ComponentType<{ className?: string }>; title: string; tone?: KpiTone | "slate";
  children: ReactNode; footnote?: string;
  /** Optional right-aligned header slot, e.g. a "View details" button. Omitted by every existing caller, so this is a no-op for them. */
  action?: ReactNode;
}) {
  const badge = tone === "slate" ? "bg-slate-100 text-slate-500" : KPI_TONES[tone].badge;
  return (
    <div className="rounded-2xl border border-slate-100 bg-white/95 p-4 shadow-sm backdrop-blur-sm transition-shadow duration-200 hover:shadow-md sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${badge}`}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <p className="text-sm font-semibold text-slate-700">{title}</p>
        </div>
        {action}
      </div>
      {children}
      {footnote && <p className="mt-3 border-t border-slate-50 pt-2 text-[11px] leading-relaxed text-slate-400">{footnote}</p>}
    </div>
  );
}

/** Gradient hero banner used at the top of each per-company live dashboard
 * — icon + eyebrow/title on the left, a pill tab switcher on the right. */
export function DashboardHero<TabKey extends string>({
  icon: Icon, eyebrow, title, tabs, activeTab, onTabChange, gradient,
}: {
  icon: ComponentType<{ className?: string }>; eyebrow: string; title: string;
  tabs: Array<{ key: TabKey; label: string }>; activeTab: TabKey; onTabChange: (key: TabKey) => void;
  /** Tailwind gradient stop classes, e.g. "from-emerald-600 via-teal-600 to-emerald-700" */
  gradient: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${gradient} p-5 text-white shadow-lg sm:p-6`}>
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.15]"
        style={{ backgroundImage: "radial-gradient(circle at 15% 20%, white, transparent 45%), radial-gradient(circle at 85% 85%, white, transparent 40%)" }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{eyebrow}</p>
            <h2 className="text-lg font-bold sm:text-xl">{title}</h2>
          </div>
        </div>
        <div className="inline-flex rounded-xl bg-white/10 p-1 backdrop-blur-sm">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onTabChange(t.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
                activeTab === t.key ? "bg-white text-slate-800 shadow-sm" : "text-white/90 hover:bg-white/10"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Date-range toolbar reused by every dashboard's toolbar row. */
export function DateRangeToolbar({
  from, to, onFrom, onTo, onReset, resetLabel = "This Month", accentFocus = "focus:border-emerald-400",
}: {
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
  onReset: () => void; resetLabel?: string; accentFocus?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <input
        type="date"
        value={from}
        max={to}
        onChange={(e) => onFrom(e.target.value)}
        className={`rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm transition-colors focus:outline-none ${accentFocus}`}
      />
      <span className="text-xs text-slate-400">to</span>
      <input
        type="date"
        value={to}
        min={from}
        max={localDateStr(new Date())}
        onChange={(e) => onTo(e.target.value)}
        className={`rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm transition-colors focus:outline-none ${accentFocus}`}
      />
      <button
        type="button"
        onClick={onReset}
        className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200"
      >
        {resetLabel}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Export ("Download Snap" / "Download Excel") — one reusable menu for every
 * Process Performance V2 dashboard. Built entirely on jsPDF + jspdf-autotable
 * + xlsx, all three already dependencies of this app and already used the
 * same way elsewhere (src/components/performance/TeamAnalytics.tsx,
 * src/pages/payroll/PfBatchesPage.tsx) — no new package added.
 *
 * Each dashboard hands this a list of "slides" (one per tab it has —
 * Overview, Agent-wise, Date-wise, ...). "Download Snap"/"Download Excel"
 * export only the currently active tab; "Download All" bundles every slide
 * into one multi-page PDF (each slide = one page) or one multi-sheet
 * workbook (each slide = one sheet) — the "all snap with slide(s)" bundle.
 * ------------------------------------------------------------------------ */

export interface ExportTable {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

/** One tab/section's exportable content. */
export interface ExportSlide {
  title: string;
  kpis?: Array<{ label: string; value: string }>;
  tables?: ExportTable[];
}

type AutoTableDoc = jsPDF & { lastAutoTable?: { finalY: number } };

function renderPdfSlideBody(doc: AutoTableDoc, slide: ExportSlide, startY: number): void {
  let y = startY;

  if (slide.kpis && slide.kpis.length > 0) {
    autoTable(doc, {
      startY: y,
      head: [["Metric", "Value"]],
      body: slide.kpis.map((k) => [k.label, k.value]),
      theme: "striped",
      headStyles: { fillColor: [30, 41, 59] },
      styles: { fontSize: 9 },
      margin: { left: 14, right: 14 },
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 8;
  }

  for (const table of slide.tables ?? []) {
    if (table.rows.length === 0) continue;
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text(table.title, 14, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [table.columns],
      body: table.rows,
      theme: "striped",
      headStyles: { fillColor: [71, 85, 105] },
      // Week-wise / date-wise tables run to 20-40 columns: shrink the type so they fit the page.
      styles: { fontSize: table.columns.length > 28 ? 5 : table.columns.length > 16 ? 6 : 8, cellPadding: table.columns.length > 16 ? 1 : 2 },
      margin: { left: 14, right: 14 },
    });
    y = (doc.lastAutoTable?.finalY ?? y) + 10;
  }

  if ((slide.kpis?.length ?? 0) === 0 && (slide.tables ?? []).every((t) => t.rows.length === 0)) {
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text("No data for this period.", 14, y);
  }
}

export function exportSlidesToPdf(params: {
  fileName: string; reportTitle: string; subtitle?: string; slides: ExportSlide[];
}): void {
  const { fileName, reportTitle, subtitle, slides } = params;
  // Wide (week / date column) tables need a landscape page, and a larger sheet when very wide.
  const maxColumns = Math.max(0, ...slides.flatMap((s) => (s.tables ?? []).map((t) => t.columns.length)));
  const doc = new jsPDF({
    orientation: maxColumns > 10 ? "landscape" : "portrait",
    format: maxColumns > 20 ? "a3" : "a4",
  }) as AutoTableDoc;
  const list = slides.length > 0 ? slides : [{ title: "No data" } satisfies ExportSlide];

  list.forEach((slide, i) => {
    if (i > 0) doc.addPage();
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text(reportTitle, 14, 18);
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(subtitle ? `${slide.title} · ${subtitle}` : slide.title, 14, 25);
    renderPdfSlideBody(doc, slide, 33);
  });

  doc.save(fileName);
}

/** Tells the server which report an Excel export belongs to, so it can attach
 * the raw source rows behind that report as extra sheets. `from`/`to`/`lob`
 * must be the same filters the report itself is currently showing. */
export interface ExportRawSpec {
  /** Key of the report in the backend's dashboard-export registry. */
  dashboard: string;
  from?: string;
  to?: string;
  lob?: string;
}

/**
 * Excel is built by the server (POST /api/process-performance/dashboard-export/excel):
 * the report's on-screen tables become styled summary sheets, and the raw
 * source rows behind the report are streamed into extra "Raw - <table>"
 * sheets, followed by a "Raw Data Notes" sheet stating what each one holds.
 * It is not built in the browser because raw data is large (tens of
 * thousands of rows x dozens of columns) -- the server streams it to disk
 * with flat memory, where the browser would have to hold every cell at once.
 */
export async function exportSlidesToExcel(params: {
  fileName: string; slides: ExportSlide[]; reportTitle: string; subtitle?: string; raw: ExportRawSpec;
}): Promise<{ failedSheets: number; truncatedSheets: number }> {
  const { fileName, slides, reportTitle, subtitle, raw } = params;
  const response = await fetch(apiUrl("/api/process-performance/dashboard-export/excel"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken()}` },
    body: JSON.stringify({
      dashboard: raw.dashboard, from: raw.from, to: raw.to, lob: raw.lob, reportTitle, subtitle, slides,
    }),
  });
  if (!response.ok) {
    let message = `Excel export failed (${response.status}).`;
    try {
      const body = await response.json();
      if (body?.error || body?.message) message = String(body.error ?? body.message);
    } catch { /* body was not JSON */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return {
    failedSheets: Number(response.headers.get("X-Export-Failed-Sheets") ?? 0),
    truncatedSheets: Number(response.headers.get("X-Export-Truncated-Sheets") ?? 0),
  };
}


/* ------------------------------------------------------------------------ *
 * Side-view (drawer) helpers -- every "View details" drawer shares these so
 * each one gets the same Week-wise / Date-wise / Combined switch and the same
 * "Download Excel" button. The workbook is built in the browser (a drawer only
 * ever holds a few dozen rows, unlike the server-built full-report export).
 * ------------------------------------------------------------------------ */

export interface DrawerSheet {
  name: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

const stampNow = (): string => localDateStr(new Date());

/** Builds and downloads a small workbook client-side. `xlsx` is loaded on demand so it
 * only costs the bundle when someone actually clicks Download. */
export async function downloadDrawerExcel(fileBase: string, sheets: DrawerSheet[]): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([sheet.columns, ...sheet.rows]);
    ws["!cols"] = sheet.columns.map((c, i) => ({
      wch: Math.min(40, Math.max(c.length, ...sheet.rows.map((r) => String(r[i] ?? "").length)) + 2),
    }));
    let name = sheet.name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet";
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)} ${n++}`;
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, `${fileBase.replace(/[^\w.-]+/g, "_")}_${stampNow()}.xlsx`);
}

/** Small "Download Excel" button for a drawer header/section. */
export function DrawerExcelButton({
  fileBase, getSheets, disabled,
}: { fileBase: string; getSheets: () => DrawerSheet[]; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button" disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try { await downloadDrawerExcel(fileBase, getSheets()); } finally { setBusy(false); }
      }}
      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSpreadsheet className="h-3 w-3" />}Download Excel
    </button>
  );
}

/** Icon-only "Download Excel" for a table card's top-right corner (SectionCard `action` slot). */
export function TableExcelIconButton({ fileBase, getSheets, disabled }: { fileBase: string; getSheets: () => DrawerSheet[]; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button" title="Download Excel" aria-label="Download Excel" disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try { await downloadDrawerExcel(fileBase, getSheets()); } finally { setBusy(false); }
      }}
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
    </button>
  );
}

export type PeriodViewMode = "week" | "date" | "combined";

const PERIOD_MODES: Array<{ key: PeriodViewMode; label: string }> = [
  { key: "week", label: "Week-wise" }, { key: "date", label: "Date-wise" }, { key: "combined", label: "Combined" },
];

/** Segmented Week-wise / Date-wise / Combined switch shared by every drawer. */
export function PeriodModeToggle({ mode, onChange }: { mode: PeriodViewMode; onChange: (m: PeriodViewMode) => void }) {
  return (
    <div className="inline-flex rounded-full bg-slate-100 p-0.5">
      {PERIOD_MODES.map((m) => (
        <button
          key={m.key} type="button" onClick={() => onChange(m.key)}
          className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${mode === m.key ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >{m.label}</button>
      ))}
    </div>
  );
}
export interface PeriodRow { key: string; label: string; cells: string[]; raw: Array<string | number> }
export interface PeriodWeek extends PeriodRow { days: PeriodRow[] }

/** Week-wise / Date-wise / Combined tables (+ the Excel button) for a drawer.
 * `weeks` carries each week's own total row and the day rows that make it up, so the
 * Combined view is a week total followed by its days. `leadSheets` are extra sheets
 * (e.g. the drawer's Overall KPIs) placed before the period sheets in the workbook. */
export function PeriodSection({
  metricLabels, weeks, fileBase, leadSheets = [], accentClass = "text-rose-700",
}: {
  metricLabels: string[]; weeks: PeriodWeek[]; fileBase: string; leadSheets?: DrawerSheet[]; accentClass?: string;
}) {
  const [mode, setMode] = useState<PeriodViewMode>("combined");
  const days = weeks.flatMap((w) => w.days);
  const th = "border border-slate-200 px-2 py-1.5";
  const td = "border border-slate-200 px-2 py-1.5";
  const empty = <tr><td colSpan={metricLabels.length + 1} className="border border-slate-200 py-6 text-center text-slate-400">No data for this period.</td></tr>;
  const table = (first: string, body: ReactNode) => (
    <div className="overflow-x-auto rounded-xl border border-slate-100">
      <table className="w-full min-w-[420px] border-collapse text-center text-[11px]">
        <thead>
          <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <th className={`${th} text-left`}>{first}</th>
            {metricLabels.map((m) => <th key={m} className={th}>{m}</th>)}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
  const cellsOf = (r: PeriodRow, cls: string) => r.cells.map((c, i) => <td key={i} className={`${td} ${cls}`}>{c}</td>);

  const getSheets = (): DrawerSheet[] => [
    ...leadSheets,
    { name: "Week-wise", columns: ["Week", ...metricLabels], rows: weeks.map((w) => [w.label, ...w.raw]) },
    { name: "Date-wise", columns: ["Date", ...metricLabels], rows: days.map((d) => [d.label, ...d.raw]) },
    {
      name: "Combined", columns: ["Period", "Level", ...metricLabels],
      rows: weeks.flatMap((w) => [[w.label, "Week total", ...w.raw], ...w.days.map((d) => [d.label, "Day", ...d.raw])]),
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodModeToggle mode={mode} onChange={setMode} />
        <DrawerExcelButton fileBase={fileBase} getSheets={getSheets} />
      </div>

      {mode === "week" && table("Week", weeks.length === 0 ? empty : weeks.map((w) => (
        <tr key={w.key}>
          <td className={`${td} text-left font-medium text-slate-700`}>{w.label}</td>
          {cellsOf(w, `font-semibold ${accentClass}`)}
        </tr>
      )))}

      {mode === "date" && table("Date", days.length === 0 ? empty : days.map((d) => (
        <tr key={d.key}>
          <td className={`${td} font-medium text-slate-700`}>{d.label}</td>
          {cellsOf(d, `font-semibold ${accentClass}`)}
        </tr>
      )))}

      {mode === "combined" && table("Week / Date", weeks.length === 0 ? empty : weeks.map((w) => (
        <Fragment key={w.key}>
          <tr className="bg-slate-100/80">
            <td className={`${td} text-left font-bold text-slate-800`}>{w.label}</td>
            {cellsOf(w, `font-bold ${accentClass}`)}
          </tr>
          {w.days.map((d) => (
            <tr key={d.key}>
              <td className={`${td} pl-5 text-left font-medium text-slate-600`}>{d.label}</td>
              {cellsOf(d, "text-slate-700")}
            </tr>
          ))}
        </Fragment>
      )))}
    </div>
  );
}

/** Drop-in "Export" button for a dashboard's toolbar row, next to
 * DateRangeToolbar. `slides` is every tab the dashboard has (feeds the two
 * "Download All" options); `activeSlideTitle` must match one slide's
 * `title` exactly and picks what the two single-view options act on.
 * `raw` is required on purpose: every Excel export carries the raw source
 * rows behind the report, so a report that forgot to say which source it
 * reads is a compile error rather than an export silently missing its data. */
export function DashboardExportMenu({
  reportTitle, fileBaseName, subtitle, slides, activeSlideTitle, raw,
}: {
  reportTitle: string;
  fileBaseName: string;
  subtitle?: string;
  slides: ExportSlide[];
  activeSlideTitle: string;
  raw: ExportRawSpec;
}) {
  const [busy, setBusy] = useState(false);
  const activeSlide = slides.find((s) => s.title === activeSlideTitle) ?? slides[0];
  const stamp = localDateStr(new Date());
  const safeFileBase = fileBaseName.replace(/\s+/g, "_");

  const runExcel = async (fileName: string, excelSlides: ExportSlide[]) => {
    setBusy(true);
    try {
      const { failedSheets, truncatedSheets } = await exportSlidesToExcel({
        fileName, slides: excelSlides, reportTitle, subtitle, raw,
      });
      if (failedSheets > 0 || truncatedSheets > 0) {
        window.alert(
          `Excel downloaded. ${failedSheets > 0 ? `${failedSheets} raw-data sheet(s) could not be included. ` : ""}` +
          `${truncatedSheets > 0 ? `${truncatedSheets} raw-data sheet(s) were cut short (row limit or time limit). ` : ""}` +
          `See the "Raw Data Notes" sheet in the file for exactly what happened and how to get the rest.`,
        );
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Excel export failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-70"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {busy ? "Preparing Excel…" : "Export"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="text-xs">
        {activeSlide && (
          <>
            <DropdownMenuItem
              onClick={() => exportSlidesToPdf({
                fileName: `${safeFileBase}_${activeSlide.title.replace(/\s+/g, "_")}_${stamp}.pdf`,
                reportTitle, subtitle, slides: [activeSlide],
              })}
            >
              <FileText className="mr-2 h-3.5 w-3.5" /> Download Snap ({activeSlide.title})
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void runExcel(
                `${safeFileBase}_${activeSlide.title.replace(/\s+/g, "_")}_${stamp}.xlsx`, [activeSlide],
              )}
            >
              <FileSpreadsheet className="mr-2 h-3.5 w-3.5" /> Download Excel + raw data ({activeSlide.title})
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={() => exportSlidesToPdf({ fileName: `${safeFileBase}_All_${stamp}.pdf`, reportTitle, subtitle, slides })}
        >
          <Layers className="mr-2 h-3.5 w-3.5" /> Download All Views (PDF, all slides)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void runExcel(`${safeFileBase}_All_${stamp}.xlsx`, slides)}>
          <Layers className="mr-2 h-3.5 w-3.5" /> Download All Views (Excel + raw data)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
