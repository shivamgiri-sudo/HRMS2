/**
 * Recipient resolution — the single place that answers "who receives this notification".
 *
 * Before this file, every feature wrote its own JOIN and none of them agreed:
 *   exit.service.ts:20                        manager via employees.reporting_manager_id
 *   ats-notification.helper.ts:48             HR via user_roles ... LIMIT 3
 *   payroll-hr.service.ts:457                 branch head via branch_head_assignments
 *   employee-creation-orchestrator.ts:512     payroll HR, branch-scoped
 * They disagree on inactive employees, on which email column wins, and none of them
 * report who was dropped. A wrong recipient on a payroll mail is a data-leak incident,
 * so this is deliberately strict and deliberately loud about what it discarded.
 *
 * Column names below were verified against production information_schema on 2026-07-31.
 * Two are counter-intuitive and are the reason this comment exists:
 *   branch_head_assignments keys on branch_head_id + branch_name (NOT employee_id, NOT branch_id)
 *   branch_wfm_spoc_config  keys on primary_spoc_user_id / backup_spoc_user_id (user ids, not employees)
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../db/mysql.js';
import { isOfficialDomain, normaliseEmail, maskEmail } from './email-domains.js';
import type {
  Bucket, DroppedRecipient, EmailPolicy, RecipientContext, RecipientResolution,
  RecipientSelector, RecipientSpec, ResolveOptions, ResolvedRecipient,
} from './recipient-resolver.types.js';
import { RecipientResolutionError } from './recipient-resolver.types.js';

const DEFAULT_CAPS = { to: 20, cc: 30, bcc: 200 };

/** Shape every selector query returns, so post-processing is uniform. */
interface PersonRow extends RowDataPacket {
  employee_id: string | null;
  user_id: string | null;
  employee_code: string | null;
  name: string | null;
  official_email: string | null;
  office_email: string | null;
  email: string | null;
  personal_email: string | null;
  branch_id: string | null;
  process_id: string | null;
}

const PERSON_COLS = `
  e.id            AS employee_id,
  e.user_id       AS user_id,
  e.employee_code AS employee_code,
  COALESCE(NULLIF(TRIM(e.full_name),''), e.employee_code) AS name,
  e.official_email, e.office_email, e.email, e.personal_email,
  e.branch_id, e.process_id`;

/** Active, or inside the post-exit grace window — matches accessGuard.getEmployeeForUser. */
const ACTIVE = `e.active_status = 1`;

// ---------------------------------------------------------------------------
// Selector -> rows
// ---------------------------------------------------------------------------

