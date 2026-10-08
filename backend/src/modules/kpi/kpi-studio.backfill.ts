/**
 * KPI Studio — compute a range of days.
 *
 * computeStudioKpis handles one date per call, and the nightly worker only ever runs "yesterday". So a feed that
 * was off for three weeks could only be refilled by somebody running a script on the server. This runs the same
 * single-day compute for each day of a range, one at a time (each day reads every source; running them in parallel
 * would multiply load on a shared database), and reports progress per day.
 *
 * Jobs live in memory: a restart forgets them, and the response says what each day did, so nothing is lost that
 * the stored values themselves do not already show. One job at a time, company-wide.
 */
import { randomUUID } from 'crypto';
import { computeStudioKpis, resetFieldNameCache, type ComputeOutcome } from './kpi-studio.compute.js';

export const MAX_RANGE_DAYS = 62;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KEEP = 20;

export interface BackfillDay {
  date: string; status: 'pending' | 'running' | 'done' | 'failed';
  written?: number; no_data?: number; errors?: number; source_failures?: Array<{ source_code: string; error: string }>;
  message?: string; seconds?: number;
}
export interface BackfillJob {
  id: string; from: string; to: string; processId: string | null; branchId: string | null; dryRun: boolean;
  status: 'running' | 'done' | 'failed' | 'cancelled'; startedBy: string | null; startedAt: string; finishedAt: string | null;
  days: BackfillDay[];
}
export interface BackfillInput { from: string; to: string; processId?: string | null; branchId?: string | null; dryRun: boolean }

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Every date from..to inclusive (local calendar). Throws a readable error for a bad or oversized range. */
export function daysInRange(from: string, to: string, today = new Date()): string[] {
  if (!ISO.test(from) || !ISO.test(to)) throw new Error('Dates must be YYYY-MM-DD');
  if (from > to) throw new Error('The start date is after the end date');
  if (to > ymd(today)) throw new Error('The end date is in the future');
  const [y, m, d] = from.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < MAX_RANGE_DAYS; i++) {
    const day = ymd(new Date(y, m - 1, d + i));
    out.push(day);
    if (day === to) return out;
  }
  throw new Error(`A range can cover at most ${MAX_RANGE_DAYS} days. Run it in parts.`);
}

const jobs = new Map<string, BackfillJob>();
let cancelRequested = new Set<string>();
type ComputeFn = (o: { date: string; processId?: string; branchId?: string; dryRun: boolean }) => Promise<ComputeOutcome>;

export const runningJob = (): BackfillJob | null => [...jobs.values()].find((j) => j.status === 'running') ?? null;
export const getBackfill = (id: string): BackfillJob | null => jobs.get(id) ?? null;
export const listBackfills = (): BackfillJob[] => [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, KEEP);
export function cancelBackfill(id: string): BackfillJob | null {
  const j = jobs.get(id);
  if (j && j.status === 'running') cancelRequested.add(id);
  return j ?? null;
}
/** Test hook. */
export function resetBackfills(): void { jobs.clear(); cancelRequested = new Set(); }

/**
 * Starts a range job and returns it immediately; days run in the background. `compute` is injectable for tests.
 * Returns the job's promise too so tests can await completion.
 */
export function startBackfill(input: BackfillInput, userId: string | null, compute: ComputeFn = computeStudioKpis as ComputeFn): { job: BackfillJob; done: Promise<void> } {
  const dates = daysInRange(input.from, input.to);
  const busy = runningJob();
  if (busy) throw new Error(`Another range is already being computed (${busy.from} to ${busy.to}). Wait for it to finish.`);
  const job: BackfillJob = {
    id: randomUUID(), from: input.from, to: input.to, processId: input.processId ?? null, branchId: input.branchId ?? null,
    dryRun: input.dryRun, status: 'running', startedBy: userId, startedAt: new Date().toISOString(), finishedAt: null,
    days: dates.map((date) => ({ date, status: 'pending' })),
  };
  jobs.set(job.id, job);
  if (jobs.size > KEEP) { const oldest = listBackfills().at(-1); if (oldest && oldest.status !== 'running') jobs.delete(oldest.id); }

  const done = (async () => {
    for (const day of job.days) {
      if (cancelRequested.has(job.id)) { job.status = 'cancelled'; break; }
      day.status = 'running';
      const t0 = Date.now();
      try {
        // A field added since the last run must be seen; the cache otherwise lives for the life of the server.
        resetFieldNameCache();
        const o = await compute({ date: day.date, processId: job.processId ?? undefined, branchId: job.branchId ?? undefined, dryRun: job.dryRun });
        Object.assign(day, { status: 'done', written: o.written, no_data: o.no_data, errors: o.errors, source_failures: o.source_failures.slice(0, 10) });
      } catch (e) {
        Object.assign(day, { status: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
      day.seconds = Math.round((Date.now() - t0) / 1000);
    }
    if (job.status === 'running') job.status = job.days.every((d) => d.status === 'failed') ? 'failed' : 'done';
    job.finishedAt = new Date().toISOString();
    cancelRequested.delete(job.id);
  })();
  return { job, done };
}
