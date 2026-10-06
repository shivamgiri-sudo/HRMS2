/**
 * Getting a joiner's onboarding bank account onto their employee record.
 *
 * The rule (owner, 2026-10-06): the system does it automatically; only exceptions reach a
 * person.
 *
 *  - AUTOMATIC. A bank check that comes back 'verified' (the bank confirmed the account and its
 *    owner matches the joiner, by name or through their verified PAN) is copied straight into
 *    employee_bank_detail by copyVerifiedBankToEmployee(). employee-creation-orchestrator does
 *    the same once, at conversion; this covers every verification that lands AFTER conversion,
 *    which used to leave the account stranded until someone clicked Approve (seven joiners on
 *    2026-10-06, all listed as penny-drop pending in the Ops Control Tower).
 *
 *  - MANUAL, for exceptions only. A check that ended in manual_review / mismatch (the bank's
 *    owner matches no recorded name, the bank returned no name, the provider was down) is listed
 *    by getManualReviewBankGaps() with what the reviewer needs to decide: the name the BANK holds
 *    next to every name the joiner is recorded under, the reason, and the cheque/passbook. The
 *    reviewer approves (approveManualReviewBankDetail) or rejects (rejectManualReviewBankDetail,
 *    which asks the joiner to resubmit their own account).
 *
 * Account numbers are read from wherever they survive: the plaintext ats_candidate column, or
 * the encrypted copies on candidate_onboarding_bank_detail / ats_candidate. Requiring the
 * plaintext column hid joiners whose number is only stored encrypted.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { encryptField } from "../../shared/fieldEncryption.js";
import { computeAccountBlindIndex } from "../../shared/bankAccountDuplicate.js";
import { decryptPii } from "../../shared/piiCiphertext.js";
import { hashPiiForMatch } from "../../shared/piiHash.js";
import { maskAccount } from "./bank-payment-readiness.service.js";

export interface ManualReviewGapRow {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  branch_name: string | null;
  candidate_id: string;
  // 'verified' appears only when the automatic copy could not run (no readable account number);
  // the UI tags it "Penny drop verified" and shows details instead of a proof image.
  verification_status: "verified" | "manual_review" | "mismatch";
  account_masked: string;
  ifsc_code: string | null;
  account_holder_name: string | null;
  // The name the BANK holds for the account, which is what the reviewer must judge.
  bank_registered_name: string | null;
  // Every name the joiner is recorded under: ATS record, onboarding profile, employee master.
  recorded_names: string[];
  // The number on file is not the one the bank checked (re-entered since). Approve is refused
  // until the bank check is re-run on the current number.
  account_changed: boolean;
  // Why the check did not pass on its own, and its risk flags.
  review_reason: string | null;
  risk_flags: string[];
  name_match_score: number | null;
  verified_at: string | null;
  bank_name: string | null;
  branch_name_onboarding: string | null;
  account_type: string | null;
  name_on_cheque: string | null;
  // Looked up against candidate_onboarding_document rather than cancelled_cheque_document_id,
  // which is populated on only ~0.7% of rows (confirmed live 2026-09-11).
  proof_document: { id: string; doc_type: string; file_name: string | null; uploaded_at: string | null } | null;
}

/** The account number in plaintext, from the first source that holds one. */
export function resolveAccountNumber(sources: {
  plain?: unknown; onboardingEncrypted?: unknown; candidateEncrypted?: unknown;
}): string | null {
  const plain = String(sources.plain ?? "").replace(/\s/g, "");
  if (plain) return plain;
  for (const cipher of [sources.onboardingEncrypted, sources.candidateEncrypted]) {
    const value = String(cipher ?? "").trim();
    if (!value) continue;
    try {
      const decrypted = decryptPii(value).replace(/\s/g, "");
      if (decrypted) return decrypted;
    } catch {
      // Unreadable under this key; try the next source.
    }
  }
  return null;
}

function parseFlags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

