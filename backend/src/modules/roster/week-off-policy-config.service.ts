import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { Request } from "express";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * Admin CRUD for week_off_policy_default (migration 1202) — tier 3-5 of the
 * week-off resolution hierarchy Part A.1 built (employee preference ->
 * roster template -> process/branch/org default). The resolution side
 * (weekoff-policy.service.ts's resolveWeekOffScopeDefault) was wired into
 * roster-generation.service.ts from the start, but the table was
 * deliberately seeded with zero rows and nothing could ever populate it
 * except direct SQL — flagged as a P1 in the round-2 audit alongside the
 * identical gap on wfm_rest_policy: "structurally ready but not yet
 * operationally effective."
 *
 * Deliberately a separate file from weekoff-policy.service.ts (the
 * resolver, consumed by roster-generation.service.ts's live write path) for
 * the same reason rest-policy-config.service.ts is separate from
 * rest-policy.service.ts: administrative CRUD has different concerns than
 * resolution logic, and keeping them apart avoids a collision on an
 * actively-depended-on file.
 */

export type WeekOffPolicyScopeType = "global" | "branch" | "process";

export interface WeekOffPolicyDefaultRow extends RowDataPacket {
  id: string;
  scope_type: WeekOffPolicyScopeType;
  process_id: string | null;
  branch_id: string | null;
  default_week_off_day: number;
  effective_from: string;
  effective_to: string | null;
  active_status: number;
  change_reason: string | null;
  created_by: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

export interface CreateWeekOffPolicyInput {
  scope_type: WeekOffPolicyScopeType;
  process_id?: string | null;
  branch_id?: string | null;
  default_week_off_day: number;
  effective_from?: string;
  effective_to?: string | null;
  change_reason?: string | null;
}

export interface UpdateWeekOffPolicyInput {
  default_week_off_day?: number;
  effective_to?: string | null;
  change_reason?: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function assertValidCreateInput(input: CreateWeekOffPolicyInput) {
  const validScopes: WeekOffPolicyScopeType[] = ["global", "branch", "process"];
  if (!validScopes.includes(input.scope_type)) {
    throw Object.assign(new Error(`scope_type must be one of ${validScopes.join(", ")}`), { statusCode: 400 });
  }
  if (input.scope_type === "global") {
    if (input.process_id || input.branch_id) {
      throw Object.assign(new Error("process_id/branch_id must be omitted for scope_type=global"), { statusCode: 400 });
    }
  } else if (input.scope_type === "process" && !input.process_id) {
    throw Object.assign(new Error("process_id is required for scope_type=process"), { statusCode: 400 });
  } else if (input.scope_type === "branch" && !input.branch_id) {
    throw Object.assign(new Error("branch_id is required for scope_type=branch"), { statusCode: 400 });
  }
  if (
    !Number.isInteger(input.default_week_off_day) ||
    input.default_week_off_day < 0 ||
    input.default_week_off_day > 6
  ) {
    throw Object.assign(
      new Error(`default_week_off_day must be an integer 0-6 (0=Sunday..6=Saturday). Business decision: this is never defaulted for you — pick the actual day explicitly.`),
      { statusCode: 400 }
    );
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

async function assertScopeTargetExists(scopeType: WeekOffPolicyScopeType, processId?: string | null, branchId?: string | null) {
  if (scopeType === "process" && processId) {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT 1 FROM process_master WHERE id = ? LIMIT 1", [processId]);
    if (!rows[0]) throw Object.assign(new Error("process_id does not match any row in process_master"), { statusCode: 400 });
  }
  if (scopeType === "branch" && branchId) {
    const [rows] = await db.execute<RowDataPacket[]>("SELECT 1 FROM branch_master WHERE id = ? LIMIT 1", [branchId]);
    if (!rows[0]) throw Object.assign(new Error("branch_id does not match any row in branch_master"), { statusCode: 400 });
  }
}

/** No DB-level uniqueness constraint backs this table (unlike wfm_rest_policy's
 *  computed-column unique key) — resolveWeekOffScopeDefault()'s own
 *  `ORDER BY effective_from DESC LIMIT 1` would just pick the most recent of
 *  several overlapping rows rather than error, but that's a confusing
 *  admin-UI state to allow silently. Block an exact scope+window duplicate at
 *  the application layer instead. */
async function assertNoExactDuplicate(input: CreateWeekOffPolicyInput) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM week_off_policy_default
      WHERE scope_type = ? AND process_id <=> ? AND branch_id <=> ?
        AND effective_from = ? AND active_status = 1
      LIMIT 1`,
    [input.scope_type, input.process_id ?? null, input.branch_id ?? null, input.effective_from ?? new Date().toISOString().slice(0, 10)]
  );
  if (rows[0]) {
    throw Object.assign(
      new Error("An active policy for this exact scope and effective_from already exists — edit it or deactivate it first"),
      { statusCode: 409 }
    );
  }
}

export const weekOffPolicyConfigService = {
  async list(filters: { scope_type?: string; active_status?: string }): Promise<WeekOffPolicyDefaultRow[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.scope_type) { conds.push("scope_type = ?"); params.push(filters.scope_type); }
    if (filters.active_status !== undefined) { conds.push("active_status = ?"); params.push(Number(filters.active_status)); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<WeekOffPolicyDefaultRow[]>(
      `SELECT * FROM week_off_policy_default ${where} ORDER BY scope_type ASC, effective_from DESC`,
      params
    );
    return rows;
  },

  async get(id: string): Promise<WeekOffPolicyDefaultRow> {
    const [rows] = await db.execute<WeekOffPolicyDefaultRow[]>("SELECT * FROM week_off_policy_default WHERE id = ? LIMIT 1", [id]);
    if (!rows[0]) throw Object.assign(new Error("Week-off policy default not found"), { statusCode: 404 });
    return rows[0];
  },

  async create(input: CreateWeekOffPolicyInput, userId: string, req?: Request): Promise<WeekOffPolicyDefaultRow> {
    assertValidCreateInput(input);
    await assertScopeTargetExists(input.scope_type, input.process_id, input.branch_id);
    await assertNoExactDuplicate(input);

    const id = randomUUID();
    await db.execute(
      `INSERT INTO week_off_policy_default
         (id, scope_type, process_id, branch_id, default_week_off_day, effective_from, effective_to, change_reason, created_by)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?, ?, ?)`,
      [
        id,
        input.scope_type,
        input.scope_type === "process" ? input.process_id : null,
        input.scope_type === "branch" ? input.branch_id : null,
        input.default_week_off_day,
        input.effective_from ?? null,
        input.effective_to ?? null,
        input.change_reason ?? null,
        userId,
      ]
    );

    await logSensitiveAction({
      actor_user_id: userId,
      action_type: "WEEK_OFF_POLICY_DEFAULT_CREATED",
      module_key: "week_off_policy_default",
      entity_type: "week_off_policy_default",
      entity_id: id,
      change_summary: {
        scope_type: input.scope_type,
        process_id: input.process_id ?? null,
        branch_id: input.branch_id ?? null,
        default_week_off_day: input.default_week_off_day,
        default_week_off_day_name: DAY_NAMES[input.default_week_off_day],
      },
      req,
    });
    return this.get(id);
  },

  /** scope_type/process_id/branch_id are immutable once created — same
   *  rationale as rest-policy-config.service.ts's update(): changing what a
   *  policy applies to is a new policy, not an edit of this one. */
  async update(id: string, input: UpdateWeekOffPolicyInput, userId: string, req?: Request): Promise<WeekOffPolicyDefaultRow> {
    const existing = await this.get(id);
    if (input.default_week_off_day !== undefined) {
      if (!Number.isInteger(input.default_week_off_day) || input.default_week_off_day < 0 || input.default_week_off_day > 6) {
        throw Object.assign(new Error("default_week_off_day must be an integer 0-6"), { statusCode: 400 });
      }
    }
    if (input.effective_to !== undefined && input.effective_to && !DATE_RE.test(input.effective_to)) {
      throw Object.assign(new Error("effective_to must be in YYYY-MM-DD format"), { statusCode: 400 });
    }
    if (input.effective_to && input.effective_to < existing.effective_from) {
      throw Object.assign(new Error("effective_to must be on or after effective_from"), { statusCode: 400 });
    }

    const sets: string[] = ["updated_by = ?"];
    const params: unknown[] = [userId];
    if (input.default_week_off_day !== undefined) { sets.push("default_week_off_day = ?"); params.push(input.default_week_off_day); }
    if (input.effective_to !== undefined) { sets.push("effective_to = ?"); params.push(input.effective_to); }
    if (input.change_reason !== undefined) { sets.push("change_reason = ?"); params.push(input.change_reason); }

    params.push(id);
    await db.execute(`UPDATE week_off_policy_default SET ${sets.join(", ")} WHERE id = ?`, params);
    await logSensitiveAction({
      actor_user_id: userId, action_type: "WEEK_OFF_POLICY_DEFAULT_UPDATED", module_key: "week_off_policy_default",
      entity_type: "week_off_policy_default", entity_id: id, change_summary: input, req,
    });
    return this.get(id);
  },

  /** Soft-deactivate only — matches rest-policy-config.service.ts's posture
   *  and this table's own idx_wopd_scope(...,active_status) index. */
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
      actor_user_id: userId, action_type: "WEEK_OFF_POLICY_DEFAULT_DEACTIVATED", module_key: "week_off_policy_default",
      entity_type: "week_off_policy_default", entity_id: id, req,
    });
  },
};
