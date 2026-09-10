/**
 * NOC Certificate (Exit Clearance) â€” case lifecycle and signatory routing.
 *
 * Digitises the paper NOC form: an invite to the leaver, eight signatories, an asset-return
 * table, and a completion record that releases salary. Schema in
 * sql/1696_noc_certificate_exit_clearance.sql.
 *
 * WHY THIS LIVES IN THE PAYROLL MODULE AND NOT THE EXIT MODULE
 *
 * It is exit clearance by subject, but the gate it exists to serve is payroll's, the existing
 * payroll_noc attachment record is here, and the page is /payroll/noc. Decisively:
 * exit.secure.routes.ts already imports ../payroll/noc.service.js, so keeping this here leaves
 * the dependency one-directional (exit -> payroll). Putting it in exit would make payroll import
 * exit while exit imports payroll, and ESM resolves that as a partially-initialised module
 * rather than an error â€” a failure mode that surfaces as an undefined function at runtime.
 *
 * TWO ORDERINGS, DELIBERATELY
 *
 * display_no is the certificate's printed 1-8 (TL, Process Manager, HR, Branch Manager, IT,
 * Admin, Accounts, Finance). tier is the escalation hierarchy (TL -> Process Manager -> Branch
 * Manager -> HR -> IT/Admin/Accounts/Finance in parallel). See the migration header.
 */

import { randomUUID, createHash, randomBytes } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";

/**
 * The pooled connection db.getConnection() actually hands back.
 *
 * Derived from the function rather than imported as mysql2's PoolConnection: the bare `mysql2`
 * export is the CALLBACK API, whose beginTransaction/commit/rollback take a callback and do not
 * return a promise, so annotating with it makes every `await conn.commit()` a type error. Taking
 * the type from the source keeps this correct if the wrapper's shape ever changes.
 */
type NocTxConnection = Awaited<ReturnType<typeof db.getConnection>>;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * 14 days, not the joining kit's 7.
 *
 * An exit runs on a notice period, and the leaver is often already off the floor and reachable
 * only on a personal address when the invite lands. A week is long enough for a joining
 * candidate who is actively waiting to start; it is short enough here to strand a form nobody
 * could open, which turns into an HR resend for no reason. Still bounded, because an
 * indefinitely valid link to a form that carries an employee's exit details is not a link, it is
 * a permanent disclosure.
 */
const INVITE_TTL_DAYS = 14;

function frontendBaseUrl(): string {
  return String(env.FRONTEND_URL ?? "https://mcnhrms.teammas.in").replace(/\/+$/, "");
}

function refuse(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  return Object.assign(new Error(message), { statusCode, code });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Types
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type NocCaseStatus =
  | "invited" | "employee_submitted" | "in_progress" | "declined" | "completed" | "cancelled";
export type SignatoryStatus = "pending" | "accepted" | "acknowledged" | "declined";
export type SignatoryDecision = "accepted" | "acknowledged" | "declined";
export type AssetStatus = "returned" | "not_returned" | "na";
export type FnfOption = "current_payroll" | "45_days" | "both";

/** The roles the escalation matrix recognises as having started a case. */
export type InitiatorRole = "agent" | "tl" | "manager" | "hr" | "it" | "admin_mis";

export interface NocSignatoryRow {
  id: string;
  noc_case_id: string;
  display_no: number;
  tier: number;
  stage_key: string;
  stage_label: string;
  role_key: string;
  fallback_role_key: string | null;
  requires_asset_clearance: number;
  status: SignatoryStatus;
  acted_by_user_id: string | null;
  acted_by_name: string | null;
  acted_by_role: string | null;
  acted_at: string | null;
  remarks: string | null;
  sla_due_at: string | null;
  notified_at: string | null;
  reminder_count: number;
}

export interface NocAssetRow {
  id: string;
  item_no: number;
  item_code: string;
  item_label: string;
  is_mandatory_for_finance: number;
  shown_on_form: number;
  quantity: number | null;
  status: AssetStatus;
  remarks: string | null;
  waived_by: string | null;
  waived_at: string | null;
  waiver_reason: string | null;
}

export interface NocCaseRow {
  id: string;
  employee_id: string;
  exit_request_id: string | null;
  branch_id: string | null;
  process_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  location: string | null;
  portfolio: string | null;
  designation: string | null;
  initiator_role: string | null;
  initiated_by_user_id: string | null;
  initiated_at: string | null;
  resignation_date: string | null;
  reason_for_leaving: string | null;
  employee_submitted_at: string | null;
  last_working_day: string | null;
  fnf_option_suggested: FnfOption | null;
  fnf_option: FnfOption | null;
  status: NocCaseStatus;
  declined_stage_key: string | null;
  declined_by: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  completed_at: string | null;
  override_by: string | null;
  override_at: string | null;
  override_reason: string | null;
  created_at: string;
}

/** Why a signatory cannot act right now. null means they can. */
export type StageBlockReason =
  | { code: "CASE_NOT_OPEN"; message: string }
  | { code: "EMPLOYEE_FORM_PENDING"; message: string }
  | { code: "PRIOR_TIER_PENDING"; message: string }
  | { code: "LWD_NOT_SET"; message: string }
  | { code: "ASSETS_OUTSTANDING"; message: string }
  | { code: "ALREADY_ACTIONED"; message: string };

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Escalation matrix
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Who is copied when a case is opened, keyed by the role that opened it.
 *
 * Straight from the spec's matrix: notify the levels ABOVE the initiator, never below, so
 * approvals move upward. This is a notification concern only â€” it does not grant anyone
 * authority, and it does not change who may sign, which is governed by noc_signatory.role_key
 * and the caller's branch scope.
 *
 * Keyed on the recorded initiator_role rather than derived from the actor's current roles: a
 * user can hold several roles at once (manager AND hr is common here), and the matrix would then
 * be ambiguous about which row applies.
 */
export const INITIATOR_ESCALATION: Record<InitiatorRole, string[]> = {
  agent:    ["tl", "process_manager", "hr", "branch_it", "branch_admin"],
  tl:       ["process_manager", "hr", "branch_it", "branch_admin"],
  manager:  ["branch_head", "hr", "branch_it", "branch_admin"],
  hr:       ["hr", "branch_it", "branch_admin"],
  it:       ["hr", "it_head", "branch_admin"],
  admin_mis:["hr", "branch_it", "branch_admin"],
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Reads
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function getCase(caseId: string): Promise<NocCaseRow | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM noc_case WHERE id = ? LIMIT 1`, [caseId]);
  return (rows[0] as NocCaseRow) ?? null;
}

export async function getCaseByEmployee(employeeId: string): Promise<NocCaseRow | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM noc_case WHERE employee_id = ? LIMIT 1`, [employeeId]);
  return (rows[0] as NocCaseRow) ?? null;
}