async function runSelector(
  sel: RecipientSelector,
  ctx: RecipientContext,
): Promise<{ rows: PersonRow[]; label: string; policy: EmailPolicy }> {
  const q = async (sql: string, params: unknown[]) =>
    (await db.execute<PersonRow[]>(sql, params))[0];

  switch (sel.kind) {
    case 'employee': {
      const id = sel.employeeId ?? ctx.employeeId;
      if (!id) return { rows: [], label: 'employee:<none>', policy: 'default' };
      return {
        rows: await q(`SELECT ${PERSON_COLS} FROM employees e WHERE e.id = ? AND ${ACTIVE} LIMIT 1`, [id]),
        label: `employee:${id}`,
        policy: sel.emailPolicy ?? 'default',
      };
    }

    case 'user': {
      return {
        rows: await q(`SELECT ${PERSON_COLS} FROM employees e WHERE e.user_id = ? AND ${ACTIVE} LIMIT 1`, [sel.userId]),
        label: `user:${sel.userId}`, policy: 'default',
      };
    }

    case 'reporting_manager': {
      const id = sel.employeeId ?? ctx.employeeId;
      if (!id) return { rows: [], label: 'reporting_manager:<none>', policy: 'default' };
      // COALESCE mirrors wfm.regularization.secure.routes.ts:70 — some records carry
      // manager_id and not reporting_manager_id.
      return {
        rows: await q(
          `SELECT ${PERSON_COLS} FROM employees sub
             JOIN employees e ON e.id = COALESCE(sub.reporting_manager_id, sub.manager_id)
            WHERE sub.id = ? AND ${ACTIVE} LIMIT 1`, [id]),
        label: `reporting_manager:${id}`, policy: 'default',
      };
    }

    case 'skip_level_manager': {
      const id = sel.employeeId ?? ctx.employeeId;
      if (!id) return { rows: [], label: 'skip_level_manager:<none>', policy: 'default' };
      return {
        rows: await q(
          `SELECT ${PERSON_COLS} FROM employees sub
             JOIN employees mgr ON mgr.id = COALESCE(sub.reporting_manager_id, sub.manager_id)
             JOIN employees e   ON e.id   = COALESCE(mgr.reporting_manager_id, mgr.manager_id)
            WHERE sub.id = ? AND ${ACTIVE} LIMIT 1`, [id]),
        label: `skip_level_manager:${id}`, policy: 'default',
      };
    }

    case 'branch_head': {
      const b = sel.branchId ?? ctx.branchId;
      if (!b) return { rows: [], label: 'branch_head:<none>', policy: 'default' };
      // branch_head_assignments joins on branch NAME or CODE (payroll-hr.service.ts:457).
      // It holds 3 fake seed rows in production, so the role+scope fallback below is what
      // actually fires most of the time. Both are tried; duplicates collapse later.
      const assigned = await q(
        `SELECT ${PERSON_COLS}
           FROM branch_head_assignments bha
           JOIN branch_master b ON bha.branch_name IN (b.branch_name, b.branch_code)
           JOIN employees e     ON e.id = bha.branch_head_id
          WHERE b.id = ? AND bha.is_active = 1 AND ${ACTIVE}`, [b]);
      const scoped = await roleScopeRows(['branch_head'], { type: 'branch', branchIds: [b] }, 5);
      return { rows: [...assigned, ...scoped], label: `branch_head:${b}`, policy: 'default' };
    }

    case 'branch_hr': {
      const b = sel.branchId ?? ctx.branchId;
      if (!b) return { rows: [], label: 'branch_hr:<none>', policy: 'default' };
      return {
        rows: await roleScopeRows(['hr'], { type: 'branch', branchIds: [b] }, 5),
        label: `branch_hr:${b}`, policy: 'default',
      };
    }

    case 'payroll_hr': {
      const b = sel.branchId ?? ctx.branchId;
      return {
        rows: await roleScopeRows(['payroll_hr'], b ? { type: 'branch', branchIds: [b] } : { type: 'all' }, 5),
        label: `payroll_hr:${b ?? 'all'}`, policy: 'default',
      };
    }

    case 'process_manager': {
      const p = sel.processId ?? ctx.processId;
      return {
        rows: await roleScopeRows(['process_manager', 'manager'], p ? { type: 'process', processIds: [p] } : { type: 'all' }, 5),
        label: `process_manager:${p ?? 'all'}`, policy: 'default',
      };
    }

    case 'wfm_spoc': {
      const b = sel.branchId ?? ctx.branchId;
      if (!b) return { rows: [], label: 'wfm_spoc:<none>', policy: 'default' };
      return { rows: await wfmSpocRows(b), label: `wfm_spoc:${b}`, policy: 'default' };
    }

    case 'wfm_chain': {
      const b = sel.branchId ?? ctx.branchId;
      if (!b) return { rows: [], label: 'wfm_chain:<none>', policy: 'default' };
      // Ordered fallback. branch_wfm_spoc_config has ZERO rows in production, so without
      // this chain every roster CC would resolve to nobody and nobody would notice.
      const spoc = await wfmSpocRows(b);
      if (spoc.length) return { rows: spoc, label: `wfm_chain:${b}#spoc`, policy: 'default' };
      const wfm = await roleScopeRows(['wfm'], { type: 'branch', branchIds: [b] }, 5);
      if (wfm.length) return { rows: wfm, label: `wfm_chain:${b}#wfm_role`, policy: 'default' };
      const hr = await roleScopeRows(['hr'], { type: 'branch', branchIds: [b] }, 5);
      return { rows: hr, label: `wfm_chain:${b}#branch_hr`, policy: 'default' };
    }

    case 'approver_chain': {
      const id = sel.employeeId ?? ctx.employeeId;
      const b = sel.branchId ?? ctx.branchId;
      if (!id && !b) return { rows: [], label: 'approver_chain:<none>', policy: 'default' };

      // 1. The reporting manager, which is who this SHOULD reach.
      if (id) {
        const mgr = await q(
          `SELECT ${PERSON_COLS} FROM employees sub
             JOIN employees e ON e.id = COALESCE(sub.reporting_manager_id, sub.manager_id)
            WHERE sub.id = ? AND ${ACTIVE} LIMIT 1`, [id]);
        if (mgr.length) return { rows: mgr, label: `approver_chain:${id}#manager`, policy: 'default' };
      }
      if (!b) return { rows: [], label: `approver_chain:${id ?? '?'}#no_branch`, policy: 'default' };

      // 2. Branch head — same dual source as the branch_head selector, since
      //    branch_head_assignments holds only 3 fake seed rows in production.
      const assigned = await q(
        `SELECT ${PERSON_COLS}
           FROM branch_head_assignments bha
           JOIN branch_master b ON bha.branch_name IN (b.branch_name, b.branch_code)
           JOIN employees e     ON e.id = bha.branch_head_id
          WHERE b.id = ? AND bha.is_active = 1 AND ${ACTIVE}`, [b]);
      const scoped = await roleScopeRows(['branch_head'], { type: 'branch', branchIds: [b] }, 5);
      const head = [...assigned, ...scoped];
      if (head.length) return { rows: head, label: `approver_chain:${b}#branch_head`, policy: 'default' };

      // 3. Branch HR, so the request is seen by someone rather than nobody.
      const hr = await roleScopeRows(['hr'], { type: 'branch', branchIds: [b] }, 5);
      return { rows: hr, label: `approver_chain:${b}#branch_hr`, policy: 'default' };
    }

    case 'role_scope': {
      const scope = sel.scope ?? { type: 'all' as const };
      return {
        rows: await roleScopeRows(sel.roleKeys, scope, sel.limit ?? 10),
        label: `role_scope:${sel.roleKeys.join('|')}`, policy: 'default',
      };
    }

    case 'tat_owner': {
      const t = sel.tatInstanceId ?? ctx.tatInstanceId;
      if (!t) return { rows: [], label: 'tat_owner:<none>', policy: 'default' };
      // task_tat_instance has NO process_id column — the bug that makes tat.service.ts:34
      // throw on every call. Only assigned_to / owner_user_id are usable here.
      return {
        rows: await q(
          `SELECT ${PERSON_COLS} FROM task_tat_instance t
             JOIN employees e ON e.id = t.assigned_to OR e.user_id = t.owner_user_id
            WHERE t.id = ? AND ${ACTIVE} LIMIT 1`, [t]),
        label: `tat_owner:${t}`, policy: 'default',
      };
    }

    case 'tat_owner_manager': {
      const t = sel.tatInstanceId ?? ctx.tatInstanceId;
      if (!t) return { rows: [], label: 'tat_owner_manager:<none>', policy: 'default' };
      return {
        rows: await q(
          `SELECT ${PERSON_COLS} FROM task_tat_instance t
             JOIN employees own ON own.id = t.assigned_to OR own.user_id = t.owner_user_id
             JOIN employees e   ON e.id = COALESCE(own.reporting_manager_id, own.manager_id)
            WHERE t.id = ? AND ${ACTIVE} LIMIT 1`, [t]),
        label: `tat_owner_manager:${t}`, policy: 'default',
      };
    }

    case 'explicit_email': {
      const row = {
        employee_id: null, user_id: null, employee_code: null, name: sel.name ?? sel.email,
        official_email: null, office_email: null, email: sel.email, personal_email: null,
        branch_id: null, process_id: null,
      } as PersonRow;
      return { rows: [row], label: `explicit_email`, policy: 'default' };
    }

    default: {
      const _exhaustive: never = sel;
      return { rows: [], label: `unknown:${JSON.stringify(_exhaustive)}`, policy: 'default' };
    }
  }
}

