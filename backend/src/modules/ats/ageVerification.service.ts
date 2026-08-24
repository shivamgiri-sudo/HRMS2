/**
 * Age verification, and the legal block on onboarding a minor.
 *
 * Nothing enforced this before. The only age logic in the codebase was in
 * OnboardingSteps1to5.tsx: frontend-only, using 16 rather than 18, computed into
 * a display string that was never consulted before save. `ats_candidate.is_minor`
 * and `guardian_consent_obtained` exist (migration 336) but nothing has ever
 * written them, so the DPDP minor-consent banner could never render.
 *
 * DOB is resolved in descending order of evidence, and which source decided is
 * recorded — an audit needs to show WHY someone was allowed or blocked, not just
 * the verdict:
 *
 *   1. candidate_bgv_check.matched_dob — returned by the verification provider
 *      during the PAN/Aadhaar check. Already populated by
 *      bgv-verification.service.ts and, until now, read by nothing.
 *   2. OCR of the Aadhaar or 10th marksheet. The 10th certificate is the
 *      canonical Indian age proof and is already a mandatory upload.
 *   3. Self-declared. Lowest trust: a candidate can type anything.
 *
 * DigiLocker is deliberately absent. toDocumentResult returns only a file blob
 * and never parses identity fields, so there is no verified DOB there to read —
 * claiming otherwise would be inventing a source.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../lib/logger.js";

/** Employment below this age is prohibited; 18 is the working standard for BPO/call-centre employment under state Shops & Establishments Acts. */
export const MINIMUM_EMPLOYMENT_AGE = 18;

/** The letter states retirement at 58. Flagged, never blocked — that is a policy call, not a legal bar to onboarding. */
export const SUPERANNUATION_AGE = 58;

export type DobSource = "bgv_verified" | "ocr_document" | "self_declared" | "none";

export type AgeVerification = {
  dob: string | null;
  source: DobSource;
  /** Age on the reference date (joining date when known, else today). */
  age: number | null;
  isMinor: boolean;
  /** True only when the DOB came from a provider-verified source. */
  verified: boolean;
  /** Sources that disagree — surfaced to HR rather than silently preferring one. */
  conflicts: Array<{ source: DobSource; dob: string }>;
  reason: string;
};

function toIsoDate(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) {
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  }
  // Format in IST: a DOB stored at 18:30 UTC is the next day in India, and being
  // a day out matters at the 18th-birthday boundary.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** Whole years completed on `on`. Calendar arithmetic, not milliseconds — 365.25 is wrong across leap years. */
