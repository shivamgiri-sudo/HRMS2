/**
 * Roster off-day policy (roster_offday_policy, migration 1850): per process / LOB / branch,
 * effective-dated FIXED_DAY or FLOATING weekly offs. WFM-only, scoped exactly like the Process LOB
 * Mapping (process-lob-map.service.ts): a caller only sees/writes policies for processes in their
 * resolved dashboard scope, every write is audited to audit_action_log, and the LOB must be an
 * active mapping of the process.
 *
 * Overlap: MySQL treats NULL as distinct in the UNIQUE key, so two rows for the same
 * (process, lob, branch) scope with overlapping effective ranges are rejected here instead.
 */
import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import {
  DashboardScopeConfigurationError, type DashboardScope,
} from "../../shared/dashboardScope.js";
import { resolveWfmScope } from "./wfm-scope-fallback.js";
import { resolveWeekOffScopeDefault } from "../roster/weekoff-policy.service.js";
import {
  LobServiceError, isLobMappedToProcess, loadActiveLob, loadProcessInScope, resolveCallerScope,
  type Actor,
} from "./process-lob-map.service.js";
import { loadActivePolicies } from "./roster-offday-policy.loader.js";
import {
  MAX_FIXED_WEEKDAYS, MAX_FLOATING_OFFS_PER_WEEK, OFF_TYPES, formatWeekdays, isValidYmd, parseWeekdays,
  pickPolicy, rangesOverlap, toYmd, weekdayLabel, type OffType,
} from "./roster-offday-resolver.js";

export const OFFDAY_MODULE_KEY = "wfm_offday_policy";
const MAX_PAGE_SIZE = 200;

const rows = (result: any): any[] => (Array.isArray(result) ? (result[0] as any[]) : []);
const placeholders = (n: number) => Array(n).fill("?").join(",");

export interface PolicyInput {
  process_id: string;
  lob_id?: string | null;
  branch_id?: string | null;
  off_type: OffType;
  fixed_weekdays?: number[];
  floating_offs_per_week?: number | null;
  effective_from: string;
  effective_to?: string | null;
}
export type PolicyUpdate = Omit<PolicyInput, "process_id" | "lob_id" | "branch_id">;

interface NormalizedShape {
  off_type: OffType;
  fixed_weekdays: string | null;
  floating_offs_per_week: number | null;
  effective_from: string;
  effective_to: string | null;
}

// ── validation ───────────────────────────────────────────────────────────────

/** Validate and normalise the editable fields shared by create and update. */
export function normalizePolicyShape(input: PolicyUpdate): NormalizedShape {
  if (!OFF_TYPES.includes(input.off_type)) throw new LobServiceError(400, "Off type must be FIXED_DAY or FLOATING.", "INVALID_OFF_TYPE");
  if (!isValidYmd(input.effective_from)) throw new LobServiceError(400, "Effective from must be a valid date (YYYY-MM-DD).", "INVALID_DATE");
  const effectiveTo = input.effective_to ? input.effective_to : null;
  if (effectiveTo !== null) {
    if (!isValidYmd(effectiveTo)) throw new LobServiceError(400, "Effective to must be a valid date (YYYY-MM-DD).", "INVALID_DATE");
    if (effectiveTo < input.effective_from) throw new LobServiceError(400, "Effective to cannot be before effective from.", "INVALID_DATE_RANGE");
  }
  if (input.off_type === "FIXED_DAY") {
    const days = [...new Set(input.fixed_weekdays ?? [])];
    if (days.length < 1 || days.length > MAX_FIXED_WEEKDAYS || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new LobServiceError(400, `A fixed-day policy needs 1 or ${MAX_FIXED_WEEKDAYS} weekdays (0=Sunday..6=Saturday).`, "INVALID_WEEKDAYS");
    }
    if (input.floating_offs_per_week !== null && input.floating_offs_per_week !== undefined) {
      throw new LobServiceError(400, "Offs per week applies only to a floating policy.", "INVALID_OFFS_PER_WEEK");
    }
    return { off_type: "FIXED_DAY", fixed_weekdays: formatWeekdays(days), floating_offs_per_week: null, effective_from: input.effective_from, effective_to: effectiveTo };
  }
  const n = input.floating_offs_per_week;
  if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > MAX_FLOATING_OFFS_PER_WEEK) {
    throw new LobServiceError(400, `A floating policy needs 1 to ${MAX_FLOATING_OFFS_PER_WEEK} offs per week.`, "INVALID_OFFS_PER_WEEK");
  }
  if (input.fixed_weekdays?.length) throw new LobServiceError(400, "Fixed weekdays apply only to a fixed-day policy.", "INVALID_WEEKDAYS");
  return { off_type: "FLOATING", fixed_weekdays: null, floating_offs_per_week: n as number, effective_from: input.effective_from, effective_to: effectiveTo };
}

