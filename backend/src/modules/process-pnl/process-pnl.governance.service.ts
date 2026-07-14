import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { queryRows, tableExists } from "../../shared/dbHelpers.js";
import { processPnlService } from "./process-pnl.service.js";

type SignoffRole = "finance_preparer" | "finance_head" | "accounts_head" | "ceo";

interface SaveContractInput {
  id?: string;
  client_id?: string | null;
  process_id?: string | null;
  contract_name: string;
  billing_type?: string;
  billing_rate?: number;
  currency?: string;
  monthly_minimum_commitment?: number;
  sla_target_percentage?: number | null;
  penalty_rule_json?: unknown;
  effective_from?: string;
  effective_to?: string | null;
  status?: string;
}

interface SaveRateInput {
  id?: string;
  process_id: string;
  contract_id?: string | null;
  rate_type: string;
  rate_amount: number;
  unit?: string;
  effective_from: string;
  effective_to?: string | null;
  approval_reference?: string | null;
}

interface SaveMonthlyPlanInput {
  id?: string;
  process_id: string;
  period_code: string;
  contracted_seats?: number | null;
  required_productive_hc?: number | null;
  planned_shrinkage_pct?: number | null;
  required_roster_hc?: number | null;
  buffer_target_pct?: number | null;
  revenue_budget?: number | null;
  direct_cost_budget?: number | null;
  indirect_cost_budget?: number | null;
  profit_budget?: number | null;
  status?: string;
}

