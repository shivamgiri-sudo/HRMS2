/**
 * Runs Mira issue-triage over every pending MIRA_FEEDBACK work_item that hasn't been triaged
 * yet. See src/modules/ai/mira-issue-triage.service.ts for the full design rationale — two
 * independent safety layers before anything reaches an AI provider, no code generation, no
 * git operations, no status changes; every outcome (including rejections) is written as a
 * work_item_audit_log entry a human sees in the existing Work Inbox.
 *
 * SAFE TO RUN REPEATEDLY: findUntriagedMiraFeedback() only returns items with no existing
 * 'mira_ai_triage' audit row, so re-running only processes genuinely new complaints.
 *
 * Usage: npx tsx scripts/mira-issue-triage-run.ts
 */
import { db } from "../src/db/mysql.js";
import { findUntriagedMiraFeedback, triageWorkItem } from "../src/modules/ai/mira-issue-triage.service.js";

(async () => {
  const items = await findUntriagedMiraFeedback();
  console.log(`untriaged MIRA_FEEDBACK items: ${items.length}`);
  if (!items.length) { console.log("nothing to do"); await db.end(); return; }

  const counts: Record<string, number> = {};
  for (const item of items) {
    const outcome = await triageWorkItem(item.id, item.description);
    counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
    console.log(`  ${item.id}: ${outcome.status}`);
  }

  console.log(`\nsummary:`, JSON.stringify(counts, null, 2));
  await db.end();
})().catch(async (e) => {
  console.error("ERR", e?.message ?? e);
  try { await db.end(); } catch { /* ignore */ }
  process.exit(1);
});