export async function getSignatories(caseId: string): Promise<NocSignatoryRow[]> {
  // Ordered by display_no so every surface â€” screen, certificate, export â€” reproduces the
  // paper form's numbering. tier drives behaviour, never presentation.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM noc_signatory WHERE noc_case_id = ? ORDER BY display_no`, [caseId]);
  return rows as NocSignatoryRow[];
}

export async function getAssets(caseId: string): Promise<NocAssetRow[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM noc_asset_return WHERE noc_case_id = ? ORDER BY item_no`, [caseId]);
  return rows as NocAssetRow[];
}

export async function getEvents(caseId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT stage_key, action, actor_role, actor_name, actor_type, reason, created_at
       FROM noc_case_event WHERE noc_case_id = ? ORDER BY created_at DESC, id`, [caseId]);
  return rows as RowDataPacket[];
}

/** Case plus everything the UI and the certificate need, in one call. */
export async function getCaseDetail(caseId: string): Promise<{
  nocCase: NocCaseRow;
  signatories: Array<NocSignatoryRow & { blocked: StageBlockReason | null }>;
  assets: NocAssetRow[];
  events: RowDataPacket[];
  assetGate: { satisfied: boolean; outstanding: string[] };
  progress: { total: number; responded: number; accepted: number; declined: number; pending: number };
}> {
  const nocCase = await getCase(caseId);
  if (!nocCase) throw refuse(404, "NOC_CASE_NOT_FOUND", "NOC case not found");

  const [signatories, assets, events] = await Promise.all([
    getSignatories(caseId), getAssets(caseId), getEvents(caseId),
  ]);

  const assetGate = evaluateAssetGate(assets);
  const annotated = signatories.map((s) => ({
    ...s,
    blocked: stageBlockReason(nocCase, signatories, s, assetGate),
  }));

  const responded = signatories.filter((s) => s.status !== "pending").length;
  return {
    nocCase,
    signatories: annotated,
    assets,
    events,
    assetGate,
    progress: {
      total: signatories.length,
      responded,
      accepted: signatories.filter((s) => s.status === "accepted" || s.status === "acknowledged").length,
      declined: signatories.filter((s) => s.status === "declined").length,
      pending: signatories.filter((s) => s.status === "pending").length,
    },
  };
}

export interface ListCaseFilters {
  status?: string;
  branchId?: string;
  stageKey?: string;
  stageStatus?: string;
  /** Only cases with at least one signatory past its SLA. */
  slaBreachedOnly?: boolean;
  search?: string;
  limit?: number;
}

/**
 * The HR / Payroll Head tracking list.
 *
 * Carries the per-role counts inline rather than making the caller fan out one query per case:
 * the dashboard shows Pending/Accepted/Declined per role per leaver, and N+1 on a list of every
 * open exit is how that page becomes unusable at a few hundred rows.
 *
 * scopeSql is applied by the caller from buildScopeWhereClause so a branch-scoped user sees only
 * their branch, using the same predicate builder as every other scoped list in this codebase.
 */
