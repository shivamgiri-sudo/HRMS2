/**
 * The command centre reads up to 25,000 candidate rows and sorts them by COALESCE(created_date,
 * created_at) - ~43 s on production 2026-09-30 while the database was under load, longer than the
 * browser's 30 s abort. The abort does not stop the query, so every retry started another copy.
 * Concurrent identical requests now share ONE computation, and a finished result is reused for
 * 30 s, so a retry after an aborted first load is answered from the finished result instead of
 * starting the query again. Failures are never cached. The key includes the actor and scope.
 */
export const COMMAND_CENTER_TTL_MS = 30_000;
const COMMAND_CENTER_CACHE_MAX = 200;
export const commandCenterCache = new Map<string, { at: number; value: Record<string, unknown> }>();

export function commandCenterCacheKey(
  actorId: string | undefined,
  bypassScope: boolean,
  query: Record<string, unknown>,
): string {
  const filters = Object.keys(query).sort().map((k) => [k, query[k]]);
  return `cc:${JSON.stringify([actorId ?? "", bypassScope, filters])}`;
}

export function pruneCommandCenterCache(): void {
  if (commandCenterCache.size <= COMMAND_CENTER_CACHE_MAX) return;
  const oldest = [...commandCenterCache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [k] of oldest.slice(0, commandCenterCache.size - COMMAND_CENTER_CACHE_MAX)) commandCenterCache.delete(k);
}
