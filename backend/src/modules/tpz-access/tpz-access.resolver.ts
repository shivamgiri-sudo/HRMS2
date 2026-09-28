import { expandRoles, normalizeRoleInputs } from "../../platform/policy/index.js";
import {
  LEGACY_TPZ_UPLOAD_ROLES, LEGACY_TPZ_VIEW_ROLES, TPZ_ALWAYS_FULL_ROLES, TPZ_COMPANIES, type TpzCapability,
} from "./tpz-access.catalog.js";

export interface TpzGrantRow {
  scope_type: "all" | "company" | "branch";
  company_key: string | null;
  branch_id: string | null;
  can_dashboards: boolean;
  can_upload: boolean;
  can_mis: boolean;
}

export interface TpzCompanyAccess { dashboards: boolean; upload: boolean; mis: boolean }

export interface TpzAccess {
  /** True when the user's ROLE shows every TPZ dashboard (unchanged behaviour for existing users). */
  roleFullView: boolean;
  /** True when the user's ROLE may already use every TPZ uploader through the bulk-upload endpoints. */
  roleFullUpload: boolean;
  /** True when the user's ROLE admits them to the bulk-upload endpoints at all (narrowing aside). */
  uploadRoleAdmitted: boolean;
  /** True for a role-based user an admin has narrowed to their grants. */
  restricted: boolean;
  /** What the grants give, per company (branch and "all" grants already expanded). */
  companies: Record<string, TpzCompanyAccess>;
}

/** Pure -- no I/O, so the decision rules can be tested exhaustively. */
export function resolveTpzAccess(input: {
  roles: readonly string[];
  restrict: boolean;
  grants: readonly TpzGrantRow[];
  /** branch_id -> the TPZ company keys whose process_master row sits in that branch. */
  branchCompanies: ReadonlyMap<string, readonly string[]>;
}): TpzAccess {
  const roles = expandRoles(normalizeRoleInputs([...input.roles]));
  const has = (list: readonly string[]) => list.some((r) => roles.includes(r as never));
  const alwaysFull = has(TPZ_ALWAYS_FULL_ROLES);
  const narrowed = input.restrict && !alwaysFull;

  const companies: Record<string, TpzCompanyAccess> = {};
  const merge = (key: string, g: TpzGrantRow) => {
    const cur = companies[key] ?? { dashboards: false, upload: false, mis: false };
    companies[key] = { dashboards: cur.dashboards || g.can_dashboards, upload: cur.upload || g.can_upload, mis: cur.mis || g.can_mis };
  };
  for (const g of input.grants) {
    if (g.scope_type === "all") for (const c of TPZ_COMPANIES) merge(c.key, g);
    else if (g.scope_type === "company" && g.company_key) merge(g.company_key, g);
    else if (g.scope_type === "branch" && g.branch_id) for (const key of input.branchCompanies.get(g.branch_id) ?? []) merge(key, g);
  }

  return {
    roleFullView: has(LEGACY_TPZ_VIEW_ROLES) && !narrowed,
    roleFullUpload: has(LEGACY_TPZ_UPLOAD_ROLES) && !narrowed,
    uploadRoleAdmitted: has(LEGACY_TPZ_UPLOAD_ROLES),
    restricted: narrowed,
    companies,
  };
}

export function canTpz(access: TpzAccess, company: string, capability: TpzCapability): boolean {
  if (capability === "upload") return access.roleFullUpload || Boolean(access.companies[company]?.upload);
  if (access.roleFullView) return true;
  return Boolean(access.companies[company]?.[capability]);
}

/** Companies the user can open at all (any capability), in catalogue order. */
export function visibleCompanies(access: TpzAccess): string[] {
  return TPZ_COMPANIES.filter((c) => canTpz(access, c.key, "dashboards") || canTpz(access, c.key, "upload") || canTpz(access, c.key, "mis")).map((c) => c.key);
}

export const hasAnyTpzAccess = (access: TpzAccess): boolean => visibleCompanies(access).length > 0;
