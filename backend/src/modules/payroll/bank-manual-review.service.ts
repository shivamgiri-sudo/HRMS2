/**
 * Bank "manual review" gap — employees whose onboarding penny-drop never resulted in an
 * employee_bank_detail row, for one of two reasons:
 *
 *  - Their LATEST verification attempt is still 'manual_review': the automatic copy in
 *    employee-creation-orchestrator.service.ts only fires on verification_status = 'verified',
 *    by design (its own comment: "a manual_review account is captured so onboarding can
 *    finish, and stays unusable for payment until a human clears it"). This human needs the
 *    uploaded passbook/cheque proof to make that call — see proof_document below.
 *
 *  - Their LATEST attempt IS 'verified', but they still have no bank record. This happens when
 *    an employee first landed on manual_review, was NOT auto-copied (that only ever ran once,
 *    at offer-approval time), and only later retried and passed penny-drop — after the
 *    orchestrator's one-shot copy had already run (or never ran, because the status at that
 *    moment was manual_review). Real gap, found live 2026-09-11 per explicit user direction
 *    ("if penny drop verified it should show the complete account details ... and a tag Penny
 *    drop verified"): these stragglers are otherwise invisible anywhere in the product. For
 *    them there is nothing to "review" — the bank already confirmed the account — so the
 *    reviewer sees full account details and a verified badge instead of a proof image, and
 *    approving is a formality, not a judgment call.
 *
 * That human clearance step (for the manual_review case) and that catch-up copy (for the
 * verified-but-stranded case) never had anywhere to happen. This module is that surface: one
 * explicit, audited approval action per employee — never an automatic write. Approving here
 * does exactly what the orchestrator's own verified-path insert does (same columns, same
 * encryption, same idempotency guard).
 */
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { encryptField } from "../../shared/fieldEncryption.js";
import { computeAccountBlindIndex } from "../../shared/bankAccountDuplicate.js";
import { maskAccount } from "./bank-payment-readiness.service.js";

export interface ManualReviewGapRow {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  branch_name: string | null;
  candidate_id: string;
  // The candidate's LATEST verification attempt status — drives the UI split: 'verified' shows
  // full details + a "Penny drop verified" tag, 'manual_review' shows the proof image instead.
  verification_status: "verified" | "manual_review";
  account_masked: string;
  ifsc_code: string | null;
  account_holder_name: string | null;
  name_match_score: number | null;
  verified_at: string | null;
  // Everything the candidate actually typed at onboarding, for the reviewer to compare against
  // the uploaded proof below — not just the verification-provider's derived fields above.
  bank_name: string | null;
  branch_name_onboarding: string | null;
  account_type: string | null;
  name_on_cheque: string | null;
  // The passbook/cheque image or PDF the candidate uploaded, if any. Looked up directly against
  // candidate_onboarding_document rather than trusting cancelled_cheque_document_id — that FK is
  // populated on only ~0.7% of rows (an auto-link bug on some upload paths leaves it null even
  // when a real document exists), confirmed live 2026-09-11.
  proof_document: { id: string; doc_type: string; file_name: string | null; uploaded_at: string | null } | null;
}

/**
 * Active employees with a manual_review penny-drop result and no existing primary bank row.
 * Read-only, masked — the same mask every other bank-readiness screen uses.
 */
