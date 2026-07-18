import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { queryRows, tableExists } from "../../shared/dbHelpers.js";
import { bpoPnlService } from "./bpo-pnl.service.js";

const safeRows = async <T extends RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> => {
  try {
    return await queryRows<T>(sql, params);
  } catch {
    return [];
  }
};

function filters(period?: string, processId?: string) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (period) {
    conditions.push("period_code = ?");
    params.push(period);
  }
  if (processId) {
    conditions.push("process_id = ?");
    params.push(processId);
  }
  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export const bpoPnlConfigurationService = {
  async listRevenueRules(processId?: string) {
    return bpoPnlService.listRevenueRules(processId);
  },

  async listDeliveryActuals(period?: string, processId?: string) {
    if (!(await tableExists("process_delivery_actual"))) return [];
    const scoped = filters(period, processId);
    return safeRows<RowDataPacket>(
      `SELECT *
         FROM process_delivery_actual
         ${scoped.where}
        ORDER BY period_code DESC, process_id, metric_key, activity_date DESC, updated_at DESC`,
      scoped.params
    );
  },

  async listRevenueComponents(period?: string, processId?: string) {
    if (!(await tableExists("process_revenue_component"))) return [];
    const scoped = filters(period, processId);
    return safeRows<RowDataPacket>(
      `SELECT *
         FROM process_revenue_component
         ${scoped.where}
        ORDER BY period_code DESC, process_id, recognition_date DESC, created_at DESC`,
      scoped.params
    );
  },

  async listCostComponents(period?: string, processId?: string) {
    if (!(await tableExists("process_pnl_cost_component"))) return [];
    const scoped = filters(period, processId);
    return safeRows<RowDataPacket>(
      `SELECT *
         FROM process_pnl_cost_component
         ${scoped.where}
        ORDER BY period_code DESC, branch_id, process_id, cost_type, created_at DESC`,
      scoped.params
    );
  },

  async listAllocationPolicies(branchId?: string) {
    if (!(await tableExists("pnl_allocation_policy"))) return [];
    return safeRows<RowDataPacket>(
      `SELECT *
         FROM pnl_allocation_policy
         ${branchId ? "WHERE branch_id = ?" : ""}
        ORDER BY branch_id, pool_type, process_id, effective_from DESC`,
      branchId ? [branchId] : []
    );
  },

  async listClassificationRules(processId?: string, branchId?: string) {
    if (!(await tableExists("pnl_cost_classification_rule"))) return [];
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (processId) {
      conditions.push("(process_id = ? OR process_id IS NULL)");
      params.push(processId);
    }
    if (branchId) {
      conditions.push("(branch_id = ? OR branch_id IS NULL)");
      params.push(branchId);
    }
    return safeRows<RowDataPacket>(
      `SELECT *
         FROM pnl_cost_classification_rule
         ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY priority ASC, rule_name, effective_from DESC`,
      params
    );
  },

  async saveRevenueRule(payload: Record<string, unknown>, userId: string) {
    return bpoPnlService.saveRevenueRule(payload, userId);
  },

  async saveDeliveryActual(payload: Record<string, unknown>, userId: string) {
    return bpoPnlService.saveDeliveryActual(payload, userId);
  },

  async saveRevenueComponent(payload: Record<string, unknown>, userId: string) {
    return bpoPnlService.saveRevenueComponent(payload, userId);
  },

  async saveCostComponent(payload: Record<string, unknown>, userId: string) {
    return bpoPnlService.saveCostComponent(payload, userId);
  },

  async saveAllocationPolicy(payload: Record<string, unknown>, userId: string) {
    return bpoPnlService.saveAllocationPolicy(payload, userId);
  },

  async saveClassificationRule(payload: Record<string, unknown>, userId: string) {
    const id = String(payload.id ?? randomUUID());
    await db.execute(
      `INSERT INTO pnl_cost_classification_rule
        (id, rule_name, scope_type, scope_key, process_id, branch_id, pnl_bucket, priority,
         effective_from, effective_to, active_status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         rule_name=VALUES(rule_name), scope_type=VALUES(scope_type), scope_key=VALUES(scope_key),
         process_id=VALUES(process_id), branch_id=VALUES(branch_id), pnl_bucket=VALUES(pnl_bucket),
         priority=VALUES(priority), effective_from=VALUES(effective_from), effective_to=VALUES(effective_to),
         active_status=VALUES(active_status), updated_by=VALUES(updated_by)`,
      [
        id,
        payload.ruleName,
        payload.scopeType,
        payload.scopeKey,
        payload.processId ?? null,
        payload.branchId ?? null,
        payload.pnlBucket,
        Number(payload.priority ?? 100),
        payload.effectiveFrom,
        payload.effectiveTo ?? null,
        payload.activeStatus === false ? 0 : 1,
        userId,
        userId,
      ]
    );
    return { id };
  },
};
