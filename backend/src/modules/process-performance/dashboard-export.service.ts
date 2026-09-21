import ExcelJS from "exceljs";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getDialerPool } from "../../db/dialerDb.js";
import { PROJECTS } from "../call-master/inbound.service.js";
import {
  EXCLUDED_RAW_COLUMNS, RAW_SOURCES,
  type DialerRawSource, type MasmisRawSource, type RawSource,
} from "./dashboard-export.registry.js";

/**
 * Builds the Excel file behind every Process Performance V2 "Download Excel"
 * action: the report's own on-screen tables (styled summary sheets, supplied
 * by the browser as "slides") followed by one raw-data sheet per source table
 * behind that report, plus a "Raw Data Notes" sheet saying exactly what each
 * raw sheet holds.
 *
 * Built here rather than in the browser because raw data is large (Bellavita
 * Chat alone is ~2,400 rows/day across ~45 columns) -- ExcelJS's streaming
 * writer flushes rows to a temp file as they arrive, so memory stays flat no
 * matter how many rows a raw sheet has, where an in-browser workbook would
 * have to hold every cell at once.
 */

// Measured on live data: 150,000 rows x 46 columns took ~67s to build (41 MB),
// which would blow past production nginx's 60s proxy_read_timeout. 75,000 rows
// keeps the worst case around 30s; a month of Bellavita Chat is ~70,000.
const MASMIS_ROW_CAP = 75_000;
const DIALER_ROW_CAP = 75_000;
/** Total build time allowed before remaining raw rows/sheets are skipped (and reported). */
const TIME_BUDGET_MS = 45_000;
const CHUNK = 5_000;
const MAX_SLIDES = 20;
const MAX_TABLE_ROWS = 5_000;

export interface ExportSlideInput {
  title: string;
  kpis?: Array<{ label: string; value: string }>;
  tables?: Array<{ title: string; columns: string[]; rows: Array<Array<string | number>> }>;
}

export interface DashboardExcelRequest {
  dashboard: string;
  reportTitle: string;
  subtitle?: string;
  slides: ExportSlideInput[];
  from?: string;
  to?: string;
  lob?: string;
}

export interface RawSheetResult {
  sheet: string;
  source: string;
  filter: string;
  rowsExported: number;
  rowsMatching: number | null;
  truncated: boolean;
  /** True when the sheet stopped early because the overall time budget ran out (not the row cap). */
  timeLimited?: boolean;
  error?: string;
  note?: string;
}

const NAVY = "FF1E293B";
const SLATE = "FF334155";
const ZEBRA = "FFF1F5F9";
const BORDER = "FFCBD5E1";
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: BORDER } }, bottom: { style: "thin", color: { argb: BORDER } },
  left: { style: "thin", color: { argb: BORDER } }, right: { style: "thin", color: { argb: BORDER } },
};

// XML 1.0 forbids C0 control characters other than tab, LF and CR. Built from char
// codes so the source file itself contains no literal control characters.
const ch = (n: number) => String.fromCharCode(n);
const ILLEGAL_XML = new RegExp(`[${ch(0)}-${ch(8)}${ch(11)}${ch(12)}${ch(14)}-${ch(31)}]`, "g");
const pad2 = (n: number) => String(n).padStart(2, "0");

