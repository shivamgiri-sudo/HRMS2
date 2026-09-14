/**
 * Cost-centre-wise review of an incentive or deduction batch, and single-line discard.
 *
 * WHAT THIS EXISTS FOR
 *
 * The approvals page used to show a batch as a flat replay of the uploaded spreadsheet.
 * That is the wrong shape for the decision being made: a Branch Head approves money for
 * a branch, and the unit they reason about is the cost centre — "why is Indiamart's
 * performance incentive up 40% this month" — not row 287 of a CSV. So the batch is
 * summarised per cost centre, and drilling into one shows every employee in it with one
 * column per incentive/deduction type and a total.
 *
 * WHERE THE COLUMNS COME FROM
 *
 * Cost centre, process and reporting manager are read off the EMPLOYEE, not off the
 * batch and not off cost_centre_master:
 *
 *   - cost_centre_master.process_id is NULL on every live row, so a cost centre cannot
 *     name its own process. The mapping that exists runs through the people posted to it.
 *   - incentive_upload_line.cost_centre_id and employee_deduction_entries.cost_centre_id
 *     both exist but the bulk importers never populate them (they set branch_id only),
 *     so reading them would return NULL for every uploaded row.
 *
 * The join is the same one the employee directory uses (employee.service.ts listEmployees),
 * including COALESCE(reporting_manager_id, manager_id) — both columns are live and every
 * list endpoint in the codebase coalesces them.
 *
 * WHY DISCARD DELETES AN INCENTIVE LINE BUT ONLY DEACTIVATES A DEDUCTION
 *
 * payrollCalculate.service.ts §5f sums incentive_upload_line for the month with NO filter
 * on validation_status — the only thing it tests is the parent batch's status. A line
 * flagged as discarded but left in place would therefore still be paid the moment the
 * batch is approved. Deductions have no such problem: payroll reads status = 'active' and
 * 'inactive' is already the state rejectDeductionBatch uses.
 *
 * Nothing is lost by the delete. upload_batch_row keeps raw_data, the row_status, the
 * reason, who discarded it and when — so the discarded line remains fully reconstructable,
 * and a finance_approval_event records the decision itself.
 */
import type { PoolConnection } from "mysql2/promise";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { recordFinanceApprovalEvent } from "../../shared/financeApprovalEvent.js";
import { BulkUploadError, type ApprovalStage, type BatchRecord } from "./bulk-approval.service.js";
import type { DiscardedLine } from "./bulk-approval-notify.service.js";

/** entity_type values used on finance_approval_event by this module. */
export const BATCH_ENTITY_TYPE = "bulk_upload_batch";
export const ROW_ENTITY_TYPE = "bulk_upload_row";

/** Cost centre shown for an employee who has none. Never invented as a real id. */
const UNASSIGNED_LABEL = "Unassigned";

export interface ReviewType {
  code: string;
  name: string;
}

export interface ReviewEmployeeRow {
  row_id: string;
  row_no: number;
  entity_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  cost_centre_id: string | null;
  cost_centre_code: string | null;
  cost_centre_name: string;
  process_name: string | null;
  reporting_manager_name: string | null;
  /** amount per type code — one key per type this employee actually has */
  amounts: Record<string, number>;
  total: number;
  discarded: boolean;
  discard_reason: string | null;
  discard_stage: string | null;
}

export interface ReviewCostCentre {
  cost_centre_id: string | null;
  cost_centre_code: string | null;
  cost_centre_name: string;
  process_name: string | null;
  employee_count: number;
  amounts: Record<string, number>;
  total: number;
  discarded_count: number;
}

export interface BatchReview {
  batch_id: string;
  upload_type_code: string;
  /** which master drives the columns */
  kind: "incentive" | "deduction";
  types: ReviewType[];
  cost_centres: ReviewCostCentre[];
  grand_total: number;
  employee_count: number;
  discarded_count: number;
}

export function isReviewable(uploadTypeCode: string): boolean {
  return uploadTypeCode === "INCENTIVE_BULK" || uploadTypeCode === "DEDUCTION_BULK";
}

