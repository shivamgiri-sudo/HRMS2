/**
 * What is actually holding a candidate's BGV back, in HR's words, and who has to act.
 *
 * Ops Control Tower used to show only the stored overall_status ("in_progress"), which told HR nothing:
 * the onboarding link looked finished, because the candidate-side steps were, while address / bank review
 * waited on HR or Payroll. This mirrors the category rules of computeAndSaveScore
 * (bgv-verification.service.ts) read-only: same normalisation, same precedence, same DigiLocker-covers-
 * Aadhaar+PAN rule, same manual report columns, same applicability.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  APPLICABLE_CHECKS_ROW_SQL,
  deriveApplicableChecksFromRow,
  normalizeCheckType,
} from "./bgv-verification.service.js";

export type PendingOwner = "candidate" | "hr" | "payroll" | "vendor";
export interface PendingItem {
  category: "identity" | "bank" | "address" | "employment" | "criminal";
  label: string;
  owner: PendingOwner;
  /** What to do, imperative, no commas (the drawer splits the summary on commas). */
  action: string;
  failed: boolean;
}

export interface PendingInput {
  /** candidate_bgv_check rows: raw check_type -> statuses seen. */
  checks: Array<{ check_type: string; status: string }>;
  /** candidate_bgv_report manual columns (passed|failed|partial|not_run), or null when there is no report. */
  report: Partial<Record<"aadhaar" | "pan" | "bank" | "education" | "employment" | "address" | "criminal", string | null>> | null;
  includeEmployment: boolean;
  includeCriminal: boolean;
  /** Newest geo-selfie attempt status, null when none was ever created. */
  addressAttempt: string | null;
}

const PRECEDENCE: Record<string, number> = { verified: 4, waived: 3, manual_review: 2, mismatch: 1, failed: 1, partial: 1 };

export function pendingItems(input: PendingInput): PendingItem[] {
  const best = new Map<string, string>();
  for (const c of input.checks) {
    const norm = normalizeCheckType(String(c.check_type));
    const incoming = PRECEDENCE[String(c.status)] ?? 0;
    const existing = PRECEDENCE[best.get(norm) ?? ""] ?? -1;
    if (incoming > existing) best.set(norm, String(c.status));
  }
  for (const category of ["aadhaar", "pan", "bank", "education", "employment", "address", "criminal"] as const) {
    if (best.has(category)) continue;
    const manual = input.report?.[category];
    if (manual === "passed") best.set(category, "verified");
    else if (manual === "failed") best.set(category, "failed");
    else if (manual === "partial") best.set(category, "partial");
  }
  const clear = (t: string) => best.get(t) === "verified" || best.get(t) === "waived";
  const failed = (t: string) => ["failed", "mismatch"].includes(best.get(t) ?? "");

  const out: PendingItem[] = [];

  const digilockerClear = clear("digilocker");
  if (!digilockerClear && !(clear("aadhaar") && clear("pan"))) {
    const missing = [!clear("aadhaar") && "Aadhaar", !clear("pan") && "PAN"].filter(Boolean).join(" and ");
    const bad = failed("aadhaar") || failed("pan");
    out.push({
      category: "identity", label: missing, failed: bad,
      owner: bad ? "hr" : "candidate",
      action: bad ? "HR to review the failed identity check" : "candidate to connect DigiLocker or upload the document",
    });
  }

  if (!clear("bank")) {
    const review = best.get("bank") === "manual_review" || failed("bank");
    out.push({
      category: "bank", label: "Bank", failed: failed("bank"),
      owner: review ? "payroll" : "candidate",
      action: review ? "Payroll Head to approve or reject in the manual bank review queue" : "candidate to submit the bank account for penny drop",
    });
  }

  // Education is not applicable (BGV_NOT_APPLICABLE_CATEGORIES, owner decision 2026-10-17): it can still be
  // recorded on the report, but it is never listed as pending and never holds the BGV back.

  if (!clear("address")) {
    const a = input.addressAttempt;
    let owner: PendingOwner = "hr";
    let action = "HR to send the address selfie link (Copy address link)";
    if (failed("address")) action = "HR to review the failed address check";
    else if (a === "pending") { owner = "candidate"; action = "candidate has not opened the address selfie link"; }
    else if (a === "submitted") action = "selfie submitted - HR to decide on the BGV report";
    else if (a === "expired" || a === "failed") action = "link expired or attempts used - HR to re-send or decide";
    out.push({ category: "address", label: "Address", failed: failed("address"), owner, action });
  }

  if (input.includeEmployment && !clear("employment")) {
    out.push({
      category: "employment", label: "Employment", failed: failed("employment"), owner: "hr",
      action: "HR to verify the previous employer",
    });
  }
  if (input.includeCriminal && !clear("criminal")) {
    out.push({
      category: "criminal", label: "Criminal", failed: failed("criminal"), owner: "vendor",
      action: "awaiting the criminal record check result",
    });
  }
  return out;
}