// The latest verification attempt per candidate, with everything needed to act on it.
// ROW_NUMBER rather than GROUP BY: mas_hrms runs only_full_group_by, and a bare GROUP BY here
// was a live 500 on 2026-09-11.
const LATEST_ATTEMPT_SQL = `
  SELECT v.*,
         ROW_NUMBER() OVER (PARTITION BY v.candidate_id ORDER BY COALESCE(v.verified_at, v.created_at) DESC, v.created_at DESC) AS rn
    FROM candidate_bank_verification v`;

const ACCOUNT_SOURCE_COLUMNS = `
  c.bank_account_no AS plain_account_no,
  c.bank_account_no_encrypted AS candidate_account_encrypted,
  obd.account_no_encrypted AS onboarding_account_encrypted,
  obd.account_no_masked AS onboarding_account_masked`;

/** Joiners whose bank account still needs a decision, one row per employee. */
export async function getManualReviewBankGaps(): Promise<ManualReviewGapRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM (
       SELECT e.id AS employee_id, e.employee_code,
              COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
              e.full_name AS employee_record_name,
              b.branch_name,
              v.candidate_id, v.verification_status, v.ifsc_code, v.input_account_holder_name AS account_holder_name,
              v.provider_account_holder_name, v.name_match_score, v.verified_at, v.account_no_hash,
              c.full_name AS candidate_name, p.employee_name AS profile_name,
              ${ACCOUNT_SOURCE_COLUMNS},
              obd.bank_name AS ob_bank_name, obd.branch_name AS ob_branch_name,
              obd.account_type AS ob_account_type, obd.name_on_cheque AS ob_name_on_cheque,
              (SELECT bc.result_summary FROM candidate_bgv_check bc
                WHERE bc.candidate_id = v.candidate_id AND bc.check_type = 'bank'
                ORDER BY bc.updated_at DESC LIMIT 1) AS review_reason,
              (SELECT bc.risk_flags_json FROM candidate_bgv_check bc
                WHERE bc.candidate_id = v.candidate_id AND bc.check_type = 'bank'
                ORDER BY bc.updated_at DESC LIMIT 1) AS risk_flags_json,
              ROW_NUMBER() OVER (PARTITION BY e.id ORDER BY COALESCE(v.verified_at, v.created_at) DESC) AS emp_rn
         FROM (${LATEST_ATTEMPT_SQL}) v
         JOIN ats_candidate c ON c.id = v.candidate_id
         JOIN employees e ON e.employee_code = c.employee_code
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN candidate_onboarding_bank_detail obd ON obd.candidate_id = v.candidate_id
         LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = v.candidate_id
        WHERE v.rn = 1
          AND e.active_status = 1
          AND c.employee_code IS NOT NULL AND c.employee_code <> ''
          AND v.verification_status IN ('manual_review', 'mismatch', 'verified')
          AND COALESCE(v.provider_key, '') <> 'hr_review'
          AND (COALESCE(c.bank_account_no, '') <> '' OR COALESCE(obd.account_no_encrypted, '') <> ''
               OR COALESCE(c.bank_account_no_encrypted, '') <> '')
          AND NOT EXISTS (
            SELECT 1 FROM employee_bank_detail ebd
             WHERE ebd.employee_id = e.id AND ebd.active_status = 1 AND ebd.is_primary = 1
          )
     ) q
     WHERE q.emp_rn = 1
     ORDER BY q.verified_at DESC`,
  );

  const candidateIds = (rows as any[]).map((r) => r.candidate_id).filter(Boolean);
  const proofByCandidate = await getProofDocumentsByCandidate(candidateIds);

  return (rows as any[]).map((r) => {
    const accountNo = resolveAccountNumber({
      plain: r.plain_account_no,
      onboardingEncrypted: r.onboarding_account_encrypted,
      candidateEncrypted: r.candidate_account_encrypted,
    });
    const names = [r.candidate_name, r.profile_name, r.employee_record_name]
      .map((n) => String(n ?? "").trim())
      .filter(Boolean);
    return {
      employee_id: r.employee_id,
      employee_code: r.employee_code,
      employee_name: String(r.employee_name ?? "").trim(),
      branch_name: r.branch_name ?? null,
      candidate_id: r.candidate_id,
      verification_status: r.verification_status,
      account_masked: accountNo ? maskAccount(accountNo) : String(r.onboarding_account_masked ?? ""),
      ifsc_code: r.ifsc_code ?? null,
      account_holder_name: r.account_holder_name ?? null,
      bank_registered_name: r.provider_account_holder_name ?? null,
      recorded_names: [...new Set(names)],
      account_changed: !!(accountNo && r.account_no_hash && hashPiiForMatch(accountNo) !== r.account_no_hash),
      review_reason: r.review_reason ?? null,
      risk_flags: parseFlags(r.risk_flags_json),
      name_match_score: r.name_match_score == null ? null : Number(r.name_match_score),
      verified_at: r.verified_at ?? null,
      bank_name: r.ob_bank_name ?? null,
      branch_name_onboarding: r.ob_branch_name ?? null,
      account_type: r.ob_account_type ?? null,
      name_on_cheque: r.ob_name_on_cheque ?? null,
      proof_document: proofByCandidate.get(r.candidate_id) ?? null,
    };
  });
}

async function getProofDocumentsByCandidate(
  candidateIds: string[],
): Promise<Map<string, { id: string; doc_type: string; file_name: string | null; uploaded_at: string | null }>> {
  const result = new Map<string, { id: string; doc_type: string; file_name: string | null; uploaded_at: string | null }>();
  if (!candidateIds.length) return result;

  const placeholders = candidateIds.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    // The table has uploaded_at, not created_at (a created_at here was a live 500 the moment the
    // queue had rows, 2026-10-06). Deleted uploads are not proof.
    `SELECT candidate_id, id, doc_type, file_original_name, uploaded_at
       FROM candidate_onboarding_document
      WHERE candidate_id IN (${placeholders})
        AND deleted_at IS NULL
        AND (doc_type LIKE '%cheque%' OR doc_type LIKE '%passbook%' OR doc_type LIKE '%Cheque%' OR doc_type LIKE '%Passbook%')
      ORDER BY uploaded_at DESC`,
    candidateIds,
  );
  for (const r of rows as any[]) {
    if (!result.has(r.candidate_id)) {
      result.set(r.candidate_id, {
        id: r.id,
        doc_type: r.doc_type,
        file_name: r.file_original_name ?? null,
        uploaded_at: r.uploaded_at ?? null,
      });
    }
  }
  return result;
}

type CopyStatus =
  | "inserted" | "would_insert" | "already_has_primary" | "not_an_employee"
  | "not_verified" | "no_account_number" | "account_changed";

/** Latest attempt for one candidate, joined to the employee it became. */
async function loadLatestForCandidate(candidateId: string): Promise<RowDataPacket | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT v.verification_status, v.provider_key, v.account_no_hash, v.ifsc_code,
            COALESCE(NULLIF(v.input_account_holder_name, ''), c.full_name) AS account_holder_name,
            e.id AS employee_id, ${ACCOUNT_SOURCE_COLUMNS},
            obd.bank_name, obd.branch_name, obd.ifsc_code AS onboarding_ifsc
       FROM (${LATEST_ATTEMPT_SQL} WHERE v.candidate_id = ?) v
       JOIN ats_candidate c ON c.id = v.candidate_id
       LEFT JOIN employees e ON e.employee_code = c.employee_code AND c.employee_code <> ''
       LEFT JOIN candidate_onboarding_bank_detail obd ON obd.candidate_id = v.candidate_id
      WHERE v.rn = 1
      LIMIT 1`,
    [candidateId],
  );
  return (rows as RowDataPacket[])[0] ?? null;
}

