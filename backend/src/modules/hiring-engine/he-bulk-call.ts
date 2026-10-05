/**
 * Manual bulk voice-call upload. One row = one confirmation call, in the format HR already uses:
 *   phone | name | role | interview_date | interview_time | branch_address | reference_id
 * Pure parsing/validation so the preview and the queueing share one definition of "valid".
 * Dates are read the Indian way (DD/MM/YYYY); Excel serial numbers and "Wed, 16 Sep 2026" are accepted too.
 */
import { normalizeMobile10 } from "./he-phone.js";
import { istAddMinutes } from "./he-slots.js";

export const BULK_CALL_COLUMNS = ["phone", "name", "role", "interview_date", "interview_time", "branch_address", "reference_id"] as const;
export const BULK_CALL_MAX_ROWS = 500;

const ALIASES: Record<(typeof BULK_CALL_COLUMNS)[number], string[]> = {
  phone: ["phone", "phone_number", "phonenumber", "mobile", "mobile_number", "mobile_no", "contact", "contact_number"],
  name: ["name", "full_name", "fullname", "candidate_name", "candidate"],
  role: ["role", "role_title", "roletitle", "designation", "position", "job_role"],
  interview_date: ["interview_date", "interviewdate", "date", "walkin_date", "walk_in_date"],
  interview_time: ["interview_time", "interviewtime", "time", "walkin_time", "walk_in_time"],
  branch_address: ["branch_address", "branchaddress", "address", "venue", "location"],
  reference_id: ["reference_id", "referenceid", "reference", "ref", "ref_id", "lead_id", "leadid"],
};

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** Map whatever headers the sheet has onto the seven canonical columns. Missing required columns are reported once. */
export function mapHeaders(headers: string[]): { map: Record<string, string>; missing: string[] } {
  const map: Record<string, string> = {};
  for (const h of headers) {
    const k = key(h);
    for (const col of BULK_CALL_COLUMNS) if (!map[col] && ALIASES[col].includes(k)) map[col] = h;
  }
  const missing = BULK_CALL_COLUMNS.filter((c) => c !== "reference_id" && !map[c]);
  return { map, missing };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const validYmd = (y: number, m: number, d: number) => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** -> "YYYY-MM-DD" or null. */
export function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v < 36526 || v > 73415) return null; // outside 2000..2100 as an Excel serial
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return validYmd(+m[1], +m[2], +m[3]) ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : null;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/); // DD/MM/YYYY (India)
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return validYmd(y, +m[2], +m[1]) ? `${y}-${pad(+m[2])}-${pad(+m[1])}` : null; }
  m = s.match(/^(?:[A-Za-z]+,?\s+)?(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})$/); // "Wed, 16 Sep 2026" / 16-Sep-2026
  if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; return mo && validYmd(+m[3], mo, +m[1]) ? `${m[3]}-${pad(mo)}-${pad(+m[1])}` : null; }
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/); // "Sep 16, 2026"
  if (m) { const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; return mo && validYmd(+m[3], mo, +m[2]) ? `${m[3]}-${pad(mo)}-${pad(+m[2])}` : null; }
  return null;
}

