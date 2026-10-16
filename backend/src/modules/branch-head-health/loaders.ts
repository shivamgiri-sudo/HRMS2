import { createHash } from "crypto";
import { TtlCache, cachedOr, cachedOrWithin, STILL_CALCULATING } from "./cache.js";
import { loadReport } from "./overview.js";
import { buildOpsSections } from "./ops.js";
import { buildProcessPnl } from "./pnl.js";
import type { HeadBranch } from "./scope.js";
import type { BranchProcess } from "./processes.js";
import type { ProcessPnlData, SectionResult } from "./types.js";

export const TTL_MS = 300_000;
export const PNL_TIMEOUT_MS = 30_000;
export { STILL_CALCULATING };


type Report = Awaited<ReturnType<typeof loadReport>>;
type Ops = Awaited<ReturnType<typeof buildOpsSections>>;

/** The warmer reloads entries older than TTL - margin so 5-minute entries stay warm across a 4-minute tick. */
export const REFRESH_MARGIN_MS = 90_000;
const REFRESH_AFTER_MS = TTL_MS - REFRESH_MARGIN_MS;
export interface LoadOpts { warm?: boolean }
const refreshOpts = (o: LoadOpts) => (o.warm ? { refreshIfOlderThanMs: REFRESH_AFTER_MS } : {});

// Branch-level data is the same for every authorised head; callers must check scope before using these.
const reportCache = new TtlCache<Report>(TTL_MS, 64);
const opsCache = new TtlCache<Ops>(TTL_MS, 64);
const opsSectionCache = new TtlCache<SectionResult<any>>(TTL_MS, 256);
const pnlCache = new TtlCache<SectionResult<ProcessPnlData>>(TTL_MS, 64);
// branchId|date -> full ops cache key (which also carries the process-list hash).
const opsKeyIndex = new Map<string, string>();

export function clearBranchHeadHealthCaches(): void {
  reportCache.clear(); opsCache.clear(); opsSectionCache.clear(); pnlCache.clear(); opsKeyIndex.clear();
}

const keyOf = (branch: HeadBranch, date: string) => `${branch.branchId}|${date}`;
const processHash = (ps: BranchProcess[]) =>
  createHash("sha1").update(ps.map((p) => p.processId).sort().join(",")).digest("hex").slice(0, 8);

export function getReportCached(branch: HeadBranch, date: string, o: LoadOpts = {}): Promise<Report> {
  return cachedOr(reportCache, keyOf(branch, date), () => loadReport(branch, date), () => true, refreshOpts(o));
}

/** True when this branch's ops entry exists and is young enough that a warm pass would not refresh it. */
export function isOpsFresh(branch: HeadBranch, date: string): boolean {
  const full = opsKeyIndex.get(keyOf(branch, date));
  const age = full ? opsCache.ageMs(full) : undefined;
  return age !== undefined && age <= REFRESH_AFTER_MS;
}

export function getOpsCached(
  branch: HeadBranch, processes: BranchProcess[], range: { startDate: string; endDate: string }, date: string, o: LoadOpts = {},
): Promise<Ops> {
  const base = `${keyOf(branch, date)}|${processHash(processes)}`;
  return cachedOr(
    opsCache, base,
    () => buildOpsSections(processes, range, {
      cache: opsSectionCache, keyBase: base, noTimeout: o.warm, ...refreshOpts(o),
    }),
    (v) => {
      const ok = v.operations.status !== "error" && v.quality.status !== "error" && v.callmaster.status !== "error";
      if (ok) opsKeyIndex.set(keyOf(branch, date), base);
      return ok;
    },
    refreshOpts(o),
  );
}

/** P&L with a 30 s caller timeout; the load keeps running and fills the cache for the next request. `warm` is for the warmer (no timeout). */
export function getPnlCached(branch: HeadBranch, date: string, o: LoadOpts = {}): Promise<SectionResult<ProcessPnlData>> {
  const load = () => buildProcessPnl(branch, date);
  const cacheable = (v: SectionResult<ProcessPnlData>) => v.status !== "error";
  const key = keyOf(branch, date);
  if (o.warm) return cachedOr(pnlCache, key, load, cacheable, refreshOpts(o));
  return cachedOrWithin(pnlCache, key, load, cacheable, PNL_TIMEOUT_MS, () => ({
    status: "error", data: null, asOf: date, message: STILL_CALCULATING,
  }));
}
