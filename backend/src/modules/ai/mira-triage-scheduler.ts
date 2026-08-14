/**
 * In-process scheduler that periodically runs Mira issue triage over any pending
 * MIRA_FEEDBACK work_items that haven't been triaged yet.
 *
 * WHY THIS EXISTS
 * findUntriagedMiraFeedback() + triageWorkItem() were only reachable through
 * backend/scripts/mira-issue-triage-run.ts (a manual `npx tsx` invocation). Nothing in
 * the running server ever called them, so complaints accumulated in work_item indefinitely
 * without a diagnosis — making the "Draft a fix" button in the Work Inbox permanently
 * unusable.
 *
 * SAFETY
 * Both safety layers from the triage service still run on every item (validateQuestion +
 * checkDomainSafety). This scheduler adds no new bypass paths; it is purely a trigger.
 *
 * IDEMPOTENCY
 * findUntriagedMiraFeedback() only returns items with no 'mira_ai_triage' audit row, so
 * re-runs on the same item never happen regardless of how often the scheduler fires.
 *
 * INTEGRATION WITH GRACEFUL SHUTDOWN
 * The returned handle is registered with worker-utils.registerTimer so clearAllTimers()
 * (called from server.ts gracefulShutdown) covers it automatically.
 */
import { findUntriagedMiraFeedback, triageWorkItem } from './mira-issue-triage.service.js';
import { registerTimer } from '../../workers/worker-utils.js';

const SCHEDULER_NAME = 'mira-triage-scheduler';

/**
 * Runs one triage pass: find all untriaged MIRA_FEEDBACK items and triage each in turn.
 * Errors on individual items are caught and logged so a single bad complaint cannot
 * stop the rest from being processed.
 */
export async function runTriagePass(): Promise<Record<string, number>> {
  const items = await findUntriagedMiraFeedback();
  if (!items.length) return {};

  const counts: Record<string, number> = {};
  for (const item of items) {
    try {
      const outcome = await triageWorkItem(item.id, item.description);
      counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
    } catch (err) {
      counts['error'] = (counts['error'] ?? 0) + 1;
      console.error(`[mira-triage] item ${item.id} threw:`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[mira-triage] processed ${items.length} item(s):`, JSON.stringify(counts));
  return counts;
}

/**
 * Starts the in-process Mira triage scheduler. Fires an initial pass immediately
 * (so the first batch is triaged without waiting a full interval), then continues
 * every intervalMs.
 *
 * @param intervalMs  How often to check for untriaged complaints. Defaults to 15 min.
 * @returns  The interval handle (also registered with registerTimer for shutdown).
 */
export function startMiraTriageScheduler(intervalMs = 15 * 60 * 1_000): NodeJS.Timeout {
  // Run once immediately on startup so untriaged items from before a restart are
  // processed without waiting a full interval.
  runTriagePass().catch((err) =>
    console.error('[mira-triage] initial pass error:', err instanceof Error ? err.message : String(err)),
  );

  const handle = setInterval(() => {
    runTriagePass().catch((err) =>
      console.error('[mira-triage] scheduled pass error:', err instanceof Error ? err.message : String(err)),
    );
  }, intervalMs);

  registerTimer(SCHEDULER_NAME, handle);
  console.log(`[mira-triage] scheduler started (interval: ${intervalMs / 1000}s)`);
  return handle;
}
