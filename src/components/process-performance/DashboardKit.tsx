import type { ComponentType, ReactNode } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";
import { Download, FileText, FileSpreadsheet, Layers } from "lucide-react";
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

export function KpiCard({
  icon: Icon, label, value, sub, tone,
}: { icon: ComponentType<{ className?: string }>; label: string; value: string; sub?: string; tone: KpiTone }) {
  const t = KPI_TONES[tone];
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className={`absolute inset-x-0 top-0 h-1 ${t.accent}`} />
      <div className={`absolute inset-0 bg-gradient-to-br ${t.wash} to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100`} />
      <div className="relative p-4">
        <div className={`mb-3 inline-flex rounded-xl p-2.5 ${t.badge}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
        <p className={`text-[22px] font-bold leading-tight tracking-tight ${t.value}`}>{value}</p>
        <p className="mt-1 text-xs font-medium text-slate-500">{label}</p>
        {sub && <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

/** Section card shell shared by every chart/table block — replaces a plain
 * white box with the app's glass-card convention (soft border, translucent
 * fill, hover lift) and a consistent icon+title header row. */
export function SectionCard({
  icon: Icon, title, tone = "slate", children, footnote,
}: {
  icon: ComponentType<{ className?: string }>; title: string; tone?: KpiTone | "slate";
  children: ReactNode; footnote?: string;
}) {
  const badge = tone === "slate" ? "bg-slate-100 text-slate-500" : KPI_TONES[tone].badge;
  return (
    <div className="rounded-2xl border border-slate-100 bg-white/95 p-4 shadow-sm backdrop-blur-sm transition-shadow duration-200 hover:shadow-md sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${badge}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <p className="text-sm font-semibold text-slate-700">{title}</p>
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
      styles: { fontSize: 8, cellPadding: 2 },
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
  const doc = new jsPDF() as AutoTableDoc;
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

const sanitizeSheetName = (name: string): string => {
  const cleaned = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31);
  return cleaned || "Sheet";
};

/** Real formatting (dark header bands, zebra rows, borders, bold values,
 * auto-sized columns) -- the free "xlsx" (SheetJS Community Edition)
 * package already used elsewhere in this app cannot reliably write cell
 * styles (fills/fonts/borders on write are a Pro-only feature there), so
 * this uses "exceljs" instead, which is built for exactly this and works
 * the same way in the browser: build a workbook in memory, get a Blob back. */
const XL_NAVY = "FF1E293B";
const XL_SLATE700 = "FF334155";
const XL_ZEBRA = "FFF1F5F9";
const XL_BORDER_COLOR = "FFCBD5E1";
const XL_HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_NAVY } };
const XL_SUBHEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_SLATE700 } };
const XL_ZEBRA_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL_ZEBRA } };
const XL_WHITE_BOLD: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const XL_THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: XL_BORDER_COLOR } },
  bottom: { style: "thin", color: { argb: XL_BORDER_COLOR } },
  left: { style: "thin", color: { argb: XL_BORDER_COLOR } },
  right: { style: "thin", color: { argb: XL_BORDER_COLOR } },
};

export async function exportSlidesToExcel(params: {
  fileName: string; slides: ExportSlide[]; reportTitle?: string; subtitle?: string;
}): Promise<void> {
  const { fileName, slides, reportTitle, subtitle } = params;
  const wb = new ExcelJS.Workbook();
  wb.creator = "MAS Callnet PeopleOS";
  wb.created = new Date();
  const usedNames = new Set<string>();
  let sheetsWritten = 0;

  for (const slide of slides) {
    let name = sanitizeSheetName(slide.title);
    let suffix = 2;
    while (usedNames.has(name)) { name = sanitizeSheetName(`${slide.title} ${suffix}`); suffix += 1; }
    usedNames.add(name);

    const ws = wb.addWorksheet(name);
    const maxCols = Math.max(2, ...(slide.tables ?? []).map((t) => t.columns.length));
    let rowIdx = 1;

    if (reportTitle) {
      ws.mergeCells(rowIdx, 1, rowIdx, maxCols);
      const titleCell = ws.getCell(rowIdx, 1);
      titleCell.value = reportTitle;
      titleCell.font = { bold: true, size: 14, color: { argb: "FF0F172A" } };
      rowIdx += 1;
      ws.mergeCells(rowIdx, 1, rowIdx, maxCols);
      const subCell = ws.getCell(rowIdx, 1);
      subCell.value = subtitle ? `${slide.title} · ${subtitle}` : slide.title;
      subCell.font = { italic: true, size: 9, color: { argb: "FF64748B" } };
      rowIdx += 2;
    }

    const contentStartRow = rowIdx;

    if (slide.kpis && slide.kpis.length > 0) {
      const headerCells = ["Metric", "Value"];
      headerCells.forEach((label, i) => {
        const cell = ws.getCell(rowIdx, i + 1);
        cell.value = label;
        cell.fill = XL_HEADER_FILL;
        cell.font = XL_WHITE_BOLD;
        cell.border = XL_THIN_BORDER;
        cell.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right" };
      });
      rowIdx += 1;
      slide.kpis.forEach((k, i) => {
        const labelCell = ws.getCell(rowIdx, 1);
        const valueCell = ws.getCell(rowIdx, 2);
        labelCell.value = k.label;
        valueCell.value = k.value;
        for (const cell of [labelCell, valueCell]) {
          cell.border = XL_THIN_BORDER;
          if (i % 2 === 1) cell.fill = XL_ZEBRA_FILL;
        }
        labelCell.alignment = { horizontal: "left" };
        valueCell.alignment = { horizontal: "right" };
        valueCell.font = { bold: true };
        rowIdx += 1;
      });
      rowIdx += 1;
    }

    for (const table of slide.tables ?? []) {
      if (table.rows.length === 0) continue;
      ws.mergeCells(rowIdx, 1, rowIdx, Math.max(1, table.columns.length));
      const titleCell = ws.getCell(rowIdx, 1);
      titleCell.value = table.title;
      titleCell.font = { bold: true, size: 11, color: { argb: "FF334155" } };
      rowIdx += 1;

      table.columns.forEach((col, i) => {
        const cell = ws.getCell(rowIdx, i + 1);
        cell.value = col;
        cell.fill = XL_SUBHEADER_FILL;
        cell.font = XL_WHITE_BOLD;
        cell.border = XL_THIN_BORDER;
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      });
      rowIdx += 1;

      table.rows.forEach((row, ri) => {
        row.forEach((val, ci) => {
          const cell = ws.getCell(rowIdx, ci + 1);
          cell.value = val;
          cell.border = XL_THIN_BORDER;
          if (ri % 2 === 1) cell.fill = XL_ZEBRA_FILL;
          cell.alignment = { horizontal: typeof val === "number" ? "right" : "center" };
        });
        rowIdx += 1;
      });
      rowIdx += 1;
    }

    if (rowIdx === contentStartRow) {
      const cell = ws.getCell(rowIdx, 1);
      cell.value = "No data for this period.";
      cell.font = { italic: true, color: { argb: "FF94A3B8" } };
      rowIdx += 1;
    }

    for (let c = 1; c <= maxCols; c++) {
      let maxLen = 10;
      ws.getColumn(c).eachCell({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? "").length;
        if (len > maxLen) maxLen = len;
      });
      ws.getColumn(c).width = Math.min(42, maxLen + 3);
    }
    ws.views = [{ state: "frozen", ySplit: reportTitle ? contentStartRow : 0 }];
    sheetsWritten += 1;
  }

  if (sheetsWritten === 0) {
    const ws = wb.addWorksheet("Sheet1");
    ws.getCell(1, 1).value = "No data for this period.";
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Drop-in "Export" button for a dashboard's toolbar row, next to
 * DateRangeToolbar. `slides` is every tab the dashboard has (feeds the two
 * "Download All" options); `activeSlideTitle` must match one slide's
 * `title` exactly and picks what the two single-view options act on. */
export function DashboardExportMenu({
  reportTitle, fileBaseName, subtitle, slides, activeSlideTitle,
}: {
  reportTitle: string;
  fileBaseName: string;
  subtitle?: string;
  slides: ExportSlide[];
  activeSlideTitle: string;
}) {
  const activeSlide = slides.find((s) => s.title === activeSlideTitle) ?? slides[0];
  const stamp = localDateStr(new Date());
  const safeFileBase = fileBaseName.replace(/\s+/g, "_");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
        >
          <Download className="h-3.5 w-3.5" />
          Export
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
              onClick={() => void exportSlidesToExcel({
                fileName: `${safeFileBase}_${activeSlide.title.replace(/\s+/g, "_")}_${stamp}.xlsx`,
                reportTitle, subtitle, slides: [activeSlide],
              })}
            >
              <FileSpreadsheet className="mr-2 h-3.5 w-3.5" /> Download Excel ({activeSlide.title})
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={() => exportSlidesToPdf({ fileName: `${safeFileBase}_All_${stamp}.pdf`, reportTitle, subtitle, slides })}
        >
          <Layers className="mr-2 h-3.5 w-3.5" /> Download All Views (PDF, all slides)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void exportSlidesToExcel({ fileName: `${safeFileBase}_All_${stamp}.xlsx`, reportTitle, subtitle, slides })}
        >
          <Layers className="mr-2 h-3.5 w-3.5" /> Download All Views (Excel, all sheets)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
