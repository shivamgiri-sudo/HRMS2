import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BonusCalculation {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  financial_year: string;
  monthly_salary: number;
  annual_salary: number;
  eligible: number;
  allocable_surplus_pct: number;
  calculated_bonus: number;
  min_bonus: number;
  max_bonus: number;
  status: "calculated" | "approved" | "paid";
  approved_by: string | null;
  created_at: string;
}

export interface PoshComplaint {
  id: string;
  complaint_ref: string;
  complainant_anon_id: string;
  respondent_anon_id: string | null;
  branch_id: string | null;
  branch_name?: string;
  date_of_complaint: string;
  nature_of_complaint: string | null;
  icc_members: string[] | null;
  status: "received" | "under_inquiry" | "settled" | "closed" | "referred_to_police";
  outcome: "substantiated" | "not_substantiated" | "malicious_complaint" | "conciliation" | null;
  closure_date: string | null;
  annual_report_year: number | null;
  created_at: string;
  updated_at: string;
}

export interface PoshAnnualReport {
  year: number;
  complaints_received: number;
  complaints_settled: number;
  complaints_pending: number;
  complaints_malicious: number;
}

export interface MaternityRecord {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  leave_start_date: string;
  leave_end_date: string | null;
  paid_weeks: number;
  nursing_break_weeks: number;
  complications: number;
  status: "applied" | "approved" | "active" | "completed" | "rejected";
  approved_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Bonus Service ────────────────────────────────────────────────────────────

export const complianceService = {
  // ── Bonus ──────────────────────────────────────────────────────────────────

  async listBonus(financialYear?: string): Promise<BonusCalculation[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (financialYear) {
      conds.push("bc.financial_year = ?");
      params.push(financialYear);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT bc.*,
              e.full_name AS employee_name,
              e.employee_code
         FROM bonus_calculation bc
         LEFT JOIN employees e ON e.id = bc.employee_id
         ${where}
         ORDER BY bc.financial_year DESC, e.employee_code ASC`,
      params
    );
    return rows as BonusCalculation[];
  },

  async calculateBonus(financialYear: string, actorUserId: string): Promise<{ upserted: number; skipped: number }> {
    // Fetch all active employees with current salary assignment
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id,
              esa.ctc_annual
         FROM employees e
         JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
         WHERE e.active_status = 1 AND e.LOWER(employment_status) = 'active'`
    );

    const employees = empRows as { employee_id: string; ctc_annual: number }[];
    if (employees.length === 0) return { upserted: 0, skipped: 0 };

    const BONUS_SALARY_CEILING = 21000;
    const MIN_WAGE_MONTHLY = 7000;
    const ALLOCABLE_PCT = 8.33;

    let upserted = 0;
    let skipped = 0;

    for (const emp of employees) {
      const annualSalary = Number(emp.ctc_annual) || 0;
      const monthlySalary = Math.round((annualSalary / 12) * 100) / 100;
      const eligible = monthlySalary <= BONUS_SALARY_CEILING ? 1 : 0;

      if (!eligible) {
        skipped++;
        continue;
      }

      const minBonus = Math.round(MIN_WAGE_MONTHLY * 12 * (ALLOCABLE_PCT / 100) * 100) / 100;
      const maxBonus = Math.round(annualSalary * 0.20 * 100) / 100;
      const calculatedBonus = Math.round(annualSalary * (ALLOCABLE_PCT / 100) * 100) / 100;

      // Check for existing record to decide insert vs update
      const [existing] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM bonus_calculation WHERE employee_id = ? AND financial_year = ? LIMIT 1",
        [emp.employee_id, financialYear]
      );

      if ((existing as RowDataPacket[]).length > 0) {
        const existingId = (existing as { id: string }[])[0].id;
        await db.execute(
          `UPDATE bonus_calculation
             SET monthly_salary = ?, annual_salary = ?, eligible = ?,
                 allocable_surplus_pct = ?, calculated_bonus = ?, min_bonus = ?, max_bonus = ?,
                 status = 'calculated', approved_by = NULL
           WHERE id = ?`,
          [monthlySalary, annualSalary, eligible, ALLOCABLE_PCT, calculatedBonus, minBonus, maxBonus, existingId]
        );
      } else {
        const id = randomUUID();
        await db.execute(
          `INSERT INTO bonus_calculation
             (id, employee_id, financial_year, monthly_salary, annual_salary, eligible,
              allocable_surplus_pct, calculated_bonus, min_bonus, max_bonus, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated')`,
          [id, emp.employee_id, financialYear, monthlySalary, annualSalary, eligible, ALLOCABLE_PCT, calculatedBonus, minBonus, maxBonus]
        );
      }
      upserted++;
    }

    void actorUserId; // reserved for audit log if needed
    return { upserted, skipped };
  },

