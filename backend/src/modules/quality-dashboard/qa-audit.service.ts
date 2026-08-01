import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { scoreQaAudit, type QaFormParameter, type QaParameterScore } from "./qa-audit-scoring.js";

/**
 * Capture and storage for manually scored QA audits.
 *
 * The one rule this file exists to enforce: the SERVER computes the score.
 * A client submits per-parameter marks and nothing else — never a total, never a
 * percentage, never the fatal flag. Accepting a submitted total would let a
 * browser decide its own quality result, and the whole point of an audit is that
 * the agent cannot set their own mark.
 *
 * Parameters are read from the stored form, not from the request, for the same
 * reason: a stale or forged payload cannot introduce a parameter that is not on
 * the form, nor change what a parameter is worth.
 */

export type SubmitAuditInput = {
  formId: string;
  employeeId: string;
  auditDate: string;
  auditorUserId: string;
  callReference?: string | null;
  evidenceUrl?: string | null;
  remarks?: string | null;
  scores: Array<{ formParameterId: string; score: number | null; notApplicable?: boolean }>;
  /** Leave as draft so an auditor can finish later. */
  submit?: boolean;
};

export type SubmittedAudit = {
  id: string;
  totalScore: number;
  maxScore: number;
  qualityPercentage: number | null;
  fatalTriggered: boolean;
  assessedCount: number;
  notApplicableCount: number;
  status: "draft" | "submitted";
};

export class QaAuditError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

/** The form's parameters and the process it belongs to, as stored. */
async function loadForm(formId: string): Promise<{
  processId: string;
  versionNo: number;
  parameters: QaFormParameter[];
}> {
  const [formRows] = await db.execute<RowDataPacket[]>(
    `SELECT process_id, version_no, status FROM qa_audit_form WHERE id = ? LIMIT 1`,
    [formId],
  );
  const form = formRows[0];
  if (!form) throw new QaAuditError("Audit form not found", 404);
  if (form.status !== "active") {
    // A draft form has not been agreed and a retired one no longer reflects how
    // the process is measured. Neither should produce a score that counts.
    throw new QaAuditError(`Audit form is ${form.status}, so it cannot be scored against`, 409);
  }

  const [paramRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, max_score, is_fatal FROM qa_audit_form_parameter
      WHERE form_id = ? AND active_status = 1`,
    [formId],
  );
  if (!paramRows.length) throw new QaAuditError("Audit form has no active parameters", 409);

  return {
    processId: String(form.process_id),
    versionNo: Number(form.version_no),
    parameters: paramRows.map((p) => ({
      id: String(p.id),
      maxScore: Number(p.max_score),
      isFatal: Boolean(p.is_fatal),
    })),
  };
}

export async function submitQaAudit(input: SubmitAuditInput): Promise<SubmittedAudit> {
  const form = await loadForm(input.formId);

  // Marks come from the client; everything they are worth comes from the form.
  const scores: QaParameterScore[] = input.scores.map((s) => ({
    formParameterId: String(s.formParameterId),
    score: s.score === null || s.score === undefined ? null : Number(s.score),
    notApplicable: Boolean(s.notApplicable),
  }));

  // Reject a mark above what the parameter can award, rather than letting it
  // inflate the total. Silently clamping would hide an integration bug.
  const maxById = new Map(form.parameters.map((p) => [p.id, p.maxScore]));
  for (const s of scores) {
    const max = maxById.get(s.formParameterId);
    if (max === undefined) continue; // not on this form; scoring ignores it
    if (s.score !== null && s.score > max) {
      throw new QaAuditError(
        `Score ${s.score} exceeds the maximum of ${max} for one of the parameters`,
      );
    }
    if (s.score !== null && s.score < 0) {
      throw new QaAuditError("A parameter score cannot be negative");
    }
  }

  const computed = scoreQaAudit(form.parameters, scores);
  const auditId = randomUUID();
  const status = input.submit === false ? "draft" : "submitted";

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO qa_audit
         (id, form_id, form_version_no, employee_id, process_id, audit_date,
          call_reference, evidence_url, auditor_user_id,
          total_score, max_score, quality_percentage, fatal_triggered,
          status, remarks, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditId, input.formId, form.versionNo, input.employeeId, form.processId, input.auditDate,
        input.callReference ?? null, input.evidenceUrl ?? null, input.auditorUserId,
        computed.totalScore, computed.maxScore, computed.qualityPercentage, computed.fatalTriggered ? 1 : 0,
        status, input.remarks ?? null, status === "submitted" ? new Date() : null,
      ],
    );

    for (const s of scores) {
      if (!maxById.has(s.formParameterId)) continue;
      await conn.execute(
        `INSERT INTO qa_audit_parameter_score
           (id, audit_id, form_parameter_id, score, not_applicable, remark)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), auditId, s.formParameterId, s.score, s.notApplicable ? 1 : 0, null],
      );
    }

    await conn.commit();
  } catch (err) {
    // A half-written audit is worse than none: the header would carry a score
    // its parameter rows do not justify, and nothing would say so.
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  return { id: auditId, status, ...computed };
}

export async function listAuditsForEmployee(
  employeeId: string,
  from: string,
  to: string,
): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.id, a.audit_date, a.process_id, a.total_score, a.max_score,
            a.quality_percentage, a.fatal_triggered, a.status, a.call_reference,
            f.form_name, a.form_version_no
       FROM qa_audit a
       JOIN qa_audit_form f ON f.id = a.form_id
      WHERE a.employee_id = ? AND a.audit_date BETWEEN ? AND ?
      ORDER BY a.audit_date DESC, a.created_at DESC`,
    [employeeId, from, to],
  );
  return rows;
}
