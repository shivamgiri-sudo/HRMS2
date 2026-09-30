import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { HEAVY_QUERY_OPTIONS, HEAVY_QUERY_TIMEOUT_MS } from "../heavyQuery";

const BASE = "/api/roster-analytics/trends";

/**
 * One GET against the Trends & Publish endpoints. `qs` is the already-built query string
 * (scopeParams output + endpoint-specific params) so it doubles as the cache key and every
 * filter change refetches, while keepPreviousData stops the panel blanking between filters.
 */
export function useTrends<T>(name: string, path: string, qs: string, enabled = true) {
  return useQuery<T>({
    queryKey: ["rcc-trends", name, qs],
    queryFn: ({ signal }) => hrmsApi.get<T>(`${BASE}/${path}?${qs}`, HEAVY_QUERY_TIMEOUT_MS, signal),
    enabled,
    ...HEAVY_QUERY_OPTIONS,
  });
}

/** Query string for a drawer request: the shared scope + range plus one extra param. */
export function withParam(qs: string, key: string, value: string): string {
  const p = new URLSearchParams(qs);
  p.set(key, value);
  return p.toString();
}
