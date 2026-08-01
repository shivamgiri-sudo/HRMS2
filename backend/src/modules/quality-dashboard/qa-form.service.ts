import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { QaAuditError } from "./qa-audit.service.js";

/**
 * Defining what a process measures, and versioning it.
 *
 * Without this the rest of the QA module is inert: qa_audit_form has no writer,
 * so GET /audit-forms returns "no active form" for all 131 processes forever and
 * no audit can be filed against anything.
 *
 * Forms are versioned rather than edited because an audit records the version it
 * scored against. Editing a live form in place would silently change what past
 * audits claim to have measured — the same defect kpi_master_config had before
 * effective dating, where changing a target rewrote history.
 */

export type FormParameterInput = {
  parameterText: string;
  maxScore: number;
  section?: string | null;
  weightage?: number;
  isFatal?: boolean;
  displayOrder?: number;
  /** Optional link to the process's canonical metric definition. */
  processMetricDefinitionId?: string | null;
};

export type CreateFormInput = {
  processId: string;
  formName: string;
  effectiveFrom: string;
  parameters: FormParameterInput[];
  createdBy?: string | null;
};

/** Next version number for this process and form name. */
async function nextVersion(processId: string, formName: string): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM qa_audit_form
      WHERE process_id = ? AND form_name = ?`,
    [processId, formName],
  );
  return Number(rows[0]?.next ?? 1);
}

function validateParameters(parameters: FormParameterInput[]): void {
  if (!parameters.length) {
    throw new QaAuditError("A form needs at least one parameter to score anything");
  }
  for (const p of parameters) {
    if (!p.parameterText?.trim()) {
      throw new QaAuditError("Every parameter needs text describing what is being scored");
    }
    if (!Number.isFinite(p.maxScore) || p.maxScore <= 0) {
      // A zero-max parameter contributes nothing to the denominator and can
      // never be failed, so it silently does nothing while looking like it works.
      throw new QaAuditError(`Parameter "${p.parameterText}" needs a maximum score above zero`);
    }
  }
}

/** Create a DRAFT form. Drafts cannot be scored against until activated. */
export async function createForm(input: CreateFormInput): Promise<{ id: string; versionNo: number }> {
  validateParameters(input.parameters);

  const versionNo = await nextVersion(input.processId, input.formName);
  const formId = randomUUID();

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO qa_audit_form
         (id, process_id, form_name, version_no, status, effective_from, created_by)
       VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
      [formId, input.processId, input.formName, versionNo, input.effectiveFrom, input.createdBy ?? null],
    );

    let order = 0;
    for (const p of input.parameters) {
      await conn.execute(
        `INSERT INTO qa_audit_form_parameter
           (id, form_id, process_metric_definition_id, section, parameter_text,
            max_score, weightage, is_fatal, display_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(), formId, p.processMetricDefinitionId ?? null, p.section ?? null,
          p.parameterText.trim(), p.maxScore, p.weightage ?? 100,
          p.isFatal ? 1 : 0, p.displayOrder ?? (order += 10),
        ],
      );
    }
    await conn.commit();
  } catch (err) {
    // A form header with no parameters would pass the "form exists" check and
    // then fail every audit against it.
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  return { id: formId, versionNo };
}

/**
 * Activate a draft, retiring whatever was active for the same process.
 *
 * One active form per process at a time. Two would make "the active form"
 * ambiguous, and GET /audit-forms picks the highest version — so a second active
 * form would quietly shadow the first rather than erroring.
 */
export async function activateForm(formId: string, approvedBy?: string | null): Promise<{
  activatedVersion: number;
  retiredFormId: string | null;
}> {
  const [formRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, process_id, version_no, status FROM qa_audit_form WHERE id = ? LIMIT 1`,
    [formId],
  );
  const form = formRows[0];
  if (!form) throw new QaAuditError("Audit form not found", 404);
  if (form.status === "active") throw new QaAuditError("That form is already active", 409);
  if (form.status === "retired") {
    // Reviving a retired form would resurrect criteria somebody deliberately
    // withdrew. Copy it to a new version instead.
    throw new QaAuditError("A retired form cannot be reactivated — create a new version", 409);
  }

  const [paramRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM qa_audit_form_parameter WHERE form_id = ? AND active_status = 1`,
    [formId],
  );
  if (Number(paramRows[0]?.n ?? 0) === 0) {
    throw new QaAuditError("A form with no active parameters cannot be activated", 409);
  }

  const [currentRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM qa_audit_form WHERE process_id = ? AND status = 'active' LIMIT 1`,
    [form.process_id],
  );
  const retiredFormId = currentRows[0]?.id ? String(currentRows[0].id) : null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (retiredFormId) {
      // Retired, not deleted: its audits must stay readable and keep meaning
      // what they meant.
      await conn.execute(
        `UPDATE qa_audit_form SET status = 'retired', effective_to = CURDATE() WHERE id = ?`,
        [retiredFormId],
      );
    }
    await conn.execute(
      `UPDATE qa_audit_form SET status = 'active', approved_by = ?, approved_at = NOW() WHERE id = ?`,
      [approvedBy ?? null, formId],
    );
    await conn.commit();
  } catch (err) {
    // Retiring the old without activating the new would leave the process with
    // no way to be audited at all.
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  return { activatedVersion: Number(form.version_no), retiredFormId };
}

/** Every version for a process, newest first, for an admin screen. */
export async function listForms(processId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT f.id, f.form_name, f.version_no, f.status, f.effective_from, f.effective_to,
            f.approved_by, f.approved_at, f.created_at,
            (SELECT COUNT(*) FROM qa_audit_form_parameter p
              WHERE p.form_id = f.id AND p.active_status = 1) AS parameter_count,
            (SELECT COUNT(*) FROM qa_audit a WHERE a.form_id = f.id) AS audit_count
       FROM qa_audit_form f
      WHERE f.process_id = ?
      ORDER BY f.form_name ASC, f.version_no DESC`,
    [processId],
  );
  return rows;
}
