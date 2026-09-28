/**
 * Shared react-query settings for the slow Roster Command Center analytics queries
 * (compliance summary/trend, shift effectiveness, quality correlation, cost impact).
 *
 * - staleTime 120s + keepPreviousData: switching tabs/filters does not blank the UI or refetch instantly.
 * - retry off: a retry of a 10-50s query doubles the load on the shared DB pool.
 * - 120s client timeout (the api client default is 30s, shorter than the slowest cold query).
 * - `refresh=1` is sent only once per explicit Refresh click, so the server bypasses its 180s cache.
 */
import { useCallback, useRef } from "react";
import { keepPreviousData } from "@tanstack/react-query";

export const HEAVY_QUERY_TIMEOUT_MS = 120_000;

export const HEAVY_QUERY_OPTIONS = {
  staleTime: 120_000,
  gcTime: 10 * 60_000,
  placeholderData: keepPreviousData,
  retry: false,
  refetchOnWindowFocus: false,
} as const;

/** Tracks which query keys should send `refresh=1` on their next fetch (one-shot per key). */
export function useRefreshFlags() {
  const pending = useRef<Set<string>>(new Set());
  const mark = useCallback((...keys: string[]) => {
    keys.forEach((k) => pending.current.add(k));
  }, []);
  /** Returns true exactly once after mark(key). */
  const consume = useCallback((key: string) => pending.current.delete(key), []);
  return { mark, consume };
}

export function formatUpdatedAt(dataUpdatedAt: number): string | null {
  if (!dataUpdatedAt) return null;
  return new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function UpdatedStamp({ updatedAt, fetching }: { updatedAt: number; fetching: boolean }) {
  const stamp = formatUpdatedAt(updatedAt);
  if (!stamp && !fetching) return null;
  return (
    <span className="text-xs text-slate-500" aria-live="polite" data-testid="updated-stamp">
      {fetching ? "Updating..." : `Updated ${stamp}`}
    </span>
  );
}

export function SectionSkeleton({ lines = 3, label }: { lines?: number; label: string }) {
  return (
    <div className="animate-pulse space-y-2 py-4" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 rounded bg-slate-200/70" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}