function kindOf(uploadTypeCode: string): "incentive" | "deduction" {
  if (uploadTypeCode === "INCENTIVE_BULK") return "incentive";
  if (uploadTypeCode === "DEDUCTION_BULK") return "deduction";
  throw new BulkUploadError(
    `${uploadTypeCode} has no cost-centre review — only incentive and deduction batches do.`,
    400,
  );
}

/**
 * The full type master, so the grid can offer every column even when the batch happens
 * to use two of them. Ordered by name, matching GET /api/incentives/upload-template, so
 * the columns an approver sees line up with the columns the uploader filled in.
 */
export async function listTypes(kind: "incentive" | "deduction"): Promise<ReviewType[]> {
  const sql =
    kind === "incentive"
      ? `SELECT incentive_code AS code, incentive_name AS name
           FROM incentive_master WHERE active_status = 1 ORDER BY incentive_name`
      : `SELECT deduction_code AS code, deduction_name AS name
           FROM payroll_deduction_type WHERE active_status = 1 ORDER BY deduction_name`;
  const [rows] = await db.execute<RowDataPacket[]>(sql);
  return (rows as RowDataPacket[]).map((r) => ({ code: String(r.code), name: String(r.name) }));
}

/**
 * `efb` is the fallback employee join, and it is what keeps a DISCARDED row visible.
 *
 * Discarding an incentive deletes its incentive_upload_line (see the header), so `iul`
 * is NULL for that row and the normal `e.id = iul.employee_id` join yields nothing —
 * which left the row with no cost centre, dropped it out of the cost centre it belonged
 * to, and made it vanish from the drawer entirely instead of showing struck through with
 * its reason. An approver then cannot see why a person is missing, which is the one thing
 * the discard was supposed to record. Resolving the employee from the spreadsheet's own
 * employee_code puts it back where it belongs.
 */
const INCENTIVE_LINE_SQL = `
  SELECT ubr.id AS row_id, ubr.row_no, ubr.created_entity_id AS entity_id,
         ubr.row_status, ubr.discard_reason, ubr.discard_stage, ubr.raw_data,
         iul.incentive_code AS type_code, iul.amount,
         COALESCE(e.id, efb.id) AS employee_id,
         COALESCE(e.employee_code, efb.employee_code) AS employee_code,
         COALESCE(NULLIF(TRIM(COALESCE(e.full_name, efb.full_name)), ''),
                  TRIM(CONCAT(COALESCE(e.first_name, efb.first_name, ''), ' ',
                              COALESCE(e.last_name, efb.last_name, '')))) AS employee_name,
         cc.id AS cost_centre_id, cc.cost_centre_code, cc.cost_centre_name,
         pm.process_name,
         COALESCE(NULLIF(TRIM(mgr.full_name), ''),
                  NULLIF(TRIM(CONCAT(COALESCE(mgr.first_name, ''), ' ', COALESCE(mgr.last_name, ''))), '')) AS reporting_manager_name
    FROM upload_batch_row ubr
    LEFT JOIN incentive_upload_line iul ON iul.id = ubr.created_entity_id
    LEFT JOIN employees e ON e.id = iul.employee_id
    LEFT JOIN employees efb
           ON iul.id IS NULL
          AND efb.employee_code = JSON_UNQUOTE(JSON_EXTRACT(ubr.raw_data, '$.employee_code'))
    LEFT JOIN cost_centre_master cc ON cc.id = COALESCE(e.cost_centre_id, efb.cost_centre_id)
    LEFT JOIN process_master pm ON pm.id = COALESCE(e.process_id, efb.process_id)
    LEFT JOIN employees mgr
           ON mgr.id = COALESCE(e.reporting_manager_id, e.manager_id,
                                efb.reporting_manager_id, efb.manager_id)
   WHERE ubr.upload_batch_id = ?
     AND ubr.created_entity_type = 'incentive_upload_line'
   ORDER BY cc.cost_centre_name, COALESCE(e.employee_code, efb.employee_code), ubr.row_no`;

