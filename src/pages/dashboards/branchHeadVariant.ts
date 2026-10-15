import type { RoleDashboardVariant } from "./roleDashboardAccess";

/**
 * Decides which variant renders once the backend pilot answer is known.
 * `fallback` is the variant the user would have resolved with the branch head flag off.
 */
export function pickBranchHeadVariant(args: {
  resolved: RoleDashboardVariant;
  enabled: boolean;
  isLoading: boolean;
  fallback: RoleDashboardVariant;
}): "loading" | RoleDashboardVariant {
  if (args.resolved !== "branch_head") return args.resolved;
  if (args.isLoading) return "loading";
  return args.enabled ? args.resolved : args.fallback;
}
