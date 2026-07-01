import { db } from "../../db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { randomUUID } from "crypto";
import { calculate, type HcInput } from "./hcCalculation.service.js";
import { planningRuleService } from "./planningRule.service.js";

export const slotRequirementService = {

  async list(params: {
    processId: string;
    branchId?: string;
    fromDate?: string;
    toDate?: string;
    coverageStatus?: string;
  }): Promise<RowDataPacket[]> {
    const { processId, branchId, fromDate, toDate, coverageStatus } = params;
    const conds: string[] = ["s.process_id = ?", "s.is_active = 1"];
    const vals: unknown[] = [processId];

    if (branchId) { conds.push("(s.branch_id = ? OR s.branch_id IS NULL)"); vals.push(branchId); }
    if (fromDate) { conds.push("s.requirement_date >= ?"); vals.push(fromDate); }
    if (toDate)   { conds.push("s.requirement_date <= ?"); vals.push(toDate); }
    if (coverageStatus) { conds.push("s.coverage_status = ?"); vals.push(coverageStatus); }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT s.*, pm.process_name
         FROM wfm_slot_requirement s
         JOIN process_master pm ON pm.id = s.process_id
        WHERE ${conds.join(" AND ")}
        ORDER BY s.requirement_date ASC, s.slot_start ASC`,
      vals
    );
    return rows;
  },

  async upsert(input: Record<string, unknown>, userId: string): Promise<RowDataPacket> {
    const { process_id, requirement_date, slot_start = "00:00:00", workload_type } = input as any;
    if (!process_id || !requirement_date || !workload_type) {
      throw new Error("process_id, requirement_date and workload_type are required");
    }

    // Check for existing active row
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM wfm_slot_requirement WHERE process_id = ? AND requirement_date = ? AND slot_start = ? AND workload_type = ? AND is_active = 1 LIMIT 1",
      [process_id, requirement_date, slot_start, workload_type]
    );

    const id = (existing as RowDataPacket[])[0]?.id ?? randomUUID();
    const isNew = !(existing as RowDataPacket[])[0];

    const WRITABLE = new Set([
      "branch_id", "slot_end", "forecast_calls", "chat_volume", "new_email_volume",
      "backlog_volume", "sla_due_volume", "case_volume", "production_volume",
      "target_attempts", "target_contacts", "target_sales", "connect_rate_pct",
      "conversion_rate_pct", "aht_seconds_override", "shrinkage_pct_override",
      "chat_concurrency_override", "emails_per_agent_hour_override",
      "cases_per_agent_hour_override", "audit_sample_pct_override",
      "audits_per_qa_hour_override", "required_skill", "required_certification",
      "source_type", "source_file_id",
    ]);

    if (isNew) {
      const cols = ["id", "process_id", "requirement_date", "slot_start", "workload_type", "created_by"];
      const vals: unknown[] = [id, process_id, requirement_date, slot_start, workload_type, userId];
      for (const [k, v] of Object.entries(input)) {
        if (WRITABLE.has(k) && v !== undefined) { cols.push(k); vals.push(v); }
      }
      await db.execute(
        `INSERT INTO wfm_slot_requirement (${cols.join(", ")}) VALUES (${vals.map(() => "?").join(", ")})`,
        vals
      );
    } else {
      const sets = ["updated_by = ?"];
      const vals: unknown[] = [userId];
      for (const [k, v] of Object.entries(input)) {
        if (WRITABLE.has(k) && v !== undefined) { sets.push(`${k} = ?`); vals.push(v); }
      }
      vals.push(id);
      await db.execute(`UPDATE wfm_slot_requirement SET ${sets.join(", ")} WHERE id = ?`, vals);
    }

    return this.getById(id);
  },

  async calculateHc(slotId: string, userId: string): Promise<RowDataPacket> {
    const [slotRows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM wfm_slot_requirement WHERE id = ? LIMIT 1", [slotId]
    );
    const slot = (slotRows as RowDataPacket[])[0];
    if (!slot) throw new Error("Slot requirement not found");

    // Load active planning rule for this process/workload_type/date
    const rule = await planningRuleService.getActive(
      slot.process_id, slot.workload_type, slot.requirement_date
    );

    // Build HcInput — slot overrides take precedence over planning rule values
    const slotHours = slot.slot_end
      ? (() => {
          const [sh, sm] = String(slot.slot_start || "00:00").split(":").map(Number);
          const [eh, em] = String(slot.slot_end || "23:59").split(":").map(Number);
          const mins = (eh * 60 + em) - (sh * 60 + sm);
          return mins > 0 ? mins / 60 : 8;
        })()
      : 8;

    const hcInput: HcInput = {
      workload_type: slot.workload_type as any,
      slot_hours: slotHours,
      shrinkage_pct: slot.shrinkage_pct_override ?? rule?.shrinkage_pct ?? 0,
      forecast_calls:     slot.forecast_calls,
      aht_seconds:        slot.aht_seconds_override ?? rule?.aht_seconds,
      chat_volume:        slot.chat_volume,
      avg_chat_duration_seconds: rule?.avg_chat_duration_seconds,
      chat_concurrency:   slot.chat_concurrency_override ?? rule?.chat_concurrency,
      new_email_volume:   slot.new_email_volume,
      backlog_volume:     slot.backlog_volume,
      sla_due_volume:     slot.sla_due_volume,
      emails_per_agent_hour: slot.emails_per_agent_hour_override ?? rule?.emails_per_agent_hour,
      case_volume:        slot.case_volume,
      cases_per_agent_hour: slot.cases_per_agent_hour_override ?? rule?.cases_per_agent_hour,
      quality_recheck_pct: rule?.quality_recheck_pct,
      production_volume:  slot.production_volume,
      audit_sample_pct:   slot.audit_sample_pct_override ?? rule?.audit_sample_pct,
      audits_per_qa_hour: slot.audits_per_qa_hour_override ?? rule?.audits_per_qa_hour,
      campaign_target_type: rule?.campaign_target_type,
      target_attempts:    slot.target_attempts ?? rule?.target_attempts,
      target_contacts:    slot.target_contacts ?? rule?.target_contacts,
      target_sales:       slot.target_sales ?? rule?.target_sales,
      connect_rate_pct:   slot.connect_rate_pct ?? rule?.connect_rate_pct,
      conversion_rate_pct: slot.conversion_rate_pct ?? rule?.conversion_rate_pct,
      dials_per_agent_hour: rule?.dials_per_agent_hour,
    };

    const result = calculate(hcInput);

    await db.execute(
      `UPDATE wfm_slot_requirement
          SET required_productive_hc = ?, required_planned_hc = ?,
              calculation_method = ?, calculation_notes = ?,
              planning_rule_id = ?, updated_by = ?
        WHERE id = ?`,
      [
        result.productive_hc, result.planned_hc,
        result.calculation_method, JSON.stringify({ ...result.notes, errors: result.errors }),
        rule?.id ?? null, userId, slotId
      ]
    );

    return this.getById(slotId);
  },

  async calculateHcBulk(processId: string, fromDate: string, toDate: string, userId: string): Promise<{ calculated: number; errors: string[] }> {
    const [slots] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM wfm_slot_requirement WHERE process_id = ? AND requirement_date BETWEEN ? AND ?",
      [processId, fromDate, toDate]
    );

    let calculated = 0;
    const errors: string[] = [];

    for (const slot of slots as RowDataPacket[]) {
      try {
        await this.calculateHc(slot.id, userId);
        calculated++;
      } catch (e: any) {
        errors.push(`Slot ${slot.id}: ${e.message}`);
      }
    }

    return { calculated, errors };
  },

  async updateCoverageAfterRoster(processId: string, date: string, scheduledHcBySlot: Record<string, number>): Promise<void> {
    for (const [slotKey, scheduledHc] of Object.entries(scheduledHcBySlot)) {
      const [slotStart] = slotKey.split("|");
      await db.execute(
        `UPDATE wfm_slot_requirement
            SET roster_scheduled_hc = ?,
                coverage_delta = ? - COALESCE(required_planned_hc, 0),
                coverage_status = CASE
                  WHEN ? < COALESCE(required_planned_hc, 0) THEN 'shortage'
                  WHEN ? > COALESCE(required_planned_hc, 0) THEN 'excess'
                  ELSE 'ok'
                END
          WHERE process_id = ? AND requirement_date = ? AND slot_start = ?`,
        [scheduledHc, scheduledHc, scheduledHc, scheduledHc, processId, date, slotStart]
      );
    }
  },

  async getById(id: string): Promise<RowDataPacket> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM wfm_slot_requirement WHERE id = ? AND is_active = 1 LIMIT 1", [id]
    );
    if (!(rows as RowDataPacket[])[0]) throw new Error("Slot requirement not found");
    return (rows as RowDataPacket[])[0];
  },

  async delete(id: string, userId: string, reason: string): Promise<void> {
    if (!reason || reason.trim().length < 5) {
      throw new Error("delete_reason is required (minimum 5 characters)");
    }
    const [result] = await db.execute<ResultSetHeader>(
      `UPDATE wfm_slot_requirement
          SET is_active = 0, deleted_by = ?, deleted_at = NOW(), delete_reason = ?
        WHERE id = ? AND is_active = 1`,
      [userId, reason.trim(), id]
    );
    if (!result.affectedRows) {
      throw new Error("Slot requirement not found or already deleted");
    }
  },
};
