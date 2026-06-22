import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [tableName]
  );
  return rows.length > 0;
}

async function scalar(sql: string, params: unknown[] = [], fallback = 0): Promise<number> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    const first = rows[0] ?? {};
    const value = Object.values(first)[0];
    const n = Number(value ?? fallback);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function riskLevel(amount: number, shortageHc: number) {
  if (amount >= 100000 || shortageHc >= 20) return "critical";
  if (amount >= 50000 || shortageHc >= 10) return "high";
  if (amount > 0 || shortageHc > 0) return "medium";
  return "none";
}

function confidence(parts: { contract: boolean; mandate: boolean; attendance: boolean }) {
  let score = 25;
  if (parts.contract) score += 30;
  if (parts.mandate) score += 25;
  if (parts.attendance) score += 20;
  return Math.min(100, score);
}

async function getProcessRows() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id AS process_id,
            p.process_name,
            cm.id AS client_id,
            cm.client_name
       FROM process_master p
       LEFT JOIN client_master cm ON cm.id = p.client_id
      WHERE COALESCE(p.active_status, 1) = 1
      ORDER BY cm.client_name, p.process_name
      LIMIT 500`
  );
  return rows as any[];
}

async function getContract(processId: string, clientId: string | null, date: string) {
  if (!(await tableExists("client_contract_master"))) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT *
       FROM client_contract_master
      WHERE status = 'active'
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
        AND (process_id = ? OR (? IS NOT NULL AND client_id = ?))
      ORDER BY CASE WHEN process_id = ? THEN 0 ELSE 1 END, effective_from DESC
      LIMIT 1`,
    [date, date, processId, clientId, clientId, processId]
  );
  return (rows[0] as any) ?? null;
}

async function requiredHc(processId: string, date: string) {
  if (await tableExists("workforce_mandate")) {
    return scalar(
      `SELECT COALESCE(SUM(mandated_hc), 0)
         FROM workforce_mandate
        WHERE process_id = ?
          AND active_status = 1
          AND (effective_from IS NULL OR effective_from <= ?)
          AND (effective_to IS NULL OR effective_to >= ?)`,
      [processId, date, date]
    );
  }
  return 0;
}

async function plannedHc(processId: string, date: string) {
  if (await tableExists("roster_assignment")) {
    return scalar(
      `SELECT COUNT(DISTINCT employee_id)
         FROM roster_assignment
        WHERE process_id = ?
          AND roster_date = ?`,
      [processId, date]
    );
  }
  if (await tableExists("employees")) {
    return scalar(
      `SELECT COUNT(*)
         FROM employees
        WHERE process_id = ?
          AND active_status = 1
          AND LOWER(COALESCE(employment_status, 'active')) = 'active'`,
      [processId]
    );
  }
  return 0;
}

async function availableHc(processId: string, date: string) {
  if (await tableExists("attendance_daily_record")) {
    // Use requested date; fall back to latest date with data if no records for requested date
    const countForDate = await scalar(
      `SELECT COUNT(DISTINCT adr.employee_id)
         FROM attendance_daily_record adr
         JOIN employees e ON e.id = adr.employee_id
        WHERE e.process_id = ?
          AND adr.record_date = ?
          AND adr.attendance_status IN ('present','half_day')`,
      [processId, date]
    );
    if (countForDate > 0) return countForDate;

    // Fallback: use latest date that has attendance data (COSEC may lag 1-2 days)
    return scalar(
      `SELECT COUNT(DISTINCT adr.employee_id)
         FROM attendance_daily_record adr
         JOIN employees e ON e.id = adr.employee_id
        WHERE e.process_id = ?
          AND adr.record_date = (
            SELECT MAX(record_date) FROM attendance_daily_record adr2
            JOIN employees e2 ON e2.id = adr2.employee_id
            WHERE e2.process_id = ? AND adr2.attendance_status IN ('present','half_day')
          )
          AND adr.attendance_status IN ('present','half_day')`,
      [processId, processId]
    );
  }
  return plannedHc(processId, date);
}