/** Role holders, optionally narrowed by branch/process scope. */
async function roleScopeRows(
  roleKeys: string[],
  scope: { type: 'all' } | { type: 'branch'; branchIds: string[] } | { type: 'process'; processIds: string[] },
  limit: number,
): Promise<PersonRow[]> {
  if (!roleKeys.length) return [];
  const keys = roleKeys.map((k) => k.trim().toLowerCase());

  // user_roles is the plain grant; user_assignment_scope is the scoped grant. A person can
  // appear in either, so both are considered (accessGuard.fetchUserRoles does the same).
  let where = '';
  const params: unknown[] = [keys, keys];
  if (scope.type === 'branch') {
    // A scope row explicitly on the branch, OR an 'all'-scoped holder, OR the person simply
    // sits in that branch. Without the last clause, branches with no scope rows get nobody.
    where = ` AND (uas.scope_type = 'all'
                OR (uas.scope_type IN ('branch','team') AND uas.branch_id = ?)
                OR e.branch_id = ?)`;
    params.push(scope.branchIds[0], scope.branchIds[0]);
  } else if (scope.type === 'process') {
    where = ` AND (uas.scope_type = 'all'
                OR (uas.scope_type IN ('process','team') AND uas.process_id = ?)
                OR e.process_id = ?)`;
    params.push(scope.processIds[0], scope.processIds[0]);
  }

  const [rows] = await db.query<PersonRow[]>(
    `SELECT DISTINCT ${PERSON_COLS}
       FROM employees e
       JOIN auth_user au ON au.id = e.user_id
       LEFT JOIN user_roles ur           ON ur.user_id = e.user_id AND ur.active_status = 1 AND ur.role_key IN (?)
       LEFT JOIN user_assignment_scope uas ON uas.user_id = e.user_id AND uas.active_status = 1 AND uas.role_key IN (?)
      WHERE ${ACTIVE}
        AND (ur.id IS NOT NULL OR uas.id IS NOT NULL)
        ${where}
      ORDER BY e.employee_code
      LIMIT ${Math.max(1, Math.min(200, limit))}`,
    params,
  );
  return rows;
}

