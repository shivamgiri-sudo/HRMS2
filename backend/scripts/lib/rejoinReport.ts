/**
 * Pure report helpers for scripts/rejoin-dbbill-compare.ts: code-family breakdown, detail rows for the
 * actionable classes and the current-rejoiner (P2 new code active in db_bill) classification.
 * No I/O. Prints employee codes, dates, status codes and categorical values only.
 */
import {
  ATTENTION_CLASSES, REJOIN_CLASSES, codeFamily, formatCapped, isTerminalStatus, parseLegacyDate,
  type BillFacts, type Candidate, type CodeFamily, type HrmsFacts, type RejoinClass,
} from "./rejoinCompare.js";

export const NON_IDC_CAP = 300;
export const DETAIL_CAP = 100;
const FAMILIES: readonly CodeFamily[] = ["IDC", "MAS", "NUMC", "OTHER"];

export interface ClassifiedCase { cand: Candidate; classes: RejoinClass[] }

/** The code a class is about: OLD_CODE_MISSING_IN_HRMS -> the old code, every other class -> the current/new code. */
export const relevantCode = (k: RejoinClass, c: Candidate) => (k === "OLD_CODE_MISSING_IN_HRMS" ? c.oldCode ?? c.code : c.code);

const familyKey = (k: RejoinClass, c: Candidate) =>
  (k === "PAIR_UNLINKED_INFO" ? `${codeFamily(c.oldCode)}->${codeFamily(c.code)}` : codeFamily(relevantCode(k, c)));

const byCountThenKey = (m: Map<string, number>) =>
  new Map([...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));

/** Case counts per code family, for every class that has at least one case (REJOIN_CLASSES order). */
export function familyBreakdown(cases: readonly ClassifiedCase[]): Map<RejoinClass, Map<string, number>> {
  const out = new Map<RejoinClass, Map<string, number>>();
  for (const k of REJOIN_CLASSES) {
    const m = new Map<string, number>();
    for (const c of cases) if (c.classes.includes(k)) { const f = familyKey(k, c.cand); m.set(f, (m.get(f) ?? 0) + 1); }
    if (m.size) out.set(k, byCountThenKey(m));
  }
  return out;
}

export interface NonIdcAttention {
  /** Attention class (with >= 1 case) -> sorted distinct non-IDC relevant codes. */
  perClass: Map<RejoinClass, string[]>;
  nonIdcCodes: string[];
  idcCodes: number;
  nonIdcByFamily: Map<CodeFamily, number>;
}

export function nonIdcAttention(cases: readonly ClassifiedCase[]): NonIdcAttention {
  const perClass = new Map<RejoinClass, string[]>();
  const nonIdc = new Set<string>(), idc = new Set<string>();
  for (const k of ATTENTION_CLASSES) {
    const set = new Set<string>();
    let any = false;
    for (const c of cases) {
      if (!c.classes.includes(k)) continue;
      any = true;
      const code = relevantCode(k, c.cand);
      if (codeFamily(code) === "IDC") idc.add(code); else { set.add(code); nonIdc.add(code); }
    }
    if (any) perClass.set(k, [...set].sort());
  }
  const nonIdcByFamily = new Map<CodeFamily, number>();
  for (const f of FAMILIES) {
    const n = [...nonIdc].filter((c) => codeFamily(c) === f).length;
    if (n) nonIdcByFamily.set(f, n);
  }
  return { perClass, nonIdcCodes: [...nonIdc].sort(), idcCodes: idc.size, nonIdcByFamily };
}

const indent = (lines: string[]) => lines.map((l) => `  ${l}`);

function classHeading(k: RejoinClass, n: number): string {
  if (k === "PAIR_UNLINKED_INFO") return `  ${k} (family OLD->NEW; cases: ${n})`;
  if (k === "MISSING_IN_HRMS") return `  ${k} (family of the NEW/current code; cases: ${n})`;
  if (k === "OLD_CODE_MISSING_IN_HRMS") return `  ${k} (family of the OLD code; cases: ${n})`;
  return `  ${k} (family of the code; cases: ${n})`;
}

/** Section (3): per-class family tables, the IDC note, the NON-IDC headline and the non-IDC code lists (cap 300). */
export function formatFamilySection(cases: readonly ClassifiedCase[]): string[] {
  const lines = ["== (3) BREAKDOWN BY CODE FAMILY =="];
  lines.push("  families (on UPPER(TRIM(code))): IDC = starts with IDC; MAS = MAS + digits; NUMC = digits + 'C'; OTHER = anything else");
  const b = familyBreakdown(cases);
  if (b.size === 0) lines.push("  (no cases)");
  for (const [k, m] of b) {
    lines.push(classHeading(k, [...m.values()].reduce((s, n) => s + n, 0)));
    for (const [f, n] of m) lines.push(`    ${f.padEnd(10)} ${n}`);
  }
  lines.push("  NOTE: IDC codes are excluded from HRMS by design: the db_bill -> HRMS sync (dbbill-snapshot-sync.sql, "
    + "sync-from-dbbill.cjs) filters EmpCode NOT LIKE 'IDC%', so IDC gaps are expected and only counted here.");
  const a = nonIdcAttention(cases);
  const fams = [...a.nonIdcByFamily.entries()].map(([f, n]) => `${f}=${n}`).join(", ");
  lines.push(`  NON-IDC gaps needing attention: ${a.nonIdcCodes.length} distinct code(s)${fams ? ` (${fams})` : ""}; `
    + `IDC-family codes in attention classes (counted only, not listed): ${a.idcCodes}`);
  for (const [k, codes] of a.perClass) {
    lines.push(`  ${k} non-IDC codes: ${codes.length} (list cap ${NON_IDC_CAP})`);
    lines.push(...indent(formatCapped(codes, NON_IDC_CAP)));
  }
  return lines;
}

