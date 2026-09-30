/**
 * The command centre reads up to 25,000 candidate rows and sorts them by COALESCE(created_date,
 * created_at) - ~43 s on production 2026-09-30 while the database was under load, longer than the
 * browser's 30 s abort. The abort does not stop the query, so every retry started another copy.
 * Concurrent identical requests now share ONE computation, and a finished result is reused for
 * 30 s, so a retry after an aborted first load is answered from the finished result instead of
 * starting the query again. Failures are never cached. The key includes the actor and scope.
 */
export const COMMAND_CENTER_TTL_MS = 30_000;
/**
 * After the 30 s fresh window, a cached result up to this old is still returned IMMEDIATELY while one refresh runs in the
 * background (stale-while-revalidate). Before, every visitor after 30 s waited for the whole 10-43 s computation, and
 * that wait is what ran past the browser's 30 s abort. Only a result older than this (or none) makes a request wait.
 * The payload carries its own refreshTime, and queue waiting-times are as of that moment.
 */
export const COMMAND_CENTER_STALE_MS = 5 * 60_000;
const COMMAND_CENTER_CACHE_MAX = 200;
export const commandCenterCache = new Map<string, { at: number; value: Record<string, unknown> }>();

export function commandCenterCacheKey(
  actorId: string | undefined,
  bypassScope: boolean,
  query: Record<string, unknown>,
): string {
  const filters = Object.keys(query).sort().map((k) => [k, query[k]]);
  // A scope-bypassing actor (super admin, hr, ceo) sees every row, and buildCandidateFilters only consults actorId when
  // scope is NOT bypassed, so their result does not depend on who asks. They share one entry; scoped actors stay per-user.
  return `cc:${JSON.stringify([bypassScope ? "*" : (actorId ?? ""), bypassScope, filters])}`;
}

export function pruneCommandCenterCache(): void {
  if (commandCenterCache.size <= COMMAND_CENTER_CACHE_MAX) return;
  const oldest = [...commandCenterCache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [k] of oldest.slice(0, commandCenterCache.size - COMMAND_CENTER_CACHE_MAX)) commandCenterCache.delete(k);
}

/** The key of the page's default request (period=ALL, no filters) as made by any scope-bypassing user. Used by the boot warm-up. */
export const DEFAULT_WIDE_VIEW_KEY = commandCenterCacheKey(undefined, true, { period: "ALL" });
