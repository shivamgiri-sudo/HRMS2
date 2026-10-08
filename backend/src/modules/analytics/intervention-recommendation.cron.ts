/**
 * Retention Intervention Recommendation — scheduler.
 *
 * Root-cause context: intervention-recommendation.service.ts's
 * generateRecommendationsForEmployee() is a complete, real, per-employee rules
 * engine (see that file's RULES array) that upserts into
 * employee_retention_recommendation — but before this file existed, nothing in
 * the codebase ever called it. No route, no cron, no worker. The Interventions
 * tab's backing table was empty in production not because of a data gap, but
 * because the engine that would fill it had never been wired to run. This file
 * is that wiring, built to the same shape as the other D-1-style self-rearming
 * schedulers already established in this codebase (see
 * modules/management/daily-brief/daily-brief.cron.ts, whose header this one
 * mirrors) — not node-cron: compute ms until the next HH:mm, setTimeout,
 * unref, reschedule in the finally.
 *
 * Population targeted: HIGH+CRITICAL risk-tier active employees only (via
 * predictive-attrition.service.ts's getAtRiskEmployeeIds, minScore=55 —
 * reusing its existing scoring formula rather than duplicating it), not every
 * active employee. Most of RULES' conditions only ever fire for genuinely
 * at-risk signals (quality free-fall, PIP + decline, sub-75% attendance,
 * etc.) — generating for the full active workforce (992 as of 2026-09-12)
 * would mostly write rows with an empty recommendations array, cluttering
 * getPendingInterventions's output for no benefit, at needless DB cost.
 *
 * ENV GATES, same convention as daily-brief.cron.ts (stays off by default —
 * no schema change needed for env.ts, matches ATS_REMINDERS_ENABLED/
 * MANAGER_DAILY_BRIEF_ENABLED precedent):
 *   - INTERVENTION_RECOMMENDATIONS_ENABLED: must be exactly "true", else
 *     startInterventionRecommendationScheduler() is a no-op.
 *   - INTERVENTION_RECOMMENDATIONS_TIME: "HH:mm" host-local, defaults to
 *     "10:00" — after the 09:30 daily-brief run and its own dependency chain
 *     (attendance finalize 23:00 D-1 -> reconciliation 02:00 -> business
 *     action syncs up to 09:00 -> daily brief 09:30), so the attendance/
 *     quality signals this engine reads are as fresh as the rest of the
 *     morning batch chain. An unparseable value silently falls back to the
 *     default rather than crashing the scheduler.
 *
 * SECOND PRE-EXISTING BUG FOUND WHILE WIRING THIS UP, WORKED AROUND HERE:
 * generateRecommendationsForEmployee's own doc comment claims its INSERT
 * "upserts" and refreshes an existing row "on duplicate (same employee_id +
 * calendar date)" — but a live schema check
 * (information_schema.STATISTICS on employee_retention_recommendation) shows
 * only a non-unique index on employee_id, no unique/primary constraint
 * covering it at all. Its `id` is always a fresh uuidv4(), so
 * `ON DUPLICATE KEY UPDATE` can never fire — every call for the same
 * employee inserts a brand new row rather than refreshing one. Calling it
 * daily for the same ~125 at-risk employees would silently duplicate their
 * pending case every day forever (getPendingInterventions has no dedup
 * either). Not fixed at the source (that would mean either a schema
 * migration or changing pre-existing upsert SQL this session didn't write
 * and hasn't fully audited) — instead, this driver only calls it for a
 * candidate that does NOT already have an open (action_taken=0) case, so a
 * new case is created once, left alone while pending, and only replaced by a
 * fresh one after the existing case is actually resolved (retained/exited)
 * via markInterventionActioned.
 */
import { db as pool } from "../../db/mysql.js";
import { recordWorkerRun } from "../../workers/worker-utils.js";
import { getAtRiskEmployeeIds } from "./predictive-attrition.service.js";
import { generateRecommendationsForEmployee } from "./intervention-recommendation.service.js";

export const WORKER_NAME = "intervention-recommendation-generation";
const DEFAULT_TIME = "10:00";
const MIN_SCORE = 55; // HIGH + CRITICAL tiers only — see file header
const MAX_EMPLOYEES = 300; // bounds worst-case run cost; matches getAtRiskEmployeeIds's own default
const BATCH_SIZE = 5; // mirrors daily-brief.cron.ts's RECIPIENT_BATCH_SIZE — no p-limit dependency exists in this repo

