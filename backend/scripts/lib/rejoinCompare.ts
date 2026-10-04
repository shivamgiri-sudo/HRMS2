/**
 * Pure logic for scripts/rejoin-dbbill-compare.ts. No I/O, no database access.
 *
 * db_bill (legacy MySQL 5.5) has no rejoin column, so a rejoin is inferred from masjclrentry rows:
 *   P1  the same EmpCode on 2+ rows with different joining dates (rehired under the same code)
 *   P2  the same person (valid PAN or Aadhaar) under DIFFERENT codes, the later row joining AFTER the
 *       earlier row left (non-overlapping stints): OLD -> NEW
 *   P3  a single row that looks revived: Status '1', no DOL, but ResignationDate / left_type present
 * Mobile numbers are deliberately not used for matching (shared and recycled, low quality).
 */
import { NON_REACTIVATABLE_STATUSES } from "../../src/modules/exit/exitEmploymentStatus.js";

export const CAP = 50;

/** The only masjclrentry columns the script reads (besides id, used for paging). */
export const BILL_COLUMNS = [
  "EmpCode", "DOJ", "DOL", "Status", "PanNo", "AdharId", "lastUpdated", "ResignationDate", "left_type",
] as const;

/** An identifier carried by more distinct codes than this is treated as a placeholder. */
export const MAX_CODES_PER_IDENTIFIER = 10;

export const REJOIN_CLASSES = [
  "MISSING_IN_HRMS",
  "OLD_CODE_MISSING_IN_HRMS",
  "STATUS_NOT_REFLECTED",
  "ACTIVE_BUT_TEXT_STALE",
  "REJOIN_TRACE_MISSING",
  "PAIR_UNLINKED_INFO",
  "REFLECTED",
] as const;
export type RejoinClass = (typeof REJOIN_CLASSES)[number];

/** Classes that mean HRMS needs a look (PAIR_UNLINKED_INFO and REFLECTED are informational). */
export const ATTENTION_CLASSES: readonly RejoinClass[] = [
  "MISSING_IN_HRMS", "OLD_CODE_MISSING_IN_HRMS", "STATUS_NOT_REFLECTED", "ACTIVE_BUT_TEXT_STALE", "REJOIN_TRACE_MISSING",
];

/**
 * Every HRMS query goes through this. Allows a single SELECT / WITH ... SELECT only; refuses
 * stacked statements, locking reads and SELECT ... INTO OUTFILE/DUMPFILE.
 */
export function readOnly(sql: string): string {
  const s = String(sql ?? "").trim().toLowerCase();
  const refuse = (why: string): never => {
    throw new Error(`rejoin-dbbill-compare is read-only; refused (${why}): ${s.slice(0, 40)}`);
  };
  if (!(s.startsWith("select") || s.startsWith("with"))) refuse("not a SELECT");
  if (/;\s*\S/.test(s)) refuse("stacked statement");
  if (/\bfor\s+update\b|\block\s+in\s+share\s+mode\b|\bfor\s+share\b/.test(s)) refuse("locking read");
  if (/\binto\s+(outfile|dumpfile)\b/.test(s)) refuse("file write");
  return sql;
}

export function chunk<T>(arr: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * db_bill dates are VARCHAR: '', '0000-00-00', 'yyyy-mm-dd[ hh:mm:ss]', 'dd/mm/yyyy' (also '-' or '.'),
 * occasionally 'mm/dd/yyyy' (swapped only when the month slot cannot be a month). Returns 'YYYY-MM-DD' or null.
 */
export function parseLegacyDate(raw: unknown): string | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return validYmd(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }
  const s = String(raw ?? "").trim();
  if (!s || /^0000/.test(s)) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[ T])/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?:$|[ T])/);
  if (m) {
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    return validYmd(+m[3], mo, d);
  }
  return null;
}

const PAN_RE = /^[A-Z]{3}[ABCFGHLJPT][A-Z][0-9]{4}[A-Z]$/;

/** Upper-cased PAN without spaces, or null when malformed or an obvious placeholder. */
export function normalizePan(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (!PAN_RE.test(s)) return null;
  const letters = s.slice(0, 5), digits = s.slice(5, 9);
  if (/^(.)\1+$/.test(letters)) return null;
  if (/^(.)\1+$/.test(digits)) return null;
  if (letters === "ABCDE") return null; // the textbook sample 'ABCDE1234F' (also fails the holder-type check)
  return s;
}

/** 12 digits, not starting 0/1 (UIDAI never issues those), not all one digit, not 123456789012. */
export function normalizeAadhaar(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/[\s-]/g, "");
  if (!/^[2-9][0-9]{11}$/.test(s)) return null;
  if (/^(.)\1+$/.test(s)) return null;
  if (s === "123456789012") return null;
  return s;
}

