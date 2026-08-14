import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { Request } from "express";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

/**
 * Admin CRUD for wfm_rest_policy — the P1 gap the round-2 minimum-rest audit
 * found: the resolution/validation side (rest-policy.service.ts) was
 * complete and correctly wired into every roster-write path, but there was
 * no route anywhere to actually create a policy row. Every one of those
 * write paths' "no minimum-rest policy configured" error already pointed
 * callers at "Admin > Roster Controls > Minimum Rest" (see
 * auto-roster-synced.service.ts's REST_POLICY_MISSING message) — a page
 * that had nothing behind it. Until now, the only way to populate this
 * table was direct SQL, which is not a production configuration mechanism.
 *
 * Deliberately a separate file from rest-policy.service.ts rather than
 * added to it: that file is resolution/validation logic consumed by every
 * roster-write path (a concurrent session's work, actively depended on by
 * several other files); this is administrative CRUD with its own
 * validation/audit concerns. Keeping them apart avoids a collision on an
 * actively-shared file while both are still moving.
 */

export type RestPolicyScopeType = "organization" | "branch" | "process" | "employee";

export interface RestPolicyRow extends RowDataPacket {
  id: string;
  scope_type: RestPolicyScopeType;
  scope_id: string | null;
  minimum_rest_minutes: number;
  allows_emergency_override: number;
  effective_from: string;
  effective_to: string | null;
  active_status: number;
  reason: string | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRestPolicyInput {
  scope_type: RestPolicyScopeType;
  scope_id?: string | null;
  minimum_rest_minutes: number;
  allows_emergency_override?: boolean;
  effective_from: string;
  effective_to?: string | null;
  reason?: string | null;
}

export interface UpdateRestPolicyInput {
  minimum_rest_minutes?: number;
  allows_emergency_override?: boolean;
  effective_to?: string | null;
  reason?: string | null;
}

const SCOPE_TABLE: Record<Exclude<RestPolicyScopeType, "organization">, string> = {
  branch: "branch_master",
  process: "process_master",
  employee: "employees",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertValidCreateInput(input: CreateRestPolicyInput) {
  const validScopes: RestPolicyScopeType[] = ["organization", "branch", "process", "employee"];
  if (!validScopes.includes(input.scope_type)) {
    throw Object.assign(new Error(`scope_type must be one of ${validScopes.join(", ")}`), { statusCode: 400 });
  }
  if (input.scope_type === "organization") {
    if (input.scope_id) {
      throw Object.assign(new Error("scope_id must be omitted for scope_type=organization"), { statusCode: 400 });
    }
  } else if (!input.scope_id) {
    throw Object.assign(new Error(`scope_id is required for scope_type=${input.scope_type}`), { statusCode: 400 });
  }
  if (!Number.isInteger(input.minimum_rest_minutes) || input.minimum_rest_minutes <= 0) {
    throw Object.assign(new Error("minimum_rest_minutes must be a positive integer"), { statusCode: 400 });
  }
  if (input.minimum_rest_minutes > 24 * 60) {
    throw Object.assign(new Error("minimum_rest_minutes cannot exceed 1440 (24 hours)"), { statusCode: 400 });
  }
  if (!input.effective_from || !DATE_RE.test(input.effective_from)) {
    throw Object.assign(new Error("effective_from is required in YYYY-MM-DD format"), { statusCode: 400 });
  }
  if (input.effective_to && !DATE_RE.test(input.effective_to)) {
    throw Object.assign(new Error("effective_to must be in YYYY-MM-DD format"), { statusCode: 400 });
  }
  if (input.effective_to && input.effective_to < input.effective_from) {
    throw Object.assign(new Error("effective_to must be on or after effective_from"), { statusCode: 400 });
  }
}

async function assertScopeIdExists(scopeType: RestPolicyScopeType, scopeId: string | null | undefined) {
  if (scopeType === "organization" || !scopeId) return;
  const table = SCOPE_TABLE[scopeType];
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT 1 FROM ${table} WHERE id = ? LIMIT 1`, [scopeId]);
  if (!rows[0]) {
    throw Object.assign(new Error(`scope_id does not match any row in ${table}`), { statusCode: 400 });
  }
}

export const restPolicyConfigService = {
  async list(filters: { scope_type?: string; active_status?: string }): Promise<RestPolicyRow[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (filters.scope_type) { conds.push("scope_type = ?"); params.push(filters.scope_type); }
    if (filters.active_status !== undefined) { conds.push("active_status = ?"); params.push(Number(filters.active_status)); }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RestPolicyRow[]>(
      `SELECT * FROM wfm_rest_policy ${where} ORDER BY scope_type ASC, effective_from DESC`,
      params
    );
    return rows;
  },

  async get(id: string): Promise<RestPolicyRow> {
    const [rows] = await db.execute<RestPolicyRow[]>("SELECT * FROM wfm_rest_policy WHERE id = ? LIMIT 1", [id]);
    if (!rows[0]) throw Object.assign(new Error("Rest policy not found"), { statusCode: 404 });
    return rows[0];
  },

  async create(input: CreateRestPolicyInput, userId: string, req?: Request): Promise<RestPolicyRow> {
    assertValidCreateInput(input);
    await assertScopeIdExists(input.scope_type, input.scope_id);

    const id = randomUUID();
    try {
      await db.execute(
        `INSERT INTO wfm_rest_policy
           (id, scope_type, scope_id, minimum_rest_minutes, allows_emergency_override,
            effective_from, effective_to, reason, created_by, approved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.scope_type,
          input.scope_type === "organization" ? null : input.scope_id,
          input.minimum_rest_minutes,
          input.allows_emergency_override ? 1 : 0,
          input.effective_from,
          input.effective_to ?? null,
          input.reason ?? null,
          userId,
          userId,
        ]
      );
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "ER_DUP_ENTRY") {
        throw Object.assign(
          new Error("A policy for this exact scope and effective window already exists — adjust effective_from/effective_to or edit the existing row instead"),
          { statusCode: 409 }
        );
      }
      throw err;
    }

    await logSensitiveAction({
      actor_user_id: userId,
      action_type: "REST_POLICY_CREATED",
      module_key: "wfm_rest_policy",
      entity_type: "wfm_rest_policy",
      entity_id: id,
      change_summary: { scope_type: input.scope_type, scope_id: input.scope_id ?? null, minimum_rest_minutes: input.minimum_rest_minutes },
      req,
    });
    return this.get(id);
  },

  /**
   * scope_type/scope_id are immutable once created — changing what a policy
   * applies to is a new policy, not an edit of this one (matches the
   * resolver's own scope-window uniqueness model). Only the policy's own
   * terms can change.
   */
  async update(id: string, input: UpdateRestPolicyInput, userId: string, req?: Request): Promise<RestPolicyRow> {
    const existing = await this.get(id);
    if (input.minimum_rest_minutes !== undefined) {
      if (!Number.isInteger(input.minimum_rest_minutes) || input.minimum_rest_minutes <= 0 || input.minimum_rest_minutes > 24 * 60) {
        throw Object.assign(new Error("minimum_rest_minutes must be a positive integer, at most 1440"), { statusCode: 400 });
      }
    }
    if (input.effective_to && !DATE_RE.test(input.effective_to)) {
      throw Object.assign(new Error("effective_to must be in YYYY-MM-DD format"), { statusCode: 400 });
    }
    if (input.effective_to && input.effective_to < existing.effective_from) {
      throw Object.assign(new Error("effective_to must be on or after effective_from"), { statusCode: 400 });
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.minimum_rest_minutes !== undefined) { sets.push("minimum_rest_minutes = ?"); params.push(input.minimum_rest_minutes); }
    if (input.allows_emergency_override !== undefined) { sets.push("allows_emergency_override = ?"); params.push(input.allows_emergency_override ? 1 : 0); }
    if (input.effective_to !== undefined) { sets.push("effective_to = ?"); params.push(input.effective_to); }
    if (input.reason !== undefined) { sets.push("reason = ?"); params.push(input.reason); }
    if (!sets.length) return existing;

    params.push(id);
    await db.execute(`UPDATE wfm_rest_policy SET ${sets.join(", ")} WHERE id = ?`, params);
    await logSensitiveAction({
      actor_user_id: userId, action_type: "REST_POLICY_UPDATED", module_key: "wfm_rest_policy",
      // Same interface-has-no-index-signature rule as week-off-policy-config.service.ts's
      // update(): the `as Record<string, unknown>` assertion this replaced does not compile,
      // because UpdateRestPolicyInput is an interface. Spreading into an object literal does.
      entity_type: "wfm_rest_policy", entity_id: id, change_summary: { ...input }, req,
    });
    return this.get(id);
  },

  /** Soft-deactivate only — matches wfm_rest_override_log's immutable-audit
   *  posture and this table's own idx_wfm_rest_policy_scope(...,active_status)
   *  index. No hard delete route; a deactivated policy stays visible in the
   *  admin UI's history. */
  async deactivate(id: string, userId: string, req?: Request): Promise<void> {
    await this.get(id); // 404s if missing
    const [result] = await db.execute<ResultSetHeader>(
      "UPDATE wfm_rest_policy SET active_status = 0 WHERE id = ? AND active_status = 1",
      [id]
    );
    if ((result as ResultSetHeader).affectedRows === 0) {
      throw Object.assign(new Error("Policy not found or already inactive"), { statusCode: 409 });
    }
    await logSensitiveAction({
      actor_user_id: userId, action_type: "REST_POLICY_DEACTIVATED", module_key: "wfm_rest_policy",
      entity_type: "wfm_rest_policy", entity_id: id, req,
    });
  },
};