const DEDUCTION_LINE_SQL = `
  SELECT ubr.id AS row_id, ubr.row_no, ubr.created_entity_id AS entity_id,
         ubr.row_status, ubr.discard_reason, ubr.discard_stage, ubr.raw_data,
         ede.deduction_type_code AS type_code, ede.amount,
         e.id AS employee_id, e.employee_code,
         COALESCE(NULLIF(TRIM(e.full_name), ''),
                  TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, '')))) AS employee_name,
         cc.id AS cost_centre_id, cc.cost_centre_code, cc.cost_centre_name,
         pm.process_name,
         COALESCE(NULLIF(TRIM(mgr.full_name), ''),
                  NULLIF(TRIM(CONCAT(COALESCE(mgr.first_name, ''), ' ', COALESCE(mgr.last_name, ''))), '')) AS reporting_manager_name
    FROM upload_batch_row ubr
    LEFT JOIN employee_deduction_entries ede ON ede.id = ubr.created_entity_id
    LEFT JOIN employees e ON e.id = ede.employee_id
    LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
    LEFT JOIN process_master pm ON pm.id = e.process_id
    LEFT JOIN employees mgr ON mgr.id = COALESCE(e.reporting_manager_id, e.manager_id)
   WHERE ubr.upload_batch_id = ?
     AND ubr.created_entity_type = 'employee_deduction_entries'
   ORDER BY cc.cost_centre_name, e.employee_code, ubr.row_no`;

/**
 * Every staged line of a batch, employee-wise, with its type and amount.
 *
 * Driven from upload_batch_row rather than from the domain table so a DISCARDED row is
 * still returned — the approver needs to see what was dropped and why, and the creator's
 * notification is built from the same list. Discarded incentive lines no longer exist in
 * incentive_upload_line, hence the LEFT JOIN and the fallback to raw_data for their
 * employee code and amount.
 */
async function loadLines(batch: BatchRecord): Promise<ReviewEmployeeRow[]> {
  const kind = kindOf(batch.upload_type_code);
  const [rows] = await db.execute<RowDataPacket[]>(
    kind === "incentive" ? INCENTIVE_LINE_SQL : DEDUCTION_LINE_SQL,
    [batch.id],
  );

  // One entry per (employee, cost centre, live/discarded) with the type amounts folded
  // in — a file may legitimately give the same employee both PERF and NSA, and the grid
  // shows those as two columns of one row, not two rows.
  const byEmployee = new Map<string, ReviewEmployeeRow>();

  for (const r of rows as RowDataPacket[]) {
    const raw: Record<string, unknown> =
      typeof r.raw_data === "string"
        ? (JSON.parse(r.raw_data) as Record<string, unknown>)
        : ((r.raw_data as Record<string, unknown>) ?? {});
    const discarded = String(r.row_status ?? "") === "discarded";

    // A discarded incentive line is gone from incentive_upload_line, so fall back to the
    // spreadsheet the uploader actually sent.
    const employeeCode = String(r.employee_code ?? raw.employee_code ?? "").trim();
    const typeCode = String(r.type_code ?? raw.incentive_code ?? raw.deduction_type_code ?? "")
      .trim()
      .toUpperCase();
    const amount = Number(r.amount ?? raw.amount ?? 0) || 0;

    const key = [
      String(r.employee_id ?? employeeCode),
      String(r.cost_centre_id ?? ""),
      discarded ? "d" : "a",
    ].join("::");

    let entry = byEmployee.get(key);
    if (!entry) {
      entry = {
        row_id: String(r.row_id),
        row_no: Number(r.row_no),
        entity_id: r.entity_id ? String(r.entity_id) : "",
        employee_id: r.employee_id ? String(r.employee_id) : "",
        employee_code: employeeCode,
        employee_name: String(r.employee_name ?? "").trim(),
        cost_centre_id: r.cost_centre_id ? String(r.cost_centre_id) : null,
        cost_centre_code: r.cost_centre_code ? String(r.cost_centre_code) : null,
        cost_centre_name: String(r.cost_centre_name ?? UNASSIGNED_LABEL),
        process_name: r.process_name ? String(r.process_name) : null,
        reporting_manager_name: r.reporting_manager_name ? String(r.reporting_manager_name) : null,
        amounts: {},
        total: 0,
        discarded,
        discard_reason: r.discard_reason ? String(r.discard_reason) : null,
        discard_stage: r.discard_stage ? String(r.discard_stage) : null,
      };
      byEmployee.set(key, entry);
    }
    if (typeCode) {
      entry.amounts[typeCode] = (entry.amounts[typeCode] ?? 0) + amount;
      entry.total += amount;
    }
  }

  return [...byEmployee.values()];
}