/** Branch WFM SPOC — primary and optionally backup. Keyed on USER ids, not employee ids. */
async function wfmSpocRows(branchId: string): Promise<PersonRow[]> {
  const [rows] = await db.execute<PersonRow[]>(
    `SELECT ${PERSON_COLS}
       FROM branch_wfm_spoc_config c
       JOIN employees e ON e.user_id IN (c.primary_spoc_user_id, c.backup_spoc_user_id)
      WHERE c.branch_id = ? AND c.is_active = 1
        AND (c.effective_to IS NULL OR c.effective_to >= CURDATE())
        AND ${ACTIVE}`,
    [branchId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Address selection
// ---------------------------------------------------------------------------

function pickAddress(
  row: PersonRow, policy: EmailPolicy,
): { email: string; source: ResolvedRecipient['emailSource'] } | { drop: 'no_email' | 'no_official_email' | 'invalid_domain' } {
  const official = normaliseEmail(row.official_email) ?? normaliseEmail(row.office_email);
  const personal = normaliseEmail(row.email) ?? normaliseEmail(row.personal_email);
  const officialSource: ResolvedRecipient['emailSource'] =
    normaliseEmail(row.official_email) ? 'official_email' : 'office_email';

  if (policy === 'official_only') {
    if (!official) return { drop: 'no_official_email' };
    if (!isOfficialDomain(official)) return { drop: 'invalid_domain' };
    return { email: official, source: officialSource };
  }

  if (policy === 'official_then_personal') {
    if (official && isOfficialDomain(official)) return { email: official, source: officialSource };
    if (personal) return { email: personal, source: 'email' };
    return { drop: 'no_email' };
  }

  if (official) return { email: official, source: officialSource };
  if (personal) return { email: personal, source: 'email' };
  return { drop: 'no_email' };
}

/**
 * Client addresses, for the deny-list. Loaded once per resolution rather than per recipient.
 * client_user is a small table; an IN-list keeps this to a single query.
 */
async function clientAddresses(candidates: string[]): Promise<Set<string>> {
  if (!candidates.length) return new Set();
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT LOWER(TRIM(email)) AS email FROM client_user WHERE is_active = 1 AND LOWER(TRIM(email)) IN (?)`,
    [candidates],
  );
  return new Set(rows.map((r) => String(r.email)));
}

/**
 * User ids (not email rows) holding `roleKey`, scoped to `branchId` when given. For
 * callers that need an actual recipient to address in-app (work_inbox_item.user_id),
 * not an email — resolveRecipients below is email-shaped and drops rows with no
 * deliverable address. Reuses the same branch_head_assignments + role-scope sources
 * as the 'branch_head' selector above so the two paths never disagree about who the
 * branch head is.
 */
export async function resolveRoleHolderUserIds(roleKey: string, branchId: string | null): Promise<string[]> {
  const scoped = branchId
    ? await roleScopeRows([roleKey], { type: 'branch', branchIds: [branchId] }, 10)
    : await roleScopeRows([roleKey], { type: 'all' }, 10);

  let assigned: PersonRow[] = [];
  if (roleKey === 'branch_head' && branchId) {
    const [rows] = await db.execute<PersonRow[]>(
      `SELECT ${PERSON_COLS}
         FROM branch_head_assignments bha
         JOIN branch_master b ON bha.branch_name IN (b.branch_name, b.branch_code)
         JOIN employees e     ON e.id = bha.branch_head_id
        WHERE b.id = ? AND bha.is_active = 1 AND ${ACTIVE}`, [branchId]);
    assigned = rows;
  }

  const ids = new Set<string>();
  for (const row of [...assigned, ...scoped]) {
    if (row.user_id) ids.add(String(row.user_id));
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function resolveRecipients(
  spec: RecipientSpec,
  options: ResolveOptions,
): Promise<RecipientResolution> {
  const { sensitivity, context } = options;
  const caps = {
    to: options.maxTo ?? DEFAULT_CAPS.to,
    cc: options.maxCc ?? DEFAULT_CAPS.cc,
    bcc: options.maxBcc ?? DEFAULT_CAPS.bcc,
  };
  const dropped: DroppedRecipient[] = [];
  let truncated = false;

  // Catalogue rule, enforced before any query runs: a financial event ABOUT an employee
  // may never CC anyone. (A payroll-run event addressed to finance roles is not about an
  // employee and is unaffected.) See NOTIFICATION_CATALOGUE.md section 5.
  const subjectIsEmployee = spec.to.some((s) => s.kind === 'employee');
  if (sensitivity === 'fin' && subjectIsEmployee && (spec.cc?.length || spec.bcc?.length)) {
    throw new RecipientResolutionError(
      'FIN_HAS_CC',
      'A financial notification about an employee cannot copy anyone else.',
    );
  }

  const buckets: Record<Bucket, ResolvedRecipient[]> = { to: [], cc: [], bcc: [] };
  const seen = new Set<string>();

  for (const bucket of ['to', 'cc', 'bcc'] as Bucket[]) {
    for (const sel of spec[bucket] ?? []) {
      // Conditional selectors (e.g. CEO only above a payroll threshold).
      if (sel.kind === 'role_scope' && sel.conditional && !evaluateCondition(sel.conditional, context)) {
        dropped.push({ selector: `role_scope:${sel.roleKeys.join('|')}`, reason: 'condition_not_met', detail: sel.conditional });
        continue;
      }

      let result: Awaited<ReturnType<typeof runSelector>>;
      try {
        result = await runSelector(sel, context);
      } catch (err) {
        dropped.push({ selector: sel.kind, reason: 'no_match', detail: (err as Error).message.slice(0, 180) });
        continue;
      }

      if (!result.rows.length) {
        dropped.push({ selector: result.label, reason: 'no_match' });
        continue;
      }

      // `fin` forces official-only regardless of what the selector asked for, unless the
      // selector explicitly opted into the documented full_final_ready exception.
      const policy: EmailPolicy =
        sensitivity === 'fin' && result.policy === 'default' ? 'official_only' : result.policy;

      for (const row of result.rows) {
        const picked = pickAddress(row, policy);
        if ('drop' in picked) {
          dropped.push({ selector: result.label, reason: picked.drop, employeeId: row.employee_id });
          continue;
        }

        // Never copy someone on a message about themselves.
        if (bucket !== 'to' && row.employee_id && row.employee_id === context.employeeId) {
          dropped.push({ selector: result.label, reason: 'self_edge', employeeId: row.employee_id });
          continue;
        }

        // to > cc > bcc: an address already in a higher bucket is not repeated.
        if (seen.has(picked.email)) {
          dropped.push({ selector: result.label, reason: 'duplicate', detail: maskEmail(picked.email) });
          continue;
        }

        if (buckets[bucket].length >= caps[bucket]) {
          truncated = true;
          dropped.push({ selector: result.label, reason: 'cap_exceeded', detail: maskEmail(picked.email) });
          continue;
        }

        seen.add(picked.email);
        buckets[bucket].push({
          bucket,
          employeeId: row.employee_id,
          userId: row.user_id,
          employeeCode: row.employee_code,
          name: row.name ?? picked.email,
          email: picked.email,
          emailSource: sel.kind === 'explicit_email' ? 'explicit' : picked.source,
          branchId: row.branch_id,
          processId: row.process_id,
          audience: 'internal',
          viaSelector: result.label,
        });
      }
    }
  }

  // Audience classification, then the deny-list. Done after resolution so the error can
  // name exactly who breached it.
  const all = [...buckets.to, ...buckets.cc, ...buckets.bcc];
  const clients = await clientAddresses(all.map((r) => r.email));
  for (const r of all) {
    if (clients.has(r.email)) r.audience = 'client';
    else if (!isOfficialDomain(r.email)) r.audience = 'external';
  }

  const resolution: RecipientResolution = { ...buckets, dropped, truncated };

  // Internal notifications may never reach a client login. Throw rather than filter:
  // silently dropping a recipient hides the misconfiguration that produced it.
  const clientHits = all.filter((r) => r.audience === 'client');
  if (clientHits.length) {
    throw new RecipientResolutionError(
      'CLIENT_AUDIENCE',
      `Refusing to send: ${clientHits.length} recipient(s) are client-portal users ` +
      `(${clientHits.map((r) => maskEmail(r.email)).join(', ')}).`,
      resolution,
    );
  }

  if (!buckets.to.length) {
    throw new RecipientResolutionError(
      'EMPTY_TO',
      `No deliverable recipient. Dropped: ${dropped.map((d) => `${d.selector}=${d.reason}`).join('; ') || 'none'}`,
      resolution,
    );
  }

  return resolution;
}

/** Guards named in a selector's `conditional`. Unknown names fail closed. */
function evaluateCondition(name: string, ctx: RecipientContext): boolean {
  const vars = ctx.vars ?? {};
  const m = /^amount_gt_(\d+)$/.exec(name);
  if (m) return Number(vars.amount ?? 0) > Number(m[1]);
  return false;
}
