import type { DrillFilters } from "@/hooks/useAtsDashboards";

/** Pure logic for the Candidates & Controls tab. */
export interface HealthCheck { name?: string; type?: string; ok?: boolean; count?: number; detail?: string }

export type CategoryKey = "data_integrity" | "sla" | "notification" | "integration" | "schema" | "other";
export const CATEGORY_ORDER: { key: CategoryKey; title: string; hint: string }[] = [
  { key: "data_integrity", title: "Data integrity", hint: "Gaps and inconsistencies in candidate records" },
  { key: "sla", title: "SLA compliance", hint: "Candidates left open too long" },
  { key: "notification", title: "Notifications", hint: "Whether emails are actually delivered" },
  { key: "integration", title: "Integrations", hint: "Recruiter contacts and templates" },
  { key: "schema", title: "Schema", hint: "Deployment probes: required tables and columns exist" },
  { key: "other", title: "Other", hint: "Checks with an unrecognised category" },
];

export function categoryOf(c: HealthCheck): CategoryKey {
  const t = String(c.type ?? "").toLowerCase();
  if (t === "schema" || t.startsWith("schema")) return "schema";
  if (CATEGORY_ORDER.some((k) => k.key === t && t !== "other")) return t as CategoryKey;
  return "other";
}

export interface CategoryGroup { key: CategoryKey; title: string; hint: string; items: HealthCheck[]; failed: number }
export function groupChecks(checks: HealthCheck[]): CategoryGroup[] {
  return CATEGORY_ORDER.map((c) => {
    const items = checks.filter((x) => categoryOf(x) === c.key);
    return { ...c, items, failed: items.filter((x) => !x.ok).length };
  }).filter((g) => g.items.length > 0);
}

/** Passing share 0..100 (rounded), or null when there is nothing to score (never NaN). */
export function healthScore(checks: HealthCheck[]): number | null {
  return checks.length ? Math.round((checks.filter((c) => c.ok).length / checks.length) * 100) : null;
}

export function scoreTone(score: number | null): "good" | "warn" | "bad" | "none" {
  return score == null ? "none" : score === 100 ? "good" : score >= 80 ? "warn" : "bad";
}

/** "open_queue_beyond_7_days" -> "Open queue beyond 7 days" */
export const checkLabel = (name?: string) => {
  const s = String(name ?? "").replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unnamed check";
};

export interface CheckDrill { label: string; crumb: string; filters: DrillFilters; note?: string }

/**
 * Failing checks that map cleanly onto a candidate filter. Idle filters bucket by days since last update (not arrival),
 * so they are the closest available view and are labelled as such. Anything not listed has no drill.
 */
export function drillsForCheck(c: HealthCheck): CheckDrill[] {
  if (c.ok) return [];
  switch (c.name) {
    case "candidates_without_branch":
      return [{ label: "View candidates", crumb: "Candidates without branch", filters: { branch: "Unspecified" } }];
    case "open_queue_beyond_7_days":
      return [
        { label: "Idle 8-14 days", crumb: "Open and idle 8-14 days", filters: { idle: "8-14d" }, note: "closest filter" },
        { label: "Idle 15+ days", crumb: "Open and idle 15+ days", filters: { idle: "15d+" }, note: "closest filter" },
      ];
    case "open_queue_beyond_30_days":
      return [{ label: "Idle 15+ days", crumb: "Open and idle 15+ days", filters: { idle: "15d+" }, note: "closest filter" }];
    default:
      return [];
  }
}

/** Distinguish "your role cannot see this" from a real failure. */
export function isForbidden(status: number | null, message?: string): boolean {
  return status === 403 || /forbidden|not authori[sz]ed|insufficient|permission/i.test(message ?? "");
}

/* ───── recent viewed (localStorage) ───── */
export interface RecentCandidate { id: string; name: string; code?: string; status?: string }
export const RECENT_KEY = "ats-cc-recent-candidates";
export const RECENT_MAX = 8;

export function pushRecent(list: RecentCandidate[], c: RecentCandidate): RecentCandidate[] {
  return [c, ...list.filter((x) => x.id !== c.id)].slice(0, RECENT_MAX);
}
type Store = Pick<Storage, "getItem" | "setItem">;
const defaultStore = (): Store | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

export function loadRecent(store: Store | null = defaultStore()): RecentCandidate[] {
  try {
    const raw = store?.getItem(RECENT_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string" && typeof x.name === "string").slice(0, RECENT_MAX) : [];
  } catch { return []; }
}
export function saveRecent(list: RecentCandidate[], store: Store | null = defaultStore()): void {
  try { store?.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* storage unavailable */ }
}
