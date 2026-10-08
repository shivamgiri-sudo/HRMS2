/**
 * The employee-signed appointment letter, surfaced on the employee's Joining
 * Documents page next to the signed joining kit.
 *
 * appointment_letter_issue.signed_file_path keeps pointing at the company-signed
 * original, and the copy the employee signed lives on
 * appointment_letter_esign_transaction. This file is a small read-only bridge:
 * it lists that copy for an employee and serves it, under the SAME access rules
 * as the rest of that page (resolveEmployeeDocumentAccessContext: self, admin, or
 * an HR/payroll role scoped to the employee's branch/process/etc.).
 *
 * The letter carries the employee's salary, so on top of that page-level scope it
 * is limited to the roles that may see the letter in the Appointment Letters
 * queue, plus the employee themselves. A team leader or process manager who can
 * see a report's joining checklist does not get their pay through this door.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { resolveEmployeeDocumentAccessContext } from "./employeeJoiningDocuments.service.js";
import { auditAppointmentLetter } from "../letters/appointmentLetterAudit.js";
import { loadAcceptedCopy, type AcceptedCopyFile } from "../letters/appointmentLetterSignedCopy.service.js";

/** Roles that may open an appointment letter (mirrors VIEW_ROLES in appointmentLetter.routes.ts). */
const LETTER_ROLES = new Set(["super_admin", "admin", "payroll", "payroll_hr", "payroll_head", "hr", "branch_head"]);

export type SignedAppointmentLetterItem = {
  issue_id: string;
  letter_number: string;
  /** issued | revoked — only HR ever sees a revoked one. */
  status: string;
  accepted_at: string | null;
  /** First 12 hex chars of the stored file's sha256, for cross-checking; never the path. */
  sha256_short: string | null;
};

type LetterAccess = { isSelf: boolean; isAdmin: boolean; roles: string[] };

const mayOpenLetter = (a: LetterAccess) => a.isSelf || a.isAdmin || a.roles.some((r) => LETTER_ROLES.has(r));
/** The employee must not keep a letter the company has withdrawn; HR keeps seeing it as a record. */
const hidesRevoked = (a: LetterAccess) => a.isSelf && !a.isAdmin && !a.roles.some((r) => LETTER_ROLES.has(r));

const isoOrNull = (value: unknown): string | null => {
  if (!value) return null;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Signed appointment letters for one employee. Empty (never an error) when the viewer may not see them. */
export async function listSignedAppointmentLetters(
  employeeId: string,
  access: LetterAccess,
): Promise<SignedAppointmentLetterItem[]> {
  if (!mayOpenLetter(access)) return [];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT i.id, i.letter_number, i.status, i.revoked_at, t.completed_at, t.signed_file_sha256
       FROM appointment_letter_issue i
       JOIN appointment_letter_esign_transaction t
         ON t.id = (SELECT t2.id FROM appointment_letter_esign_transaction t2
                     WHERE t2.issue_id = i.id AND t2.status = 'signed' AND t2.signed_file_path IS NOT NULL
                     ORDER BY t2.completed_at DESC, t2.initiated_at DESC LIMIT 1)
      WHERE i.employee_id = ?
      ORDER BY i.issued_at DESC`,
    [employeeId],
  );
  return (rows as RowDataPacket[])
    .filter((r) => !(hidesRevoked(access) && (r.revoked_at || String(r.status) === "revoked")))
    .map((r) => ({
      issue_id: String(r.id),
      letter_number: String(r.letter_number),
      status: r.revoked_at || String(r.status) === "revoked" ? "revoked" : "issued",
      accepted_at: isoOrNull(r.completed_at),
      sha256_short: r.signed_file_sha256 ? String(r.signed_file_sha256).slice(0, 12) : null,
    }));
}

const httpError = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

/** Serve the signed copy of one letter after the same access checks as the pack listing. */
export async function getSignedAppointmentLetterForAccess(params: {
  employeeId: string;
  issueId: string;
  actorUserId: string;
  inline: boolean;
}): Promise<AcceptedCopyFile> {
  const access = await resolveEmployeeDocumentAccessContext(params.actorUserId, params.employeeId);
  if (!mayOpenLetter(access)) throw httpError("Not authorized to open this document", 403);

  // employee_id in the WHERE is the row-scope: an issue id from another employee's
  // page must not be readable through this employee's URL.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT letter_number, status, revoked_at FROM appointment_letter_issue WHERE id = ? AND employee_id = ? LIMIT 1`,
    [params.issueId, params.employeeId],
  );
  const letter = (rows as RowDataPacket[])[0];
  if (!letter) throw httpError("Appointment letter not found", 404);
  if (hidesRevoked(access) && (letter.revoked_at || String(letter.status) === "revoked")) {
    throw httpError("Appointment letter not found", 404);
  }

  const file = await loadAcceptedCopy(params.issueId, String(letter.letter_number));
  await auditAppointmentLetter(params.issueId, "SIGNED_COPY_VIEWED", params.actorUserId, {
    transactionId: file.transactionId, inline: params.inline, via: "employee_documents",
  });
  return file;
}
