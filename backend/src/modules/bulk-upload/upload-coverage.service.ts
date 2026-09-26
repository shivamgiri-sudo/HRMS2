import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * "Data uploaded till <date>" for the TPZ uploaders: the latest data date actually present in each upload type's target table,
 * so the person uploading knows where to continue from.
 *
 * The date is read from the DATA (the table's own date column), not from when the file was uploaded -- a backfill uploaded today
 * must not make September look covered. Upload types with no date column (agent lists, mandates, month targets) report only when
 * they were last uploaded.
 */

type Fmt = "auto" | "dmy" | "mdy";
interface Source { table: string; col: string; kind: "date" | "text"; fmt?: Fmt }

const M = (table: string, col: string, kind: "date" | "text" = "text", fmt: Fmt = "auto"): Source => ({ table: `db_masmis.${table}`, col, kind, fmt });
const H = (table: string, col = "report_date"): Source => ({ table: `mas_hrms.${table}`, col, kind: "date" });

/** upload_type_code -> where its data lands and which column carries the data date. null = no data date. */
export const COVERAGE_SOURCES: Record<string, Source | null> = {
  AW_BILLING_MASMIS: M("aw_billing", "call_date"), AW_INBOUND_MASMIS: M("aw_inbound", "call_date"), AW_MANDATE_MASMIS: null,
  AW_NEW_CDR_MASMIS: M("aw_new_cdr", "call_date"), AW_OUT_MASMIS: M("aw_out", "call_date"), AW_CHAT_MASMIS: null,
  BB_APR_MASMIS: M("bb_apr", "report_date", "date"), BB_CART_MASMIS: M("bb_cart", "call_date"), BB_CHAT_MASMIS: M("new_bb_chat", "chat_date", "date"),
  BB_SALE_MASMIS: M("bb_sale", "Date", "date"),
  BIRLANU_APR_MASMIS: M("birlanu_apr", "report_date"), BIRLANU_SALE_MASMIS: M("birlanu_sale", "report_date"),
  CL_APR_MASMIS: M("cl_apr", "report_date"), CL_CHAT_MASMIS: M("cl_chat", "report_date"), CL_DISPO_MASMIS: M("cl_dispo", "report_date", "text", "dmy"),
  CL_EMAIL_RAW_MASMIS: M("cl_email_raw", "report_date"), CL_FEEDBACK_MASMIS: M("cl_feedback", "report_date"), CL_IB_CDR_MASMIS: M("cl_ib_cdr", "call_date"),
  CL_OUTBOUND_MASMIS: M("cl_outbound", "call_date", "text", "mdy"), CL_QUALITY_MASMIS: M("cl_quality", "audit_date"), CL_RECHURN_CALL_MASMIS: M("cl_rechurn_call", "report_date"),
  GNC_ALLOCATION_MASMIS: M("gnc_allocation", "alloc_date", "date"), GNC_APR: H("gnc_apr_daily_actual"), GNC_CHAT_MASMIS: M("gnc_chat", "report_date"),
  GNC_SALE_MASMIS: M("gnc_sale", "sale_date", "date"),
  LP_FEEDBACK_APR_MASMIS: M("lp_feedback_apr", "report_date"), LP_FEEDBACK_CDR_MASMIS: M("lp_feedback_cdr", "report_date"),
  LP_ONBOARDING_APR_MASMIS: M("lp_onboarding_apr", "report_date"), LP_ONBOARDING_CDR_MASMIS: M("lp_onboarding_cdr", "report_date"),
  NEEMANS_AGENT_DETAILS_MASMIS: null, NEEMANS_ALLOCATION_MASMIS: M("neemans_allocation", "date"), NEEMANS_APR_MASMIS: M("neemans_apr", "date"),
  NEEMANS_CHAT_MASMIS: M("neemans_chat", "report_date"), NEEMANS_MONTH_TARGET_MASMIS: null, NEEMANS_SALE_RAW_MASMIS: M("neemans_sale_raw", "date"),
  OWNER_AGENT_DETAILS_MASMIS: null, OWNER_CDR_MASMIS: M("Owner_cdr", "report_date"), OWNER_SALE_MASMIS: M("owner_sale", "report_date"),
  PRE_AGENT_DETAILS_MASMIS: null, PRE_CDR_MASMIS: M("Pre_cdr", "report_date", "text", "mdy"), PRE_SALE_MASMIS: M("pre_sale", "report_date"),
  SATYA_ALLOCATION_MASMIS: M("satya_allocation", "report_date"), SATYA_CDR_MASMIS: M("satya_cdr", "report_date"),
  DALMIA_DD_RAW: H("dalmia_dd_raw"), DALMIA_OUTBOUND_RAW: H("dalmia_outbound_raw"), DALMIA_AFTER_HOUR: H("dalmia_after_hour_raw"),
  DALMIA_APR: M("dalmia_apr_raw", "report_date", "date"),
};

export interface UploadCoverage {
  /** Latest data date present (YYYY-MM-DD), or null when the type has no data date / no data yet. */
  latestDate: string | null;
  firstDate: string | null;
  /** How many distinct dates have data. */
  days: number;
  /** When a file of this type was last imported (ISO), or null. */
  lastUploadedAt: string | null;
  uploads: number;
  /** Where latestDate came from: the table's own date column, or nothing (upload history only). */
  basis: "data" | "uploads-only";
}

const pad = (n: number): string => String(n).padStart(2, "0");
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const validYmd = (y: number, m: number, d: number): string | null => {
  if (y < 2000 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** Text dates as they were stored: "22-Aug-26", "2026-09-01", "15/09/2026", "9/15/26", Excel serials ("46215"). Time parts are ignored. */
export function parseCoverageDate(raw: unknown, fmt: Fmt = "auto"): string | null {
  const s = String(raw ?? "").trim().split(/[ T]/)[0];
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{2,4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return mon ? validYmd(y, mon, Number(m[1])) : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) {
    const a = Number(m[1]); const b = Number(m[2]);
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    let day: number; let month: number;
    if (fmt === "mdy") { month = a; day = b; }
    else if (fmt === "dmy") { day = a; month = b; }
    else if (a > 12) { day = a; month = b; }
    else if (b > 12) { month = a; day = b; }
    else { day = a; month = b; } // ambiguous and no hint: day first, as the rest of the platform reads Indian dates
    return validYmd(y, month, day);
  }
  m = /^(\d{5})(?:\.\d+)?$/.exec(s);
  if (m) {
    const serial = Number(m[1]);
    if (serial < 40000 || serial > 60000) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  return null;
}

const todayPlus = (days: number): string => {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const quoteTable = (t: string): string => t.split(".").map((p) => `\`${p.replace(/`/g, "")}\``).join(".");
const quoteCol = (c: string): string => `\`${c.replace(/`/g, "")}\``;

async function dataCoverage(src: Source): Promise<Pick<UploadCoverage, "latestDate" | "firstDate" | "days"> | null> {
  const table = quoteTable(src.table);
  const col = quoteCol(src.col);
  const limit = todayPlus(2); // a typo'd future date must not read as "covered till 2030"
  try {
    if (src.kind === "date") {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(MIN(${col}), '%Y-%m-%d') AS f, DATE_FORMAT(MAX(${col}), '%Y-%m-%d') AS l, COUNT(DISTINCT ${col}) AS d
           FROM ${table} WHERE ${col} IS NOT NULL AND ${col} >= '2000-01-01' AND ${col} <= ?`,
        [limit],
      );
      const r = rows[0];
      return r?.l ? { latestDate: String(r.l), firstDate: String(r.f), days: Number(r.d ?? 0) } : { latestDate: null, firstDate: null, days: 0 };
    }
    // Text columns hold many spellings, so the distinct day strings are read (a few hundred at most) and parsed here.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT SUBSTRING_INDEX(TRIM(${col}), ' ', 1) AS v FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> '' GROUP BY v LIMIT 5000`,
    );
    const dates = new Set<string>();
    for (const r of rows) {
      const iso = parseCoverageDate(r.v, src.fmt);
      if (iso && iso <= limit) dates.add(iso);
    }
    if (dates.size === 0) return { latestDate: null, firstDate: null, days: 0 };
    const sorted = [...dates].sort();
    return { latestDate: sorted[sorted.length - 1], firstDate: sorted[0], days: sorted.length };
  } catch (err) {
    const code = String((err as { code?: unknown })?.code ?? "");
    if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_FIELD_ERROR") return null; // table / column not there (yet): fall back to upload history
    throw err;
  }
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: Pick<UploadCoverage, "latestDate" | "firstDate" | "days"> | null }>();

export function invalidateUploadCoverage(code?: string): void {
  if (code) cache.delete(code); else cache.clear();
}

export async function getUploadCoverage(codes: string[], refresh = false): Promise<Record<string, UploadCoverage>> {
  const known = [...new Set(codes)].filter((c) => c in COVERAGE_SOURCES);
  const out: Record<string, UploadCoverage> = {};
  if (known.length === 0) return out;

  // Upload history: when each type was last imported (independent of the data dates).
  const history = new Map<string, { at: string | null; n: number }>();
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT upload_type_code AS c, MAX(created_at) AS at, COUNT(*) AS n FROM upload_batch
        WHERE upload_type_code IN (${known.map(() => "?").join(",")}) AND batch_status IN ('imported','imported_with_errors','completed')
        GROUP BY upload_type_code`,
      known,
    );
    for (const r of rows) history.set(String(r.c), { at: r.at ? new Date(r.at).toISOString() : null, n: Number(r.n ?? 0) });
  } catch { /* history is optional */ }

  const compute = async (code: string) => {
    const src = COVERAGE_SOURCES[code];
    if (!src) return null;
    const hit = cache.get(code);
    if (!refresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
    let value: Awaited<ReturnType<typeof dataCoverage>> = null;
    try { value = await dataCoverage(src); } catch (err) { console.error(`[upload-coverage] ${code}:`, err instanceof Error ? err.message : String(err)); }
    if (value) cache.set(code, { at: Date.now(), value });
    return value;
  };

  // A few at a time -- each is one indexed/aggregate read, but a company can list a dozen types.
  const queue = [...known];
  await Promise.all(Array.from({ length: Math.min(5, queue.length) }, async () => {
    for (let code = queue.shift(); code; code = queue.shift()) {
      const data = await compute(code);
      const h = history.get(code);
      out[code] = {
        latestDate: data?.latestDate ?? null, firstDate: data?.firstDate ?? null, days: data?.days ?? 0,
        lastUploadedAt: h?.at ?? null, uploads: h?.n ?? 0, basis: data ? "data" : "uploads-only",
      };
    }
  }));
  return out;
}