async function insertPrimaryBankRow(employeeId: string, row: RowDataPacket, accountNo: string): Promise<void> {
  await db.execute(
    `INSERT INTO employee_bank_detail
       (id, employee_id, is_primary, account_seq, account_holder_name,
        account_number, account_number_enc, account_number_blind_index, ifsc_code,
        bank_name, bank_branch, account_type, verified, active_status)
     VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, 'savings', 1, 1)`,
    [
      randomUUID(), employeeId,
      row.account_holder_name ?? null,
      accountNo,
      encryptField(accountNo),
      computeAccountBlindIndex(accountNo),
      row.ifsc_code ?? row.onboarding_ifsc ?? null,
      row.bank_name ?? null,
      row.branch_name ?? null,
    ],
  );
}

async function hasPrimaryBankRow(employeeId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employee_bank_detail WHERE employee_id = ? AND active_status = 1 AND is_primary = 1 LIMIT 1`,
    [employeeId],
  );
  return (rows as RowDataPacket[]).length > 0;
}

/**
 * The automatic path: copy a VERIFIED account onto the employee record. Runs after every bank
 * verification and from the backfill script. Never writes for anything but a verified latest
 * attempt, and only the account that was verified: when the stored number no longer hashes to
 * the verified one (the joiner changed it since), it stops rather than copy an unchecked account.
 */
export async function copyVerifiedBankToEmployee(
  candidateId: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ status: CopyStatus; employeeId?: string }> {
  const row = await loadLatestForCandidate(candidateId);
  if (!row?.employee_id) return { status: "not_an_employee" };
  const employeeId = String(row.employee_id);
  if (row.verification_status !== "verified" || String(row.provider_key ?? "").includes("mock")) {
    return { status: "not_verified", employeeId };
  }
  if (await hasPrimaryBankRow(employeeId)) return { status: "already_has_primary", employeeId };

  const accountNo = resolveAccountNumber({
    plain: row.plain_account_no,
    onboardingEncrypted: row.onboarding_account_encrypted,
    candidateEncrypted: row.candidate_account_encrypted,
  });
  if (!accountNo) return { status: "no_account_number", employeeId };
  if (row.account_no_hash && hashPiiForMatch(accountNo) !== row.account_no_hash) {
    return { status: "account_changed", employeeId };
  }
  if (opts.dryRun) return { status: "would_insert", employeeId };

  await insertPrimaryBankRow(employeeId, row, accountNo);
  return { status: "inserted", employeeId };
}

async function candidateForEmployee(employeeId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT v.candidate_id
       FROM candidate_bank_verification v
       JOIN ats_candidate c ON c.id = v.candidate_id
       JOIN employees e ON e.employee_code = c.employee_code
      WHERE e.id = ? AND c.employee_code <> ''
      ORDER BY COALESCE(v.verified_at, v.created_at) DESC, v.created_at DESC
      LIMIT 1`,
    [employeeId],
  );
  return (rows as RowDataPacket[])[0]?.candidate_id ? String((rows as RowDataPacket[])[0].candidate_id) : null;
}