export interface LegacyRow {
  id: number;
  code: string;
  doj: unknown;
  dol: unknown;
  status: unknown;
  pan: unknown;
  aadhaar: unknown;
  lastUpdated: unknown;
  resignationDate: unknown;
  leftType: unknown;
}

export const normCode = (c: unknown) => String(c ?? "").trim().toUpperCase();
const isStatusActive = (s: unknown) => String(s ?? "").trim() === "1";
/** Active stint: Status '1' and no parseable leaving date. */
export const isActiveRow = (r: LegacyRow) => isStatusActive(r.status) && parseLegacyDate(r.dol) === null;
/** When the stint ended: DOL, else ResignationDate. */
export const leaveDate = (r: LegacyRow) => parseLegacyDate(r.dol) ?? parseLegacyDate(r.resignationDate);
const isEmptyDate = (raw: unknown) => { const s = String(raw ?? "").trim(); return !s || /^0000/.test(s); };
const EMPTY_TEXT = new Set(["", "0", "-", "NA", "N/A", "NULL", "NONE"]);
const hasText = (raw: unknown) => !EMPTY_TEXT.has(String(raw ?? "").trim().toUpperCase());

/** The row that represents a code's current stint: an active row first, then the latest DOJ, then the highest id. */
export function currentRow(rows: LegacyRow[]): LegacyRow {
  return [...rows].sort((a, b) => {
    const act = Number(isActiveRow(b)) - Number(isActiveRow(a));
    if (act) return act;
    const da = parseLegacyDate(a.doj) ?? "", dbb = parseLegacyDate(b.doj) ?? "";
    if (da !== dbb) return da < dbb ? 1 : -1;
    return b.id - a.id;
  })[0];
}

export interface P1Case { code: string; rows: number; currentActive: boolean }
export interface P2Case { oldCode: string; newCode: string; via: Array<"PAN" | "AADHAAR">; newActive: boolean }
export interface P3Case { code: string }
export interface Detection {
  p1: P1Case[];
  p1DuplicateOnly: string[];
  p2: P2Case[];
  p3: P3Case[];
  stats: { rows: number; codes: number; validPan: number; validAadhaar: number; placeholderIdentifiers: number };
}

export function detectCandidates(input: readonly LegacyRow[]): Detection {
  const rows = input.map((r) => ({ ...r, code: normCode(r.code) })).filter((r) => r.code !== "");
  const byCode = new Map<string, LegacyRow[]>();
  for (const r of rows) {
    const g = byCode.get(r.code);
    if (g) g.push(r); else byCode.set(r.code, [r]);
  }
  const codeActive = new Map<string, boolean>();
  for (const [code, g] of byCode) codeActive.set(code, isActiveRow(currentRow(g)));

  // P1 / P3
  const p1: P1Case[] = [], p1DuplicateOnly: string[] = [], p3: P3Case[] = [];
  for (const [code, g] of byCode) {
    if (g.length >= 2) {
      const dojs = new Set(g.map((r) => parseLegacyDate(r.doj) ?? String(r.doj ?? "").trim()));
      if (dojs.size >= 2) p1.push({ code, rows: g.length, currentActive: codeActive.get(code)! });
      else p1DuplicateOnly.push(code);
    } else {
      const r = g[0];
      if (isStatusActive(r.status) && isEmptyDate(r.dol) && (parseLegacyDate(r.resignationDate) !== null || hasText(r.leftType))) {
        p3.push({ code });
      }
    }
  }

  // P2
  let validPan = 0, validAadhaar = 0, placeholderIdentifiers = 0;
  const byIdent = new Map<string, LegacyRow[]>();
  const add = (k: string, r: LegacyRow) => { const g = byIdent.get(k); if (g) g.push(r); else byIdent.set(k, [r]); };
  for (const r of rows) {
    const pan = normalizePan(r.pan), aad = normalizeAadhaar(r.aadhaar);
    if (pan) { validPan++; add(`PAN:${pan}`, r); }
    if (aad) { validAadhaar++; add(`AADHAAR:${aad}`, r); }
  }
  const pairs = new Map<string, P2Case>();
  for (const [key, g] of byIdent) {
    const codes = new Set(g.map((r) => r.code));
    if (codes.size < 2) continue;
    if (codes.size > MAX_CODES_PER_IDENTIFIER) { placeholderIdentifiers++; continue; }
    const via = key.startsWith("PAN:") ? "PAN" : "AADHAAR";
    for (const b of g) {
      const bDoj = parseLegacyDate(b.doj);
      if (!bDoj) continue;
      let best: LegacyRow | null = null, bestLeave = "";
      for (const a of g) {
        if (a.code === b.code) continue;
        const l = leaveDate(a);
        if (l && l < bDoj && l > bestLeave) { best = a; bestLeave = l; }
      }
      if (!best) continue;
      const k = `${best.code}\u0000${b.code}`;
      const prev = pairs.get(k);
      if (prev) { if (!prev.via.includes(via)) prev.via.push(via); }
      else pairs.set(k, { oldCode: best.code, newCode: b.code, via: [via], newActive: codeActive.get(b.code)! });
    }
  }
  const p2 = [...pairs.values()].sort((x, y) => (x.oldCode + x.newCode).localeCompare(y.oldCode + y.newCode));
  for (const p of p2) p.via.sort((x, y) => (x === "PAN" ? -1 : y === "PAN" ? 1 : 0));

  p1.sort((a, b) => a.code.localeCompare(b.code));
  p3.sort((a, b) => a.code.localeCompare(b.code));
  p1DuplicateOnly.sort();
  return { p1, p1DuplicateOnly, p2, p3, stats: { rows: rows.length, codes: byCode.size, validPan, validAadhaar, placeholderIdentifiers } };
}

