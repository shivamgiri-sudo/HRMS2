import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import type { Response } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

export const payrollCalendarRouter = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

payrollCalendarRouter.use(requireAuth);

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS payroll_calendar (
    calendar_month            VARCHAR(7)   NOT NULL PRIMARY KEY,
    attendance_cutoff_date    DATE         NULL,
    incentive_upload_deadline DATE         NULL,
    deductions_upload_deadline DATE        NULL,
    branch_readiness_deadline DATE         NULL,
    payroll_run_date          DATE         NULL,
    validation_date           DATE         NULL,
    disbursement_date         DATE         NULL,
    notes                     TEXT         NULL,
    created_by                VARCHAR(36)  NULL,
    updated_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`;

async function ensureTable(): Promise<void> {
  try {
    await db.execute(CREATE_TABLE_SQL);
  } catch {
    // table may already exist — ignore
  }
}

/** Return next N calendar months from today as YYYY-MM strings */
function nextMonths(count: number): string[] {
  const today = new Date();
  const months: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    months.push(`${d.getFullYear()}-${mm}`);
  }
  return months;
}

/** GET /api/payroll/calendar?month=YYYY-MM */
payrollCalendarRouter.get(
  "/",
  h(async (req: AuthenticatedRequest, res: Response) => {
    await ensureTable();

    const today = new Date();
    const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const month = (req.query.month as string | undefined) ?? defaultMonth;

    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, message: "Invalid month format. Use YYYY-MM" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM payroll_calendar WHERE calendar_month = ? LIMIT 1",
      [month],
    );

    return res.json({ success: true, month, data: rows[0] ?? null });
  }),
);

/** GET /api/payroll/calendar/upcoming — next 3 months */
payrollCalendarRouter.get(
  "/upcoming",
  h(async (_req: AuthenticatedRequest, res: Response) => {
    await ensureTable();

    const months = nextMonths(3);
    const placeholders = months.map(() => "?").join(", ");
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM payroll_calendar WHERE calendar_month IN (${placeholders})`,
      months,
    );

    const byMonth: Record<string, RowDataPacket> = {};
    for (const row of rows) byMonth[row.calendar_month as string] = row;

    const result = months.map((m) => ({ month: m, data: byMonth[m] ?? null }));
    return res.json({ success: true, data: result });
  }),
);

/** POST /api/payroll/calendar — create / upsert milestones for a month */
payrollCalendarRouter.post(
  "/",
  requireRole("payroll_head", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await ensureTable();

    const {
      calendar_month,
      attendance_cutoff_date,
      incentive_upload_deadline,
      deductions_upload_deadline,
      branch_readiness_deadline,
      payroll_run_date,
      validation_date,
      disbursement_date,
      notes,
    } = req.body as {
      calendar_month: string;
      attendance_cutoff_date?: string | null;
      incentive_upload_deadline?: string | null;
      deductions_upload_deadline?: string | null;
      branch_readiness_deadline?: string | null;
      payroll_run_date?: string | null;
      validation_date?: string | null;
      disbursement_date?: string | null;
      notes?: string | null;
    };

    if (!calendar_month || !/^\d{4}-\d{2}$/.test(calendar_month)) {
      return res.status(400).json({ success: false, message: "calendar_month (YYYY-MM) is required" });
    }

    const createdBy = req.authUser?.id ?? null;

    await db.execute(
      `INSERT INTO payroll_calendar
         (calendar_month, attendance_cutoff_date, incentive_upload_deadline, deductions_upload_deadline,
          branch_readiness_deadline, payroll_run_date, validation_date, disbursement_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         attendance_cutoff_date     = VALUES(attendance_cutoff_date),
         incentive_upload_deadline  = VALUES(incentive_upload_deadline),
         deductions_upload_deadline = VALUES(deductions_upload_deadline),
         branch_readiness_deadline  = VALUES(branch_readiness_deadline),
         payroll_run_date           = VALUES(payroll_run_date),
         validation_date            = VALUES(validation_date),
         disbursement_date          = VALUES(disbursement_date),
         notes                      = VALUES(notes),
         updated_at                 = CURRENT_TIMESTAMP`,
      [
        calendar_month,
        attendance_cutoff_date ?? null,
        incentive_upload_deadline ?? null,
        deductions_upload_deadline ?? null,
        branch_readiness_deadline ?? null,
        payroll_run_date ?? null,
        validation_date ?? null,
        disbursement_date ?? null,
        notes ?? null,
        createdBy,
      ],
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM payroll_calendar WHERE calendar_month = ? LIMIT 1",
      [calendar_month],
    );
    return res.status(201).json({ success: true, data: rows[0] });
  }),
);

/** PATCH /api/payroll/calendar/:month — partial update of milestones */
payrollCalendarRouter.patch(
  "/:month",
  requireRole("payroll_head", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await ensureTable();

    const { month } = req.params;
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, message: "Invalid month format. Use YYYY-MM" });
    }

    const allowedFields = [
      "attendance_cutoff_date",
      "incentive_upload_deadline",
      "deductions_upload_deadline",
      "branch_readiness_deadline",
      "payroll_run_date",
      "validation_date",
      "disbursement_date",
      "notes",
    ] as const;

    type AllowedField = (typeof allowedFields)[number];
    const updates: Partial<Record<AllowedField, string | null>> = {};

    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = (req.body[field] as string | null) ?? null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update" });
    }

    // Upsert — if the month row doesn't exist yet, create it
    const setClauses = (Object.keys(updates) as AllowedField[]).map((f) => `${f} = ?`).join(", ");
    const values = Object.values(updates);

    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT calendar_month FROM payroll_calendar WHERE calendar_month = ? LIMIT 1",
      [month],
    );

    if (existing.length === 0) {
      // insert with only provided fields
      const colList = ["calendar_month", "created_by", ...Object.keys(updates)].join(", ");
      const valPlaceholders = Array(2 + Object.keys(updates).length).fill("?").join(", ");
      await db.execute(
        `INSERT INTO payroll_calendar (${colList}) VALUES (${valPlaceholders})`,
        [month, req.authUser?.id ?? null, ...values],
      );
    } else {
      await db.execute<ResultSetHeader>(
        `UPDATE payroll_calendar SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE calendar_month = ?`,
        [...values, month],
      );
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM payroll_calendar WHERE calendar_month = ? LIMIT 1",
      [month],
    );
    return res.json({ success: true, data: rows[0] });
  }),
);