async function resolveScopeObject(actor: Actor): Promise<DashboardScope> {
  try {
    return await resolveWfmScope(actor);
  } catch (err) {
    if (err instanceof DashboardScopeConfigurationError) {
      throw new LobServiceError(403, "Your account has no branch/process scope configured for WFM.", "SCOPE_NOT_CONFIGURED");
    }
    throw err;
  }
}

async function assertBranchAllowed(actor: Actor, branchId: string) {
  const r = rows(await db.execute(`SELECT id, branch_name FROM branch_master WHERE id = ? AND active_status = 1 LIMIT 1`, [branchId]));
  if (!r.length) throw new LobServiceError(400, "Branch not found or inactive.", "BRANCH_INVALID");
  const scope = await resolveScopeObject(actor);
  if (scope.level === "BRANCH_ALL" && !scope.branchIds.includes(branchId)) {
    throw new LobServiceError(403, "Branch is outside your scope.", "BRANCH_OUT_OF_SCOPE");
  }
}

async function assertNoOverlap(
  scope: { process_id: string; lob_id: string | null; branch_id: string | null },
  from: string, to: string | null, excludeId?: string,
) {
  const existing = rows(await db.execute(
    `SELECT id, effective_from, effective_to FROM roster_offday_policy
      WHERE active_status = 1 AND process_id = ? AND lob_id <=> ? AND branch_id <=> ?${excludeId ? " AND id <> ?" : ""}`,
    [scope.process_id, scope.lob_id, scope.branch_id, ...(excludeId ? [excludeId] : [])],
  ));
  for (const e of existing) {
    const eFrom = toYmd(e.effective_from);
    const eTo = e.effective_to ? toYmd(e.effective_to) : null;
    if (rangesOverlap(from, to, eFrom, eTo)) {
      throw new LobServiceError(409, `Overlaps an existing policy for the same scope (${eFrom} to ${eTo ?? "open-ended"}). End that one first.`, "POLICY_OVERLAP");
    }
  }
}

function audit(actor: Actor, action: string, id: string, meta: Record<string, unknown>) {
  return writeAuditLog({
    actor_user_id: actor.id, action_type: action, module_key: OFFDAY_MODULE_KEY,
    entity_type: "roster_offday_policy", entity_id: id, metadata: { ...meta, actor_role: actor.role ?? null },
  });
}

function clampPage(page?: number, limit?: number) {
  const l = Math.min(Math.max(Math.trunc(limit ?? 50), 1), MAX_PAGE_SIZE);
  const p = Math.max(Math.trunc(page ?? 1), 1);
  return { limit: l, offset: (p - 1) * l };
}

// ── reads ────────────────────────────────────────────────────────────────────

const POLICY_SELECT = `
  SELECT p.id, p.process_id, pm.process_code, pm.process_name, p.lob_id, l.lob_code, l.lob_name,
         p.branch_id, bm.branch_name, p.off_type, p.fixed_weekdays, p.floating_offs_per_week,
         p.effective_from, p.effective_to, p.active_status, p.created_by, p.created_at, p.updated_by, p.updated_at
    FROM roster_offday_policy p
    JOIN process_master pm ON pm.id = p.process_id
    LEFT JOIN lob_master l ON l.id = p.lob_id
    LEFT JOIN branch_master bm ON bm.id = p.branch_id`;

function present(r: Record<string, any>): Record<string, any> {
  const days = parseWeekdays(r.fixed_weekdays);
  return {
    ...r,
    effective_from: toYmd(r.effective_from),
    effective_to: r.effective_to ? toYmd(r.effective_to) : null,
    fixed_weekdays: days,
    fixed_weekdays_label: days.length ? weekdayLabel(days) : null,
    active_status: Number(r.active_status),
  };
}

