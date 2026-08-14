/**
 * Closes a Mira complaint against the commit that actually fixed it.
 *
 * The write-back half of /mira-fix. Marks the work_item completed and records an audit row
 * naming the commit, so the Complaint Intelligence page can answer "what happened after the
 * diagnosis" — the question that started this whole thread on 2026-08-13 and had no answer.
 *
 * WHY THIS VERIFIES BEFORE IT WRITES
 *
 * A `git push` here reports success and does not land often enough that it cannot be trusted:
 * it happened twice on 2026-08-14 alone (one silent timeout, one that needed --verbose to
 * land), and a push can also ship a DIFFERENT session's commit from a shared tree. Closing a
 * complaint against a commit that is not on origin/main would mark a live bug fixed and file
 * the evidence for it under a SHA nobody can find — worse than leaving it open, because the
 * next person trusts the record.
 *
 * So the gate is: fetch, then `git merge-base --is-ancestor <sha> origin/main`. Ancestry, not
 * `git show` — a commit is readable locally whether or not it was ever pushed. The commit's
 * own stat is printed before the write so the operator can see what is being credited.
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/mira-close-complaint.ts <workItemId> <commitSha> ["note"]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import type { RowDataPacket } from 'mysql2';
import { db } from '../src/db/mysql.js';

const exec = promisify(execFile);
const REPO_ROOT = resolve(process.cwd(), '..');

async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: REPO_ROOT, timeout: 60_000 });
  return stdout.trim();
}

/** True only if the commit is reachable from origin/main — i.e. it really shipped. */
async function isOnMain(sha: string): Promise<boolean> {
  try {
    await git(['merge-base', '--is-ancestor', sha, 'origin/main']);
    return true; // exit 0
  } catch {
    return false; // exit 1 = not an ancestor; anything else also means "cannot prove it"
  }
}

async function main() {
  const [workItemId, commitSha, note] = process.argv.slice(2);
  if (!workItemId || !commitSha) {
    console.error('Usage: mira-close-complaint.ts <workItemId> <commitSha> ["note"]');
    process.exitCode = 1;
    return;
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, title, status FROM work_item WHERE id = ? AND item_type = 'MIRA_FEEDBACK'`,
    [workItemId],
  );
  const item = (rows as RowDataPacket[])[0];
  if (!item) {
    console.error(`No MIRA_FEEDBACK work item with id ${workItemId}.`);
    process.exitCode = 1;
    return;
  }
  if (item.status === 'completed') {
    console.log(`Already completed — nothing to do. (${item.title})`);
    return;
  }

  await git(['fetch', 'origin', 'main']);
  const full = await git(['rev-parse', commitSha]).catch(() => '');
  if (!full) {
    console.error(`REFUSING: ${commitSha} is not a commit in this repository.`);
    process.exitCode = 1;
    return;
  }
  if (!(await isOnMain(full))) {
    console.error(`REFUSING: ${full.slice(0, 8)} is not an ancestor of origin/main — it has not shipped.`);
    console.error('A push that reported success is not proof. Re-push, confirm the ref moved, then re-run this.');
    process.exitCode = 1;
    return;
  }

  console.log(`Commit verified on origin/main:\n${await git(['show', '--stat', '--oneline', '-s', full])}`);
  console.log(await git(['show', '--stat', '--format=', full]));

  const remarks = `Fixed and shipped as ${full.slice(0, 8)} (verified on origin/main).${note ? ` ${note}` : ''} Closed by mira-close-complaint.`;
  await db.execute(
    `INSERT INTO work_item_audit_log (id, work_item_id, action, from_status, to_status, remarks, performed_by, performed_at)
     VALUES (UUID(), ?, 'mira_fix_shipped', ?, 'completed', ?, 'mira-fix-workflow', NOW())`,
    [workItemId, String(item.status ?? 'pending'), remarks.slice(0, 4000)],
  );
  await db.execute(
    `UPDATE work_item SET status = 'completed', completed_at = NOW() WHERE id = ?`,
    [workItemId],
  );

  console.log(`\nClosed ${workItemId} — "${item.title}"`);
}

main()
  .catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : String(e)); process.exitCode = 1; })
  .finally(async () => { await db.end(); });
