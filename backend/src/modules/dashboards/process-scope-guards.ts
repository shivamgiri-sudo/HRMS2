import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { ANALYTICS_VIEWER_ROLES, isOrgWide } from "../analytics-catalogue/scope.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { TPZ_COMPANIES, companyForInboundKey, tpzCompany } from "../tpz-access/tpz-access.catalog.js";
import { accessOf } from "../tpz-access/tpz-access.middleware.js";
import { canTpz } from "../tpz-access/tpz-access.resolver.js";

/**
 * Owner ruling 2026-10-01: company / process dashboards (TPZ, inbound, call-master) are not exempt from
 * branch scoping. A role gate (manager, qa, hr ...) says who may open the page; the PROCESS behind a
 * dashboard has to sit inside the caller's branch / assigned scope. Org-wide roles (super_admin, admin,
 * ceo and holders of a scope_type='all' row on an exempt role) are never narrowed.
 *
 * Fail closed: a caller with no scope rows resolves to an empty process set and sees nothing.
 */

/** Roles whose assignment rows count when working out which processes a caller can read. */
export const PROCESS_SCOPE_ROLES = [
  ...ANALYTICS_VIEWER_ROLES,
  "hr_admin", "branch_hr", "hr_branch", "operations_head", "process_hr", "qa_manager", "quality_lead",
  "assistant_manager", "team_lead", "tl", "payroll_hr", "wfm_spoc", "rta", "wfm_analyst",
];

export type ProcessScope =
  | { orgWide: true }
  | { orgWide: false; processIds: ReadonlySet<string>; processCodes: ReadonlySet<string> };

export async function resolveProcessScope(userId: string): Promise<ProcessScope> {
  if (await isOrgWide(userId)) return { orgWide: true };
  const clause = await buildScopeWhereClause(
    userId,
    PROCESS_SCOPE_ROLES,
    { processId: "p.id", branchId: "p.branch_id" },
    { allowAdminBypass: true, allowCeoAllRead: true },
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id, p.process_code FROM process_master p WHERE p.active_status = 1 AND (${clause.sql})`,
    clause.params as never[],
  );
  return {
    orgWide: false,
    processIds: new Set((rows as RowDataPacket[]).map((r) => String(r.id))),
    processCodes: new Set((rows as RowDataPacket[]).map((r) => String(r.process_code ?? "")).filter(Boolean)),
  };
}

/**
 * TPZ company dashboards. A company the catalogue ties to no process_master row (processCodes is empty)
 * has no branch to scope by, so it stays reachable on its role gate - listed as a gap by the caller.
 */
export function tpzCompanyAllowed(scope: ProcessScope, companyKey: string): boolean {
  if (scope.orgWide) return true;
  const company = tpzCompany(companyKey);
  if (!company || company.processCodes.length === 0) return true;
  return company.processCodes.some((c) => scope.processCodes.has(c));
}

export interface InboundProjectLike { key: string; processId?: string | null; clientId?: string | null }

/** Inbound project: its own process (DB-defined) or the catalogue company that owns its key. */
export function inboundProjectAllowed(scope: ProcessScope, project: InboundProjectLike): boolean {
  if (scope.orgWide) return true;
  if (project.processId) return scope.processIds.has(String(project.processId));
  const key = String(project.key ?? "").toLowerCase();
  const company = TPZ_COMPANIES.find((c) => c.inboundKeys.includes(key));
  if (!company) return false;
  if (company.processCodes.length === 0) return true;
  return company.processCodes.some((c) => scope.processCodes.has(c));
}

/**
 * True when the caller reaches this inbound project through an explicit TPZ grant (an admin chose that company /
 * branch for them) rather than through a legacy role: such access is already branch / company specific, so it is
 * not re-narrowed by the role-based process scope.
 */
export async function tpzGrantCoversInboundKey(req: AuthenticatedRequest, inboundKey: string): Promise<boolean> {
  const company = companyForInboundKey(inboundKey);
  if (!company) return false;
  const access = await accessOf(req);
  return !access.roleFullView && canTpz(access, company, "dashboards");
}

/**
 * Express middleware for dashboards that belong to one TPZ company: GET requests from a caller who is not org-wide
 * need that company's process inside their branch / assigned scope (403 otherwise, fail closed). Writes pass untouched
 * (they keep their own role guard).
 */
export function requireTpzCompanyInScope(companyKey: string) {
  return async (req: any, res: any, next: (e?: unknown) => void) => {
    try {
      if (req.method !== "GET") return next();
      const userId = req.authUser?.id as string | undefined;
      if (!userId) return res.status(403).json({ success: false, message: "Forbidden: no resolvable scope" });
      const scope = await resolveProcessScope(userId);
      if (tpzCompanyAllowed(scope, companyKey)) return next();
      return res.status(403).json({ success: false, message: "Forbidden: this process is outside your branch / assigned scope" });
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Same rule for a dashboard that belongs to a process the TPZ catalogue does not list (BLA BLI BLU): GET requests
 * from a caller who is not org-wide need one of these process codes inside their branch / assigned scope.
 */
export function requireProcessCodesInScope(processCodes: readonly string[]) {
  return async (req: any, res: any, next: (e?: unknown) => void) => {
    try {
      if (req.method !== "GET") return next();
      const userId = req.authUser?.id as string | undefined;
      if (!userId) return res.status(403).json({ success: false, message: "Forbidden: no resolvable scope" });
      const scope = await resolveProcessScope(userId);
      if (scope.orgWide || processCodes.some((c) => scope.processCodes.has(c))) return next();
      return res.status(403).json({ success: false, message: "Forbidden: this process is outside your branch / assigned scope" });
    } catch (err) {
      return next(err);
    }
  };
}
