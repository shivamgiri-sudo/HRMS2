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
import type { RowDataPacket } from 'mysql2';
import { findUntriagedMiraFeedback, triageWorkItem } from './mira-issue-triage.service.js';
import { generateFixDraftForWorkItem } from './mira-fix-draft-generate.service.js';
import { registerTimer } from '../../workers/worker-utils.js';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';

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

  // Stage 2 of the same pass: turn the diagnoses just written into candidate diffs.
  //
  // Without this, drafting only ever happened when a super_admin clicked the button — which
  // is why mira_fix_draft held zero rows on 2026-08-14 despite two complaints being eligible
  // for months. The chain was built end to end and then never actually driven.
  //
  // Arming is separate from triage on purpose: drafting costs an LLM call per eligible item,
  // so MIRA_AUTO_DRAFT_ENABLED defaults to false. Arm this first and read what it produces;
  // MIRA_AUTO_DEPLOY_ENABLED (mira-fix-deploy.service.ts) is the second, larger decision and
  // is independent — drafting can run for weeks with nothing shipping.
  if (env.MIRA_AUTO_DRAFT_ENABLED) {
    const drafted = await runDraftPass();
    if (Object.keys(drafted).length) counts.drafted_outcomes = Object.values(drafted).reduce((a, b) => a + b, 0);
  }

  return counts;
}

/**
 * Attempts a fix draft for every eligible triaged complaint that does not already have one.
 *
 * Eligibility is decided inside generateFixDraftForWorkItem (genuine_bug + actionable=true);
 * this only filters out items that already have a draft, so a re-run never spends a second
 * LLM call on a complaint that has already been attempted. That check is the idempotency
 * property the triage half gets for free from its audit row, and it has to be explicit here
 * because a draft row is not written when the model declines.
 */
export async function runDraftPass(): Promise<Record<string, number>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT wi.id
       FROM work_item wi
      WHERE wi.item_type = 'MIRA_FEEDBACK'
        AND EXISTS (SELECT 1 FROM work_item_audit_log al
                     WHERE al.work_item_id = wi.id AND al.action = 'mira_ai_triage'
                       AND al.remarks LIKE 'AI-drafted diagnosis%')
        AND NOT EXISTS (SELECT 1 FROM mira_fix_draft fd WHERE fd.work_item_id = wi.id)
      ORDER BY wi.created_at ASC`,
  );
  const counts: Record<string, number> = {};
  for (const row of rows as RowDataPacket[]) {
    try {
      const outcome = await generateFixDraftForWorkItem(String(row.id));
      counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
    } catch (err) {
      counts['error'] = (counts['error'] ?? 0) + 1;
      console.error(`[mira-draft] item ${row.id} threw:`, err instanceof Error ? err.message : String(err));
    }
  }
  if (rows.length) console.log(`[mira-draft] attempted ${rows.length} draft(s):`, JSON.stringify(counts));
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