export interface Candidate {
  pattern: "P1" | "P2" | "P3";
  /** The db_bill CURRENT code (P2: the NEW code). */
  code: string;
  /** P2 only. */
  oldCode?: string;
  /** db_bill says the current stint is active (Status '1', no DOL). */
  billCurrentActive: boolean;
}

export function toCandidates(d: Detection): Candidate[] {
  return [
    ...d.p1.map((c): Candidate => ({ pattern: "P1", code: c.code, billCurrentActive: c.currentActive })),
    ...d.p2.map((c): Candidate => ({ pattern: "P2", code: c.newCode, oldCode: c.oldCode, billCurrentActive: c.newActive })),
    ...d.p3.map((c): Candidate => ({ pattern: "P3", code: c.code, billCurrentActive: true })),
  ];
}

export interface HrmsFacts {
  employmentStatus: string | null;
  activeStatus: number | null;
  dateOfJoining: string | null;
  dateOfExit: string | null;
  reactivationCount: number | null;
  previousExitDate: string | null;
  /** employment_stint rows with stint_no >= 2 (stint 1 is every employee's first stint). */
  rejoinStints: number;
  rejoinedExits: number;
  approvedReactivations: number;
}

const TERMINAL = new Set(NON_REACTIVATABLE_STATUSES.map((s) => s.toLowerCase()));
export const isTerminalStatus = (s: string | null | undefined) => TERMINAL.has(String(s ?? "").trim().toLowerCase());

export function hasRejoinTrace(f: HrmsFacts): boolean {
  return f.rejoinStints > 0 || f.rejoinedExits > 0 || f.approvedReactivations > 0
    || Number(f.reactivationCount ?? 0) > 0 || (f.previousExitDate != null && String(f.previousExitDate).trim() !== "");
}

/**
 * Classes for one candidate. `cur` = HRMS facts for the current/new code, `old` = for the P2 old code
 * (null = no employees row). Result is in REJOIN_CLASSES order; [] = nothing to say.
 */
export function classifyCase(c: Candidate, cur: HrmsFacts | null, old?: HrmsFacts | null): RejoinClass[] {
  const out = new Set<RejoinClass>();
  if (!cur) out.add("MISSING_IN_HRMS");
  if (c.pattern === "P2") {
    if (!old) out.add("OLD_CODE_MISSING_IN_HRMS");
    else if (cur) out.add("PAIR_UNLINKED_INFO");
  }
  if (cur) {
    const active = Number(cur.activeStatus) === 1;
    const terminal = isTerminalStatus(cur.employmentStatus);
    const trace = hasRejoinTrace(cur);
    if (c.billCurrentActive && (!active || terminal)) out.add("STATUS_NOT_REFLECTED");
    if (active && terminal) out.add("ACTIVE_BUT_TEXT_STALE");
    if (c.pattern !== "P2" && active && !trace) out.add("REJOIN_TRACE_MISSING");
    if (trace) out.add("REFLECTED");
  }
  return REJOIN_CLASSES.filter((k) => out.has(k));
}

/** Indented lines, at most `cap` items, then "... N more not shown (cap N)". */
export function formatCapped(items: readonly string[], cap = CAP): string[] {
  if (items.length === 0) return ["  (none)"];
  const lines = items.slice(0, cap).map((s) => `  ${s}`);
  if (items.length > cap) lines.push(`  ... ${items.length - cap} more not shown (cap ${cap})`);
  return lines;
}

/** Digit/letter shape of a value ('dd/dd/dddd'), for format reporting without values. */
export const shapeOf = (raw: unknown) =>
  String(raw ?? "").trim().replace(/[A-Za-z]/g, "a").replace(/[0-9]/g, "d").slice(0, 24) || "(empty)";