function cellValue(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "boolean") return v;
  if (v instanceof Date) {
    const date = `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
    const midnight = v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0;
    return midnight ? date : `${date} ${pad2(v.getHours())}:${pad2(v.getMinutes())}:${pad2(v.getSeconds())}`;
  }
  if (Buffer.isBuffer(v)) return "[binary]";
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  s = s.replace(ILLEGAL_XML, "");
  return s.length > 32_000 ? `${s.slice(0, 32_000)}…` : s;
}

function safeSheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31)) || "Sheet";
  let out = base;
  let n = 2;
  while (used.has(out.toLowerCase())) {
    const suffix = ` ${n++}`;
    out = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(out.toLowerCase());
  return out;
}

function widthFor(lengths: number[]): number {
  const longest = lengths.reduce((m, l) => Math.max(m, l), 0);
  return Math.min(42, Math.max(10, longest + 3));
}

/* ------------------------------ summary sheets ------------------------------ */

function writeSummarySheet(
  wb: ExcelJS.stream.xlsx.WorkbookWriter, slide: ExportSlideInput, name: string,
  reportTitle: string, subtitle: string | undefined,
): void {
  const tables = (slide.tables ?? []).filter((t) => t.rows.length > 0);
  const kpis = slide.kpis ?? [];
  const colCount = Math.max(2, ...tables.map((t) => t.columns.length));

  // Column widths must be known before the first row is committed.
  const lens: number[][] = Array.from({ length: colCount }, () => []);
  for (const k of kpis) { lens[0].push(k.label.length); lens[1].push(k.value.length); }
  for (const t of tables) {
    t.columns.forEach((c, i) => lens[i].push(c.length));
    for (const r of t.rows) r.forEach((v, i) => lens[i]?.push(String(v ?? "").length));
  }

  const headerRows = 3; // title, subtitle, blank
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: headerRows }] });
  ws.columns = lens.map((l) => ({ width: widthFor(l) }));

  const put = (values: Array<string | number | null>, style?: (cell: ExcelJS.Cell, i: number) => void) => {
    const row = ws.addRow(values);
    if (style) values.forEach((_, i) => style(row.getCell(i + 1), i));
    row.commit();
  };

  put([reportTitle], (c) => { c.font = { bold: true, size: 14, color: { argb: "FF0F172A" } }; });
  put([subtitle ? `${slide.title} · ${subtitle}` : slide.title], (c) => {
    c.font = { italic: true, size: 9, color: { argb: "FF64748B" } };
  });
  put([]);

  if (kpis.length > 0) {
    put(["Metric", "Value"], (c, i) => {
      c.fill = fill(NAVY); c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 }; c.border = thin;
      c.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right" };
    });
    kpis.forEach((k, ri) => {
      put([k.label, k.value], (c, i) => {
        c.border = thin;
        if (ri % 2 === 1) c.fill = fill(ZEBRA);
        c.alignment = { horizontal: i === 0 ? "left" : "right" };
        if (i === 1) c.font = { bold: true };
      });
    });
    put([]);
  }

  for (const t of tables) {
    put([t.title], (c) => { c.font = { bold: true, size: 11, color: { argb: SLATE } }; });
    put(t.columns, (c) => {
      c.fill = fill(SLATE); c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 }; c.border = thin;
      c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
    t.rows.forEach((r, ri) => {
      put(r.map((v) => cellValue(v) as string | number | null), (c, i) => {
        c.border = thin;
        if (ri % 2 === 1) c.fill = fill(ZEBRA);
        c.alignment = { horizontal: typeof r[i] === "number" ? "right" : "center" };
      });
    });
    put([]);
  }

  if (kpis.length === 0 && tables.length === 0) {
    put(["No data for this period."], (c) => { c.font = { italic: true, color: { argb: "FF94A3B8" } }; });
  }
  ws.commit();
}

/* -------------------------------- raw sheets -------------------------------- */

interface RawWriteInput { name: string; columns: string[]; firstRows: unknown[][]; }

/** Creates a raw sheet with a styled header and widths sized from the first rows. */
function startRawSheet(wb: ExcelJS.stream.xlsx.WorkbookWriter, input: RawWriteInput): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(input.name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = input.columns.map((c, i) => ({
    width: widthFor([c.length, ...input.firstRows.slice(0, 200).map((r) => String(r[i] ?? "").length)]),
  }));
  const header = ws.addRow(input.columns);
  input.columns.forEach((_, i) => {
    const c = header.getCell(i + 1);
    c.fill = fill(NAVY); c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  header.commit();
  return ws;
}

function describeFilter(src: MasmisRawSource, req: DashboardExcelRequest): string {
  const parts: string[] = [];
  if (src.dateExpr && req.from && req.to) parts.push(`date ${req.from} to ${req.to}`);
  else if (src.dateExpr) parts.push("no date range supplied -- all rows");
  else parts.push("all rows (not date based)");
  if (src.lobColumn && req.lob) parts.push(`${src.lobColumn} = ${req.lob}`);
  if (src.extraWhere) parts.push(src.extraWhere);
  return parts.join("; ");
}

async function writeMasmisRaw(
  wb: ExcelJS.stream.xlsx.WorkbookWriter, src: MasmisRawSource, req: DashboardExcelRequest, sheetName: string,
  deadline: number,
): Promise<RawSheetResult> {
  const result: RawSheetResult = {
    sheet: sheetName, source: `db_masmis.${src.table}`, filter: describeFilter(src, req),
    rowsExported: 0, rowsMatching: null, truncated: false, note: src.note,
  };

  const [colRows] = await db.query<RowDataPacket[]>(`SHOW COLUMNS FROM db_masmis.\`${src.table}\``);
  const allCols = colRows.map((c) => String(c.Field));
  const cols = allCols.filter((c) => !EXCLUDED_RAW_COLUMNS.has(c) && !(src.excludeColumns ?? []).includes(c));
  const hasId = allCols.includes("id");
  const select = cols.map((c) => `\`${c}\``).join(", ");

  const where: string[] = [];
  const params: unknown[] = [];
  if (src.dateExpr && req.from && req.to) {
    where.push(`(${src.dateExpr}) >= ? AND (${src.dateExpr}) < DATE_ADD(?, INTERVAL 1 DAY)`);
    params.push(req.from, req.to);
  }
  if (src.lobColumn && req.lob) { where.push(`\`${src.lobColumn}\` = ?`); params.push(req.lob); }
  if (src.extraWhere) where.push(`(${src.extraWhere})`);
  const whereSql = where.length ? ` AND ${where.join(" AND ")}` : "";
  const table = `db_masmis.\`${src.table}\``;

  // Keyset pagination on the primary key: each chunk resumes where the last one
  // stopped, so cost stays linear in table size (OFFSET would rescan every time).
  let lastId = 0;
  let exhausted = false;
  const fetchChunk = async (want: number): Promise<RowDataPacket[]> => {
    if (exhausted) return [];
    if (!hasId) {
      exhausted = true;
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT ${select} FROM ${table} WHERE 1=1${whereSql} LIMIT ${want}`, params,
      );
      return rows;
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${select} FROM ${table} WHERE id > ?${whereSql} ORDER BY id ASC LIMIT ${want}`, [lastId, ...params],
    );
    if (rows.length < want) exhausted = true;
    if (rows.length) lastId = Number(rows[rows.length - 1].id);
    return rows;
  };

  const limit = MASMIS_ROW_CAP + 1; // one extra row tells us whether we truncated
  let first = await fetchChunk(Math.min(CHUNK, limit));
  const toArrays = (rows: RowDataPacket[]) => rows.map((r) => cols.map((c) => r[c]));
  let pending = toArrays(first);

  const ws = startRawSheet(wb, { name: sheetName, columns: cols, firstRows: pending });
  let written = 0;
  let sawExtra = false;
  while (pending.length > 0) {
    for (const r of pending) {
      if (written >= MASMIS_ROW_CAP) { sawExtra = true; break; }
      const row = ws.addRow(r.map(cellValue));
      row.commit();
      written += 1;
    }
    if (sawExtra || exhausted) break;
    if (Date.now() > deadline) { sawExtra = true; result.timeLimited = true; break; }
    first = await fetchChunk(Math.min(CHUNK, limit - written));
    pending = toArrays(first);
  }

  if (written === 0) {
    ws.addRow(["No rows matched the selected filters."]).commit();
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, cols.length) } };
  ws.commit();

  result.rowsExported = written;
  if (sawExtra) {
    result.truncated = true;
    const [[cnt]] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${table} WHERE 1=1${whereSql}`, params);
    result.rowsMatching = Number(cnt?.n ?? 0);
  } else {
    result.rowsMatching = written;
  }
  return result;
}

async function writeDialerRaw(
  wb: ExcelJS.stream.xlsx.WorkbookWriter, src: DialerRawSource, req: DashboardExcelRequest, sheetName: string,
  deadline: number,
): Promise<RawSheetResult> {
  const project = PROJECTS.find((p) => p.key === src.projectKey);
  if (!project) throw new Error(`Unknown inbound project: ${src.projectKey}`);
  const result: RawSheetResult = {
    sheet: sheetName, source: `dialer_db.${project.table}`,
    filter: `${req.from && req.to ? `CallDate ${req.from} to ${req.to}` : "no date range supplied"}; ${project.campaigns.length} ${project.name} campaigns`,
    rowsExported: 0, rowsMatching: null, truncated: false,
    note: "Live dialer call records (read-only source).",
  };
  if (!req.from || !req.to) throw new Error("A date range is required to export inbound call records.");

  const pool = await getDialerPool();
  const ph = project.campaigns.map(() => "?").join(",");
  const [rows, fields] = await pool.execute(
    `SELECT * FROM dialer_db.${project.table}
      WHERE CallDate >= ? AND CallDate < DATE_ADD(DATE(?), INTERVAL 1 DAY) AND CampaignName IN (${ph})
      ORDER BY CallDate ASC LIMIT ${DIALER_ROW_CAP + 1}`,
    [req.from, req.to, ...project.campaigns],
  ) as [RowDataPacket[], Array<{ name: string }>];

  const cols = fields.map((f) => f.name);
  const data = rows.map((r) => cols.map((c) => r[c]));
  const ws = startRawSheet(wb, { name: sheetName, columns: cols, firstRows: data });
  const capped = data.slice(0, DIALER_ROW_CAP);
  let written = 0;
  for (const r of capped) {
    if (written % 2_000 === 0 && Date.now() > deadline) { result.timeLimited = true; break; }
    ws.addRow(r.map(cellValue)).commit();
    written += 1;
  }
  if (written === 0 && !result.timeLimited) ws.addRow(["No rows matched the selected filters."]).commit();
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, cols.length) } };
  ws.commit();

  result.rowsExported = written;
  result.truncated = result.timeLimited === true || data.length > DIALER_ROW_CAP;
  result.rowsMatching = result.truncated ? null : written;
  return result;
}

function writeNotesSheet(wb: ExcelJS.stream.xlsx.WorkbookWriter, results: RawSheetResult[], used: Set<string>): void {
  const ws = wb.addWorksheet(safeSheetName("Raw Data Notes", used), { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = ["Sheet", "Source table", "Filter applied", "Rows exported", "Rows matching", "Status"];
  ws.columns = [{ width: 28 }, { width: 34 }, { width: 58 }, { width: 15 }, { width: 15 }, { width: 70 }];
  const h = ws.addRow(headers);
  headers.forEach((_, i) => {
    const c = h.getCell(i + 1);
    c.fill = fill(NAVY); c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.border = thin;
    c.alignment = { vertical: "middle", horizontal: "center" };
  });
  h.commit();
  results.forEach((r, ri) => {
    const status = r.error
      ? `NOT EXPORTED: ${r.error}`
      : r.timeLimited
        ? `Stopped at ${r.rowsExported.toLocaleString("en-IN")} rows: the export time limit was reached. Narrow the date range or LOB filter and export again for the rest.${r.note ? ` ${r.note}` : ""}`
        : r.truncated
          ? `Truncated at ${r.rowsExported.toLocaleString("en-IN")} rows (${r.rowsMatching?.toLocaleString("en-IN") ?? "more"} matched). Narrow the date range or LOB filter for the rest.${r.note ? ` ${r.note}` : ""}`
          : `Complete.${r.note ? ` ${r.note}` : ""}`;
    const row = ws.addRow([r.sheet, r.source, r.filter, r.rowsExported, r.rowsMatching ?? "", status]);
    for (let i = 1; i <= 6; i++) {
      const c = row.getCell(i);
      c.border = thin;
      c.alignment = { vertical: "top", wrapText: i === 3 || i === 6 };
      if (ri % 2 === 1) c.fill = fill(ZEBRA);
      if (r.error && i === 6) c.font = { bold: true, color: { argb: "FFB91C1C" } };
    }
    row.commit();
  });
  ws.commit();
}

/* ---------------------------------- entry ---------------------------------- */

export function isKnownDashboard(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(RAW_SOURCES, key);
}

/** Trims client-supplied slides to sane limits so a malformed body cannot balloon the workbook. */
export function normalizeSlides(input: unknown): ExportSlideInput[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_SLIDES).map((s): ExportSlideInput => {
    const slide = (s ?? {}) as Record<string, unknown>;
    const kpis = Array.isArray(slide.kpis)
      ? (slide.kpis as Array<Record<string, unknown>>).slice(0, 100).map((k) => ({
          label: String(cellValue(k?.label) ?? ""), value: String(cellValue(k?.value) ?? ""),
        }))
      : [];
    const tables = Array.isArray(slide.tables)
      ? (slide.tables as Array<Record<string, unknown>>).slice(0, 30).map((t) => {
          const columns = (Array.isArray(t?.columns) ? (t.columns as unknown[]) : []).slice(0, 80).map((c) => String(cellValue(c) ?? ""));
          const rows = (Array.isArray(t?.rows) ? (t.rows as unknown[][]) : []).slice(0, MAX_TABLE_ROWS)
            .map((r) => (Array.isArray(r) ? r.slice(0, 80).map((v) => cellValue(v) as string | number) : []));
          return { title: String(cellValue(t?.title) ?? ""), columns, rows };
        })
      : [];
    return { title: String(cellValue(slide.title) ?? "Sheet"), kpis, tables };
  });
}

export async function buildDashboardExcel(
  req: DashboardExcelRequest, filePath: string,
): Promise<{ raw: RawSheetResult[] }> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: false });
  wb.creator = "MAS Callnet PeopleOS";
  wb.created = new Date();
  const used = new Set<string>();

  const slides = req.slides.length > 0 ? req.slides : [{ title: "Report" }];
  for (const slide of slides) {
    writeSummarySheet(wb, slide, safeSheetName(slide.title, used), req.reportTitle, req.subtitle);
  }

  const raw: RawSheetResult[] = [];
  const deadline = Date.now() + TIME_BUDGET_MS;
  for (const src of RAW_SOURCES[req.dashboard] ?? []) {
    const sheetName = safeSheetName(`Raw - ${src.sheet}`, used);
    const sourceLabel = src.kind === "masmis" ? `db_masmis.${(src as MasmisRawSource).table}` : "dialer_db";
    if (Date.now() > deadline) {
      raw.push({
        sheet: sheetName, source: sourceLabel, filter: "", rowsExported: 0, rowsMatching: null, truncated: false,
        error: "skipped because the export time limit was reached before this sheet. Narrow the date range and export again.",
      });
      continue;
    }
    try {
      raw.push(src.kind === "masmis"
        ? await writeMasmisRaw(wb, src, req, sheetName, deadline)
        : await writeDialerRaw(wb, src as DialerRawSource, req, sheetName, deadline));
    } catch (err) {
      // One unreachable/failed source must not lose the whole report: record it in the notes sheet.
      // A sheet that already started writing is committed by wb.commit() below, so the file stays valid.
      raw.push({
        sheet: sheetName, source: sourceLabel, filter: "", rowsExported: 0, rowsMatching: null, truncated: false,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
    }
  }

  if (raw.length > 0) writeNotesSheet(wb, raw, used);
  await wb.commit();
  return { raw };
}

export type { RawSource };