export async function getManualReviewBankGaps(): Promise<ManualReviewGapRow[]> {
  // ats_candidate carries more than one row per employee_code in practice (re-applications,
  // duplicate imports), and candidate_bank_verification can hold more than one attempt per
  // candidate — so "one row per employee" needs the LATEST verification explicitly picked,
  // not a bare GROUP BY e.id (which mas_hrms's own sql_mode=only_full_group_by correctly
  // refuses: every non-aggregated selected column has to be functionally dependent on the
  // group key, and candidate_id/ifsc_code/etc. are not). Caught live, 2026-09-11 — this was
  // a real 500 on first deploy, not a hypothetical.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id, e.employee_code,
            COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
            b.branch_name,
            v.candidate_id, v.verification_status, v.ifsc_code, v.input_account_holder_name AS account_holder_name,
            v.name_match_score, v.verified_at,
            c.bank_account_no,
            obd.bank_name AS ob_bank_name, obd.branch_name AS ob_branch_name,
            obd.account_type AS ob_account_type, obd.name_on_cheque AS ob_name_on_cheque
       FROM (
         -- LATEST attempt per candidate, any status -- not restricted to manual_review. A
         -- candidate whose latest attempt is now 'verified' still belongs here if nobody has
         -- copied it to employee_bank_detail yet (see module header). Other statuses (pending,
         -- failed, etc.) are excluded below since there is nothing actionable to show for them.
         SELECT v1.*
           FROM candidate_bank_verification v1
           JOIN (
             SELECT candidate_id, MAX(COALESCE(verified_at, created_at)) AS latest
               FROM candidate_bank_verification
              GROUP BY candidate_id
           ) latest ON latest.candidate_id = v1.candidate_id
                   AND COALESCE(v1.verified_at, v1.created_at) = latest.latest
       ) v
       JOIN ats_candidate c ON c.id = v.candidate_id
       JOIN employees e ON e.employee_code = c.employee_code
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN candidate_onboarding_bank_detail obd ON obd.candidate_id = v.candidate_id
      WHERE e.active_status = 1
        AND v.verification_status IN ('manual_review', 'verified')
        AND c.bank_account_no IS NOT NULL AND c.bank_account_no <> ''
        AND NOT EXISTS (
          SELECT 1 FROM employee_bank_detail ebd
           WHERE ebd.employee_id = e.id AND ebd.active_status = 1 AND ebd.is_primary = 1
        )
      GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, b.branch_name,
               v.candidate_id, v.verification_status, v.ifsc_code, v.input_account_holder_name,
               v.name_match_score, v.verified_at, c.bank_account_no, obd.bank_name, obd.branch_name,
               obd.account_type, obd.name_on_cheque
      ORDER BY v.verified_at DESC`,
  );

  // Proof documents matter only for the manual_review case (a verified account needs no human
  // eyeballing a photo), but the lookup is cheap and uniform either way — keeps the mapping
  // below simple, and the frontend already only renders the image when status is manual_review.
  const candidateIds = (rows as any[]).map((r) => r.candidate_id).filter(Boolean);
  const proofByCandidate = await getProofDocumentsByCandidate(candidateIds);

  return (rows as any[]).map((r) => ({
    employee_id: r.employee_id,
    employee_code: r.employee_code,
    employee_name: String(r.employee_name ?? "").trim(),
    branch_name: r.branch_name ?? null,
    candidate_id: r.candidate_id,
    verification_status: r.verification_status,
    account_masked: maskAccount(r.bank_account_no),
    ifsc_code: r.ifsc_code ?? null,
    account_holder_name: r.account_holder_name ?? null,
    name_match_score: r.name_match_score == null ? null : Number(r.name_match_score),
    verified_at: r.verified_at ?? null,
    bank_name: r.ob_bank_name ?? null,
    branch_name_onboarding: r.ob_branch_name ?? null,
    account_type: r.ob_account_type ?? null,
    name_on_cheque: r.ob_name_on_cheque ?? null,
    proof_document: proofByCandidate.get(r.candidate_id) ?? null,
  }));
}

/**
 * Looks up each candidate's passbook/cheque proof directly against candidate_onboarding_document
 * by doc_type, NOT via candidate_onboarding_bank_detail.cancelled_cheque_document_id — that FK is
 * null on ~99.3% of rows even when a real document was uploaded (an auto-link gap on some upload
 * paths/timings, confirmed live 2026-09-11 against 5 real manual_review candidates: 3 had an
 * actual uploaded doc, but only 1 of those 3 had the FK set). Picks the most recent doc per
 * candidate when more than one was uploaded (e.g. both "Bank Passbook" and "Cancelled Cheque").
 */
async function getProofDocumentsByCandidate(
  candidateIds: string[],
): Promise<Map<string, { id: string; doc_type: string; file_name: string | null; uploaded_at: string | null }>> {
  const result = new Map<string, { id: string; doc_type: string; file_name: string | null; uploaded_at: string | null }>();
  if (!candidateIds.length) return result;

  const placeholders = candidateIds.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT candidate_id, id, doc_type, file_original_name, created_at
       FROM candidate_onboarding_document
      WHERE candidate_id IN (${placeholders})
        AND (doc_type LIKE '%cheque%' OR doc_type LIKE '%passbook%' OR doc_type LIKE '%Cheque%' OR doc_type LIKE '%Passbook%')
      ORDER BY created_at DESC`,
    candidateIds,
  );
  for (const r of rows as any[]) {
    if (!result.has(r.candidate_id)) {
      result.set(r.candidate_id, {
        id: r.id,
        doc_type: r.doc_type,
        file_name: r.file_original_name ?? null,
        uploaded_at: r.created_at ?? null,
      });
    }
  }
  return result;
}

