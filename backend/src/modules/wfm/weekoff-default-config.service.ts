import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { Request } from "express";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * Admin CRUD for week_off_policy_default — tier 3-5 (process/branch/org) of
 * the week-off resolution hierarchy roster-generation.service.ts consults
 * when neither an approved week_off_preference (tier 1) nor a process
 * roster_template pattern (tier 2) resolves an employee's week-off day. See
 * sql/1202_week_off_policy_default.sql: the table is deliberately seeded
 * empty ("never default to Sunday") and until this file, nothing could ever
 * populate it except direct SQL — the exact same P1 gap
 * rest-policy-config.service.ts closed for wfm_rest_policy, and this module
 * is deliberately built to match that file's structure/validation/audit
 * shape rather than invent a new one.
 *
 * scope_type is one of 'global' | 'branch' | 'process' — note this table has
 * no 'employee' tier (that's week_off_preference's job, tier 1; duplicating
 * it here would create a second source of truth CLAUDE.md prohibits) and
 * uses 'global' rather than 'organization' for the top tier, matching the
 * migration's own ENUM exactly.
 */

export type WeekOffDefaultScopeType = "global" | "branch" | "process";

export interface WeekOffDefaultRow extends RowDataPacket {
  id: string;
  scope_type: WeekOffDefaultScopeType;
  process_id: string | null;
  branch_id: string | null;
  default_week_off_day: number;
  effective_from: string;
  effective_to: string | null;
  active_status: number;
  change_reason: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateWeekOffDefaultInput {
  scope_type: WeekOffDefaultScopeType;
  process_id?: string | null;
  branch_id?: string | null;
  default_week_off_day: number;
  effective_from?: string;
  effective_to?: string | null;
  change_reason?: string | null;
}

export interface UpdateWeekOffDefaultInput {
  default_week_off_day?: number;
  effective_to?: string | null;
  change_reason?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertValidCreateInput(input: CreateWeekOffDefaultInput) {
  const validScopes: WeekOffDefaultScopeType[] = ["global", "branch", "process"];
  if (!validScopes.includes(input.scope_type)) {
    throw Object.assign(new Error(`scope_type must be one of ${validScopes.join(", ")}`), { statusCode: 400 });
  }
  if (input.scope_type === "global") {
    if (input.process_id || input.branch_id) {
      throw Object.assign(new Error("process_id/branch_id must be omitted for scope_type=global"), { statusCode: 400 });
    }
  } else if (input.scope_type === "process") {
    if (!input.process_id) throw Object.assign(new Error("process_id is required for scope_type=process"), { statusCode: 400 });
    if (input.branch_id) throw Object.assign(new Error("branch_id must be omitted for scope_type=process"), { statusCode: 400 });
  } else if (input.scope_type === "branch") {
    if (!input.branch_id) throw Object.assign(new Error("branch_id is required for scope_type=branch"), { statusCode: 400 });
    if (input.process_id) throw Object.assign(new Error("process_id must be omitted for scope_type=branch"), { statusCode: 400 });
  }
  if (
    !Number.isInteger(input.default_week_off_day) ||
    input.default_week_off_day < 0 ||
    input.default_week_off_day > 6
  ) {
    throw Object.assign(new Error("default_week_off_day must be an integer 0 (Sunday) through 6 (Saturday)"), { statusCode: 400 });
  }
  if (input.effective_from && !DATE_RE.test(input.effective_from)) {
    throw Object.assign(new Error("effective_from must be in YYYY-MM-DD format"), { statusCode: 400 });
  }
  if (input.effective_to && !DATE_RE.test(input.effective_to)) {
    throw Object.assign(new Error("effective_to must be in YYYY-MM-DD format"), { statusCode: 400 });
  }
  if (input.effective_from && input.effective_to && input.effective_to < input.effective_from) {
    throw Object.assign(new Error("effective_to must be on or after effective_from"), { statusCode: 400 });
  }
}

async function assertScopeRefExists(scopeType: WeekOffDefaultScopeType, processId?: string | null, branchId?: string | null) {
  if (scopeType === "process" && processId) {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT 1 FROM process_master WHERE id = ? LIMIT 1", [processId]);
    if (!rows[0]) throw Object.assign(new Error("process_id does not match any row in process_master"), { statusCode: 400 });
  }
  if (scopeType === "branch" && branchId) {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT 1 FROM branch_master WHERE id = ? LIMIT 1", [branchId]);
    if (!rows[0]) throw Object.assign(new Error("branch_id does not match any row in branch_master"), { statusCode: 400 });
  }
}

/** True while an active row's effective window still overlaps `existingTo`
 *  (open-ended or in the future) — used to give a 409 with the same
 *  "adjust the window or edit the existing row" guidance the DB's own
 *  overlap would otherwise surface as an opaque constraint error, since
 *  unlike wfm_rest_policy this table has no generated-column unique index
 *  enforcing it at the DB layer. */
async function findOverlappingActiveRow(
  scopeType: WeekOffDefaultScopeType,
  processId: string | null,
  branchId: string | null,
  effectiveFrom: string,
  effectiveTo: string | null,
  excludeId?: string
): Promise<WeekOffDefaultRow | null> {
  const conds = ["scope_type = ?", "active_status = 1", "effective_from <= ?", "(effective_to IS NULL OR effective_to >= ?)"];
  const params: unknown[] = [scopeType, effectiveTo ?? "9999-12-31", effectiveFrom];
  conds.push(scopeType === "process" ? "process_id <=> ?" : "process_id IS NULL");
  if (scopeType === "process") params.push(processId);
  conds.push(scopeType === "branch" ? "branch_id <=> ?" : "branch_id IS NULL");
  if (scopeType === "branch") params.push(branchId);
  if (excludeId) { conds.push("id <> ?"); params.push(excludeId); }

  const [rows] = await db.execute<WeekOffDefaultRow[]>(
    `SELECT * FROM week_off_policy_default WHERE ${conds.join(" AND ")} LIMIT 1`,
    params
  );
  return rows[0] ?? null;
}

export const weekOffDefaultConfigService = {
  async list(filters: { scope_type?: string; active_status?: string }): Promise<WeekOffDefaultRow[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.scope_type) { conds.push("scope_type = ?"); params.push(filters.scope_type); }
    if (filters.active_status !== undefined) { conds.push("active_status = ?"); params.push(Number(filters.active_status)); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<WeekOffDefaultRow[]>(
      `SELECT * FROM week_off_policy_default ${where} ORDER BY scope_type ASC, effective_from DESC`,
      params
    );
    return rows;
  },

  async get(id: string): Promise<WeekOffDefaultRow> {
    const [rows] = await db.execute<WeekOffDefaultRow[]>("SELECT * FROM week_off_policy_default WHERE id = ? LIMIT 1", [id]);
    if (!rows[0]) throw Object.assign(new Error("Week-off default policy not found"), { statusCode: 404 });
    return rows[0];
  },

  async create(input: CreateWeekOffDefaultInput, userId: string, req?: Request): Promise<WeekOffDefaultRow> {
    assertValidCreateInput(input);
    await assertScopeRefExists(input.scope_type, input.process_id, input.branch_id);

    const effectiveFrom = input.effective_from ?? new Date().toISOString().slice(0, 10);
    const overlap = await findOverlappingActiveRow(
      input.scope_type, input.process_id ?? null, input.branch_id ?? null, effectiveFrom, input.effective_to ?? null
    );
    if (overlap) {
      throw Object.assign(
        new Error("An active week-off default for this exact scope and effective window already exists — adjust effective_from/effective_to or edit the existing row instead"),
        { statusCode: 409 }
      );
    }

    const id = randomUUID();
    await db.execute(
      `INSERT INTO week_off_policy_default
         (id, scope_type, process_id, branch_id, default_week_off_day,
          effective_from, effective_to, change_reason, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.scope_type,
        input.scope_type === "process" ? input.process_id : null,
        input.scope_type === "branch" ? input.branch_id : null,
        input.default_week_off_day,
        effectiveFrom,
        input.effective_to ?? null,
        input.change_reason ?? null,
        userId,
        userId,
      ]
    );

    await logSensitiveAction({
      actor_user_id: userId,
      action_type: "WEEK_OFF_DEFAULT_CREATED",
      module_key: "week_off_policy_default",
      entity_type: "week_off_policy_default",
      entity_id: id,
      change_summary: {
        scope_type: input.scope_type,
        process_id: input.process_id ?? null,
        branch_id: input.branch_id ?? null,
        default_week_off_day: input.default_week_off_day,
      },
      req,
    });
    return this.get(id);
  },

  /** scope_type/process_id/branch_id are immutable once created — matches
   *  rest-policy-config.service.ts's own update() posture: changing what a
   *  policy applies to is a new policy, not an edit of this one. */
  async update(id: string, input: UpdateWeekOffDefaultInput, userId: string, req?: Request): Promise<WeekOffDefaultRow> {
    const existing = await this.get(id);
    if (input.default_week_off_day !== undefined) {
      if (!Number.isInteger(input.default_week_off_day) || input.default_week_off_day < 0 || input.default_week_off_day > 6) {
        throw Object.assign(new Error("default_week_off_day must be an integer 0 (Sunday) through 6 (Saturday)"), { statusCode: 400 });
      }
    }
    if (input.effective_to !== undefined && input.effective_to !== null) {
      if (!DATE_RE.test(input.effective_to)) {
        throw Object.assign(new Error("effective_to must be in YYYY-MM-DD format"), { statusCode: 400 });
      }
      if (input.effective_to < existing.effective_from) {
        throw Object.assign(new Error("effective_to must be on or after effective_from"), { statusCode: 400 });
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.default_week_off_day !== undefined) { sets.push("default_week_off_day = ?"); params.push(input.default_week_off_day); }
    if (input.effective_to !== undefined) { sets.push("effective_to = ?"); params.push(input.effective_to); }
    if (input.change_reason !== undefined) { sets.push("change_reason = ?"); params.push(input.change_reason); }
    if (!sets.length) return existing;

    sets.push("updated_by = ?");
    params.push(userId, id);
    await db.execute(`UPDATE week_off_policy_default SET ${sets.join(", ")} WHERE id = ?`, params);
    await logSensitiveAction({
      actor_user_id: userId, action_type: "WEEK_OFF_DEFAULT_UPDATED", module_key: "week_off_policy_default",
      entity_type: "week_off_policy_default", entity_id: id, change_summary: input as Record<string, unknown>, req,
    });
    return this.get(id);
  },

  /** Soft-deactivate only — matches wfm_rest_policy's own posture (no hard
   *  delete route; a deactivated default stays visible in the admin UI's
   *  history rather than disappearing, so a later WEEK_OFF_POLICY_MISSING
   *  investigation can see what used to apply and when it stopped). */
  async deactivate(id: string, userId: string, req?: Request): Promise<void> {
    await this.get(id); // 404s if missing
    const [result] = await db.execute<ResultSetHeader>(
      "UPDATE week_off_policy_default SET active_status = 0, updated_by = ? WHERE id = ? AND active_status = 1",
      [userId, id]
    );
    if ((result as ResultSetHeader).affectedRows === 0) {
      throw Object.assign(new Error("Policy not found or already inactive"), { statusCode: 409 });
    }
    await logSensitiveAction({
      actor_user_id: userId, action_type: "WEEK_OFF_DEFAULT_DEACTIVATED", module_key: "week_off_policy_default",
      entity_type: "week_off_policy_default", entity_id: id, req,
    });
  },
};
