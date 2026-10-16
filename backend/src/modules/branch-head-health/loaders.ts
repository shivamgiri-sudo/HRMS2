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

// Branch-level data is the same for every authorised head; callers must check scope before using these.
const reportCache = new TtlCache<Report>(TTL_MS, 64);
const opsCache = new TtlCache<Ops>(TTL_MS, 64);
const pnlCache = new TtlCache<SectionResult<ProcessPnlData>>(TTL_MS, 64);

export function clearBranchHeadHealthCaches(): void { reportCache.clear(); opsCache.clear(); pnlCache.clear(); }

const keyOf = (branch: HeadBranch, date: string) => `${branch.branchId}|${date}`;

export function getReportCached(branch: HeadBranch, date: string): Promise<Report> {
  return cachedOr(reportCache, keyOf(branch, date), () => loadReport(branch, date));
}

export function getOpsCached(
  branch: HeadBranch, processes: BranchProcess[], range: { startDate: string; endDate: string }, date: string,
): Promise<Ops> {
  return cachedOr(
    opsCache, keyOf(branch, date), () => buildOpsSections(processes, range),
    (v) => v.operations.status !== "error" && v.quality.status !== "error" && v.callmaster.status !== "error",
  );
}

/** P&L with a 30 s caller timeout; the load keeps running and fills the cache for the next request. `noTimeout` is for the warmer. */
export function getPnlCached(branch: HeadBranch, date: string, opts: { noTimeout?: boolean } = {}): Promise<SectionResult<ProcessPnlData>> {
  const load = () => buildProcessPnl(branch, date);
  const cacheable = (v: SectionResult<ProcessPnlData>) => v.status !== "error";
  const key = keyOf(branch, date);
  if (opts.noTimeout) return cachedOr(pnlCache, key, load, cacheable);
  return cachedOrWithin(pnlCache, key, load, cacheable, PNL_TIMEOUT_MS, () => ({
    status: "error", data: null, asOf: date, message: STILL_CALCULATING,
  }));
}