/**
 * Copies one employee's manual_review account into employee_bank_detail. Same shape as
 * employee-creation-orchestrator.service.ts's verified-path insert (account_number,
 * account_number_enc, blind index, IFSC, active/primary/verified=1) — the only difference
 * is the human decision behind it, recorded via the caller's audit log entry.
 *
 * Idempotent: silently no-ops (returns already_has_primary) if a primary row now exists,
 * same guard the orchestrator uses, so a double-click or a race with a real bank-change
 * approval can't create two primary rows.
 */
export async function approveManualReviewBankDetail(params: {
  employeeId: string;
}): Promise<{ status: "inserted" | "already_has_primary" | "no_manual_review_row" }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.bank_account_no AS account_no,
            COALESCE(NULLIF(v.ifsc_code, ''), c.bank_ifsc) AS ifsc_code,
            COALESCE(NULLIF(v.input_account_holder_name, ''), c.full_name) AS account_holder_name
       FROM candidate_bank_verification v
       JOIN ats_candidate c ON c.id = v.candidate_id
       JOIN employees e ON e.employee_code = c.employee_code
      WHERE e.id = ?
        AND v.verification_status IN ('manual_review', 'verified')
        AND c.bank_account_no IS NOT NULL AND c.bank_account_no <> ''
      ORDER BY v.verified_at DESC, v.created_at DESC
      LIMIT 1`,
    [params.employeeId],
  );
  const row = (rows as any[])[0];
  if (!row?.account_no) return { status: "no_manual_review_row" };

  const [existingPrimary] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employee_bank_detail WHERE employee_id = ? AND active_status = 1 AND is_primary = 1 LIMIT 1`,
    [params.employeeId],
  );
  if ((existingPrimary as any[]).length) return { status: "already_has_primary" };

  // No created_by/updated_by columns on this table (confirmed against the live schema) --
  // matches the orchestrator's own insert shape exactly. Who approved this lives in the
  // audit log the route below writes, not on the row itself.
  const accountNoStr = String(row.account_no).trim();
  await db.execute(
    `INSERT INTO employee_bank_detail
       (id, employee_id, is_primary, account_seq, account_holder_name,
        account_number, account_number_enc, account_number_blind_index, ifsc_code, account_type, verified, active_status)
     VALUES (?, ?, 1, 1, ?, ?, ?, ?, ?, 'savings', 1, 1)`,
    [
      randomUUID(), params.employeeId,
      row.account_holder_name ?? null,
      accountNoStr,
      encryptField(accountNoStr),
      computeAccountBlindIndex(accountNoStr),
      row.ifsc_code ?? null,
    ],
  );
  return { status: "inserted" };
}