export async function listPolicies(actor: Actor, f: {
  process_id?: string; lob_id?: string; branch_id?: string; include_inactive?: boolean; page?: number; limit?: number;
}) {
  const scope = await resolveCallerScope(actor);
  const { limit, offset } = clampPage(f.page, f.limit);
  const where = [scope.sql];
  const params: any[] = [...scope.params];
  if (!f.include_inactive) where.push("p.active_status = 1");
  if (f.process_id) { where.push("p.process_id = ?"); params.push(f.process_id); }
  if (f.lob_id) { where.push("p.lob_id = ?"); params.push(f.lob_id); }
  if (f.branch_id) { where.push("p.branch_id = ?"); params.push(f.branch_id); }
  const data = rows(await db.execute(
    `${POLICY_SELECT} WHERE ${where.join(" AND ")} ORDER BY pm.process_name, l.lob_name, bm.branch_name, p.effective_from DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  ));
  const total = rows(await db.execute(
    `SELECT COUNT(*) AS c FROM roster_offday_policy p JOIN process_master pm ON pm.id = p.process_id WHERE ${where.join(" AND ")}`, params,
  ))[0]?.c ?? 0;
  return { items: data.map(present), total: Number(total) };
}

async function loadPolicyInScope(actor: Actor, id: string) {
  const scope = await resolveCallerScope(actor);
  const r = rows(await db.execute(`${POLICY_SELECT} WHERE p.id = ? AND ${scope.sql} LIMIT 1`, [id, ...scope.params]));
  if (!r.length) throw new LobServiceError(404, "Policy not found.", "NOT_FOUND");
  return present(r[0]);
}

export async function getPolicyDetail(actor: Actor, id: string) {
  const policy = await loadPolicyInScope(actor, id);
  const rawAudit = rows(await db.execute(
    `SELECT a.id, a.action_type, a.actor_user_id, a.metadata_json, a.created_at
       FROM audit_action_log a
      WHERE a.module_key = ? AND a.entity_type = 'roster_offday_policy' AND a.entity_id = ?
      ORDER BY a.created_at DESC LIMIT 100`,
    [OFFDAY_MODULE_KEY, id],
  ));
  // Actor emails by parameter, not joined: audit_action_log and auth_user may not share a collation.
  const actorIds = Array.from(new Set(rawAudit.map((a) => a.actor_user_id).filter(Boolean)));
  const emails = new Map<string, string>();
  if (actorIds.length) {
    for (const u of rows(await db.execute(`SELECT id, email FROM auth_user WHERE id IN (${placeholders(actorIds.length)})`, actorIds))) {
      emails.set(u.id, u.email);
    }
  }
  const employees = rows(await db.execute(
    `SELECT COUNT(*) AS c FROM employees WHERE process_id = ?${policy.lob_id ? " AND lob_id = ?" : ""}${policy.branch_id ? " AND branch_id = ?" : ""}`,
    [policy.process_id, ...(policy.lob_id ? [policy.lob_id] : []), ...(policy.branch_id ? [policy.branch_id] : [])],
  ))[0]?.c ?? 0;
  return {
    policy,
    employees_in_scope: Number(employees),
    audit: rawAudit.map((a) => ({ ...a, actor_email: emails.get(a.actor_user_id) ?? null })),
  };
}

/** Branch dropdown: branches of the processes the caller can manage (all active branches for org-wide scope). */
export async function listBranchOptions(actor: Actor) {
  const scope = await resolveCallerScope(actor);
  if (scope.sql === "1=1") {
    return rows(await db.execute(`SELECT id, branch_name FROM branch_master WHERE active_status = 1 ORDER BY branch_name`));
  }
  return rows(await db.execute(
    `SELECT DISTINCT bm.id, bm.branch_name
       FROM process_master pm JOIN branch_master bm ON bm.id = pm.branch_id
      WHERE bm.active_status = 1 AND ${scope.sql} ORDER BY bm.branch_name`,
    scope.params,
  ));
}

// ── writes ───────────────────────────────────────────────────────────────────

export async function createPolicy(actor: Actor, input: PolicyInput) {
  const scope = await resolveCallerScope(actor);
  const proc = await loadProcessInScope(db, scope, input.process_id);
  const shape = normalizePolicyShape(input);
  const lobId = input.lob_id || null;
  const branchId = input.branch_id || null;
  if (lobId) {
    await loadActiveLob(db, lobId);
    if (!(await isLobMappedToProcess(db, proc.id, lobId))) {
      throw new LobServiceError(400, "This LOB is not mapped to the process. Add it in Process LOB Mapping first.", "LOB_NOT_MAPPED");
    }
  }
  if (branchId) await assertBranchAllowed(actor, branchId);
  await assertNoOverlap({ process_id: proc.id, lob_id: lobId, branch_id: branchId }, shape.effective_from, shape.effective_to);
  const id = randomUUID();
  try {
    await db.execute(
      `INSERT INTO roster_offday_policy
         (id, process_id, lob_id, branch_id, off_type, fixed_weekdays, floating_offs_per_week, effective_from, effective_to, active_status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, proc.id, lobId, branchId, shape.off_type, shape.fixed_weekdays, shape.floating_offs_per_week, shape.effective_from, shape.effective_to, actor.id, actor.id],
    );
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") throw new LobServiceError(409, "A policy for this scope already starts on that date.", "POLICY_DUPLICATE");
    throw err;
  }
  await audit(actor, "roster_offday_policy.create", id, { process_id: proc.id, process_name: proc.process_name, lob_id: lobId, branch_id: branchId, ...shape });
  return { id };
}

