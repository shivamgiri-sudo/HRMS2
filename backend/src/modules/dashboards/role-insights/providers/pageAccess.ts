import { rows } from "../helpers.js";
import type { InsightContext } from "../types.js";

/**
 * Which app pages the caller can actually open, so a pending-action link never lands on an
 * "Access restricted" screen. Mirrors the grants the frontend Gate reads: role_page_access
 * (by role) plus user_page_access (per-user, unrevoked, unexpired). super_admin passes every Gate.
 *
 * Only the routes the role dashboards link to are mapped (route -> page code, copied from
 * src/lib/pageRoutePageCodes.ts); a route absent from the map is treated as open to everyone.
 */
export const ROUTE_PAGE_CODE: Readonly<Record<string, string>> = {
  "/ats/candidate-master": "ATS_CANDIDATE_MASTER",
  "/ats/walkin-queue": "ATS_WALKIN_QUEUE",
  "/ats/waiting-queue": "ATS_WAITING_QUEUE",
  "/ats/offer-approvals": "ATS_OFFER_APPROVALS",
  "/ats/bgv": "ATS_BGV",
  "/ats/onboarding-requests": "ATS_ONBOARDING_REQUESTS",
  "/ats/joining-documents-tracker": "ATS_JOINING_DOCUMENTS_TRACKER",
  "/ats/joining-control-room": "ATS_JOINING_CONTROL_ROOM",
  "/ats/command-center": "ATS_DASHBOARD",
  "/ats/sourcing-analysis": "ATS_DASHBOARD",
  "/ats/recruiter/workspace": "ATS_RECRUITER_WORKSPACE",
  "/recruitment/job-requisition": "JOB_REQUISITION",
  "/provisioning/it": "PROVISIONING_IT",
  "/it-provisioning": "IT_PROVISIONING_TRACKER",
  "/assets-manager": "ASSETS_MANAGER",
  "/helpdesk": "HELPDESK",
  "/employees": "EMPLOYEES",
};

type Allowed = Set<string> | "all";
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; pages: Allowed }>();

export async function allowedPageCodes(ctx: Pick<InsightContext, "userId" | "roleKeys">): Promise<Allowed> {
  const roles = [...new Set(ctx.roleKeys.map((r) => r.toLowerCase()))];
  if (roles.includes("super_admin")) return "all";
  const key = `${ctx.userId}|${roles.sort().join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.pages;
  const pages = new Set<string>();
  if (roles.length) {
    const byRole = await rows(
      `SELECT DISTINCT page_code FROM role_page_access
        WHERE can_view = 1 AND active_status = 1 AND LOWER(role_key) IN (${roles.map(() => "?").join(",")})`,
      roles,
    );
    for (const r of byRole) pages.add(String(r.page_code));
  }
  const byUser = await rows(
    `SELECT DISTINCT page_code FROM user_page_access
      WHERE user_id = ? AND can_view = 1 AND active_status = 1 AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [ctx.userId],
  );
  for (const r of byUser) pages.add(String(r.page_code));
  cache.set(key, { at: Date.now(), pages });
  return pages;
}

export function canOpen(allowed: Allowed, href: string): boolean {
  if (allowed === "all") return true;
  const code = ROUTE_PAGE_CODE[href.split("?")[0]];
  return code === undefined ? true : allowed.has(code);
}

/** First candidate route the caller may open; `fallback` (always reachable) when none. */
export function pickHref(allowed: Allowed, candidates: readonly string[], fallback: string): string {
  return candidates.find((href) => canOpen(allowed, href)) ?? fallback;
}

/** Test seam: clears the grant cache. */
export function resetPageAccessCache() { cache.clear(); }