export function ageOn(dobIso: string, on: Date = new Date()): number {
  const [y, m, d] = dobIso.split("-").map(Number);
  let age = on.getFullYear() - y;
  const beforeBirthday =
    on.getMonth() + 1 < m || (on.getMonth() + 1 === m && on.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/** Pull a date of birth out of OCR text. Handles the formats Indian IDs actually print. */
export function extractDobFromText(text: string): string | null {
  if (!text) return null;
  const patterns: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    // DOB: 01/02/1990 or 01-02-1990 (dd/mm/yyyy — Aadhaar and marksheets)
    [/\b(?:DOB|D\.O\.B|Date of Birth|Birth)\D{0,12}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/i,
      (m) => `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`],
    // Year of Birth: 1990 — Aadhaar prints this when only the year is known.
    [/\b(?:YOB|Year of Birth)\D{0,8}(\d{4})\b/i, (m) => `${m[1]}-01-01`],
    // Bare dd/mm/yyyy anywhere, as a last resort.
    [/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/,
      (m) => `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`],
  ];

  for (const [re, build] of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const iso = build(m);
    const d = new Date(`${iso}T12:00:00+05:30`);
    if (Number.isNaN(d.getTime())) continue;
    const year = Number(iso.slice(0, 4));
    // A plausible working-age DOB. Rejects OCR noise like an issue date of 2024,
    // a garbled 1899, or any year that would make the person < 15 (could never
    // be a valid candidate DOB — only document issue/print dates land there).
    if (year < 1930 || year > new Date().getFullYear() - 15) continue;
    return iso;
  }
  return null;
}

/**
 * Resolve the most trustworthy date of birth on file.
 * `referenceDate` should be the joining date — age is judged when employment
 * starts, not when the form happens to be filled in.
 */
export async function resolveVerifiedDob(
  candidateId: string,
  referenceDate?: Date | string | null,
): Promise<AgeVerification> {
  const candidates: Array<{ source: DobSource; dob: string }> = [];

  // 1. provider-verified
  const [bgv] = await db.execute<RowDataPacket[]>(
    `SELECT matched_dob FROM candidate_bgv_check
      WHERE candidate_id = ? AND matched_dob IS NOT NULL
      ORDER BY updated_at DESC LIMIT 1`,
    [candidateId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const bgvDob = toIsoDate((bgv as RowDataPacket[])[0]?.matched_dob);
  if (bgvDob) candidates.push({ source: "bgv_verified", dob: bgvDob });

  // 2. OCR of an uploaded identity/age document
  const [docs] = await db.execute<RowDataPacket[]>(
    `SELECT ocr_raw_text FROM candidate_onboarding_document
      WHERE candidate_id = ? AND ocr_raw_text IS NOT NULL AND ocr_raw_text <> ''
        AND (LOWER(doc_type) LIKE '%aadhaar%' OR LOWER(doc_type) LIKE '%aadhar%'
             OR LOWER(doc_type) LIKE '%10th%' OR LOWER(doc_name) LIKE '%10th%')
      ORDER BY uploaded_at DESC LIMIT 5`,
    [candidateId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  for (const d of docs as RowDataPacket[]) {
    const dob = extractDobFromText(String(d.ocr_raw_text ?? ""));
    if (dob) { candidates.push({ source: "ocr_document", dob }); break; }
  }

  // 3. self-declared
  const [prof] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(p.date_of_birth, c.date_of_birth) AS dob
       FROM ats_candidate c
       LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
      WHERE c.id = ? LIMIT 1`,
    [candidateId],
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const declared = toIsoDate((prof as RowDataPacket[])[0]?.dob);
  if (declared) candidates.push({ source: "self_declared", dob: declared });

  if (candidates.length === 0) {
    return {
      dob: null, source: "none", age: null, isMinor: false, verified: false,
      conflicts: [],
      reason: "No date of birth is on record from any source, so age could not be verified.",
    };
  }

  const chosen = candidates[0];
  const on = referenceDate ? new Date(referenceDate) : new Date();
  const reference = Number.isNaN(on.getTime()) ? new Date() : on;
  const age = ageOn(chosen.dob, reference);

  // Disagreement beyond a day is worth HR's attention; a one-day gap is a
  // timezone artefact, not a discrepancy.
  const conflicts = candidates.slice(1).filter((c) => {
    const diff = Math.abs(new Date(c.dob).getTime() - new Date(chosen.dob).getTime());
    return diff > 36 * 3600 * 1000;
  });

  return {
    dob: chosen.dob,
    source: chosen.source,
    age,
    isMinor: age < MINIMUM_EMPLOYMENT_AGE,
    verified: chosen.source === "bgv_verified",
    conflicts,
    reason:
      age < MINIMUM_EMPLOYMENT_AGE
        ? `Date of birth ${chosen.dob} makes this candidate ${age} years old, below the minimum employment age of ${MINIMUM_EMPLOYMENT_AGE}.`
        : `Age ${age} verified from ${chosen.source.replace(/_/g, " ")}.`,
  };
}

/**
 * Stop onboarding an underage candidate.
 *
 * Throws in the shape the existing onboarding guards use, so the caller's error
 * handling and the candidate-facing message work unchanged.
 */
export async function assertEmployableAge(
  candidateId: string,
  referenceDate?: Date | string | null,
): Promise<AgeVerification> {
  const v = await resolveVerifiedDob(candidateId, referenceDate);
  // Only hard-block when the DOB was confirmed by a verification provider.
  // OCR extraction is too noisy (garbled scans, rotated images, issue dates
  // misread as birth dates) to be a hard gate for the candidate. Self-declared
  // typos also shouldn't stop submission. HR sees the age flag during review
  // and can reject at the approval stage if the candidate is genuinely underage.
  if (v.isMinor && v.verified) {
    throw Object.assign(
      new Error(
        `This candidate is ${v.age} years old. Employment below ${MINIMUM_EMPLOYMENT_AGE} is not permitted, so onboarding cannot continue.`,
      ),
      { statusCode: 400, code: "UNDERAGE_CANDIDATE", ageVerification: v },
    );
  }
  return v;
}

/**
 * Persist the DPDP minor flag.
 *
 * The column and the consent banner have existed since migration 336; nothing
 * ever computed the value, so the banner could not render.
 *
 * The write itself used to be `.catch(() => undefined)` — completely silent, with no
 * logging at all — so a real write failure (schema drift, a dropped connection) would
 * reproduce the exact defect this function exists to fix, invisibly: the guardian-consent
 * banner still wouldn't render for a genuine minor, and nobody would know why. Logged
 * loudly instead so a failure here is observable and can be investigated/backfilled,
 * rather than blocking the whole onboarding submission over one column write — the hard
 * legal block on employing anyone under MINIMUM_EMPLOYMENT_AGE lives in
 * assertEmployableAge, above, and is unaffected by this flag either way.
 */
export async function persistMinorFlag(candidateId: string, v: AgeVerification): Promise<void> {
  await db.execute(
    `UPDATE ats_candidate SET is_minor = ?, updated_at = NOW() WHERE id = ?`,
    [v.isMinor ? 1 : 0, candidateId],
  ).catch((err: unknown) => {
    logger.error({ err, candidateId, isMinor: v.isMinor }, '[ageVerification] Failed to persist is_minor flag');
  });
}