export async function updatePolicy(actor: Actor, id: string, input: PolicyUpdate) {
  const current = await loadPolicyInScope(actor, id);
  const shape = normalizePolicyShape(input);
  if (Number(current.active_status) === 1) {
    await assertNoOverlap({ process_id: current.process_id, lob_id: current.lob_id, branch_id: current.branch_id }, shape.effective_from, shape.effective_to, id);
  }
  try {
    await db.execute(
      `UPDATE roster_offday_policy
          SET off_type = ?, fixed_weekdays = ?, floating_offs_per_week = ?, effective_from = ?, effective_to = ?, updated_by = ?
        WHERE id = ?`,
      [shape.off_type, shape.fixed_weekdays, shape.floating_offs_per_week, shape.effective_from, shape.effective_to, actor.id, id],
    );
  } catch (err: any) {
    if (err?.code === "ER_DUP_ENTRY") throw new LobServiceError(409, "A policy for this scope already starts on that date.", "POLICY_DUPLICATE");
    throw err;
  }
  await audit(actor, "roster_offday_policy.update", id, {
    before: { off_type: current.off_type, fixed_weekdays: formatWeekdays(current.fixed_weekdays), floating_offs_per_week: current.floating_offs_per_week, effective_from: current.effective_from, effective_to: current.effective_to },
    after: shape,
  });
  return { id };
}

export async function setPolicyActive(actor: Actor, id: string, active: boolean) {
  const current = await loadPolicyInScope(actor, id);
  if (Number(current.active_status) === (active ? 1 : 0)) return { id, changed: false };
  if (active) {
    await assertNoOverlap({ process_id: current.process_id, lob_id: current.lob_id, branch_id: current.branch_id }, current.effective_from, current.effective_to, id);
  }
  await db.execute(`UPDATE roster_offday_policy SET active_status = ?, updated_by = ? WHERE id = ?`, [active ? 1 : 0, actor.id, id]);
  await audit(actor, active ? "roster_offday_policy.reactivate" : "roster_offday_policy.deactivate", id, {
    process_id: current.process_id, lob_id: current.lob_id, branch_id: current.branch_id,
  });
  return { id, changed: true };
}

// ── resolve ──────────────────────────────────────────────────────────────────

/**
 * Effective policy for one employee on one date. Precedence: process+LOB+branch > process+LOB >
 * process+branch > process > legacy week_off_policy_default (a single fixed weekday) > none.
 * Note: the legacy resolver has no date parameter; it answers for today.
 */
export async function resolvePolicyForEmployee(actor: Actor, employeeId: string, date: string) {
  if (!isValidYmd(date)) throw new LobServiceError(400, "date must be a valid YYYY-MM-DD.", "INVALID_DATE");
  const scope = await resolveCallerScope(actor);
  const found = rows(await db.execute(
    `SELECT e.id, e.employee_code, e.process_id, e.lob_id, e.branch_id
       FROM employees e JOIN process_master pm ON pm.id = e.process_id
      WHERE e.id = ? AND ${scope.sql} LIMIT 1`,
    [employeeId, ...scope.params],
  ));
  if (!found.length) throw new LobServiceError(403, "Employee not found, has no process, or is outside your scope.", "EMPLOYEE_OUT_OF_SCOPE");
  const emp = found[0];
  const empScope = {
    processId: String(emp.process_id),
    lobId: emp.lob_id ? String(emp.lob_id) : null,
    branchId: emp.branch_id ? String(emp.branch_id) : null,
  };
  const base = {
    employee_id: String(emp.id), employee_code: emp.employee_code, date,
    process_id: empScope.processId, lob_id: empScope.lobId, branch_id: empScope.branchId,
  };
  const policy = pickPolicy(await loadActivePolicies([empScope.processId]), empScope, date);
  if (policy) {
    return { ...base, source: "roster_offday_policy" as const, policy_id: policy.id, off_type: policy.off_type,
      fixed_weekdays: policy.fixed_weekdays, floating_offs_per_week: policy.floating_offs_per_week,
      matched_scope: { lob: !!policy.lob_id, branch: !!policy.branch_id } };
  }
  const legacy = await resolveWeekOffScopeDefault(empScope.processId, empScope.branchId);
  if (legacy) {
    return { ...base, source: "week_off_policy_default" as const, legacy_scope: legacy.source, off_type: "FIXED_DAY" as const,
      fixed_weekdays: [legacy.day], floating_offs_per_week: null };
  }
  return { ...base, source: "none" as const };
}
