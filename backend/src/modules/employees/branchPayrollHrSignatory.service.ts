/**
 * The Payroll HR who signs a candidate's joining documents, per branch.
 *
 * Two things on those documents should name a person and currently do not name
 * the right one:
 *
 *   * {{surveillance_hr_name}} on the NDA / Surveillance declaration has
 *     source_path NULL, so it has printed blank on every document ever issued.
 *   * employer_signature on EPF Form 2 and the EPF Declaration is filled from
 *     the single company-wide seal, so a Noida joiner and a Jaipur joiner are
 *     signed for by the same person regardless of who actually processed them.
 *
 * Both should be the Payroll HR of the branch the candidate is joining.
 *
 * Everything here degrades rather than fails. The table is added by sql/1061 and
 * production runs SKIP_MIGRATIONS=true, so a missing table, a branch with no
 * configured signatory, or a signatory with no uploaded image must each leave
 * the documents no worse than they are today — the company seal still applies
 * and the name simply stays blank, exactly as now.
 */
import fs from "fs";
import path from "path";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { COMPANY_ASSET_CATEGORY } from "./companySeal.service.js";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

export interface BranchPayrollHrSignatory {
  branchId: string;
  hrName: string;
  hrDesignation: string | null;
  employeeId: string | null;
  signatureFile: string | null;
  /** Read lazily — only the PDF renderer needs the bytes. */
  signature: Buffer | null;
}

/** Same traversal guard as companySeal: only ever a bare filename we wrote. */
function readAsset(fileName: string | null): Buffer | null {
  if (!fileName) return null;
  const safe = path.basename(fileName);
  const dir = path.join(UPLOADS_ROOT, COMPANY_ASSET_CATEGORY);
  const full = path.join(dir, safe);
  if (!full.startsWith(dir)) return null;
  return fs.existsSync(full) ? fs.readFileSync(full) : null;
}

/**
 * The active signatory for a branch, or null.
 *
 * Returns null rather than throwing when the table does not exist yet, because
 * the migration is applied by hand and every caller has a working fallback.
 */
export async function getBranchPayrollHrSignatory(
  branchId: string | null | undefined,
  options: { withImage?: boolean } = {},
): Promise<BranchPayrollHrSignatory | null> {
  if (!branchId) return null;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, hr_name, hr_designation, employee_id, signature_file
       FROM branch_payroll_hr_signatory
      WHERE branch_id = ? AND active_status = 1
      LIMIT 1`,
    [branchId],
  ).catch(() => [[] as RowDataPacket[]]);

  const row = (rows as RowDataPacket[])[0];
  if (!row) return null;

  const signatureFile = row.signature_file ? String(row.signature_file) : null;
  return {
    branchId: String(row.branch_id),
    hrName: String(row.hr_name ?? "").trim(),
    hrDesignation: row.hr_designation ? String(row.hr_designation) : null,
    employeeId: row.employee_id ? String(row.employee_id) : null,
    signatureFile,
    signature: options.withImage ? readAsset(signatureFile) : null,
  };
}

/**
 * The signatory for the branch an employee belongs to.
 *
 * The joining-document renderer knows the employee, not the branch, so this
 * resolves the hop. A failure here must never stop a document rendering.
 */
export async function getPayrollHrSignatoryForEmployee(
  employeeId: string,
  options: { withImage?: boolean } = {},
): Promise<BranchPayrollHrSignatory | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  ).catch(() => [[] as RowDataPacket[]]);

  const branchId = (rows as RowDataPacket[])[0]?.branch_id;
  return getBranchPayrollHrSignatory(branchId ? String(branchId) : null, options);
}

/**
 * The seal to stamp on a document, preferring the branch's Payroll HR.
 *
 * applyCompanySeal already accepts a seal override, so nothing about the
 * stamping logic changes — only which signature is handed to it. Two
 * deliberate choices:
 *
 * The company stamp is always kept. A branch has its own signatory but not its
 * own company stamp; that belongs to the organisation, and dropping it would
 * remove something the statutory form expects.
 *
 * A branch with a name but no uploaded image still gets named, while the
 * company signature is used for the mark. That is better than showing the
 * company signatory's name, because the branch HR is who actually processed
 * this joiner — and it means the document is never sent out unsigned merely
 * because an image has not been uploaded yet.
 */
export function mergeBranchSignatureIntoSeal<
  T extends { signature: Buffer | null; stamp: Buffer | null; signatoryName: string | null; signatoryDesignation: string | null },
>(companySeal: T, branch: BranchPayrollHrSignatory | null): T {
  if (!branch) return companySeal;
  return {
    ...companySeal,
    signature: branch.signature ?? companySeal.signature,
    signatoryName: branch.hrName || companySeal.signatoryName,
    signatoryDesignation: branch.hrDesignation ?? companySeal.signatoryDesignation,
  };
}

/** Every branch with its signatory, for the Super Admin configuration screen. */
export async function listBranchPayrollHrSignatories(): Promise<Array<{
  branchId: string;
  branchName: string;
  branchCode: string | null;
  hrName: string | null;
  hrDesignation: string | null;
  employeeId: string | null;
  hasSignature: boolean;
  updatedAt: string | null;
}>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    // LEFT JOIN so unconfigured branches are listed too — the point of the
    // screen is seeing which branches still have nobody.
    `SELECT b.id AS branch_id, b.branch_name, b.branch_code,
            s.hr_name, s.hr_designation, s.employee_id, s.signature_file, s.updated_at
       FROM branch_master b
       LEFT JOIN branch_payroll_hr_signatory s
              ON s.branch_id = b.id AND s.active_status = 1
      ORDER BY b.branch_name ASC`,
  ).catch(() => [[] as RowDataPacket[]]);

  return (rows as RowDataPacket[]).map((r) => ({
    branchId: String(r.branch_id),
    branchName: String(r.branch_name ?? ""),
    branchCode: r.branch_code ? String(r.branch_code) : null,
    hrName: r.hr_name ? String(r.hr_name) : null,
    hrDesignation: r.hr_designation ? String(r.hr_designation) : null,
    employeeId: r.employee_id ? String(r.employee_id) : null,
    hasSignature: Boolean(r.signature_file),
    updatedAt: r.updated_at ? String(r.updated_at) : null,
  }));
}

/** Create or replace a branch's signatory. Deactivates the previous one. */
export async function upsertBranchPayrollHrSignatory(input: {
  branchId: string;
  hrName: string;
  hrDesignation?: string | null;
  employeeId?: string | null;
  signatureFile?: string | null;
  actorUserId?: string | null;
}): Promise<void> {
  const name = String(input.hrName ?? "").trim();
  if (!name) throw Object.assign(new Error("The Payroll HR name is required."), { statusCode: 400 });

  // Keep any signature already uploaded when the caller is only editing the
  // name, so saving a typo fix does not silently drop the image.
  const existing = await getBranchPayrollHrSignatory(input.branchId);
  const signatureFile = input.signatureFile !== undefined
    ? input.signatureFile
    : existing?.signatureFile ?? null;

  await db.execute(
    `UPDATE branch_payroll_hr_signatory SET active_status = 0, updated_by = ?, updated_at = NOW()
      WHERE branch_id = ? AND active_status = 1`,
    [input.actorUserId ?? null, input.branchId],
  );

  await db.execute(
    `INSERT INTO branch_payroll_hr_signatory
       (branch_id, hr_name, hr_designation, employee_id, signature_file, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.branchId,
      name,
      input.hrDesignation?.trim() || null,
      input.employeeId || null,
      signatureFile,
      input.actorUserId ?? null,
      input.actorUserId ?? null,
    ],
  );
}