/** -> "HH:MM:00" (24h) or null. Accepts "10:30 AM", "10.30am", "14:00", "1030", Excel day-fractions. */
export function parseTime(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const frac = v - Math.floor(v);
    if (v < 0 || (v > 1 && frac === 0)) return null;
    const mins = Math.round(frac * 1440);
    return mins >= 1440 ? null : `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}:00`;
  }
  const s = String(v).trim().toLowerCase().replace(/\./g, ":");
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(?::\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (min > 59) return null;
  if (m[3]) { if (h < 1 || h > 12) return null; if (m[3] === "pm" && h < 12) h += 12; if (m[3] === "am" && h === 12) h = 0; }
  else if (h > 23) return null;
  return `${pad(h)}:${pad(min)}:00`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-16" -> "Wed, 16 Sep 2026" (what the bot says aloud and what HR sees). */
export function dateLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function timeLabel(hms: string): string {
  const [h, m] = hms.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
}

export interface BulkCallRow {
  rowNo: number;
  mobile10: string;
  name: string;
  role: string;
  interviewDate: string; // YYYY-MM-DD
  interviewTime: string; // HH:MM:SS
  interviewAt: string; // YYYY-MM-DD HH:MM:SS (IST)
  branchAddress: string;
  referenceId: string;
}
export interface RowDisplay { phone: string; name: string; role: string; when: string }
export interface RowResult { rowNo: number; ok: boolean; errors: string[]; warnings: string[]; row?: BulkCallRow; raw: Record<string, unknown>; display: RowDisplay }

const cell = (raw: Record<string, unknown>, header: string | undefined) => (header ? raw[header] : undefined);
const text = (v: unknown) => (v == null ? "" : String(v).trim());

/** Validate every row. `nowIst` is injectable for tests. Duplicates within the file keep the first occurrence. */
export function validateBulkCalls(rawRows: Array<Record<string, unknown>>, nowIst: string): { results: RowResult[]; missingColumns: string[]; tooMany: boolean } {
  const headers = Array.from(new Set(rawRows.flatMap((r) => Object.keys(r))));
  const { map, missing } = mapHeaders(headers);
  if (missing.length) return { results: [], missingColumns: missing, tooMany: false };
  if (rawRows.length > BULK_CALL_MAX_ROWS) return { results: [], missingColumns: [], tooMany: true };

  const seen = new Map<string, number>();
  const results: RowResult[] = rawRows.map((raw, i) => {
    const rowNo = i + 2; // spreadsheet row (header is row 1)
    const errors: string[] = [];
    const warnings: string[] = [];
    const mobile10 = normalizeMobile10(cell(raw, map.phone));
    const name = text(cell(raw, map.name));
    const role = text(cell(raw, map.role));
    const addr = text(cell(raw, map.branch_address));
    const date = parseDate(cell(raw, map.interview_date));
    const time = parseTime(cell(raw, map.interview_time));

    if (!mobile10) errors.push("phone is not a valid 10-digit Indian mobile");
    if (!name) errors.push("name is required");
    if (!role) errors.push("role is required");
    if (addr.length < 10) errors.push("branch_address is required (the bot reads it out - give the full address)");
    if (!date) errors.push("interview_date is not a recognised date (use DD/MM/YYYY or YYYY-MM-DD)");
    if (!time) errors.push("interview_time is not a recognised time (use 10:30 AM or 14:00)");

    let interviewAt = "";
    if (date && time) {
      interviewAt = `${date} ${time}`;
      if (interviewAt < nowIst) errors.push("interview is in the past");
      else if (interviewAt < istAddMinutes(nowIst, 30)) warnings.push("interview starts within 30 minutes");
    }
    if (name.length > 120) errors.push("name is too long");
    if (role.length > 150) errors.push("role is too long");
    if (addr.length > 400) errors.push("branch_address is too long");

    if (mobile10) {
      const first = seen.get(mobile10);
      if (first) errors.push(`duplicate of row ${first} (same phone) - only the first is called`);
      else seen.set(mobile10, rowNo);
    }
    const referenceId = text(cell(raw, map.reference_id)).slice(0, 40) || (mobile10 ? `BC-${mobile10.slice(-4)}${date ? date.slice(5).replace("-", "") : ""}` : "");
    const ok = errors.length === 0;
    // What the sheet actually said, so a rejected row is still recognisable in the preview.
    const display: RowDisplay = { phone: text(cell(raw, map.phone)), name, role, when: [date ?? text(cell(raw, map.interview_date)), time ? time.slice(0, 5) : text(cell(raw, map.interview_time))].filter(Boolean).join(" ") };
    return {
      rowNo, ok, errors, warnings, raw, display,
      row: ok ? { rowNo, mobile10: mobile10!, name, role, interviewDate: date!, interviewTime: time!, interviewAt, branchAddress: addr, referenceId } : undefined,
    };
  });
  return { results, missingColumns: [], tooMany: false };
}

/** The CSV HR downloads as a starting point. */
export function sampleCsv(): string {
  const ex = (d: string) => d;
  return [
    BULK_CALL_COLUMNS.join(","),
    `9876543210,Rohit Sharma,Customer Success Executive - Telesales,${ex("16/10/2026")},10:30 AM,"Trapezoid IT Park, 1st Floor, C-27, Sector 62, Noida - 201309",HE-1001`,
    `9812345678,Priya Singh,Collections Executive,${ex("16/10/2026")},11:00 AM,"F-15, Jal Darshan Co-operative Society, Ashram Road, Ahmedabad - 380006",HE-1002`,
  ].join("\n");
}
