/**
 * Phase 1 of the missing second half of Mira issue-triage: record-keeping and the
 * server-side safety gate for AI-drafted fix diffs. See mira-fix-draft-guard.ts for the
 * deny-list itself and 1135_mira_fix_draft.sql for the table this writes to.
 *
 * WHAT IS AND IS NOT BUILT YET
 *
 * This service can record a fix draft and gate it through checkFixDraftSafety(). It does
 * NOT generate diffs — no LLM call exists here yet — and there is no route calling this
 * service, no UI showing its output, and no deploy path. A draft only reaches this table
 * today if something outside this file constructs a diff and calls createFixDraft()
 * directly (e.g. from a test, or manually while Phase 2 is being built). Reported live
 * 2026-08-13: a super_admin asked what execution happens after a triage diagnosis, and
 * the honest answer was "nothing yet" — this file is the first half of closing that gap,
 * not the whole thing. See mira-fix-draft-guard.ts for what remains before any diff of
 * this service's making could ever reach a deploy button.
 */
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import { checkFixDraftSafety, extractTouchedFiles } from './mira-fix-draft-guard.js';

export type FixDraftStatus = 'drafted' | 'rejected' | 'deploying' | 'deployed' | 'failed';

export interface FixDraft {
  id: string;
  workItemId: string;
  status: FixDraftStatus;
  targetFiles: string[];
  diffText: string;
  model: string | null;
  safetyFlags: string[] | null;
  rejectedReason: string | null;
  createdAt: string;
}

/**
 * Records a candidate fix diff against a triaged work_item and runs it through the
 * deny-list before it is ever stored as 'drafted'. A diff that fails the deny-list is
 * still recorded — as 'rejected', with the reason — so there is an auditable record of
 * what the engine attempted and why it did not go further, rather than silently
 * discarding it.
 */
export async function createFixDraft(params: {
  workItemId: string;
  diffText: string;
  model?: string;
}): Promise<FixDraft> {
  const { workItemId, diffText, model } = params;
  const guardResult = checkFixDraftSafety(diffText);
  const targetFiles = extractTouchedFiles(diffText);
  const id = randomUUID();
  const status: FixDraftStatus = guardResult.safe ? 'drafted' : 'rejected';
  const rejectedReason = guardResult.safe
    ? null
    : guardResult.deniedFiles.map((d) => `${d.file}: ${d.reason}`).join('; ').slice(0, 500);
  const safetyFlags = guardResult.safe ? null : JSON.stringify(guardResult.deniedFiles);

  await db.execute(
    `INSERT INTO mira_fix_draft (id, work_item_id, status, target_files, diff_text, model, safety_flags, rejected_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [id, workItemId, status, JSON.stringify(targetFiles), diffText, model ?? null, safetyFlags, rejectedReason],
  );

  return {
    id,
    workItemId,
    status,
    targetFiles,
    diffText,
    model: model ?? null,
    safetyFlags: guardResult.safe ? null : guardResult.deniedFiles.map((d) => `${d.file}: ${d.reason}`),
    rejectedReason,
    createdAt: new Date().toISOString(),
  };
}