export async function listCases(
  filters: ListCaseFilters,
  scope: { sql: string; params: unknown[] } = { sql: "1=1", params: [] },
): Promise<RowDataPacket[]> {
  const conds: string[] = [`(${scope.sql})`];
  const params: unknown[] = [...scope.params];

  if (filters.status)   { conds.push("c.status = ?");    params.push(filters.status); }
  if (filters.branchId) { conds.push("c.branch_id = ?"); params.push(filters.branchId); }
  if (filters.search) {
    conds.push("(c.employee_code LIKE ? OR c.employee_name LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.stageKey) {
    conds.push(`EXISTS (SELECT 1 FROM noc_signatory s2
                         WHERE s2.noc_case_id = c.id AND s2.stage_key = ?
                           ${filters.stageStatus ? "AND s2.status = ?" : ""})`);
    params.push(filters.stageKey);
    if (filters.stageStatus) params.push(filters.stageStatus);
  }
  if (filters.slaBreachedOnly) {
    conds.push(`EXISTS (SELECT 1 FROM noc_signatory s3
                         WHERE s3.noc_case_id = c.id AND s3.status = 'pending'
                           AND s3.sla_due_at IS NOT NULL AND s3.sla_due_at < NOW())`);
  }

  const limit = Math.max(1, Math.min(500, filters.limit ?? 200));
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.*,
            b.branch_name,
            COALESCE(sig.total, 0)        AS signatory_total,
            COALESCE(sig.accepted, 0)     AS signatory_accepted,
            COALESCE(sig.declined, 0)     AS signatory_declined,
            COALESCE(sig.pending, 0)      AS signatory_pending,
            COALESCE(sig.sla_breached, 0) AS signatory_sla_breached,
            sig.pending_stages
       FROM noc_case c
       LEFT JOIN branch_master b ON b.id = c.branch_id
       LEFT JOIN (
         SELECT noc_case_id,
                COUNT(*) AS total,
                SUM(status IN ('accepted','acknowledged')) AS accepted,
                SUM(status = 'declined')                   AS declined,
                SUM(status = 'pending')                    AS pending,
                SUM(status = 'pending' AND sla_due_at IS NOT NULL AND sla_due_at < NOW()) AS sla_breached,
                GROUP_CONCAT(CASE WHEN status = 'pending' THEN stage_key END ORDER BY display_no) AS pending_stages
           FROM noc_signatory GROUP BY noc_case_id
       ) sig ON sig.noc_case_id = c.id
      WHERE ${conds.join(" AND ")}
      ORDER BY c.created_at DESC
      LIMIT ${limit}`,
    params,
  );
  return rows as RowDataPacket[];
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Gating rules
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Finance's precondition, from the declaration printed on the paper form.
 *
 * 'na' does NOT satisfy it. That is the whole point of defaulting to 'na': the gate asks "has
 * this been positively accounted for", and an untouched row has not been. Only 'returned' or an
 * explicit Admin/IT waiver clears an item.
 */
export function evaluateAssetGate(assets: NocAssetRow[]): { satisfied: boolean; outstanding: string[] } {
  const outstanding = assets
    .filter((a) => Number(a.is_mandatory_for_finance) === 1)
    .filter((a) => a.status !== "returned" && !a.waived_at)
    .map((a) => a.item_label);
  return { satisfied: outstanding.length === 0, outstanding };
}

/**
 * Whether one signatory may act, and if not, why.
 *
 * Returns a reason object rather than a boolean so the UI can explain the block instead of
 * showing a disabled button with no cause, and so the route can return a specific code.
 */
export function stageBlockReason(
  nocCase: NocCaseRow,
  all: NocSignatoryRow[],
  target: NocSignatoryRow,
  assetGate: { satisfied: boolean; outstanding: string[] },
): StageBlockReason | null {
  if (target.status !== "pending") {
    return { code: "ALREADY_ACTIONED", message: `${target.stage_label} already recorded ${target.status}.` };
  }
  if (nocCase.status === "declined") {
    return {
      code: "CASE_NOT_OPEN",
      message: `This NOC was declined at the ${nocCase.declined_stage_key ?? "an earlier"} stage and is locked pending HR resolution.`,
    };
  }
  if (nocCase.status === "cancelled" || nocCase.status === "completed") {
    return { code: "CASE_NOT_OPEN", message: `This NOC is ${nocCase.status}.` };
  }
  // The form comes first: the signatories are certifying against what the employee declared,
  // so signing before that exists would be certifying a blank document.
  if (nocCase.status === "invited") {
    return {
      code: "EMPLOYEE_FORM_PENDING",
      message: "The employee has not submitted the NOC form yet. HR can record it on their behalf if the employee is unreachable.",
    };
  }

  // Tier gate. Equal tiers are independent; every LOWER tier must have responded positively.
  const blockingLower = all.filter(
    (s) => s.tier < target.tier && s.status !== "accepted" && s.status !== "acknowledged",
  );
  if (blockingLower.length > 0) {
    return {
      code: "PRIOR_TIER_PENDING",
      message: `Awaiting ${blockingLower.map((s) => s.stage_label).join(", ")} before ${target.stage_label} can act.`,
    };
  }

  // HR owns the Last Working Day, and every downstream calculation â€” the FNF route suggestion,
  // the 45-day window, final pay â€” is derived from it. HR clearing its own stage without having
  // set it would hand Finance a case that cannot be settled.
  if (target.stage_key === "hr" && !nocCase.last_working_day) {
    return {
      code: "LWD_NOT_SET",
      message: "Record the confirmed Last Working Day before clearing the HR stage.",
    };
  }

  if (Number(target.requires_asset_clearance) === 1 && !assetGate.satisfied) {
    return {
      code: "ASSETS_OUTSTANDING",
      message:
        `Company property is still outstanding: ${assetGate.outstanding.join(", ")}. ` +
        `Mark each as Returned, or have Admin/IT record an explicit waiver, before Finance signs off.`,
    };
  }

  return null;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Case creation
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface EmployeeSnapshot extends RowDataPacket {
  id: string;
  employee_code: string | null;
  full_name: string | null;
  branch_id: string | null;
  process_id: string | null;
  branch_name: string | null;
  process_name: string | null;
  designation_name: string | null;
  employment_status: string | null;
  official_email: string | null;
  email: string | null;
  personal_email: string | null;
  mobile: string | null;
}

async function loadEmployeeSnapshot(employeeId: string): Promise<EmployeeSnapshot | null> {
  const [rows] = await db.execute<EmployeeSnapshot[]>(
    `SELECT e.id, e.employee_code, e.full_name, e.branch_id, e.process_id,
            b.branch_name, p.process_name, d.designation_name,
            e.employment_status,
            e.official_email, e.email, e.personal_email,
            COALESCE(e.mobile, e.personal_phone, e.alternate_mobile) AS mobile
       FROM employees e
       LEFT JOIN branch_master b      ON b.id = e.branch_id
       LEFT JOIN process_master p     ON p.id = e.process_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  return rows[0] ?? null;
}

/**
 * Open (or return) the single NOC case for an employee, seeding its eight signatories and ten
 * asset rows from the templates.
 *
 * Idempotent by uq_noc_case_employee: a second call returns the existing case rather than
 * racing a duplicate. Two open cases would each satisfy the salary-release gate independently,
 * which is the one bug this table's unique key exists to make impossible.
 *
 * The identity fields are SNAPSHOT here, not joined at read time â€” see the migration header.
 */
export async function openCase(params: {
  employeeId: string;
  initiatorRole: InitiatorRole;
  initiatedByUserId: string;
  actorName?: string | null;
  actorRole?: string | null;
  exitRequestId?: string | null;
}): Promise<{ caseId: string; created: boolean }> {
  const existing = await getCaseByEmployee(params.employeeId);
  if (existing) return { caseId: existing.id, created: false };

  const emp = await loadEmployeeSnapshot(params.employeeId);
  if (!emp) throw refuse(404, "EMPLOYEE_NOT_FOUND", "Employee not found");

  // Resolve the exit request if one was not supplied. Optional throughout: the gate applies to
  // inactive employees generally, and many have no exit_request row at all.
  let exitRequestId = params.exitRequestId ?? null;
  if (!exitRequestId) {
    const [er] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM exit_request WHERE employee_id = ?
        ORDER BY created_at DESC LIMIT 1`, [params.employeeId]);
    exitRequestId = (er[0]?.id as string) ?? null;
  }

  const caseId = randomUUID();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO noc_case
         (id, employee_id, exit_request_id, branch_id, process_id,
          employee_code, employee_name, location, portfolio, designation,
          initiator_role, initiated_by_user_id, initiated_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'invited')`,
      [
        caseId, params.employeeId, exitRequestId, emp.branch_id, emp.process_id,
        emp.employee_code, emp.full_name, emp.branch_name, emp.process_name, emp.designation_name,
        params.initiatorRole, params.initiatedByUserId,
      ],
    );

    // Signatories, copied from the template so a later retitle or role change cannot rewrite
    // what somebody already signed.
    await conn.execute(
      `INSERT INTO noc_signatory
         (id, noc_case_id, display_no, tier, stage_key, stage_label, role_key,
          fallback_role_key, requires_asset_clearance, status)
       SELECT UUID(), ?, t.display_no, t.tier, t.stage_key, t.stage_label, t.role_key,
              t.fallback_role_key, t.requires_asset_clearance, 'pending'
         FROM noc_signatory_template t
        WHERE t.active_status = 1`,
      [caseId],
    );

    await conn.execute(
      `INSERT INTO noc_asset_return
         (id, noc_case_id, item_no, item_code, item_label,
          is_mandatory_for_finance, shown_on_form, quantity, status)
       SELECT UUID(), ?, t.item_no, t.item_code, t.item_label,
              t.is_mandatory_for_finance, t.shown_on_form, t.default_qty, 'na'
         FROM noc_asset_item_template t
        WHERE t.active_status = 1`,
      [caseId],
    );

    await writeEvent(conn, {
      caseId, action: "case_opened", actorUserId: params.initiatedByUserId,
      actorRole: params.actorRole ?? params.initiatorRole, actorName: params.actorName ?? null,
      reason: `Initiated by ${params.initiatorRole}`,
    });

    await conn.commit();
    return { caseId, created: true };
  } catch (err) {
    await conn.rollback();
    // Lost the race against a concurrent opener: return theirs rather than failing the caller.
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      const winner = await getCaseByEmployee(params.employeeId);
      if (winner) return { caseId: winner.id, created: false };
    }
    throw err;
  } finally {
    conn.release();
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Invite tokens
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Mint a fresh form link, superseding any previous active one.
 *
 * Hash-only storage means the original URL is unrecoverable, so a "resend" is necessarily a new
 * token â€” the same constraint and the same resolution as joiningKitDispatch.resendKitEsignLink.
 * Superseding rather than leaving the old row active matters for the reminder worker, which
 * joins on token_status='active' and would otherwise mail twice.
 */
export async function mintInvite(caseId: string, actorUserId: string | null): Promise<{
  inviteId: string; url: string; expiresAt: string; email: string | null; mobile: string | null;
}> {
  const nocCase = await getCase(caseId);
  if (!nocCase) throw refuse(404, "NOC_CASE_NOT_FOUND", "NOC case not found");
  if (nocCase.status === "completed" || nocCase.status === "cancelled") {
    throw refuse(409, "NOC_CASE_CLOSED", `This NOC is ${nocCase.status}; there is no form to send.`);
  }

  const emp = await loadEmployeeSnapshot(nocCase.employee_id);
  const email = [emp?.official_email, emp?.email, emp?.personal_email]
    .find((e) => typeof e === "string" && e.includes("@")) ?? null;
  const mobile = emp?.mobile ?? null;

  await db.execute(
    `UPDATE noc_invite SET token_status = 'superseded'
      WHERE noc_case_id = ? AND token_status = 'active'`, [caseId]);

  const token = randomBytes(24).toString("hex");
  const inviteId = randomUUID();
  await db.execute(
    `INSERT INTO noc_invite
       (id, noc_case_id, employee_id, token_hash, token_status, sent_to_email, sent_to_mobile,
        expires_at, created_by)
     VALUES (?, ?, ?, ?, 'active', ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY), ?)`,
    [inviteId, caseId, nocCase.employee_id, sha256(token), email, mobile, INVITE_TTL_DAYS, actorUserId],
  );

  const [row] = await db.execute<RowDataPacket[]>(
    `SELECT expires_at FROM noc_invite WHERE id = ? LIMIT 1`, [inviteId]);

  return {
    inviteId,
    url: `${frontendBaseUrl()}/employee/noc/${token}`,
    expiresAt: String(row[0]?.expires_at ?? ""),
    email,
    mobile,
  };
}

/** Resolve a public token. Every failure mode is a flat message that leaks no employee data. */
export async function resolveInvite(token: string): Promise<{ inviteId: string; caseId: string }> {
  if (!token || token.length < 20) {
    throw refuse(404, "NOC_LINK_INVALID", "This NOC form link is not valid.");
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, noc_case_id, token_status, expires_at FROM noc_invite
      WHERE token_hash = ? LIMIT 1`, [sha256(token)]);
  const row = rows[0];
  if (!row) throw refuse(404, "NOC_LINK_INVALID", "This NOC form link is not valid.");

  if (String(row.token_status) === "consumed") {
    throw refuse(410, "NOC_ALREADY_SUBMITTED",
      "This NOC form has already been submitted. No further action is needed.");
  }
  if (String(row.token_status) !== "active") {
    throw refuse(410, "NOC_LINK_SUPERSEDED",
      "This NOC form link is no longer active. Please use the most recent link, or ask HR to resend it.");
  }
  if (row.expires_at && new Date(String(row.expires_at)).getTime() < Date.now()) {
    throw refuse(410, "NOC_LINK_EXPIRED", "This NOC form link has expired. Please ask HR to resend it.");
  }
  return { inviteId: String(row.id), caseId: String(row.noc_case_id) };
}

/**
 * What the employee sees. Deliberately narrow: the identity fields the form pre-fills read-only,
 * the asset rows printed on the certificate, and nothing about who has or has not signed â€”
 * clearance decisions by named managers are not the leaver's to see on an unauthenticated page.
 */
export async function getPublicFormView(token: string): Promise<{
  caseId: string;
  employeeCode: string | null; employeeName: string | null;
  location: string | null; portfolio: string | null; designation: string | null;
  resignationDate: string | null; lastWorkingDay: string | null;
  reasonForLeaving: string | null;
  submitted: boolean;
  assets: Array<{ itemNo: number; itemCode: string; itemLabel: string; quantity: number | null; status: AssetStatus }>;
}> {
  const { caseId } = await resolveInvite(token);
  const nocCase = await getCase(caseId);
  if (!nocCase) throw refuse(404, "NOC_LINK_INVALID", "This NOC form link is not valid.");

  await db.execute(
    `UPDATE noc_invite SET opened_at = COALESCE(opened_at, NOW())
      WHERE noc_case_id = ? AND token_status = 'active'`, [caseId]).catch(() => undefined);

  const assets = (await getAssets(caseId)).filter((a) => Number(a.shown_on_form) === 1);
  return {
    caseId,
    employeeCode: nocCase.employee_code,
    employeeName: nocCase.employee_name,
    location: nocCase.location,
    portfolio: nocCase.portfolio,
    designation: nocCase.designation,
    resignationDate: nocCase.resignation_date,
    lastWorkingDay: nocCase.last_working_day,
    reasonForLeaving: nocCase.reason_for_leaving,
    submitted: Boolean(nocCase.employee_submitted_at),
    assets: assets.map((a) => ({
      itemNo: a.item_no, itemCode: a.item_code, itemLabel: a.item_label,
      quantity: a.quantity, status: a.status,
    })),
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Employee submission
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface EmployeeFormSubmission {
  resignationDate: string;
  reasonForLeaving?: string | null;
  assets?: Array<{ itemCode: string; quantity?: number | null; status: AssetStatus; remarks?: string | null }>;
}

/** Shared by the public token path and HR's record-on-behalf path. */
async function applyEmployeeSubmission(
  caseId: string,
  input: EmployeeFormSubmission,
  actor: { userId: string | null; role: string | null; name: string | null; actorType: string },
  request: { ip?: string | null; userAgent?: string | null },
  consumeInvite: boolean,
): Promise<void> {
  const nocCase = await getCase(caseId);
  if (!nocCase) throw refuse(404, "NOC_CASE_NOT_FOUND", "NOC case not found");
  if (nocCase.employee_submitted_at) {
    throw refuse(409, "NOC_ALREADY_SUBMITTED", "This NOC form has already been submitted.");
  }
  if (nocCase.status === "cancelled" || nocCase.status === "completed") {
    throw refuse(409, "NOC_CASE_CLOSED", `This NOC is ${nocCase.status}.`);
  }

  if (!input.resignationDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.resignationDate)) {
    throw refuse(400, "NOC_RESIGNATION_DATE_REQUIRED", "Resignation Date is required (YYYY-MM-DD).");
  }
  // Validated here rather than only in the browser: this is reachable by an unauthenticated
  // caller, so a client-side date picker constraint is a suggestion, not a rule.
  const todayIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (input.resignationDate > todayIst) {
    throw refuse(400, "NOC_RESIGNATION_DATE_FUTURE", "Resignation Date cannot be later than today.");
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE noc_case
          SET resignation_date = ?, reason_for_leaving = ?,
              employee_submitted_at = NOW(),
              employee_ip_address = COALESCE(employee_ip_address, ?),
              employee_user_agent = COALESCE(employee_user_agent, ?),
              status = CASE WHEN status = 'invited' THEN 'employee_submitted' ELSE status END
        WHERE id = ?`,
      [input.resignationDate, input.reasonForLeaving ?? null,
       request.ip ?? null, (request.userAgent ?? null)?.slice(0, 512) ?? null, caseId],
    );

    // Asset rows are UPDATEd by item_code, never inserted: the row set is fixed by the template
    // at open time, so an unknown code from an unauthenticated caller silently affects nothing
    // rather than adding a line to the certificate.
    for (const a of input.assets ?? []) {
      if (!["returned", "not_returned", "na"].includes(a.status)) continue;
      await conn.execute(
        `UPDATE noc_asset_return
            SET quantity = ?, status = ?, remarks = ?, updated_by = ?, updated_by_role = ?,
                status_updated_at = NOW()
          WHERE noc_case_id = ? AND item_code = ?`,
        [a.quantity ?? null, a.status, a.remarks ?? null, actor.userId, actor.role, caseId, a.itemCode],
      );
    }

    if (consumeInvite) {
      await conn.execute(
        `UPDATE noc_invite SET token_status = 'consumed', consumed_at = NOW()
          WHERE noc_case_id = ? AND token_status = 'active'`, [caseId]);
    }

    await writeEvent(conn, {
      caseId,
      action: consumeInvite ? "employee_form_submitted" : "employee_form_recorded_by_hr",
      actorUserId: actor.userId, actorRole: actor.role, actorName: actor.name,
      actorType: actor.actorType,
      reason: consumeInvite ? null : "Recorded on the employee's behalf",
      ip: request.ip ?? null, userAgent: request.userAgent ?? null,
    });

    // Tier 1 becomes actionable now, so its SLA clock starts. Started here rather than at case
    // open because a signatory must not accrue a breach while structurally unable to act.
    await startSlaForActionableStages(conn, caseId);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function submitEmployeeForm(params: {
  token: string;
  input: EmployeeFormSubmission;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ caseId: string }> {
  const { caseId } = await resolveInvite(params.token);
  await applyEmployeeSubmission(
    caseId, params.input,
    { userId: null, role: "employee", name: null, actorType: "public_token" },
    { ip: params.ip, userAgent: params.userAgent },
    true,
  );
  return { caseId };
}

/**
 * HR records the form for an employee who never opened the link.
 *
 * Absconding and unreachable leavers are routine in this business, and without this the whole
 * chain is hostage to someone who has already gone â€” the eight signatories could never start,
 * so the NOC could never complete, so salary could never be released even with everyone willing
 * to sign. Recorded under its own event action so it is distinguishable from the employee's own
 * submission rather than silently equivalent to it.
 */
export async function recordEmployeeFormOnBehalf(params: {
  caseId: string;
  input: EmployeeFormSubmission;
  actorUserId: string;
  actorRole: string | null;
  actorName: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await applyEmployeeSubmission(
    params.caseId, params.input,
    { userId: params.actorUserId, role: params.actorRole, name: params.actorName, actorType: "user" },
    { ip: params.ip, userAgent: params.userAgent },
    true,
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// HR: Last Working Day
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function setLastWorkingDay(params: {
  caseId: string; lastWorkingDay: string;
  actorUserId: string; actorRole: string | null; actorName: string | null;
}): Promise<void> {
  const nocCase = await getCase(params.caseId);
  if (!nocCase) throw refuse(404, "NOC_CASE_NOT_FOUND", "NOC case not found");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.lastWorkingDay)) {
    throw refuse(400, "NOC_LWD_INVALID", "Last Working Day must be a valid date (YYYY-MM-DD).");
  }
  // The form's own rule. Enforced server-side because it changes the FNF route and the 45-day
  // window, both of which are money.
  if (nocCase.resignation_date && params.lastWorkingDay < nocCase.resignation_date) {
    throw refuse(400, "NOC_LWD_BEFORE_RESIGNATION",
      `Last Working Day (${params.lastWorkingDay}) cannot be earlier than the Resignation Date (${nocCase.resignation_date}).`);
  }

  await db.execute(
    `UPDATE noc_case SET last_working_day = ?, lwd_set_by = ?, lwd_set_at = NOW() WHERE id = ?`,
    [params.lastWorkingDay, params.actorUserId, params.caseId],
  );
  await writeEvent(null, {
    caseId: params.caseId, stageKey: "hr", action: "lwd_set",
    actorUserId: params.actorUserId, actorRole: params.actorRole, actorName: params.actorName,
    reason: `Last Working Day set to ${params.lastWorkingDay}`,
  });
  await refreshFnfSuggestion(params.caseId);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Assets
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function updateAssetReturn(params: {
  caseId: string; itemCode: string; status: AssetStatus;
  quantity?: number | null; remarks?: string | null;
  actorUserId: string; actorRole: string | null; actorName: string | null;
}): Promise<void> {
  if (!["returned", "not_returned", "na"].includes(params.status)) {
    throw refuse(400, "NOC_ASSET_STATUS_INVALID", "Status must be Returned, Not Returned or NA.");
  }
  const [res] = await db.execute(
    `UPDATE noc_asset_return
        SET status = ?, quantity = COALESCE(?, quantity), remarks = ?,
            updated_by = ?, updated_by_role = ?, status_updated_at = NOW()
      WHERE noc_case_id = ? AND item_code = ?`,
    [params.status, params.quantity ?? null, params.remarks ?? null,
     params.actorUserId, params.actorRole, params.caseId, params.itemCode],
  );
  if ((res as { affectedRows?: number }).affectedRows === 0) {
    throw refuse(404, "NOC_ASSET_ITEM_NOT_FOUND", "That asset item is not on this NOC.");
  }
  await writeEvent(null, {
    caseId: params.caseId, action: "asset_status_updated",
    actorUserId: params.actorUserId, actorRole: params.actorRole, actorName: params.actorName,
    reason: `${params.itemCode} marked ${params.status}`,
  });
}

/**
 * The waiver the paper declaration already contemplates.
 *
 * Reason is mandatory. A waiver is the one way a mandatory item stops blocking Finance, so an
 * unexplained one is indistinguishable from someone clicking past the control â€” which is what
 * the gate exists to prevent.
 */
export async function waiveAsset(params: {
  caseId: string; itemCode: string; reason: string;
  actorUserId: string; actorRole: string | null; actorName: string | null;
}): Promise<void> {
  if (!params.reason?.trim()) {
    throw refuse(400, "NOC_WAIVER_REASON_REQUIRED", "A waiver reason is required.");
  }
  const [res] = await db.execute(
    `UPDATE noc_asset_return
        SET waived_by = ?, waived_at = NOW(), waiver_reason = ?
      WHERE noc_case_id = ? AND item_code = ?`,
    [params.actorUserId, params.reason.trim(), params.caseId, params.itemCode],
  );
  if ((res as { affectedRows?: number }).affectedRows === 0) {
    throw refuse(404, "NOC_ASSET_ITEM_NOT_FOUND", "That asset item is not on this NOC.");
  }
  await writeEvent(null, {
    caseId: params.caseId, action: "asset_waived",
    actorUserId: params.actorUserId, actorRole: params.actorRole, actorName: params.actorName,
    reason: `${params.itemCode} waived: ${params.reason.trim()}`,
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Signatory action
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ActOnSignatoryResult {
  caseStatus: NocCaseStatus;
  completed: boolean;
  declined: boolean;
  /** Stages that became actionable as a result, so the caller can notify them. */
  newlyActionable: NocSignatoryRow[];
}

/**
 * Record one signatory's decision.
 *
 * Accepted and Acknowledged both clear the stage â€” the paper form offers both and the
 * distinction is the signatory's own (a positive clearance versus noting it without objection),
 * not a difference in workflow effect. Declined does not clear it: it locks the case.
 *
 * The UPDATE carries `AND status = 'pending'` so two signatories acting concurrently cannot both
 * write; the loser gets a 409 rather than silently overwriting the winner's name and timestamp
 * on what is meant to be a signature.
 */
export async function actOnSignatory(params: {
  caseId: string;
  stageKey: string;
  decision: SignatoryDecision;
  remarks?: string | null;
  actorUserId: string;
  actorEmployeeId?: string | null;
  actorName: string | null;
  actorRole: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<ActOnSignatoryResult> {
  if (!["accepted", "acknowledged", "declined"].includes(params.decision)) {
    throw refuse(400, "NOC_DECISION_INVALID", "Decision must be Accepted, Acknowledged or Declined.");
  }
  if (params.decision === "declined" && !params.remarks?.trim()) {
    // A decline stops a person's salary. It does not get to be unexplained.
    throw refuse(400, "NOC_DECLINE_REASON_REQUIRED",
      "A reason is required when declining a NOC clearance.");
  }

  const nocCase = await getCase(params.caseId);
  if (!nocCase) throw refuse(404, "NOC_CASE_NOT_FOUND", "NOC case not found");

  const signatories = await getSignatories(params.caseId);
  const target = signatories.find((s) => s.stage_key === params.stageKey);
  if (!target) throw refuse(404, "NOC_STAGE_NOT_FOUND", "That signatory stage is not on this NOC.");

  const assetGate = evaluateAssetGate(await getAssets(params.caseId));
  const blocked = stageBlockReason(nocCase, signatories, target, assetGate);
  // A decline is allowed to bypass the asset gate: "I cannot clear this because the laptop is
  // missing" is exactly the decline Finance needs to be able to record, and refusing it because
  // the laptop is missing would be circular. Every other block still applies.
  if (blocked && !(params.decision === "declined" && blocked.code === "ASSETS_OUTSTANDING")) {
    throw refuse(409, `NOC_${blocked.code}`, blocked.message);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [res] = await conn.execute(
      `UPDATE noc_signatory
          SET status = ?, acted_by_user_id = ?, acted_by_employee_id = ?, acted_by_name = ?,
              acted_by_role = ?, acted_at = NOW(), remarks = ?,
              ip_address = ?, user_agent = ?
        WHERE id = ? AND status = 'pending'`,
      [params.decision, params.actorUserId, params.actorEmployeeId ?? null, params.actorName,
       params.actorRole, params.remarks?.trim() ?? null,
       params.ip ?? null, (params.userAgent ?? null)?.slice(0, 512) ?? null, target.id],
    );
    if ((res as { affectedRows?: number }).affectedRows !== 1) {
      throw refuse(409, "NOC_STAGE_ALREADY_ACTIONED",
        "This stage was actioned by someone else â€” reload and check before acting again.");
    }

    await writeEvent(conn, {
      caseId: params.caseId, stageKey: params.stageKey, action: `signatory_${params.decision}`,
      actorUserId: params.actorUserId, actorRole: params.actorRole, actorName: params.actorName,
      reason: params.remarks?.trim() ?? null,
      ip: params.ip ?? null, userAgent: params.userAgent ?? null,
    });

    let caseStatus: NocCaseStatus = nocCase.status;
    let completed = false;
    let declined = false;

    if (params.decision === "declined") {
      // Terminal until HR reopens. No automatic path onward, by design.
      await conn.execute(
        `UPDATE noc_case
            SET status = 'declined', declined_stage_key = ?, declined_by = ?, declined_at = NOW(),
                decline_reason = ?
          WHERE id = ?`,
        [params.stageKey, params.actorUserId, params.remarks?.trim() ?? null, params.caseId],
      );
      caseStatus = "declined";
      declined = true;
    } else {
      const after = signatories.map((s) =>
        s.id === target.id ? { ...s, status: params.decision as SignatoryStatus } : s);
      const allCleared = after.every((s) => s.status === "accepted" || s.status === "acknowledged");

      if (allCleared) {
        await conn.execute(
          `UPDATE noc_case SET status = 'completed', completed_at = NOW() WHERE id = ?`,
          [params.caseId]);
        caseStatus = "completed";
        completed = true;
        await writeEvent(conn, {
          caseId: params.caseId, action: "case_completed",
          actorUserId: params.actorUserId, actorRole: params.actorRole, actorName: params.actorName,
          reason: "All signatories responded",
        });
      } else if (nocCase.status === "employee_submitted") {
        await conn.execute(`UPDATE noc_case SET status = 'in_progress' WHERE id = ?`, [params.caseId]);
        caseStatus = "in_progress";
      }
    }

    await startSlaForActionableStages(conn, params.caseId);
    await conn.commit();

    // Recomputed after commit so the caller notifies exactly the stages that are now open.
    const newlyActionable = completed || declined ? [] : await actionableStages(params.caseId);
    return { caseStatus, completed, declined, newlyActionable };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** Pending stages that are not blocked â€” i.e. someone can act on them right now. */
export async function actionableStages(caseId: string): Promise<NocSignatoryRow[]> {
  const nocCase = await getCase(caseId);
  if (!nocCase) return [];
  const signatories = await getSignatories(caseId);
  const assetGate = evaluateAssetGate(await getAssets(caseId));
  return signatories.filter((s) => stageBlockReason(nocCase, signatories, s, assetGate) === null);
}

/**
 * Start the SLA clock for every stage that is actionable and has not had one started.
 *
 * Set when the stage OPENS, not when the case does: a tier-5 signatory blocked behind HR must
 * not accrue a breach for time they could not have acted in, or the SLA dashboard fills with
 * breaches nobody could have prevented and stops being read.
 *
 * COALESCE on sla_due_at makes this idempotent â€” re-running never pushes an existing deadline
 * out, which would let a stage escape its SLA by having the function called again.
 */
async function startSlaForActionableStages(conn: NocTxConnection | null, caseId: string): Promise<void> {
  const open = await actionableStages(caseId);
  const sql =
    `UPDATE noc_signatory ns
        JOIN noc_signatory_template t ON t.stage_key = ns.stage_key
        SET ns.sla_due_at = COALESCE(ns.sla_due_at, DATE_ADD(NOW(), INTERVAL t.sla_hours HOUR))
      WHERE ns.id = ?`;
  for (const s of open) {
    if (conn) await conn.execute(sql, [s.id]);
    else await db.execute(sql, [s.id]);
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// HR resolution of a declined case
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Reopen a declined case, clearing the declining stage back to pending.
 *
 * HR only. The decline lock exists so a refusal is resolved by a person rather than absorbed by
 * the workflow, and that is only true if reopening is itself a deliberate, recorded act. The
 * original decline stays in noc_case_event, so reopening does not erase that it happened.
 */
export async function reopenDeclinedCase(params: {
  caseId: string; reason: string;
  actorUserId: string; actorRole: string | null; actorName: string | null;
}): Promise<void> {
  if (!params.reason?.trim()) {
    throw refuse(400, "NOC_REOPEN_REASON_REQUIRED", "A resolution note is required to reopen a declined NOC.");
  }
  const nocCase = await getCase(params.caseId);
  if (!nocCase) throw refuse(404, "NOC_CASE_NOT_FOUND", "NOC case not found");
  if (nocCase.status !== "declined") {
    throw refuse(409, "NOC_NOT_DECLINED", `This NOC is ${nocCase.status}, not declined.`);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE noc_signatory
          SET status = 'pending', acted_by_user_id = NULL, acted_by_employee_id = NULL,
              acted_by_name = NULL, acted_by_role = NULL, acted_at = NULL,
              sla_due_at = NULL, reminder_count = 0, escalated_at = NULL
        WHERE noc_case_id = ? AND stage_key = ? AND status = 'declined'`,
      [params.caseId, nocCase.declined_stage_key],
    );
    await conn.execute(
      `UPDATE noc_case
          SET status = 'in_progress', declined_stage_key = NULL, declined_by = NULL,
              declined_at = NULL, decline_reason = NULL
        WHERE id = ?`,
      [params.caseId],
    );
    await writeEvent(conn, {
      caseId: params.caseId, stageKey: nocCase.declined_stage_key, action: "case_reopened",
      actorUserId: params.actorUserId, actorRole: params.actorRole, actorName: params.actorName,
      reason: params.reason.trim(),
    });
    await startSlaForActionableStages(conn, params.caseId);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Salary / FNF processing route
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Suggest the settlement route from clearance timing against the payroll window.
 *
 * current_payroll â€” clearance lands while the run covering the Last Working Day is still open,
 *   so the exit month's pay can carry it.
 * 45_days â€” the standard cycle referenced on the declaration, used when the window has closed.
 * both â€” a split settlement: the employee has an open salary line AND a pending F&F with money
 *   on it, so part is paid now and the balance follows.
 *
 * A SUGGESTION, never an assignment. Finance overrides it, and the suggestion is stored beside
 * the choice rather than under it so an override reads as an override. Returns null when there
 * is no Last Working Day, because every branch of this depends on it and guessing the settlement
 * route for an unknown exit date would be a confident wrong answer about someone's money.
 */
export async function computeFnfSuggestion(caseId: string): Promise<FnfOption | null> {
  const nocCase = await getCase(caseId);
  if (!nocCase?.last_working_day) return null;

  const runMonth = String(nocCase.last_working_day).slice(0, 7);

  // window_close_date is the payroll cut-off. LOWER(status) because FINALIZED is stored
  // uppercase while older values are lowercase â€” the casing trap run-status.ts documents.
  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT window_close_date, status
       FROM salary_prep_run
      WHERE run_month = ?
        AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'rejected')
      ORDER BY created_at DESC LIMIT 1`,
    [runMonth],
  );
  const run = runRows[0];
  const runOpen = run
    ? !["locked", "disbursed", "finalized"].includes(String(run.status ?? "").trim().toLowerCase())
    : false;
  const withinWindow = run?.window_close_date
    ? new Date(String(run.window_close_date)).getTime() >= Date.now()
    : runOpen;

  const [ffRows] = await db.execute<RowDataPacket[]>(
    `SELECT net_payable FROM full_final_calculation
      WHERE employee_id = ? AND status NOT IN ('paid', 'cancelled')
      ORDER BY created_at DESC LIMIT 1`,
    [nocCase.employee_id],
  );
  const ffPending = Number(ffRows[0]?.net_payable ?? 0) > 0;

  const [lineRows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.employee_id = ?
        AND LOWER(COALESCE(spr.status, '')) NOT IN ('locked','disbursed','finalized','cancelled')
      LIMIT 1`,
    [nocCase.employee_id],
  );
  const salaryPending = lineRows.length > 0;

  if (salaryPending && ffPending) return "both";
  if (runOpen && withinWindow) return "current_payroll";
  return "45_days";
}

async function refreshFnfSuggestion(caseId: string): Promise<void> {
  const suggestion = await computeFnfSuggestion(caseId);
  if (!suggestion) return;
  await db.execute(
    `UPDATE noc_case SET fnf_option_suggested = ? WHERE id = ?`, [suggestion, caseId]);
}

export async function setFnfOption(params: {
  caseId: string; option: FnfOption;
  actorUserId: string; actorRole: string | null; actorName: string | null;
}): Promise<void> {
  if (!["current_payroll", "45_days", "both"].includes(params.option)) {
    throw refuse(400, "NOC_FNF_OPTION_INVALID",
      "Option must be Current Payroll, 45 Days of Leaving Date, or Both.");
  }
  const nocCase = await getCase(params.caseId);
  if (!nocCase) throw refuse(404, "NOC_CASE_NOT_FOUND", "NOC case not found");

  await db.execute(
    `UPDATE noc_case SET fnf_option = ?, fnf_option_set_by = ?, fnf_option_set_at = NOW() WHERE id = ?`,
    [params.option, params.actorUserId, params.caseId],
  );
  await writeEvent(null, {
    caseId: params.caseId, action: "fnf_option_set",
    actorUserId: params.actorUserId, actorRole: params.actorRole, actorName: params.actorName,
    reason: nocCase.fnf_option_suggested && nocCase.fnf_option_suggested !== params.option
      ? `Set to ${params.option}, overriding the suggested ${nocCase.fnf_option_suggested}`
      : `Set to ${params.option}`,
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Events
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function writeEvent(
  conn: NocTxConnection | null,
  e: {
    caseId: string; stageKey?: string | null; action: string;
    actorUserId?: string | null; actorRole?: string | null; actorName?: string | null;
    actorType?: string; reason?: string | null; ip?: string | null; userAgent?: string | null;
  },
): Promise<void> {
  const sql =
    `INSERT INTO noc_case_event
       (id, noc_case_id, stage_key, action, actor_user_id, actor_role, actor_name,
        actor_type, reason, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    randomUUID(), e.caseId, e.stageKey ?? null, e.action,
    e.actorUserId ?? null, e.actorRole ?? null, e.actorName ?? null,
    e.actorType ?? "user", e.reason?.slice(0, 700) ?? null,
    e.ip ?? null, (e.userAgent ?? null)?.slice(0, 512) ?? null,
  ];
  try {
    // Branched rather than `(conn ?? db).execute(...)`: a union of two call signatures yields a
    // union return type, which is not awaitable-then-catchable without further casting.
    if (conn) await conn.execute(sql, params);
    else await db.execute(sql, params);
  } catch (err) {
    // The timeline is a record of an action that has already happened. Losing a row here must
    // not roll back the action itself; a failure is logged so it is visible rather than silent.
    console.error(`[noc-case] event write failed (${e.action}):`, (err as Error).message);
  }
}

export { writeEvent as __writeNocEvent };