  async approveBonus(id: string, actorUserId: string): Promise<BonusCalculation> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, status FROM bonus_calculation WHERE id = ? LIMIT 1",
      [id]
    );
    const rec = (rows as { id: string; status: string }[])[0];
    if (!rec) throw new Error("Bonus record not found");
    if (rec.status === "paid") throw new Error("Cannot change status of a paid bonus record");

    await db.execute(
      "UPDATE bonus_calculation SET status = 'approved', approved_by = ? WHERE id = ?",
      [actorUserId, id]
    );

    const [updated] = await db.execute<RowDataPacket[]>(
      `SELECT bc.*, e.full_name AS employee_name, e.employee_code
         FROM bonus_calculation bc
         LEFT JOIN employees e ON e.id = bc.employee_id
         WHERE bc.id = ? LIMIT 1`,
      [id]
    );
    return (updated as BonusCalculation[])[0];
  },

  // ── POSH ──────────────────────────────────────────────────────────────────

  async listPoshComplaints(): Promise<PoshComplaint[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT pc.*,
              b.branch_name
         FROM posh_complaint pc
         LEFT JOIN branch_master b ON b.id = pc.branch_id
         ORDER BY pc.date_of_complaint DESC`
    );
    return (rows as PoshComplaint[]).map((r) => ({
      ...r,
      icc_members: r.icc_members
        ? typeof r.icc_members === "string"
          ? JSON.parse(r.icc_members)
          : r.icc_members
        : null,
    }));
  },

  async createPoshComplaint(input: {
    complainant_anon_id: string;
    respondent_anon_id?: string;
    branch_id?: string;
    date_of_complaint: string;
    nature_of_complaint?: string;
    icc_members?: string[];
  }): Promise<PoshComplaint> {
    const id = randomUUID();
    // Auto-generate complaint ref: POSH-YYYYMM-XXXX
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    const suffix = randomUUID().slice(0, 4).toUpperCase();
    const complaint_ref = `POSH-${ym}-${suffix}`;

    const annual_report_year = new Date(input.date_of_complaint).getFullYear();
    const icc_members_json = input.icc_members ? JSON.stringify(input.icc_members) : null;

    await db.execute(
      `INSERT INTO posh_complaint
         (id, complaint_ref, complainant_anon_id, respondent_anon_id, branch_id,
          date_of_complaint, nature_of_complaint, icc_members, status, annual_report_year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)`,
      [
        id,
        complaint_ref,
        input.complainant_anon_id,
        input.respondent_anon_id ?? null,
        input.branch_id ?? null,
        input.date_of_complaint,
        input.nature_of_complaint ?? null,
        icc_members_json,
        annual_report_year,
      ]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM posh_complaint WHERE id = ? LIMIT 1",
      [id]
    );
    const rec = (rows as PoshComplaint[])[0];
    return {
      ...rec,
      icc_members: rec.icc_members
        ? typeof rec.icc_members === "string"
          ? JSON.parse(rec.icc_members as unknown as string)
          : rec.icc_members
        : null,
    };
  },

  async updatePoshComplaint(
    id: string,
    input: {
      status?: PoshComplaint["status"];
      outcome?: PoshComplaint["outcome"];
      closure_date?: string;
    }
  ): Promise<PoshComplaint> {
    const [check] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM posh_complaint WHERE id = ? LIMIT 1",
      [id]
    );
    if (!(check as RowDataPacket[]).length) throw new Error("Complaint not found");

    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.status !== undefined) { sets.push("status = ?"); params.push(input.status); }
    if (input.outcome !== undefined) { sets.push("outcome = ?"); params.push(input.outcome); }
    if (input.closure_date !== undefined) { sets.push("closure_date = ?"); params.push(input.closure_date); }

    if (sets.length > 0) {
      params.push(id);
      await db.execute(`UPDATE posh_complaint SET ${sets.join(", ")} WHERE id = ?`, params);
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM posh_complaint WHERE id = ? LIMIT 1",
      [id]
    );
    const rec = (rows as PoshComplaint[])[0];
    return {
      ...rec,
      icc_members: rec.icc_members
        ? typeof rec.icc_members === "string"
          ? JSON.parse(rec.icc_members as unknown as string)
          : rec.icc_members
        : null,
    };
  },

  async poshAnnualReport(year: number): Promise<PoshAnnualReport> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS complaints_received,
         SUM(CASE WHEN status IN ('settled','closed') THEN 1 ELSE 0 END) AS complaints_settled,
         SUM(CASE WHEN status IN ('received','under_inquiry') THEN 1 ELSE 0 END) AS complaints_pending,
         SUM(CASE WHEN outcome = 'malicious_complaint' THEN 1 ELSE 0 END) AS complaints_malicious
       FROM posh_complaint
       WHERE annual_report_year = ?`,
      [year]
    );
    const row = (rows as Record<string, number>[])[0] ?? {};
    return {
      year,
      complaints_received: Number(row.complaints_received) || 0,
      complaints_settled: Number(row.complaints_settled) || 0,
      complaints_pending: Number(row.complaints_pending) || 0,
      complaints_malicious: Number(row.complaints_malicious) || 0,
    };
  },

  // ── Maternity ─────────────────────────────────────────────────────────────

  async listMaternity(employeeId?: string): Promise<MaternityRecord[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (employeeId) {
      conds.push("mbr.employee_id = ?");
      params.push(employeeId);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT mbr.*,
              e.full_name AS employee_name,
              e.employee_code
         FROM maternity_benefit_record mbr
         LEFT JOIN employees e ON e.id = mbr.employee_id
         ${where}
         ORDER BY mbr.leave_start_date DESC`,
      params
    );
    return rows as MaternityRecord[];
  },

  async createMaternity(input: {
    employee_id: string;
    expected_delivery_date?: string;
    leave_start_date: string;
    paid_weeks?: number;
    complications?: boolean;
  }): Promise<MaternityRecord> {
    const id = randomUUID();
    const paid_weeks = input.paid_weeks ?? 26;
    const complications = input.complications ? 1 : 0;

    await db.execute(
      `INSERT INTO maternity_benefit_record
         (id, employee_id, expected_delivery_date, leave_start_date, paid_weeks, complications, status)
       VALUES (?, ?, ?, ?, ?, ?, 'applied')`,
      [
        id,
        input.employee_id,
        input.expected_delivery_date ?? null,
        input.leave_start_date,
        paid_weeks,
        complications,
      ]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT mbr.*, e.full_name AS employee_name, e.employee_code
         FROM maternity_benefit_record mbr
         LEFT JOIN employees e ON e.id = mbr.employee_id
         WHERE mbr.id = ? LIMIT 1`,
      [id]
    );
    return (rows as MaternityRecord[])[0];
  },

  async updateMaternity(
    id: string,
    actorUserId: string,
    input: {
      status?: MaternityRecord["status"];
      actual_delivery_date?: string;
      leave_end_date?: string;
    }
  ): Promise<MaternityRecord> {
    const [check] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM maternity_benefit_record WHERE id = ? LIMIT 1",
      [id]
    );
    if (!(check as RowDataPacket[]).length) throw new Error("Maternity record not found");

    const sets: string[] = [];
    const params: unknown[] = [];

    if (input.status !== undefined) {
      sets.push("status = ?");
      params.push(input.status);
      if (input.status === "approved") {
        sets.push("approved_by = ?");
        params.push(actorUserId);
      }
    }
    if (input.actual_delivery_date !== undefined) {
      sets.push("actual_delivery_date = ?");
      params.push(input.actual_delivery_date);
    }
    if (input.leave_end_date !== undefined) {
      sets.push("leave_end_date = ?");
      params.push(input.leave_end_date);
    }

    if (sets.length > 0) {
      params.push(id);
      await db.execute(`UPDATE maternity_benefit_record SET ${sets.join(", ")} WHERE id = ?`, params);
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT mbr.*, e.full_name AS employee_name, e.employee_code
         FROM maternity_benefit_record mbr
         LEFT JOIN employees e ON e.id = mbr.employee_id
         WHERE mbr.id = ? LIMIT 1`,
      [id]
    );
    return (rows as MaternityRecord[])[0];
  },
};
