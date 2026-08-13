import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";

/**
 * Architecture for a future, superadmin-configurable additional deduction
 * per unplanned-absence day — on top of the zero-pay treatment that day
 * already gets. NOT ACTIVATED.
 * (2026-08-13, leave-module audit — policy sign-off.)
 *
 * `getEffectiveAbsencePenaltyDays()` is the one function payroll would call
 * to read this. It is deliberately NOT called from
 * payrollCalculate.service.ts yet — wiring even an always-zero read into
 * that file is itself a change to protected payroll-arithmetic code, and
 * this pass was scoped to build the architecture, not touch payroll's live
 * formula. Today, with no approved row ever inserted, this function always
 * returns 0 regardless of whether anything calls it — activating the
 * penalty requires BOTH an approved config row here AND a small, separately
 * reviewed change wiring this read into payrollCalculate.service.ts's
 * absence-day counting.
 */
const CONFIG_KEY = "unplanned_absence_penalty_days";

export interface AbsencePenaltyConfigRow {
  id: string;
  configKey: string;
  penaltyDays: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string;
  notes: string | null;
}

/**
 * The approved penalty-days value effective on `asOfDate` (default: today).
 * Returns 0 if no approved row covers that date — which is every date,
 * until this is deliberately activated. Unapproved (proposal) rows are
 * never read here, matching statutory_config_version's own rule.
 */
export async function getEffectiveAbsencePenaltyDays(asOfDate?: string): Promise<number> {
  const date = asOfDate ?? new Date().toISOString().slice(0, 10);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT penalty_days FROM absence_penalty_config
      WHERE config_key = ?
        AND approved_by IS NOT NULL
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY effective_from DESC
      LIMIT 1`,
    [CONFIG_KEY, date, date]
  );
  return Number((rows as RowDataPacket[])[0]?.penalty_days ?? 0);
}

export async function listAbsencePenaltyConfig(): Promise<AbsencePenaltyConfigRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, config_key, penalty_days, effective_from, effective_to,
            approved_by, approved_at, created_by, created_at, notes
       FROM absence_penalty_config
      WHERE config_key = ?
      ORDER BY effective_from DESC`,
    [CONFIG_KEY]
  );
  return (rows as RowDataPacket[]).map((r: any) => ({
    id: r.id, configKey: r.config_key, penaltyDays: Number(r.penalty_days),
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to,
    approvedBy: r.approved_by, approvedAt: r.approved_at,
    createdBy: r.created_by, createdAt: r.created_at, notes: r.notes,
  }));
}

/**
 * Proposes a new penalty-days value effective from a future/given date.
 * Unapproved until a super_admin explicitly calls approveAbsencePenaltyConfig
 * — the row has no effect until then, per the same "unapproved rows are
 * proposals" rule statutory_config_version already enforces.
 */
export async function proposeAbsencePenaltyConfig(input: {
  penaltyDays: number;
  effectiveFrom: string;
  createdBy: string;
  notes?: string;
}): Promise<string> {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO absence_penalty_config
       (id, config_key, penalty_days, effective_from, created_by, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, CONFIG_KEY, input.penaltyDays, input.effectiveFrom, input.createdBy, input.notes ?? null]
  );
  return id;
}

export async function approveAbsencePenaltyConfig(id: string, approvedBy: string): Promise<void> {
  await db.execute(
    `UPDATE absence_penalty_config SET approved_by = ?, approved_at = NOW()
      WHERE id = ? AND approved_by IS NULL`,
    [approvedBy, id]
  );
}