const dash = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? "-" : String(v));
const cleanStatus = (s: unknown) => String(s ?? "").replace(/[^A-Za-z _-]/g, "").replace(/\s+/g, " ").trim().slice(0, 30);

/** HRMS columns: employment_status | active_status | date_of_joining | date_of_exit | reactivation_count | stint rows. */
function hrmsCols(h: HrmsFacts | null | undefined): string[] {
  if (!h) return ["-", "-", "-", "-", "-", "-"];
  return [
    dash(cleanStatus(h.employmentStatus)), dash(h.activeStatus), dash(parseLegacyDate(h.dateOfJoining)),
    dash(parseLegacyDate(h.dateOfExit)), dash(h.reactivationCount), dash(h.stintRows),
  ];
}
const HRMS_HEADER = "hrms_employment_status | hrms_active_status | hrms_date_of_joining | hrms_date_of_exit | hrms_reactivation_count | hrms_stint_rows";

export const DETAIL_HEADER = "code | pattern | bill_status | bill_doj | bill_left (DOL, else ResignationDate) | bill_left_type | " + HRMS_HEADER;

export function formatDetailRow(c: Candidate, bill: BillFacts | undefined, h: HrmsFacts | null | undefined): string {
  const pattern = c.pattern === "P2" ? `P2 ${c.oldCode}->${c.code}` : c.pattern;
  return [
    c.code, pattern, dash(bill?.status), dash(bill?.doj), dash(bill?.left), dash(bill?.leftType), ...hrmsCols(h),
  ].join(" | ");
}

/** Header + one row per case sorted by code (P2 by new code, then old), capped at 100. */
export function formatDetailRows(cands: readonly Candidate[], bill: Map<string, BillFacts>, facts: Map<string, HrmsFacts>): string[] {
  if (cands.length === 0) return ["  (none)"];
  const rows = [...cands]
    .sort((a, b) => (a.code + "\u0000" + (a.oldCode ?? "")).localeCompare(b.code + "\u0000" + (b.oldCode ?? "")))
    .map((c) => formatDetailRow(c, bill.get(c.code), facts.get(c.code) ?? null));
  return [`  ${DETAIL_HEADER}`, ...formatCapped(rows, DETAIL_CAP)];
}

export interface CurrentRejoiners {
  /** Distinct P2 new codes that are active in db_bill. */
  total: number;
  active: string[];
  inactive: string[];
  missing: string[];
  /** P2 pairs whose new code is not active in db_bill (historical rejoiners who left again). */
  historical: number;
}

export function currentRejoiners(cands: readonly Candidate[], facts: Map<string, HrmsFacts>): CurrentRejoiners {
  const codes = new Set<string>();
  let historical = 0;
  for (const c of cands) {
    if (c.pattern !== "P2") continue;
    if (c.billCurrentActive) codes.add(c.code); else historical++;
  }
  const active: string[] = [], inactive: string[] = [], missing: string[] = [];
  for (const code of [...codes].sort()) {
    const h = facts.get(code);
    if (!h) missing.push(code);
    else if (Number(h.activeStatus) === 1 && !isTerminalStatus(h.employmentStatus)) active.push(code);
    else inactive.push(code);
  }
  return { total: codes.size, active, inactive, missing, historical };
}

/** Section (4). */
export function formatCurrentRejoiners(r: CurrentRejoiners, facts: Map<string, HrmsFacts>): string[] {
  return [
    "== (4) CURRENT REJOINERS UNDER A NEW CODE (db_bill active) ==",
    `  P2 new codes active in db_bill (distinct): ${r.total}`,
    `    present in HRMS and active: ${r.active.length}`,
    `    present in HRMS but NOT active: ${r.inactive.length}`,
    `    missing from HRMS: ${r.missing.length}`,
    `  missing from HRMS, codes (cap ${NON_IDC_CAP}):`,
    ...indent(formatCapped(r.missing, NON_IDC_CAP)),
    `  present in HRMS but NOT active (cap ${NON_IDC_CAP}): code | ${HRMS_HEADER}`,
    ...indent(formatCapped(r.inactive.map((c) => [c, ...hrmsCols(facts.get(c))].join(" | ")), NON_IDC_CAP)),
    `  historical P2 pairs whose new code is no longer active in db_bill: ${r.historical} (unchanged; see section (2))`,
  ];
}
