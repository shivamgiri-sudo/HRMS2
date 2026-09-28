/**
 * Identity snapshot for the fraud-review screen.
 *
 * The screen has to answer one question in plain words: "is this the same person as
 * the one this alert matched, or a different person?". That needs the same handful
 * of facts about each side — name, date of birth, gender, father's name, mobile,
 * Aadhaar/PAN, what the government (DigiLocker) said, which phone the form was
 * filled from — none of which the older comparison payload carried.
 *
 * Everything returned here is masked to the same level the rest of the review
 * screen already shows (last four of Aadhaar and mobile, PAN with the middle
 * hidden). Full Aadhaar/PAN numbers never leave the server.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { extractDigilockerDemographics } from "./digilocker-demographics.js";

export interface GovtIdentity {
  name: string | null;
  dob: string | null;
  gender: "Male" | "Female" | "Other" | null;
  aadhaarLast4: string | null;
}

export interface IdentitySnapshot {
  candidateId: string;
  code: string | null;
  /** The name on the candidate record (DigiLocker overwrites it); `name` below is what the candidate typed. */
  displayName: string | null;
  name: string | null;
  dob: string | null;
  gender: string | null;
  fatherName: string | null;
  mobileMasked: string | null;
  aadhaarLast4: string | null;
  panMasked: string | null;
  govt: GovtIdentity | null;
  selfieDocId: string | null;
  hasDigilockerPhoto: boolean;
  employee: { code: string; name: string | null; status: string | null; joinedOn: string | null } | null;
}

export interface IdentityComparison {
  subject: IdentitySnapshot;
  other: IdentitySnapshot | null;
  sharedMobile: boolean | null;
  sharedDevice: boolean | null;
}

export function maskMobile(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `XXXXXX${digits.slice(-4)}` : null;
}

export function last4(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** ABCDE1234F -> ABCXXXX4F. Anything that is not a full PAN is returned as-is only if already masked. */
export function maskPan(value: unknown): string | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(raw)) return `${raw.slice(0, 3)}XXXX${raw.slice(-2)}`;
  if (/^[A-Z]{3}X{4}[A-Z0-9]{2}$/.test(raw)) return raw;
  return null;
}

const clean = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s ? s : null;
};

async function loadSnapshot(candidateId: string): Promise<IdentitySnapshot | null> {
  const [candRows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id, c.candidate_code, c.full_name,
            DATE_FORMAT(c.date_of_birth, '%Y-%m-%d') AS cand_dob,
            c.mobile, c.aadhar_number, c.pan_number,
            p.employee_name, p.gender AS profile_gender,
            DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS profile_dob,
            p.father_husband_name, p.mobile_number,
            p.aadhaar_number_masked, p.pan_number_masked
       FROM ats_candidate c
       LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
      WHERE c.id = ? LIMIT 1`,
    [candidateId],
  );
  const c = candRows[0];
  if (!c) return null;

  const [govtRows] = await db.execute<RowDataPacket[]>(
    `SELECT CAST(result_json AS CHAR) AS rj
       FROM candidate_bgv_check
      WHERE candidate_id = ? AND check_type = 'digilocker' AND status = 'verified'
      ORDER BY updated_at DESC LIMIT 1`,
    [candidateId],
  );
  let govt: GovtIdentity | null = null;
  const rj = govtRows[0]?.rj;
  if (rj) {
    try {
      const d = extractDigilockerDemographics(JSON.parse(String(rj)));
      if (d.fullName || d.dateOfBirth || d.gender || d.aadhaarLast4) {
        govt = { name: d.fullName, dob: d.dateOfBirth, gender: d.gender, aadhaarLast4: d.aadhaarLast4 };
      }
    } catch {
      govt = null;
    }
  }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_code, full_name, employment_status,
            DATE_FORMAT(date_of_joining, '%Y-%m-%d') AS joined_on
       FROM employees WHERE candidate_id = ? LIMIT 1`,
    [candidateId],
  );
  const e = empRows[0];

  const [selfieRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM candidate_onboarding_document
      WHERE candidate_id = ? AND deleted_at IS NULL AND LOWER(doc_type) LIKE '%selfie%'
      ORDER BY uploaded_at DESC LIMIT 1`,
    [candidateId],
  );

  return {
    candidateId,
    code: clean(c.candidate_code),
    displayName: clean(c.full_name),
    name: clean(c.employee_name) ?? clean(c.full_name),
    dob: clean(c.profile_dob) ?? clean(c.cand_dob),
    gender: clean(c.profile_gender),
    fatherName: clean(c.father_husband_name),
    mobileMasked: maskMobile(c.mobile_number ?? c.mobile),
    aadhaarLast4: last4(c.aadhar_number) ?? last4(c.aadhaar_number_masked),
    panMasked: maskPan(c.pan_number) ?? maskPan(c.pan_number_masked),
    govt,
    selfieDocId: selfieRows[0]?.id ? String(selfieRows[0].id) : null,
    hasDigilockerPhoto: govt !== null,
    employee: e
      ? {
          code: String(e.employee_code),
          name: clean(e.full_name),
          status: clean(e.employment_status),
          joinedOn: clean(e.joined_on),
        }
      : null,
  };
}

/** True when both candidates' onboarding sessions came from the same IP and browser. */
async function sharedDevice(a: string, b: string): Promise<boolean | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT candidate_id, ip_address, LEFT(user_agent, 120) AS ua
       FROM candidate_onboarding_submission_log
      WHERE candidate_id IN (?, ?) AND action_by_type = 'candidate'
        AND ip_address IS NOT NULL AND user_agent IS NOT NULL
      GROUP BY candidate_id, ip_address, LEFT(user_agent, 120)`,
    [a, b],
  );
  const keys = (id: string) =>
    new Set(rows.filter((r) => String(r.candidate_id) === id).map((r) => `${r.ip_address}|${r.ua}`));
  const ka = keys(a);
  const kb = keys(b);
  if (!ka.size || !kb.size) return null;
  for (const k of ka) if (kb.has(k)) return true;
  return false;
}

/**
 * `matchedCandidateId` is the candidate the blocking alert matched against (null for
 * alerts about one person only, e.g. a face mismatch).
 */
export async function buildIdentityComparison(
  candidateId: string,
  matchedCandidateId: string | null,
): Promise<IdentityComparison | null> {
  const subject = await loadSnapshot(candidateId);
  if (!subject) return null;
  const other = matchedCandidateId ? await loadSnapshot(matchedCandidateId) : null;
  const sharedMobile =
    other && subject.mobileMasked && other.mobileMasked ? subject.mobileMasked === other.mobileMasked : null;
  const device = other ? await sharedDevice(candidateId, other.candidateId).catch(() => null) : null;
  return { subject, other, sharedMobile, sharedDevice: device };
}
