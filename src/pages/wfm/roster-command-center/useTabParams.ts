/**
 * URL-synced per-tab filter state for the Roster Command Center. Tab-local filters (month, week,
 * search, sub-tab…) live in the query string next to the shared scope filters, so a refresh or a
 * shared link restores them. Values equal to their default are omitted from the URL.
 */
import { useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/** Every tab-local key. The shell clears these on tab change so one tab's filters never leak into another. */
export const TAB_LOCAL_PARAMS = [
  "sub", "week", "period", "month", "date", "q",
  "kind", "rule", "sev", "status", "change", "source", "runStatus", "tier", "owner",
] as const;

export type TabParamKey = (typeof TAB_LOCAL_PARAMS)[number];
type Defaults = Partial<Record<TabParamKey, string>>;

export function clearTabLocalParams(prev: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(prev);
  for (const k of TAB_LOCAL_PARAMS) next.delete(k);
  return next;
}

/** Returns the current values (URL value or default) and a `set` that applies several keys in one update. */
export function useTabParams<D extends Defaults>(defaults: D) {
  const [params, setParams] = useSearchParams();
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const values = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, d] of Object.entries(defaultsRef.current)) out[k] = params.get(k) ?? (d as string);
    return out as { [K in keyof D]: string };
  }, [params]);

  const set = useCallback(
    (patch: { [K in keyof D]?: string }) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            const d = (defaultsRef.current as Record<string, string>)[k];
            if (v === undefined || v === d || v === "") next.delete(k);
            else next.set(k, v as string);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return [values, set] as const;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Use a URL value only if it is one of the allowed options; otherwise the fallback. */
export const pickOne = <T extends string>(v: string, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
export const pickMonth = (v: string, fallback: string) => (MONTH_RE.test(v) ? v : fallback);
export const pickDay = (v: string, fallback: string) => (DAY_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : fallback);