/**
 * A reviewer accepts an exception: the joiner's onboarding account goes onto the employee
 * record. Who decided lives in the caller's audit-log entry.
 */
export async function approveManualReviewBankDetail(params: {
  employeeId: string;
}): Promise<{ status: "inserted" | "already_has_primary" | "no_manual_review_row" | "account_changed" }> {
  const candidateId = await candidateForEmployee(params.employeeId);
  if (!candidateId) return { status: "no_manual_review_row" };
  const row = await loadLatestForCandidate(candidateId);
  if (!row || !["manual_review", "mismatch", "verified"].includes(String(row.verification_status))) {
    return { status: "no_manual_review_row" };
  }
  const accountNo = resolveAccountNumber({
    plain: row.plain_account_no,
    onboardingEncrypted: row.onboarding_account_encrypted,
    candidateEncrypted: row.candidate_account_encrypted,
  });
  if (!accountNo) return { status: "no_manual_review_row" };
  // A person may accept a name variance, but not an account number nobody checked.
  if (row.account_no_hash && hashPiiForMatch(accountNo) !== row.account_no_hash) return { status: "account_changed" };
  if (await hasPrimaryBankRow(params.employeeId)) return { status: "already_has_primary" };

  await insertPrimaryBankRow(params.employeeId, row, accountNo);
  return { status: "inserted" };
}

