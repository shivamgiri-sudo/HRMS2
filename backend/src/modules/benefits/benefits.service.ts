import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BenefitPlan {
  id: string;
  plan_name: string;
  plan_type: "insurance" | "transport" | "meal" | "wellness" | "other";
  description: string | null;
  eligibility_rule: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface BenefitEnrollment {
  id: string;
  employee_id: string;
  plan_id: string;
  plan_name?: string;
  plan_type?: string;
  enrolled_date: string;
  effective_from: string;
  effective_to: string | null;
  status: "active" | "inactive" | "pending";
  created_at: string;
}

export interface ReimbursementClaim {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  claim_type: "travel" | "medical" | "meal" | "equipment" | "other";
  amount: number;
  claim_date: string;
  description: string | null;
  receipt_ref: string | null;
  status: "draft" | "submitted" | "approved" | "rejected" | "paid";
  reviewed_by: string | null;
  reviewed_at: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Plans ────────────────────────────────────────────────────────────────────

export const benefitsService = {
  async listPlans(activeOnly = true): Promise<BenefitPlan[]> {
    const where = activeOnly ? "WHERE is_active = 1" : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM benefit_plan ${where} ORDER BY plan_name ASC`
    );
    return rows as BenefitPlan[];
  },

  async createPlan(input: {
    plan_name: string;
    plan_type: string;
    description?: string | null;
    eligibility_rule?: string | null;
  }): Promise<BenefitPlan> {
    const [result] = await db.execute<RowDataPacket[]>(
      `INSERT INTO benefit_plan (plan_name, plan_type, description, eligibility_rule)
       VALUES (?, ?, ?, ?)`,
      [
        input.plan_name,
        input.plan_type,
        input.description ?? null,
        input.eligibility_rule ?? null,
      ]
    );
    const insertId = (result as { insertId?: number }).insertId;
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM benefit_plan WHERE id = LAST_INSERT_ID() LIMIT 1"
    );
    // fallback: query by inserted id hint or just return last
    void insertId;
    return (rows as BenefitPlan[])[0];
  },

  // ─── Enrollments ───────────────────────────────────────────────────────────

  async listEnrollments(employeeId: string): Promise<BenefitEnrollment[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT be.*, bp.plan_name, bp.plan_type
       FROM benefit_enrollment be
       LEFT JOIN benefit_plan bp ON bp.id = be.plan_id
       WHERE be.employee_id = ?
       ORDER BY be.enrolled_date DESC`,
      [employeeId]
    );
    return rows as BenefitEnrollment[];
  },

  async enroll(input: {
    employee_id: string;
    plan_id: string;
    enrolled_date: string;
    effective_from: string;
    effective_to?: string | null;
  }): Promise<BenefitEnrollment> {
    // Check plan exists
    const [planRows] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM benefit_plan WHERE id = ? LIMIT 1",
      [input.plan_id]
    );
    if (!(planRows as RowDataPacket[]).length) {
      throw new Error("Benefit plan not found");
    }

    await db.execute(
      `INSERT INTO benefit_enrollment
         (employee_id, plan_id, enrolled_date, effective_from, effective_to, status)
       VALUES (?, ?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE
         enrolled_date = VALUES(enrolled_date),
         effective_from = VALUES(effective_from),
         effective_to = VALUES(effective_to),
         status = 'pending'`,
      [
        input.employee_id,
        input.plan_id,
        input.enrolled_date,
        input.effective_from,
        input.effective_to ?? null,
      ]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT be.*, bp.plan_name, bp.plan_type
       FROM benefit_enrollment be
       LEFT JOIN benefit_plan bp ON bp.id = be.plan_id
       WHERE be.employee_id = ? AND be.plan_id = ? LIMIT 1`,
      [input.employee_id, input.plan_id]
    );
    return (rows as BenefitEnrollment[])[0];
  },

  async updateEnrollmentStatus(
    id: string,
    status: "active" | "inactive" | "pending"
  ): Promise<BenefitEnrollment> {
    const [check] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM benefit_enrollment WHERE id = ? LIMIT 1",
      [id]
    );
    if (!(check as RowDataPacket[]).length) throw new Error("Enrollment not found");

    await db.execute(
      "UPDATE benefit_enrollment SET status = ? WHERE id = ?",
      [status, id]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT be.*, bp.plan_name, bp.plan_type
       FROM benefit_enrollment be
       LEFT JOIN benefit_plan bp ON bp.id = be.plan_id
       WHERE be.id = ? LIMIT 1`,
      [id]
    );
    return (rows as BenefitEnrollment[])[0];
  },

  // ─── Claims ────────────────────────────────────────────────────────────────

  async listClaims(filters: {
    employeeId?: string;
    status?: string;
  }): Promise<ReimbursementClaim[]> {
    const conds: string[] = [];
    const params: unknown[] = [];

    if (filters.employeeId) {
      conds.push("rc.employee_id = ?");
      params.push(filters.employeeId);
    }
    if (filters.status) {
      conds.push("rc.status = ?");
      params.push(filters.status);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT rc.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM reimbursement_claim rc
       LEFT JOIN employees e ON e.id = rc.employee_id
       ${where}
       ORDER BY rc.claim_date DESC`,
      params
    );
    return rows as ReimbursementClaim[];
  },

  async submitClaim(input: {
    employee_id: string;
    claim_type: string;
    amount: number;
    claim_date: string;
    description?: string | null;
    receipt_ref?: string | null;
  }): Promise<ReimbursementClaim> {
    if (input.amount <= 0) throw new Error("Amount must be greater than zero");

    await db.execute(
      `INSERT INTO reimbursement_claim
         (employee_id, claim_type, amount, claim_date, description, receipt_ref, status)
       VALUES (?, ?, ?, ?, ?, ?, 'submitted')`,
      [
        input.employee_id,
        input.claim_type,
        input.amount,
        input.claim_date,
        input.description ?? null,
        input.receipt_ref ?? null,
      ]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT rc.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM reimbursement_claim rc
       LEFT JOIN employees e ON e.id = rc.employee_id
       WHERE rc.id = LAST_INSERT_ID() LIMIT 1`
    );
    return (rows as ReimbursementClaim[])[0];
  },

  async reviewClaim(
    id: string,
    action: "approved" | "rejected",
    reviewedBy: string,
    remarks?: string | null
  ): Promise<ReimbursementClaim> {
    const [check] = await db.execute<RowDataPacket[]>(
      "SELECT id, status FROM reimbursement_claim WHERE id = ? LIMIT 1",
      [id]
    );
    const existing = (check as { id: string; status: string }[])[0];
    if (!existing) throw new Error("Claim not found");
    if (existing.status !== "submitted") {
      throw new Error(`Cannot review a claim with status '${existing.status}'`);
    }

    await db.execute(
      `UPDATE reimbursement_claim
       SET status = ?, reviewed_by = ?, reviewed_at = NOW(), remarks = ?, updated_at = NOW()
       WHERE id = ?`,
      [action, reviewedBy, remarks ?? null, id]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT rc.*,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code
       FROM reimbursement_claim rc
       LEFT JOIN employees e ON e.id = rc.employee_id
       WHERE rc.id = ? LIMIT 1`,
      [id]
    );
    return (rows as ReimbursementClaim[])[0];
  },

  async claimStats(): Promise<{
    total_submitted: number;
    total_approved: number;
    total_amount_approved: number;
  }> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS total_submitted,
         SUM(CASE WHEN status IN ('approved', 'paid') THEN 1 ELSE 0 END) AS total_approved,
         SUM(CASE WHEN status IN ('approved', 'paid') THEN amount ELSE 0 END) AS total_amount_approved
       FROM reimbursement_claim`
    );
    const row = (rows as {
      total_submitted: number;
      total_approved: number;
      total_amount_approved: number;
    }[])[0];
    return {
      total_submitted: Number(row.total_submitted ?? 0),
      total_approved: Number(row.total_approved ?? 0),
      total_amount_approved: Number(row.total_amount_approved ?? 0),
    };
  },
};