/**
 * Whether a report counts as done right now, from its per-category checks, without waiting for the stored
 * overall_status to be recomputed (it is only rewritten when a check changes, so a rule change such as
 * education becoming not applicable leaves old rows stale). Mirrors computeAndSaveScore: a stored 'clear' is
 * done; a 'negative' (HR hard reject) or a locked report keeps its stored verdict; otherwise done when
 * nothing applicable is outstanding or failed.
 */
export function isBgvDone(storedStatus: string | null | undefined, locked: unknown, items: PendingItem[] | undefined): boolean {
  const s = String(storedStatus ?? "").toLowerCase();
  if (s === "clear") return true;
  if (s === "negative" || Number(locked) === 1) return false;
  return items !== undefined && items.length === 0;
}

/** "2 pending: Address (HR to send the address selfie link ...), Employment (...)". */
export function summarisePending(items: PendingItem[]): string {
  if (!items.length) return "Checks complete - overall status not refreshed yet";
  return `${items.length} pending: ${items.map((i) => `${i.label} (${i.action})`).join(", ")}`;
}

/** Batch loader: one query per table for the whole list, never per candidate. */
export async function getPendingItemsBatch(candidateIds: string[]): Promise<Map<string, PendingItem[]>> {
  const out = new Map<string, PendingItem[]>();
  const ids = [...new Set(candidateIds.filter(Boolean))];
  if (!ids.length) return out;
  const ph = ids.map(() => "?").join(",");
  const [checks, reports, applic, attempts] = await Promise.all([
    db.execute<RowDataPacket[]>(`SELECT candidate_id, check_type, status FROM candidate_bgv_check WHERE candidate_id IN (${ph})`, ids),
    db.execute<RowDataPacket[]>(
      `SELECT candidate_id, aadhaar_status, pan_status, bank_status, education_status, employment_status, address_status, criminal_status
         FROM candidate_bgv_report WHERE candidate_id IN (${ph})`, ids),
    db.execute<RowDataPacket[]>(`SELECT c.id AS candidate_id, ${APPLICABLE_CHECKS_ROW_SQL} WHERE c.id IN (${ph})`, ids),
    db.execute<RowDataPacket[]>(
      `SELECT v.candidate_id, v.status FROM candidate_bgv_address_verification v
        WHERE v.candidate_id IN (${ph})
          AND v.created_at = (SELECT MAX(v2.created_at) FROM candidate_bgv_address_verification v2 WHERE v2.candidate_id = v.candidate_id)`, ids),
  ]);
  const group = <T extends RowDataPacket>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) { const k = String(r.candidate_id); m.set(k, [...(m.get(k) ?? []), r]); }
    return m;
  };
  const checkBy = group(checks[0]);
  const reportBy = new Map(reports[0].map((r) => [String(r.candidate_id), r]));
  const applicBy = new Map(applic[0].map((r) => [String(r.candidate_id), r]));
  const attemptBy = new Map(attempts[0].map((r) => [String(r.candidate_id), String(r.status)]));
  for (const id of ids) {
    const rep = reportBy.get(id);
    const ap = deriveApplicableChecksFromRow(applicBy.get(id));
    out.set(id, pendingItems({
      checks: (checkBy.get(id) ?? []).map((c) => ({ check_type: String(c.check_type), status: String(c.status) })),
      report: rep ? {
        aadhaar: rep.aadhaar_status, pan: rep.pan_status, bank: rep.bank_status, education: rep.education_status,
        employment: rep.employment_status, address: rep.address_status, criminal: rep.criminal_status,
      } : null,
      includeEmployment: ap.includeEmployment,
      includeCriminal: ap.includeCriminal,
      addressAttempt: attemptBy.get(id) ?? null,
    }));
  }
  return out;
}