/**
 * Columns for a grid: the master types actually present, in master order, plus any code
 * in the file that is no longer active in the master. That last part matters — an
 * inactive code's money is still in the total, so hiding its column would leave a grid
 * whose rows do not add up to their own total.
 */
function columnsFor(allTypes: ReviewType[], lines: ReviewEmployeeRow[]): ReviewType[] {
  const present = new Set<string>();
  for (const l of lines) for (const c of Object.keys(l.amounts)) present.add(c);
  const types = allTypes.filter((t) => present.has(t.code));
  for (const code of present) {
    if (!types.some((t) => t.code === code)) types.push({ code, name: code });
  }
  return types;
}

/** Cost-centre summary — what the Branch Head and Payroll Head see first. */
export async function getBatchReview(batch: BatchRecord): Promise<BatchReview> {
  const kind = kindOf(batch.upload_type_code);
  const [allTypes, lines] = await Promise.all([listTypes(kind), loadLines(batch)]);

  const byCostCentre = new Map<string, ReviewCostCentre>();
  let grandTotal = 0;
  let discardedCount = 0;

  for (const line of lines) {
    const key = line.cost_centre_id ?? UNASSIGNED_LABEL;
    let cc = byCostCentre.get(key);
    if (!cc) {
      cc = {
        cost_centre_id: line.cost_centre_id,
        cost_centre_code: line.cost_centre_code,
        cost_centre_name: line.cost_centre_name,
        process_name: line.process_name,
        employee_count: 0,
        amounts: {},
        total: 0,
        discarded_count: 0,
      };
      byCostCentre.set(key, cc);
    }
    if (line.discarded) {
      // Discarded money is excluded from every total — the approver is deciding on what
      // would actually be paid, not on what was originally uploaded.
      discardedCount++;
      cc.discarded_count++;
      continue;
    }
    cc.employee_count++;
    for (const [code, amt] of Object.entries(line.amounts)) {
      cc.amounts[code] = (cc.amounts[code] ?? 0) + amt;
    }
    cc.total += line.total;
    grandTotal += line.total;
  }

  const costCentres = [...byCostCentre.values()].sort((a, b) =>
    a.cost_centre_name.localeCompare(b.cost_centre_name),
  );

  return {
    batch_id: batch.id,
    upload_type_code: batch.upload_type_code,
    kind,
    types: columnsFor(allTypes, lines.filter((l) => !l.discarded)),
    cost_centres: costCentres,
    grand_total: grandTotal,
    employee_count: lines.filter((l) => !l.discarded).length,
    discarded_count: discardedCount,
  };
}

/** The drill-down: every employee in one cost centre, or the whole batch when unfiltered. */
export async function getBatchEmployees(
  batch: BatchRecord,
  costCentreId?: string | null,
): Promise<{ types: ReviewType[]; rows: ReviewEmployeeRow[] }> {
  const kind = kindOf(batch.upload_type_code);
  const [allTypes, lines] = await Promise.all([listTypes(kind), loadLines(batch)]);

  const wanted = costCentreId ?? "";
  const filtered =
    wanted === ""
      ? lines
      : lines.filter((l) =>
          wanted === UNASSIGNED_LABEL ? l.cost_centre_id === null : l.cost_centre_id === wanted,
        );

  return { types: columnsFor(allTypes, filtered), rows: filtered };
}