let nextRun: NodeJS.Timeout | undefined;

function isEnabled(): boolean {
  return process.env.INTERVENTION_RECOMMENDATIONS_ENABLED === "true";
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseRunTime(value: string | undefined): { hour: number; minute: number } {
  const raw = value && TIME_PATTERN.test(value) ? value : DEFAULT_TIME;
  const [hourStr, minuteStr] = raw.split(":");
  return { hour: Number(hourStr), minute: Number(minuteStr) };
}

export function millisecondsUntilNextInterventionRecommendationRun(now = new Date()): number {
  const { hour, minute } = parseRunTime(process.env.INTERVENTION_RECOMMENDATIONS_TIME);
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export interface InterventionRecommendationRunSummary {
  candidatesFound: number;
  alreadyOpen: number;
  generated: number;
  failed: number;
}

/**
 * One full run: fetch HIGH+CRITICAL at-risk employee ids, skip anyone who
 * already has an open (action_taken=0) case (see file header — the upsert
 * this calls into cannot dedupe on its own), generate a case for the rest,
 * bounded concurrency, one employee's failure never aborts the rest.
 */
export async function runInterventionRecommendationGeneration(): Promise<InterventionRecommendationRunSummary> {
  const startedAt = Date.now();
  console.log(`[${WORKER_NAME}] run start`);
  await recordWorkerRun(WORKER_NAME, "started", {});

  const summary: InterventionRecommendationRunSummary = {
    candidatesFound: 0,
    alreadyOpen: 0,
    generated: 0,
    failed: 0,
  };

  try {
    const allCandidates = await getAtRiskEmployeeIds(MIN_SCORE, MAX_EMPLOYEES);
    summary.candidatesFound = allCandidates.length;

    const [openRows] = await pool.query<any[]>(
      "SELECT DISTINCT employee_id FROM employee_retention_recommendation WHERE action_taken = 0"
    );
    const openEmployeeIds = new Set(openRows.map((r) => r.employee_id));

    const candidates = allCandidates.filter((c) => !openEmployeeIds.has(c.id));
    summary.alreadyOpen = allCandidates.length - candidates.length;

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const chunk = candidates.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        chunk.map((c) => generateRecommendationsForEmployee(c.id))
      );
      results.forEach((result, idx) => {
        if (result.status === "rejected") {
          summary.failed += 1;
          console.error(
            `[${WORKER_NAME}] employeeId=${chunk[idx]!.id} threw:`,
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          );
          return;
        }
        summary.generated += 1;
      });
    }
  } catch (error) {
    console.error(`[${WORKER_NAME}] run failed`, error instanceof Error ? error.message : String(error));
    await recordWorkerRun(WORKER_NAME, "failed", {
      ...summary,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[${WORKER_NAME}] run end elapsedMs=${elapsedMs} candidates=${summary.candidatesFound} ` +
      `alreadyOpen=${summary.alreadyOpen} generated=${summary.generated} failed=${summary.failed}`
  );
  await recordWorkerRun(WORKER_NAME, "completed", { ...summary, elapsedMs });
  return summary;
}

export function startInterventionRecommendationScheduler(): void {
  if (!isEnabled()) {
    console.log(`[${WORKER_NAME}] disabled (set INTERVENTION_RECOMMENDATIONS_ENABLED=true to enable)`);
    return;
  }
  if (nextRun) return;

  const scheduleNext = () => {
    nextRun = setTimeout(async () => {
      try {
        await runInterventionRecommendationGeneration();
      } catch (error) {
        console.error(`[${WORKER_NAME}] scheduled run failed`, error instanceof Error ? error.message : String(error));
      } finally {
        nextRun = undefined;
        scheduleNext();
      }
    }, millisecondsUntilNextInterventionRecommendationRun());
    nextRun.unref();
  };

  scheduleNext();
  const { hour, minute } = parseRunTime(process.env.INTERVENTION_RECOMMENDATIONS_TIME);
  console.log(
    `[${WORKER_NAME}] scheduled daily at ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  );
}

export function stopInterventionRecommendationScheduler(): void {
  if (!nextRun) return;
  clearTimeout(nextRun);
  nextRun = undefined;
}
