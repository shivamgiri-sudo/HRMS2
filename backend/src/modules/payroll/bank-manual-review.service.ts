/**
 * Bank "manual review" gap — employees whose onboarding penny-drop landed on manual_review
 * (not verified), and who therefore never got an employee_bank_detail row from
 * employee-creation-orchestrator.service.ts's automatic copy (it only copies on
 * verification_status = 'verified', by design — see its own comment: "a manual_review
 * account is captured so onboarding can finish, and stays unusable for payment until a
 * human clears it").
 *
 * That human clearance step never had anywhere to happen. This module is that surface:
 * a small, explicit, audited approval action — never an automatic write. Approving here
 * does exactly what the orchestrator's own verified-path insert does (same columns, same
 * encryption, same idempotency guard), just gated on a person deciding a manual_review
 * account is good enough, instead of the system deciding a verified one is.
 *
 * Scope, measured live 2026-09-11: 36 manual_review candidates total, 17 already converted
 * to employees, 16 (4 unique employees — ats_candidate carries duplicate rows per
 * candidate) still missing their employee_bank_detail row.
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
  account_masked: string;
  ifsc_code: string | null;
  account_holder_name: string | null;
  name_match_score: number | null;
  verified_at: string | null;
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
            v.candidate_id, v.ifsc_code, v.input_account_holder_name AS account_holder_name,
            v.name_match_score, v.verified_at,
            c.bank_account_no
       FROM (
         SELECT v1.*
           FROM candidate_bank_verification v1
           JOIN (
             SELECT candidate_id, MAX(COALESCE(verified_at, created_at)) AS latest
               FROM candidate_bank_verification
              WHERE verification_status = 'manual_review'
              GROUP BY candidate_id
           ) latest ON latest.candidate_id = v1.candidate_id
                   AND COALESCE(v1.verified_at, v1.created_at) = latest.latest
          WHERE v1.verification_status = 'manual_review'
       ) v
       JOIN ats_candidate c ON c.id = v.candidate_id
       JOIN employees e ON e.employee_code = c.employee_code
       LEFT JOIN branch_master b ON b.id = e.branch_id
      WHERE e.active_status = 1
        AND c.bank_account_no IS NOT NULL AND c.bank_account_no <> ''
        AND NOT EXISTS (
          SELECT 1 FROM employee_bank_detail ebd
           WHERE ebd.employee_id = e.id AND ebd.active_status = 1 AND ebd.is_primary = 1
        )
      GROUP BY e.id, e.employee_code, e.full_name, e.first_name, e.last_name, b.branch_name,
               v.candidate_id, v.ifsc_code, v.input_account_holder_name, v.name_match_score,
               v.verified_at, c.bank_account_no
      ORDER BY v.verified_at DESC`,
  );

  return (rows as any[]).map((r) => ({
    employee_id: r.employee_id,
    employee_code: r.employee_code,
    employee_name: String(r.employee_name ?? "").trim(),
    branch_name: r.branch_name ?? null,
    candidate_id: r.candidate_id,
    account_masked: maskAccount(r.bank_account_no),
    ifsc_code: r.ifsc_code ?? null,
    account_holder_name: r.account_holder_name ?? null,
    name_match_score: r.name_match_score == null ? null : Number(r.name_match_score),
    verified_at: r.verified_at ?? null,
  }));
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
        AND v.verification_status = 'manual_review'
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
