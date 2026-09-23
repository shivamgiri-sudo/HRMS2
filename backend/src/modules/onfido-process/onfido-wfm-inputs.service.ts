import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import type { ManpowerPlanRow, ProcessQueue } from "./onfido-overview-report.pure.js";
import type { ManpowerPlanInput, UtilizationInputRow } from "./onfido-wfm-inputs.validation.js";

/**
 * Manual WFM inputs for the Onfido Overview / Utilization formats (migration 1845):
 * onfido_manpower_plan and onfido_utilization_daily_input, both in mas_hrms. These are the
 * figures no uploaded Onfido report carries; they are entered by WFM, never derived.
 */

const AUDIT_MODULE = "onfido-process";

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface ManpowerPlanRecord extends ManpowerPlanRow {
  id: string;
  remarks: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export async function listManpowerPlan(): Promise<ManpowerPlanRecord[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, process_queue, DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from, approved_hc, active_hc,
            remarks, created_by, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            updated_by, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
       FROM onfido_manpower_plan ORDER BY effective_from DESC, process_queue`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    processQueue: r.process_queue as ProcessQueue,
    effectiveFrom: String(r.effective_from),
    approvedHc: Number(r.approved_hc),
    activeHc: numOrNull(r.active_hc),
    remarks: r.remarks ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at ?? null,
    updatedBy: r.updated_by ?? null,
    updatedAt: r.updated_at ?? null,
  }));
}

export async function upsertManpowerPlan(input: ManpowerPlanInput, actorUserId: string): Promise<void> {
  await db.execute(
    `INSERT INTO onfido_manpower_plan (id, process_queue, effective_from, approved_hc, active_hc, remarks, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE approved_hc = VALUES(approved_hc), active_hc = VALUES(active_hc),
                             remarks = VALUES(remarks), updated_by = ?`,
    [randomUUID(), input.processQueue, input.effectiveFrom, input.approvedHc, input.activeHc, input.remarks, actorUserId, actorUserId],
  );
  await writeAuditLog({
    actor_user_id: actorUserId,
    action_type: "ONFIDO_MANPOWER_PLAN_UPSERT",
    module_key: AUDIT_MODULE,
    entity_type: "onfido_manpower_plan",
    entity_id: `${input.processQueue}:${input.effectiveFrom}`,
    metadata: { ...input },
  });
}

export interface UtilizationInputRecord extends UtilizationInputRow {
  updatedBy: string | null;
  updatedAt: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

export async function listUtilizationInputs(from: string, to: string): Promise<UtilizationInputRecord[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(input_date, '%Y-%m-%d') AS input_date, forecast_task, forecast_task_poa, manual_far_cases,
            adhoc_time, analyst_qc, facial_checks, cross_training_task_poa, poa_live_audits_pq, remarks,
            created_by, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
            updated_by, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
       FROM onfido_utilization_daily_input WHERE input_date BETWEEN ? AND ? ORDER BY input_date`,
    [from, to],
  );
  return rows.map((r) => ({
    inputDate: String(r.input_date),
    forecastTask: numOrNull(r.forecast_task),
    forecastTaskPoa: numOrNull(r.forecast_task_poa),
    manualFarCases: numOrNull(r.manual_far_cases),
    adhocTime: numOrNull(r.adhoc_time),
    analystQc: numOrNull(r.analyst_qc),
    facialChecks: numOrNull(r.facial_checks),
    crossTrainingTaskPoa: numOrNull(r.cross_training_task_poa),
    poaLiveAuditsPq: numOrNull(r.poa_live_audits_pq),
    remarks: r.remarks ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at ?? null,
    updatedBy: r.updated_by ?? null,
    updatedAt: r.updated_at ?? null,
  }));
}

/** Inserts or overwrites one row per date. The caller has already validated every row. */
export async function upsertUtilizationInputs(rows: readonly UtilizationInputRow[], actorUserId: string): Promise<number> {
  for (const r of rows) {
    await db.execute(
      `INSERT INTO onfido_utilization_daily_input
         (input_date, forecast_task, forecast_task_poa, manual_far_cases, adhoc_time, analyst_qc, facial_checks,
          cross_training_task_poa, poa_live_audits_pq, remarks, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE forecast_task = VALUES(forecast_task), forecast_task_poa = VALUES(forecast_task_poa),
         manual_far_cases = VALUES(manual_far_cases), adhoc_time = VALUES(adhoc_time), analyst_qc = VALUES(analyst_qc),
         facial_checks = VALUES(facial_checks), cross_training_task_poa = VALUES(cross_training_task_poa),
         poa_live_audits_pq = VALUES(poa_live_audits_pq), remarks = VALUES(remarks), updated_by = ?`,
      [
        r.inputDate, r.forecastTask, r.forecastTaskPoa, r.manualFarCases, r.adhocTime, r.analystQc, r.facialChecks,
        r.crossTrainingTaskPoa, r.poaLiveAuditsPq, r.remarks, actorUserId, actorUserId,
      ],
    );
  }
  const dates = rows.map((r) => r.inputDate).sort();
  await writeAuditLog({
    actor_user_id: actorUserId,
    action_type: "ONFIDO_UTILIZATION_INPUT_UPSERT",
    module_key: AUDIT_MODULE,
    entity_type: "onfido_utilization_daily_input",
    entity_id: dates.length === 1 ? dates[0] : `${dates[0]}..${dates[dates.length - 1]}`,
    metadata: { rowCount: rows.length, firstDate: dates[0], lastDate: dates[dates.length - 1] },
  });
  return rows.length;
}