function calculateRevenue(contract: any, required: number, available: number) {
  const billingType = contract?.billing_type ?? "per_seat";
  const rate = Number(contract?.billing_rate ?? 0);
  const monthlyMin = Number(contract?.monthly_minimum_commitment ?? 0);
  const shortage = Math.max(0, required - available);
  const productiveHours = available * 8;
  const billableHours = available * 8;

  let expected = 0;
  let actual = 0;
  if (billingType === "per_hour") {
    expected = required * 8 * rate;
    actual = available * 8 * rate;
  } else if (billingType === "fixed_monthly") {
    expected = monthlyMin / 30;
    actual = required > 0 ? expected * Math.min(1, available / required) : expected;
  } else {
    expected = required * rate;
    actual = available * rate;
  }

  return {
    productiveHours,
    billableHours,
    expectedRevenue: Math.max(0, expected),
    actualRevenue: Math.max(0, actual),
    revenueAtRisk: Math.max(0, expected - actual),
    shortageHc: shortage,
  };
}

export const revenueRiskService = {
  async listContracts() {
    if (!(await tableExists("client_contract_master"))) return [];
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ccm.*, cm.client_name, pm.process_name
         FROM client_contract_master ccm
         LEFT JOIN client_master cm ON cm.id = ccm.client_id
         LEFT JOIN process_master pm ON pm.id = ccm.process_id
        ORDER BY ccm.status, ccm.effective_from DESC
        LIMIT 500`
    );
    return rows;
  },

  async createContract(input: any, actorUserId: string) {
    if (!(await tableExists("client_contract_master"))) {
      throw Object.assign(new Error("client_contract_master table missing. Run revenue risk migration first."), { statusCode: 500 });
    }
    if (!input.contract_name) throw Object.assign(new Error("contract_name is required"), { statusCode: 400 });
    const id = randomUUID();
    await db.execute(
      `INSERT INTO client_contract_master
        (id, client_id, process_id, contract_name, billing_type, billing_rate, currency, monthly_minimum_commitment, sla_target_percentage, penalty_rule_json, effective_from, effective_to, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.client_id ?? null,
        input.process_id ?? null,
        input.contract_name,
        input.billing_type ?? "per_seat",
        Number(input.billing_rate ?? 0),
        Number(input.monthly_minimum_commitment ?? 0),
        input.sla_target_percentage ?? null,
        input.penalty_rule_json ? JSON.stringify(input.penalty_rule_json) : null,
        input.effective_from ?? new Date().toISOString().slice(0, 10),
        input.effective_to ?? null,
        input.status ?? "active",
        actorUserId,
      ]
    );
    return { id };
  },

  async calculate(date = new Date().toISOString().slice(0, 10), persist = false) {
    const processes = await getProcessRows();
    const mandateAvailable = await tableExists("workforce_mandate");
    const attendanceAvailable = await tableExists("attendance_daily_record");
    const contractAvailable = await tableExists("client_contract_master");
    const rows = [];

    for (const process of processes) {
      const contract = await getContract(String(process.process_id), process.client_id ? String(process.client_id) : null, date);
      const required = await requiredHc(String(process.process_id), date);
      const planned = await plannedHc(String(process.process_id), date);
      const available = await availableHc(String(process.process_id), date);
      const finalRequired = required || planned;
      const calc = calculateRevenue(contract, finalRequired, available);
      const conf = confidence({ contract: !!contract && contractAvailable, mandate: mandateAvailable && required > 0, attendance: attendanceAvailable });
      const reasons = [];
      if (!contract) reasons.push("No active client contract/rate configured");
      if (!required) reasons.push("No workforce mandate found; using planned HC as fallback");
      if (calc.shortageHc > 0) reasons.push(`Short by ${calc.shortageHc} HC`);
      if (!attendanceAvailable) reasons.push("Attendance table unavailable; available HC estimated from planned HC");

      const row = {
        revenue_date: date,
        client_id: process.client_id,
        client_name: process.client_name,
        process_id: process.process_id,
        process_name: process.process_name,
        contract_id: contract?.id ?? null,
        billing_type: contract?.billing_type ?? null,
        billing_rate: Number(contract?.billing_rate ?? 0),
        required_hc: finalRequired,
        planned_hc: planned,
        available_hc: available,
        shortage_hc: calc.shortageHc,
        productive_hours: calc.productiveHours,
        billable_hours: calc.billableHours,
        expected_revenue: calc.expectedRevenue,
        actual_revenue_estimate: calc.actualRevenue,
        revenue_at_risk: calc.revenueAtRisk,
        risk_level: riskLevel(calc.revenueAtRisk, calc.shortageHc),
        reason_json: reasons,
        data_confidence_score: conf,
      };
      rows.push(row);

      if (persist && await tableExists("process_revenue_daily")) {
        await db.execute(
          `INSERT INTO process_revenue_daily
            (id, revenue_date, client_id, process_id, contract_id, required_hc, planned_hc, available_hc, shortage_hc,
             productive_hours, billable_hours, expected_revenue, actual_revenue_estimate, revenue_at_risk, risk_level, reason_json, data_confidence_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             contract_id = VALUES(contract_id), required_hc = VALUES(required_hc), planned_hc = VALUES(planned_hc),
             available_hc = VALUES(available_hc), shortage_hc = VALUES(shortage_hc), productive_hours = VALUES(productive_hours),
             billable_hours = VALUES(billable_hours), expected_revenue = VALUES(expected_revenue), actual_revenue_estimate = VALUES(actual_revenue_estimate),
             revenue_at_risk = VALUES(revenue_at_risk), risk_level = VALUES(risk_level), reason_json = VALUES(reason_json),
             data_confidence_score = VALUES(data_confidence_score), generated_at = NOW(), updated_at = NOW()`,
          [
            randomUUID(), row.revenue_date, row.client_id, row.process_id, row.contract_id, row.required_hc, row.planned_hc,
            row.available_hc, row.shortage_hc, row.productive_hours, row.billable_hours, row.expected_revenue,
            row.actual_revenue_estimate, row.revenue_at_risk, row.risk_level, JSON.stringify(row.reason_json), row.data_confidence_score,
          ]
        );
      }
    }

    rows.sort((a, b) => b.revenue_at_risk - a.revenue_at_risk || b.shortage_hc - a.shortage_hc);
    return {
      generated_at: new Date().toISOString(),
      date,
      totals: {
        expected_revenue: rows.reduce((sum, row) => sum + row.expected_revenue, 0),
        actual_revenue_estimate: rows.reduce((sum, row) => sum + row.actual_revenue_estimate, 0),
        revenue_at_risk: rows.reduce((sum, row) => sum + row.revenue_at_risk, 0),
        shortage_hc: rows.reduce((sum, row) => sum + row.shortage_hc, 0),
        critical_processes: rows.filter((row) => row.risk_level === "critical").length,
        high_processes: rows.filter((row) => row.risk_level === "high").length,
      },
      rows: rows.slice(0, 250),
    };
  },

  async snapshot(date = new Date().toISOString().slice(0, 10)) {
    if (!(await tableExists("process_revenue_daily"))) return this.calculate(date, false);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT prd.*, cm.client_name, pm.process_name, ccm.billing_type, ccm.billing_rate
         FROM process_revenue_daily prd
         LEFT JOIN client_master cm ON cm.id = prd.client_id
         LEFT JOIN process_master pm ON pm.id = prd.process_id
         LEFT JOIN client_contract_master ccm ON ccm.id = prd.contract_id
        WHERE prd.revenue_date = ?
        ORDER BY prd.revenue_at_risk DESC, prd.shortage_hc DESC
        LIMIT 250`,
      [date]
    );
    if (rows.length === 0) return this.calculate(date, false);
    const mapped = rows.map((row: any) => ({ ...row, reason_json: typeof row.reason_json === "string" ? JSON.parse(row.reason_json || "[]") : row.reason_json }));
    return {
      generated_at: new Date().toISOString(),
      date,
      totals: {
        expected_revenue: mapped.reduce((sum, row) => sum + Number(row.expected_revenue ?? 0), 0),
        actual_revenue_estimate: mapped.reduce((sum, row) => sum + Number(row.actual_revenue_estimate ?? 0), 0),
        revenue_at_risk: mapped.reduce((sum, row) => sum + Number(row.revenue_at_risk ?? 0), 0),
        shortage_hc: mapped.reduce((sum, row) => sum + Number(row.shortage_hc ?? 0), 0),
        critical_processes: mapped.filter((row) => row.risk_level === "critical").length,
        high_processes: mapped.filter((row) => row.risk_level === "high").length,
      },
      rows: mapped,
    };
  },
};