interface CreateAdjustmentInput {
  process_id: string;
  period_code: string;
  metric_key: string;
  previous_value: number;
  adjustment_amount: number;
  reason: string;
  attachment_path?: string | null;
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(period: string) {
  const [year, month] = period.split("-").map(Number);
  const start = `${period}-01`;
  const endDate = new Date(year, month, 0);
  const end = `${period}-${String(endDate.getDate()).padStart(2, "0")}`;
  return { start, end };
}

function shiftPeriod(period: string, delta: number) {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableId(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

async function ensureRequiredTable(tableName: string, help: string) {
  if (!(await tableExists(tableName))) {
    throw Object.assign(new Error(`${tableName} table missing. ${help}`), { statusCode: 500 });
  }
}

async function ensureFinancePeriod(periodCode: string) {
  await ensureRequiredTable("finance_period", "Run the Process P&L governance migration first.");

  const existing = await queryRows<RowDataPacket>(
    `SELECT *
       FROM finance_period
      WHERE period_code = ?
      LIMIT 1`,
    [periodCode]
  );

  if (existing[0]) return existing[0];

  const id = randomUUID();
  const { start, end } = monthRange(periodCode);
  const [year, month] = periodCode.split("-").map(Number);
  await db.execute(
    `INSERT INTO finance_period
      (id, period_code, period_year, period_month, start_date, end_date, status, actual_cutoff_date)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
    [id, periodCode, year, month, start, end, end]
  );

  const created = await queryRows<RowDataPacket>(
    `SELECT *
       FROM finance_period
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  return created[0];
}

async function refreshFinancePeriodStatus(periodId: string) {
  if (!(await tableExists("pnl_period_signoff"))) return;

  const signoffs = await queryRows<RowDataPacket>(
    `SELECT signoff_role
       FROM pnl_period_signoff
      WHERE finance_period_id = ?
        AND status = 'signed'`,
    [periodId]
  );

  const signed = new Set(signoffs.map((row) => String(row.signoff_role)));
  let status = "open";
  if (signed.size > 0) status = "in_review";
  if (["finance_preparer", "finance_head", "accounts_head"].every((role) => signed.has(role))) {
    status = signed.has("ceo") ? "signed_off" : "in_review";
  }
  if (["finance_preparer", "finance_head", "accounts_head", "ceo"].every((role) => signed.has(role))) {
    status = "signed_off";
  }

  await db.execute(`UPDATE finance_period SET status = ? WHERE id = ?`, [status, periodId]);
}

async function getReferenceData() {
  const [processes, clients, branches] = await Promise.all([
    queryRows<RowDataPacket>(
      `SELECT
          p.id,
          p.process_name,
          p.client_id,
          cm.client_name,
          p.branch_id,
          COALESCE(bm.branch_name, bm.name) AS branch_name
        FROM process_master p
        LEFT JOIN client_master cm ON cm.id = p.client_id
        LEFT JOIN branch_master bm ON bm.id = p.branch_id
       WHERE COALESCE(p.active_status, 1) = 1
       ORDER BY cm.client_name, p.process_name`
    ),
    queryRows<RowDataPacket>(
      `SELECT id, client_name
         FROM client_master
        WHERE COALESCE(active_status, 1) = 1
        ORDER BY client_name`
    ).catch(() => []),
    queryRows<RowDataPacket>(
      `SELECT id, COALESCE(branch_name, name) AS branch_name
         FROM branch_master
        WHERE COALESCE(active_status, 1) = 1
        ORDER BY COALESCE(branch_name, name)`
    ).catch(() => []),
  ]);

  return {
    processes: processes.map((row) => ({
      id: String(row.id),
      process_name: String(row.process_name ?? ""),
      client_id: row.client_id ? String(row.client_id) : null,
      client_name: row.client_name ? String(row.client_name) : null,
      branch_id: row.branch_id ? String(row.branch_id) : null,
      branch_name: row.branch_name ? String(row.branch_name) : null,
    })),
    clients: clients.map((row) => ({
      id: String(row.id),
      client_name: String(row.client_name ?? ""),
    })),
    branches: branches.map((row) => ({
      id: String(row.id),
      branch_name: String(row.branch_name ?? ""),
    })),
  };
}

export const processPnlGovernanceService = {
  async getReferenceData() {
    return getReferenceData();
  },

  async listContracts() {
    if (!(await tableExists("client_contract_master"))) return [];

    const rows = await queryRows<RowDataPacket>(
      `SELECT
          ccm.*,
          cm.client_name,
          pm.process_name,
          COALESCE(bm.branch_name, bm.name) AS branch_name
        FROM client_contract_master ccm
        LEFT JOIN client_master cm ON cm.id = ccm.client_id
        LEFT JOIN process_master pm ON pm.id = ccm.process_id
        LEFT JOIN branch_master bm ON bm.id = pm.branch_id
       ORDER BY ccm.status = 'active' DESC, ccm.effective_from DESC, pm.process_name`
    );

    return rows;
  },

  async saveContract(input: SaveContractInput, actorUserId: string) {
    await ensureRequiredTable("client_contract_master", "Run the revenue at risk foundation migration first.");

    if (!input.contract_name?.trim()) {
      throw Object.assign(new Error("contract_name is required"), { statusCode: 400 });
    }

    const id = input.id?.trim() || randomUUID();
    const values = [
      nullableId(input.client_id),
      nullableId(input.process_id),
      input.contract_name.trim(),
      input.billing_type ?? "per_seat",
      toNumber(input.billing_rate),
      input.currency ?? "INR",
      toNumber(input.monthly_minimum_commitment),
      input.sla_target_percentage ?? null,
      input.penalty_rule_json ? JSON.stringify(input.penalty_rule_json) : null,
      input.effective_from ?? `${currentPeriod()}-01`,
      input.effective_to ?? null,
      input.status ?? "active",
    ];

    const existing = await queryRows<RowDataPacket>(
      `SELECT id FROM client_contract_master WHERE id = ? LIMIT 1`,
      [id]
    );

    if (existing[0]) {
      await db.execute(
        `UPDATE client_contract_master
            SET client_id = ?,
                process_id = ?,
                contract_name = ?,
                billing_type = ?,
                billing_rate = ?,
                currency = ?,
                monthly_minimum_commitment = ?,
                sla_target_percentage = ?,
                penalty_rule_json = ?,
                effective_from = ?,
                effective_to = ?,
                status = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [...values, id]
      );
    } else {
      await db.execute(
        `INSERT INTO client_contract_master
          (id, client_id, process_id, contract_name, billing_type, billing_rate, currency, monthly_minimum_commitment,
           sla_target_percentage, penalty_rule_json, effective_from, effective_to, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ...values, actorUserId]
      );
    }

    return { id };
  },

  async listRates() {
    if (!(await tableExists("process_billing_rate"))) return [];

    const rows = await queryRows<RowDataPacket>(
      `SELECT
          pbr.*,
          pm.process_name,
          ccm.contract_name
        FROM process_billing_rate pbr
        LEFT JOIN process_master pm ON pm.id = pbr.process_id
        LEFT JOIN client_contract_master ccm ON ccm.id = pbr.contract_id
       ORDER BY pbr.effective_from DESC, pm.process_name`
    );

    return rows;
  },

  async saveRate(input: SaveRateInput, actorUserId: string) {
    await ensureRequiredTable("process_billing_rate", "Run the Process P&L governance migration first.");

    if (!input.process_id) throw Object.assign(new Error("process_id is required"), { statusCode: 400 });
    if (!input.rate_type?.trim()) throw Object.assign(new Error("rate_type is required"), { statusCode: 400 });
    if (!input.effective_from) throw Object.assign(new Error("effective_from is required"), { statusCode: 400 });

    const id = input.id?.trim() || randomUUID();
    const values = [
      String(input.process_id).trim(),
      nullableId(input.contract_id),
      input.rate_type.trim(),
      toNumber(input.rate_amount),
      input.unit ?? "seat",
      input.effective_from,
      input.effective_to ?? null,
      actorUserId,
      input.approval_reference ?? null,
    ];

    const existing = await queryRows<RowDataPacket>(
      `SELECT id FROM process_billing_rate WHERE id = ? LIMIT 1`,
      [id]
    );

    if (existing[0]) {
      await db.execute(
        `UPDATE process_billing_rate
            SET process_id = ?,
                contract_id = ?,
                rate_type = ?,
                rate_amount = ?,
                unit = ?,
                effective_from = ?,
                effective_to = ?,
                approved_by = ?,
                approval_reference = ?,
                updated_at = NOW()
          WHERE id = ?`,
        [...values, id]
      );
    } else {
      await db.execute(
        `INSERT INTO process_billing_rate
          (id, process_id, contract_id, rate_type, rate_amount, unit, effective_from, effective_to, approved_by, approval_reference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, ...values]
      );
    }

    return { id };
  },

  async listMonthlyPlans(periodCode?: string) {
    if (!(await tableExists("process_monthly_plan"))) return [];

    const period = periodCode || currentPeriod();
    const rows = await queryRows<RowDataPacket>(
      `SELECT
          pmp.*,
          pm.process_name,
          cm.client_name,
          COALESCE(bm.branch_name, bm.name) AS branch_name
        FROM process_monthly_plan pmp
        JOIN process_master pm ON pm.id = pmp.process_id
        LEFT JOIN client_master cm ON cm.id = pm.client_id
        LEFT JOIN branch_master bm ON bm.id = pm.branch_id
       WHERE pmp.period_code = ?
       ORDER BY cm.client_name, pm.process_name`,
      [period]
    );

    return rows;
  },

  async saveMonthlyPlan(input: SaveMonthlyPlanInput, actorUserId: string) {
    await ensureRequiredTable("process_monthly_plan", "Run the Process P&L governance migration first.");

    if (!input.process_id) throw Object.assign(new Error("process_id is required"), { statusCode: 400 });
    if (!input.period_code) throw Object.assign(new Error("period_code is required"), { statusCode: 400 });

    const id = input.id?.trim() || randomUUID();
    const values = [
      input.process_id,
      input.period_code,
      input.contracted_seats ?? null,
      input.required_productive_hc ?? null,
      input.planned_shrinkage_pct ?? null,
      input.required_roster_hc ?? null,
      input.buffer_target_pct ?? null,
      input.revenue_budget ?? null,
      input.direct_cost_budget ?? null,
      input.indirect_cost_budget ?? null,
      input.profit_budget ?? null,
      input.status ?? "draft",
      actorUserId,
      actorUserId,
    ];

    await db.execute(
      `INSERT INTO process_monthly_plan
        (id, process_id, period_code, contracted_seats, required_productive_hc, planned_shrinkage_pct,
         required_roster_hc, buffer_target_pct, revenue_budget, direct_cost_budget, indirect_cost_budget,
         profit_budget, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         contracted_seats = VALUES(contracted_seats),
         required_productive_hc = VALUES(required_productive_hc),
         planned_shrinkage_pct = VALUES(planned_shrinkage_pct),
         required_roster_hc = VALUES(required_roster_hc),
         buffer_target_pct = VALUES(buffer_target_pct),
         revenue_budget = VALUES(revenue_budget),
         direct_cost_budget = VALUES(direct_cost_budget),
         indirect_cost_budget = VALUES(indirect_cost_budget),
         profit_budget = VALUES(profit_budget),
         status = VALUES(status),
         updated_by = VALUES(updated_by),
         updated_at = NOW()`,
      [id, ...values]
    );

    return { id };
  },

  async listAdjustments(periodCode?: string, processId?: string) {
    if (!(await tableExists("pnl_adjustment_journal"))) return [];

    const conds = ["paj.period_code = ?"];
    const params: unknown[] = [periodCode || currentPeriod()];
    if (processId) {
      conds.push("paj.process_id = ?");
      params.push(processId);
    }

    const rows = await queryRows<RowDataPacket>(
      `SELECT
          paj.*,
          pm.process_name,
          cm.client_name
        FROM pnl_adjustment_journal paj
        LEFT JOIN process_master pm ON pm.id = paj.process_id
        LEFT JOIN client_master cm ON cm.id = pm.client_id
       WHERE ${conds.join(" AND ")}
       ORDER BY paj.created_at DESC`,
      params
    );

    return rows;
  },

  async createAdjustment(input: CreateAdjustmentInput, actorUserId: string) {
    await ensureRequiredTable("pnl_adjustment_journal", "Run the Process P&L governance migration first.");

    if (!input.process_id) throw Object.assign(new Error("process_id is required"), { statusCode: 400 });
    if (!input.period_code) throw Object.assign(new Error("period_code is required"), { statusCode: 400 });
    if (!input.metric_key?.trim()) throw Object.assign(new Error("metric_key is required"), { statusCode: 400 });
    if (!input.reason?.trim()) throw Object.assign(new Error("reason is required"), { statusCode: 400 });

    const id = randomUUID();
    const previousValue = toNumber(input.previous_value);
    const adjustmentAmount = toNumber(input.adjustment_amount);
    const revisedValue = previousValue + adjustmentAmount;

    await db.execute(
      `INSERT INTO pnl_adjustment_journal
        (id, process_id, period_code, metric_key, previous_value, adjustment_amount, revised_value, reason,
         attachment_path, maker_user_id, approval_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        id,
        input.process_id,
        input.period_code,
        input.metric_key.trim(),
        previousValue,
        adjustmentAmount,
        revisedValue,
        input.reason.trim(),
        input.attachment_path ?? null,
        actorUserId,
      ]
    );

    return { id, revised_value: revisedValue };
  },

  async listPeriods() {
    if (!(await tableExists("finance_period"))) {
      return [shiftPeriod(currentPeriod(), -1), currentPeriod(), shiftPeriod(currentPeriod(), 1)].map((periodCode) => ({
        id: periodCode,
        period_code: periodCode,
        status: "open",
        virtual: true,
      }));
    }

    const rows = await queryRows<RowDataPacket>(
      `SELECT *
         FROM finance_period
        ORDER BY period_year DESC, period_month DESC
        LIMIT 24`
    );

    return rows;
  },

  async getPeriodClose(periodCode?: string) {
    const period = periodCode || currentPeriod();
    const financePeriod = await ensureFinancePeriod(period);
    const hasSignoffTable = await tableExists("pnl_period_signoff");
    const [summary, processes, signoffs, adjustments] = await Promise.all([
      processPnlService.getSummary({ period }),
      processPnlService.listProcesses({ period }),
      hasSignoffTable
        ? queryRows<RowDataPacket>(
            `SELECT signoff_role, status, signed_by, signed_at, note
               FROM pnl_period_signoff
              WHERE finance_period_id = ?
              ORDER BY signed_at DESC`,
            [financePeriod.id]
          )
        : Promise.resolve([]),
      this.listAdjustments(period),
    ]);

    const requiredSignoffs: SignoffRole[] = [
      "finance_preparer",
      "finance_head",
      "accounts_head",
      "ceo",
    ];
    const signoffMap = new Map(
      signoffs.map((row) => [String(row.signoff_role), row])
    );

    const groupedBranches = new Map<string, { branchName: string; revenue: number; indirectCost: number; activeHc: number }>();
    for (const row of processes) {
      const key = row.branchId ?? "unassigned";
      const current = groupedBranches.get(key) ?? {
        branchName: row.branchName ?? "Unassigned branch",
        revenue: 0,
        indirectCost: 0,
        activeHc: 0,
      };
      current.revenue += row.revenueMtd;
      current.indirectCost += row.indirectCost;
      current.activeHc += row.activeHc;
      groupedBranches.set(key, current);
    }

    const totalIndirect = processes.reduce((sum, row) => sum + row.indirectCost, 0);
    const allocationDrivers = Array.from(groupedBranches.values())
      .map((row) => ({
        ...row,
        sharePct: totalIndirect > 0 ? (row.indirectCost / totalIndirect) * 100 : 0,
      }))
      .sort((left, right) => right.indirectCost - left.indirectCost);

    return {
      period: financePeriod,
      summary: summary.kpis,
      alertCounts: {
        critical: summary.alerts.filter((item) => item.type === "critical").length,
        warning: summary.alerts.filter((item) => item.type === "warning").length,
        info: summary.alerts.filter((item) => item.type === "info").length,
      },
      topAlerts: summary.alerts.slice(0, 8),
      processCounts: {
        total: processes.length,
        profitable: processes.filter((row) => row.processStatus === "profitable").length,
        atRisk: processes.filter((row) => row.processStatus === "at-risk").length,
        lossMaking: processes.filter((row) => row.processStatus === "loss-making").length,
        pendingReconciliation: processes.filter((row) => row.reconciliationStatus !== "matched").length,
      },
      lossMakingProcesses: processes
        .filter((row) => row.processStatus === "loss-making")
        .slice(0, 10),
      signoffs: requiredSignoffs.map((role) => ({
        role,
        status: signoffMap.get(role)?.status ?? "pending",
        signed_by: signoffMap.get(role)?.signed_by ?? null,
        signed_at: signoffMap.get(role)?.signed_at ?? null,
        note: signoffMap.get(role)?.note ?? null,
      })),
      allocationDrivers,
      adjustments: adjustments.slice(0, 20),
      lastCalculatedAt: summary.generatedAt,
    };
  },

  async signoffPeriod(periodId: string, signoffRole: SignoffRole, note: string | null, actorUserId: string) {
    await ensureRequiredTable("pnl_period_signoff", "Run the Process P&L governance migration first.");

    const periodRows = await queryRows<RowDataPacket>(
      `SELECT id FROM finance_period WHERE id = ? LIMIT 1`,
      [periodId]
    );
    if (!periodRows[0]) {
      throw Object.assign(new Error("Finance period not found"), { statusCode: 404 });
    }

    await db.execute(
      `INSERT INTO pnl_period_signoff
        (id, finance_period_id, signoff_role, status, signed_by, signed_at, note)
       VALUES (?, ?, ?, 'signed', ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         signed_by = VALUES(signed_by),
         signed_at = VALUES(signed_at),
         note = VALUES(note),
         updated_at = NOW()`,
      [randomUUID(), periodId, signoffRole, actorUserId, note ?? null]
    );

    await refreshFinancePeriodStatus(periodId);
    return { success: true };
  },

  async lockPeriod(periodId: string, actorUserId: string) {
    await ensureRequiredTable("finance_period", "Run the Process P&L governance migration first.");
    await ensureRequiredTable("pnl_period_signoff", "Run the Process P&L governance migration first.");

    const required = ["finance_preparer", "finance_head", "accounts_head"];
    const signedRows = await queryRows<RowDataPacket>(
      `SELECT signoff_role
         FROM pnl_period_signoff
        WHERE finance_period_id = ?
          AND status = 'signed'`,
      [periodId]
    );
    const signed = new Set(signedRows.map((row) => String(row.signoff_role)));
    if (!required.every((role) => signed.has(role))) {
      throw Object.assign(new Error("Finance Preparer, Finance Head and Accounts Head signoffs are required before locking."), {
        statusCode: 400,
      });
    }

    await db.execute(
      `UPDATE finance_period
          SET status = 'locked',
              locked_at = NOW(),
              locked_by = ?
        WHERE id = ?`,
      [actorUserId, periodId]
    );

    return { success: true };
  },

  async recalculate(periodCode?: string) {
    const period = periodCode || currentPeriod();
    const summary = await processPnlService.getSummary({ period });
    const processes = await processPnlService.listProcesses({ period });
    await ensureFinancePeriod(period);

    return {
      period,
      generatedAt: summary.generatedAt,
      processCount: processes.length,
      revenue: summary.kpis.organisationRevenue,
      operatingProfit: summary.kpis.operatingProfit,
      alertCount: summary.alerts.length,
    };
  },
};
