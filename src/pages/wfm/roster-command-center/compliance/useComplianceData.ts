import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { HEAVY_QUERY_OPTIONS, HEAVY_QUERY_TIMEOUT_MS } from "../heavyQuery";
import type { ComplianceSummary, FeedKind, FeedResponse, TrendPoint } from "./types";

export interface FeedFilters { kind: FeedKind; ruleId: string; severity: string; q: string; page: number }
export const FEED_PAGE_SIZE = 50;
export const ALL = "__all__";

const BASE = "/api/wfm/compliance";

/** Summary, trend and feed fire in parallel: the backend shares one cached computation, so there is no waterfall. */
/** `scopeQs` is the shared branch/process/lob query string built with scopeParams(). */
export function useComplianceData(scopeQs: string, month: string, feed: FeedFilters, consume: (key: string) => boolean) {
  const params = (extra: Record<string, string> = {}, key?: string) => {
    const p = new URLSearchParams(scopeQs);
    p.set("period", month);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    if (key && consume(key)) p.set("refresh", "1");
    return p;
  };
  const summary = useQuery({
    queryKey: ["compliance", "summary", scopeQs, month],
    queryFn: ({ signal }) => hrmsApi.get<ComplianceSummary>(`${BASE}/summary?${params({}, "summary")}`, HEAVY_QUERY_TIMEOUT_MS, signal),
    ...HEAVY_QUERY_OPTIONS,
  });
  const trend = useQuery({
    queryKey: ["compliance", "trend", scopeQs, month],
    queryFn: async ({ signal }) => (await hrmsApi.get<{ trend: TrendPoint[] }>(`${BASE}/trend?${params({}, "trend")}`, HEAVY_QUERY_TIMEOUT_MS, signal))?.trend ?? [],
    ...HEAVY_QUERY_OPTIONS,
  });
  const violations = useQuery({
    queryKey: ["compliance", "violations", scopeQs, month, feed],
    queryFn: ({ signal }) => {
      const extra: Record<string, string> = { kind: feed.kind, page: String(feed.page), pageSize: String(FEED_PAGE_SIZE) };
      if (feed.ruleId !== ALL) extra.ruleId = feed.ruleId;
      if (feed.severity !== ALL) extra.severity = feed.severity;
      if (feed.q.trim()) extra.q = feed.q.trim();
      return hrmsApi.get<FeedResponse>(`${BASE}/violations?${params(extra, "violations")}`, HEAVY_QUERY_TIMEOUT_MS, signal);
    },
    ...HEAVY_QUERY_OPTIONS,
    placeholderData: keepPreviousData,
  });
  return { summary, trend, violations };
}