/**
 * A reviewer refuses an exception (most often an account in someone else's name). Recorded as a
 * new, append-only attempt so the provider's answer stays intact, the joiner leaves the queue,
 * and the onboarding record reads mismatch until they resubmit. The joiner is then sent the
 * existing bank-resubmit link to enter their own account.
 */
export async function rejectManualReviewBankDetail(params: {
  employeeId: string;
  reason: string;
  actorUserId: string;
}): Promise<{ status: "rejected" | "no_manual_review_row"; candidateId?: string; resubmitEmailSent?: boolean; resubmitError?: string }> {
  const candidateId = await candidateForEmployee(params.employeeId);
  if (!candidateId) return { status: "no_manual_review_row" };

  const [latestRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM (${LATEST_ATTEMPT_SQL} WHERE v.candidate_id = ?) v WHERE v.rn = 1 LIMIT 1`,
    [candidateId],
  );
  const latest = (latestRows as RowDataPacket[])[0];
  if (!latest || !["manual_review", "mismatch", "verified"].includes(String(latest.verification_status))) {
    return { status: "no_manual_review_row" };
  }

  await db.execute(
    `INSERT INTO candidate_bank_verification
       (id, candidate_id, bank_detail_id, account_no_last4, account_no_hash, ifsc_code, input_account_holder_name,
        provider_account_holder_name, name_match_score, verification_method, provider_key, provider_reference_id,
        verification_status, result_json, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'hr_review', ?, 'mismatch', ?, NULL)`,
    [
      randomUUID(), candidateId, latest.bank_detail_id ?? null, latest.account_no_last4 ?? null,
      latest.account_no_hash ?? null, latest.ifsc_code ?? null, latest.input_account_holder_name ?? null,
      latest.provider_account_holder_name ?? null, latest.name_match_score ?? null,
      latest.provider_reference_id ?? null,
      JSON.stringify({ mode: "hr_rejected", reason: params.reason, rejected_by: params.actorUserId }),
    ],
  );

  const { syncBridgePennyDropStatus } = await import("../ats/onboarding-bridge-status.js");
  await syncBridgePennyDropStatus(db, candidateId, "mismatch", ["HR_REJECTED_BANK_ACCOUNT"]);

  try {
    const { sendBankResubmitRequest } = await import("../ats/ats.onboarding.service.js");
    const sent = await sendBankResubmitRequest(candidateId, params.actorUserId);
    return { status: "rejected", candidateId, resubmitEmailSent: sent.emailSent, resubmitError: sent.emailError };
  } catch (err) {
    // The rejection stands either way; the reviewer is told the email did not go.
    return { status: "rejected", candidateId, resubmitEmailSent: false, resubmitError: (err as Error).message };
  }
}

/** Every employee whose latest bank check is verified but whose account never reached them. */
export async function findStrandedVerifiedCandidates(): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT v.candidate_id
       FROM (${LATEST_ATTEMPT_SQL}) v
       JOIN ats_candidate c ON c.id = v.candidate_id
       JOIN employees e ON e.employee_code = c.employee_code
      WHERE v.rn = 1 AND v.verification_status = 'verified'
        AND COALESCE(v.provider_key, '') NOT LIKE '%mock%'
        AND c.employee_code <> '' AND e.active_status = 1
        AND NOT EXISTS (SELECT 1 FROM employee_bank_detail ebd
                         WHERE ebd.employee_id = e.id AND ebd.active_status = 1 AND ebd.is_primary = 1)`,
  );
  return (rows as RowDataPacket[]).map((r) => String(r.candidate_id));
}