export interface DiscardResult {
  discarded: DiscardedLine[];
  remaining: number;
  remainingAmount: number;
}

/**
 * Drop one or more employee lines out of a batch, with a reason.
 *
 * Allowed at EITHER stage, and only while the batch is still pending — once the Payroll
 * Head has approved it the rows are locked in bulk_upload_locked_entity and reversing one
 * is the discard module's job, not this one. That is enforced by the `status =
 * 'pending_approval'` guard on each domain UPDATE/DELETE, not by trusting the caller.
 *
 * One transaction per row, so a failure on one line can never leave the spreadsheet row
 * marked discarded while its money is still staged.
 */
export async function discardRows(params: {
  batch: BatchRecord;
  rowIds: string[];
  stage: ApprovalStage;
  actorRole: string;
  userId: string;
  reason: string;
}): Promise<DiscardResult> {
  const kind = kindOf(params.batch.upload_type_code);
  const reason = params.reason.trim();
  if (reason.length < 10) {
    throw new BulkUploadError(
      "A discard needs a reason of at least 10 characters — it is what the uploader has to act on.",
      400,
    );
  }
  if (params.rowIds.length === 0) {
    throw new BulkUploadError("Select at least one row to discard.", 400);
  }

  // Everything about the rows BEFORE they are touched, so the notification can name the
  // employee and amount of a line that is about to stop existing.
  const before = await loadLines(params.batch);
  const byRowId = new Map<string, ReviewEmployeeRow>();
  for (const line of before) byRowId.set(line.row_id, line);

  const discarded: DiscardedLine[] = [];

  for (const rowId of params.rowIds) {
    const line = byRowId.get(rowId);
    if (!line) {
      throw new BulkUploadError(
        `That row is not part of batch ${params.batch.upload_batch_no}.`,
        404,
      );
    }
    if (line.discarded) continue; // discarding twice is a no-op, not an error

    const conn: PoolConnection = await db.getConnection();
    try {
      await conn.beginTransaction();

      let incentiveBatchId: string | null = null;

      if (kind === "incentive") {
        // Read the parent before the delete — afterwards the line is gone and there is
        // nothing left to resolve it from.
        const [parent] = await conn.execute<RowDataPacket[]>(
          "SELECT batch_id FROM incentive_upload_line WHERE id = ? LIMIT 1",
          [line.entity_id],
        );
        incentiveBatchId = (parent as RowDataPacket[])[0]?.batch_id
          ? String((parent as RowDataPacket[])[0].batch_id)
          : null;

        // Deleted, not flagged — payrollCalculate §5f has no validation_status filter, so
        // a flagged line would still be paid. See the file header.
        const [res] = await conn.execute<ResultSetHeader>(
          `DELETE iul FROM incentive_upload_line iul
             JOIN incentive_upload_batch iub ON iub.id = iul.batch_id
            WHERE iul.id = ? AND iub.status = 'pending_approval'`,
          [line.entity_id],
        );
        if (res.affectedRows === 0) {
          throw new BulkUploadError(
            `${line.employee_code}: this incentive line is no longer pending approval — refresh the batch.`,
            409,
          );
        }

        // The header must never disagree with its own detail.
        if (incentiveBatchId) {
          await conn.execute(
            `UPDATE incentive_upload_batch ib
                SET ib.total_employees = (
                      SELECT COUNT(DISTINCT employee_id) FROM incentive_upload_line WHERE batch_id = ib.id),
                    ib.total_amount = (
                      SELECT COALESCE(SUM(amount), 0) FROM incentive_upload_line WHERE batch_id = ib.id),
                    ib.updated_at = NOW()
              WHERE ib.id = ?`,
            [incentiveBatchId],
          );

          // Discarding the LAST line of one incentive type would otherwise strand that
          // sub-batch at 'pending_approval' for ever: applyIncentiveBatch finds its
          // sub-batches by joining through incentive_upload_line, so a sub-batch with no
          // lines left is invisible to the approval that follows and nothing would ever
          // move it off pending. Close it here instead, naming why.
          const [remaining] = await conn.execute<RowDataPacket[]>(
            "SELECT COUNT(*) AS c FROM incentive_upload_line WHERE batch_id = ?",
            [incentiveBatchId],
          );
          if (Number((remaining as RowDataPacket[])[0]?.c ?? 0) === 0) {
            await conn.execute(
              `UPDATE incentive_upload_batch
                  SET status = 'rejected',
                      remarks = ?,
                      updated_at = NOW()
                WHERE id = ? AND status = 'pending_approval'`,
              [
                `Every line was discarded at the ${params.stage} stage of ${params.batch.upload_batch_no}: ${reason}`,
                incentiveBatchId,
              ],
            );
          }
        }
      } else {
        const [res] = await conn.execute<ResultSetHeader>(
          `UPDATE employee_deduction_entries
              SET status = 'inactive', updated_at = NOW()
            WHERE id = ? AND status = 'pending_approval'`,
          [line.entity_id],
        );
        if (res.affectedRows === 0) {
          throw new BulkUploadError(
            `${line.employee_code}: this deduction is no longer pending approval — refresh the batch.`,
            409,
          );
        }
      }

      await conn.execute(
        `UPDATE upload_batch_row
            SET row_status = 'discarded',
                discarded_by = ?, discarded_at = NOW(),
                discard_stage = ?, discard_reason = ?
          WHERE id = ? AND upload_batch_id = ?`,
        [params.userId, params.stage, reason, rowId, params.batch.id],
      );

      // Keep the batch's own row count honest. imported_rows is what the queue list shows
      // in its ROWS column and what the decision footer counts down ("N rows will be held
      // for Payroll Head approval") — leaving it at the pre-discard figure puts a number
      // on screen next to a money decision that no longer matches the rows being decided.
      // GREATEST(...) so a replay can never drive it negative.
      await conn.execute(
        `UPDATE upload_batch
            SET imported_rows = GREATEST(COALESCE(imported_rows, 0) - 1, 0),
                updated_at = NOW()
          WHERE id = ?`,
        [params.batch.id],
      );

      await recordFinanceApprovalEvent(
        {
          entityType: ROW_ENTITY_TYPE,
          entityId: rowId,
          action: "reject",
          fromStatus: params.batch.approval_status ?? null,
          toStatus: "discarded",
          decision: "discarded",
          actorUserId: params.userId,
          actorRole: params.actorRole,
          remarks: reason,
          details: {
            upload_batch_id: params.batch.id,
            upload_batch_no: params.batch.upload_batch_no,
            employee_code: line.employee_code,
            amount: line.total,
            stage: params.stage,
          },
        },
        conn,
      );

      await conn.commit();

      discarded.push({
        rowNo: line.row_no,
        employeeCode: line.employee_code,
        employeeName: line.employee_name,
        amount: line.total,
        reason,
      });
    } catch (err) {
      await conn.rollback().catch(() => {
        /* connection already broken — nothing to undo */
      });
      throw err;
    } finally {
      conn.release();
    }
  }

  void logSensitiveAction({
    actor_user_id: params.userId,
    actor_role: params.actorRole,
    action_type: "BULK_UPLOAD_ROWS_DISCARDED",
    module_key: "bulk_upload",
    entity_type: "upload_batch",
    entity_id: params.batch.id,
    reason,
    new_value_json: {
      upload_batch_no: params.batch.upload_batch_no,
      stage: params.stage,
      discarded: discarded.map((d) => ({
        row_no: d.rowNo,
        employee_code: d.employeeCode,
        amount: d.amount,
      })),
    },
  });

  const after = await loadLines(params.batch);
  const live = after.filter((l) => !l.discarded);
  return {
    discarded,
    remaining: live.length,
    remainingAmount: live.reduce((sum, l) => sum + l.total, 0),
  };
}
