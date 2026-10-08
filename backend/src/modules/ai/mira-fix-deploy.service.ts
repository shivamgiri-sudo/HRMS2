/**
 * Phase 3 of the Mira fix pipeline: the stage that was missing entirely.
 *
 * Until now the chain stopped at a diagnosis. mira-fix-draft-generate.service.ts added a
 * candidate diff; nothing ever applied it, tested it, shipped it, or checked whether the
 * complaint was actually resolved. Reported live 2026-08-14: "prompt creation and execution
 * on prompt is not happening for correction in code and then deploy it and then check". This
 * file is that execution stage — apply, verify, ship, confirm, and undo if the confirmation
 * fails.
 *
 * THE ORDER IS THE SAFETY PROPERTY
 *
 *   guard -> isolated worktree -> apply -> verify command -> commit -> push -> health-confirm
 *                                                                              |
 *                                                              failure at any point after
 *                                                              push triggers an automatic
 *                                                              revert commit, not a manual
 *                                                              cleanup task for a human at
 *                                                              2am.
 *
 * Every step before `push` is side-effect-free with respect to production. A draft that
 * fails apply or verification never becomes a commit, and the failure output is recorded on
 * the draft row so the next reader can see exactly why rather than re-deriving it.
 *
 * WHAT IS DELIBERATELY NOT TRUSTED
 *
 *   - The stored `status='drafted'`. checkFixDraftSafety() is re-run here against the diff
 *     text itself, exactly as mira-fix-draft-guard.ts's header demands ("MUST be re-run
 *     server-side at deploy time — never trust a client-supplied 'already checked' flag").
 *     A draft that passed the deny-list at generation time but whose diff was since altered
 *     in the database is rejected here, not shipped.
 *   - The repository the process happens to be running from. Applying a diff inside the live
 *     serving checkout would mutate the code serving requests, mid-request. assertSafeWorktree()
 *     refuses any path that is not a freshly created, disposable worktree.
 *   - That "the tests passed" means anything if no test actually ran. An empty or missing
 *     verification result is treated as failure, never as "nothing to check, ship it".
 *
 * ARMING
 *
 * MIRA_AUTO_DEPLOY_ENABLED is false by default and must be set deliberately. Unarmed, this
 * service still does everything up to and including the verification run, and records the
 * result — a dry run is useful on its own, and it means the arming decision is made with
 * evidence about whether these diffs actually pass. Unarmed it never commits, never pushes,
 * and never touches production.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { env } from '../../config/env.js';
import { checkFixDraftSafety } from './mira-fix-draft-guard.js';
import { getFixDraftById, type FixDraft } from './mira-fix-draft.service.js';

const exec = promisify(execFile);

export const DEPLOY_AUDIT_ACTION = 'mira_fix_deploy';

/** One deploy at a time, process-wide and host-wide. Two concurrent runs would race on the
 *  same branch and could push a commit built from the other's half-applied tree. */
const DEPLOY_LOCK_NAME = 'mira_fix_deploy';

/** A diff larger than this is refused outright. The pipeline exists for small, targeted
 *  corrections; a 2,000-line AI-authored change is not something a deny-list plus one test
 *  command can meaningfully vouch for, and it should go to a human. */
const MAX_DIFF_BYTES = 60_000;
const MAX_TOUCHED_FILES = 10;

/** Every child process is bounded. A hung `git` or a test command that waits on stdin must
 *  fail the deploy, not pin the worker forever — the pool it is holding is shared with 45
 *  other workers. */
const GIT_TIMEOUT_MS = 60_000;
const VERIFY_TIMEOUT_MS = 15 * 60_000;
const HEALTH_CONFIRM_TIMEOUT_MS = 10 * 60_000;
const HEALTH_POLL_INTERVAL_MS = 15_000;

export type DeployOutcome =
  | { status: 'not_deployable'; reason: string }
  | { status: 'guard_rejected'; reason: string }
  | { status: 'apply_failed'; detail: string }
  | { status: 'verify_failed'; output: string }
  | { status: 'dry_run_passed'; output: string }
  | { status: 'push_failed'; detail: string }
  | { status: 'confirm_failed'; detail: string; rolledBack: boolean; commitSha: string }
  | { status: 'deployed'; commitSha: string; output: string };

/**
 * Refuses to operate anywhere except a disposable worktree created by this run.
 *
 * The failure this prevents is not hypothetical: the production checkout at /var/www/HRMS2
 * is the directory nginx serves and pm2 runs from, and `git apply` there would edit code
 * underneath live requests. Checking that the path sits under the OS temp dir AND is not the
 * configured repo root is cheap; discovering the alternative in production is not.
 */
function assertSafeWorktree(worktreePath: string, repoRoot: string): void {
  const wt = resolve(worktreePath);
  const root = resolve(repoRoot);
  const temp = resolve(tmpdir());
  if (wt === root || root.startsWith(wt + sep)) {
    throw new Error(`refusing to apply a diff inside the repository root (${root}) — worktree must be disposable`);
  }
  if (!wt.startsWith(temp + sep)) {
    throw new Error(`refusing to apply a diff outside the temp directory (got ${wt})`);
  }
}

async function git(cwd: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
  const { stdout, stderr } = await exec('git', args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 });
  return `${stdout ?? ''}${stderr ?? ''}`;
}

async function recordDeployAudit(workItemId: string, remarks: string): Promise<void> {
  await db.execute(
    `INSERT INTO work_item_audit_log (id, work_item_id, action, from_status, to_status, remarks, performed_by, performed_at)
     VALUES (UUID(), ?, ?, 'pending', 'pending', ?, 'mira-fix-deploy', NOW())`,
    [workItemId, DEPLOY_AUDIT_ACTION, remarks.slice(0, 4000)],
  );
}

async function setDraftState(
  draftId: string,
  fields: { status?: string; testOutput?: string; commitSha?: string; deployedAt?: boolean; rejectedReason?: string },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (fields.status) { sets.push('status = ?'); params.push(fields.status); }
  if (fields.testOutput !== undefined) { sets.push('test_output = ?'); params.push(fields.testOutput.slice(0, 60_000)); }
  if (fields.commitSha !== undefined) { sets.push('commit_sha = ?'); params.push(fields.commitSha); }
  if (fields.rejectedReason !== undefined) { sets.push('rejected_reason = ?'); params.push(fields.rejectedReason.slice(0, 500)); }
  if (fields.deployedAt) { sets.push('deployed_at = NOW()'); }
  if (!sets.length) return;
  params.push(draftId);
  await db.execute(`UPDATE mira_fix_draft SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * Confirms the pushed commit is the one actually serving traffic AND that the app is healthy.
 *
 * Checking only /api/health would pass while the old build is still running — the deploy
 * takes minutes and the previous process stays up throughout, so "healthy" says nothing about
 * whether this change shipped. /api/health/version reports the running commit, which is the
 * only signal that distinguishes "deployed" from "queued behind someone else's build".
 * Both must agree before this returns true, and a 503 (schema degraded) is a failure however
 * green the commit looks.
 */
async function confirmDeployed(commitSha: string, baseUrl: string): Promise<{ ok: boolean; detail: string }> {
  const deadline = Date.now() + HEALTH_CONFIRM_TIMEOUT_MS;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const vRes = await fetch(`${baseUrl}/api/health/version`, { signal: AbortSignal.timeout(20_000) });
      if (vRes.ok) {
        const body = (await vRes.json()) as { commit?: string };
        if (body.commit === commitSha) {
          const hRes = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(20_000) });
          if (hRes.ok) return { ok: true, detail: `commit ${commitSha.slice(0, 8)} live and /api/health 200` };
          last = `commit is live but /api/health returned ${hRes.status}`;
          return { ok: false, detail: last };
        }
        last = `running commit is ${String(body.commit ?? '?').slice(0, 8)}, waiting for ${commitSha.slice(0, 8)}`;
      } else {
        last = `/api/health/version returned ${vRes.status}`;
      }
    } catch (err) {
      last = `probe error: ${err instanceof Error ? err.message : String(err)}`;
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  return { ok: false, detail: `timed out after ${HEALTH_CONFIRM_TIMEOUT_MS / 60_000}min — ${last}` };
}

/**
 * Applies, verifies, ships and confirms one fix draft.
 *
 * Returns an outcome for every path rather than throwing, because "the deny-list rejected it"
 * and "the tests failed" are informative results a reviewer needs to read, not errors. Only a
 * genuine infrastructure fault (git missing, lock unobtainable) throws.
 */
export async function deployFixDraft(draftId: string, actor = 'system'): Promise<DeployOutcome> {
  const draft = await getFixDraftById(draftId);
  if (!draft) return { status: 'not_deployable', reason: 'draft not found' };
  if (draft.status !== 'drafted') {
    return { status: 'not_deployable', reason: `draft status is '${draft.status}', only 'drafted' can be deployed` };
  }

  // Re-run the deny-list against the diff itself. See the file header: the stored status is
  // not evidence, only the diff text is.
  const guard = checkFixDraftSafety(draft.diffText);
  if (!guard.safe) {
    const reason = guard.deniedFiles.map((d) => `${d.file}: ${d.reason}`).join('; ');
    await setDraftState(draftId, { status: 'rejected', rejectedReason: reason });
    await recordDeployAudit(draft.workItemId, `Fix draft ${draftId} rejected at deploy time by the server-side deny-list: ${reason}`);
    return { status: 'guard_rejected', reason };
  }
  if (Buffer.byteLength(draft.diffText, 'utf8') > MAX_DIFF_BYTES) {
    const reason = `diff is ${Buffer.byteLength(draft.diffText, 'utf8')} bytes, over the ${MAX_DIFF_BYTES} limit for an unattended change`;
    await setDraftState(draftId, { status: 'rejected', rejectedReason: reason });
    return { status: 'guard_rejected', reason };
  }
  if (draft.targetFiles.length > MAX_TOUCHED_FILES) {
    const reason = `diff touches ${draft.targetFiles.length} files, over the ${MAX_TOUCHED_FILES} limit for an unattended change`;
    await setDraftState(draftId, { status: 'rejected', rejectedReason: reason });
    return { status: 'guard_rejected', reason };
  }

  const repoRoot = env.MIRA_FIX_REPO_PATH;
  const baseUrl = env.MIRA_FIX_HEALTH_URL;
  const armed = env.MIRA_AUTO_DEPLOY_ENABLED;

  // GET_LOCK returns 1 on acquisition, 0 on timeout. A second concurrent deploy must not
  // queue and then push a commit built from a tree the first one was still mutating.
  const [lockRows] = await db.execute<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS got', [DEPLOY_LOCK_NAME]);
  if (Number((lockRows as RowDataPacket[])[0]?.got) !== 1) {
    return { status: 'not_deployable', reason: 'another fix deploy is already running' };
  }

  let worktree: string | null = null;
  try {
    worktree = await mkdtemp(join(tmpdir(), 'mira-fix-'));
    assertSafeWorktree(worktree, repoRoot);

    await git(repoRoot, ['fetch', 'origin', 'main']);
    await git(repoRoot, ['worktree', 'add', '--detach', worktree, 'origin/main']);

    // The patch goes to a file rather than stdin because execFile cannot pipe input, and it
    // is written inside the disposable worktree so the cleanup in `finally` removes it even
    // if this run dies partway. `git apply --check` runs first: a diff that will not apply
    // cleanly must be rejected before anything on disk is modified.
    const patchPath = join(worktree, '.mira-fix.patch');
    await writeFile(patchPath, draft.diffText, 'utf8');
    try {
      await git(worktree, ['apply', '--check', '--whitespace=nowarn', patchPath]);
      await git(worktree, ['apply', '--whitespace=nowarn', patchPath]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await setDraftState(draftId, { status: 'failed', testOutput: `git apply failed:\n${detail}` });
      await recordDeployAudit(draft.workItemId, `Fix draft ${draftId} did not apply to origin/main: ${detail.slice(0, 500)}`);
      return { status: 'apply_failed', detail };
    }
    await rm(patchPath, { force: true });

    // Verification. An empty result is failure, not a pass — see the header.
    let verifyOutput = '';
    try {
      const { stdout, stderr } = await exec(
        env.MIRA_FIX_VERIFY_COMMAND_BIN,
        env.MIRA_FIX_VERIFY_COMMAND_ARGS,
        { cwd: worktree, timeout: VERIFY_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
      );
      verifyOutput = `${stdout ?? ''}${stderr ?? ''}`;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      verifyOutput = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`;
      await setDraftState(draftId, { status: 'failed', testOutput: verifyOutput });
      await recordDeployAudit(draft.workItemId, `Fix draft ${draftId} failed verification — not deployed. Output tail: ${verifyOutput.slice(-500)}`);
      return { status: 'verify_failed', output: verifyOutput };
    }
    if (!verifyOutput.trim()) {
      const output = 'verification command produced no output — treating as failure rather than assuming success';
      await setDraftState(draftId, { status: 'failed', testOutput: output });
      return { status: 'verify_failed', output };
    }
    await setDraftState(draftId, { testOutput: verifyOutput });

    if (!armed) {
      await recordDeployAudit(
        draft.workItemId,
        `Fix draft ${draftId} applied cleanly and passed verification, but MIRA_AUTO_DEPLOY_ENABLED is false — not deployed. This is a dry run.`,
      );
      return { status: 'dry_run_passed', output: verifyOutput };
    }

    // ── From here on, production can change. ──────────────────────────────────────────
    await setDraftState(draftId, { status: 'deploying' });
    let commitSha = '';
    try {
      await git(worktree, ['add', '--', ...draft.targetFiles]);
      await git(worktree, [
        'commit',
        '-m', `fix(mira): automated correction for work item ${draft.workItemId}\n\nDrafted by ${draft.model ?? 'the Mira fix pipeline'} and applied by mira-fix-deploy.service.ts\nafter passing the server-side deny-list and the verification command.\nDeploy requested by: ${actor}\n\nDraft: ${draftId}`,
      ]);
      commitSha = (await git(worktree, ['rev-parse', 'HEAD'])).trim();
      await git(worktree, ['push', 'origin', `${commitSha}:refs/heads/main`]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      await setDraftState(draftId, { status: 'failed', testOutput: `${verifyOutput}\n\npush failed:\n${detail}` });
      await recordDeployAudit(draft.workItemId, `Fix draft ${draftId} passed verification but could not be pushed: ${detail.slice(0, 500)}`);
      return { status: 'push_failed', detail };
    }

    const confirm = await confirmDeployed(commitSha, baseUrl);
    if (!confirm.ok) {
      // The commit is on main and may or may not be serving. Revert rather than leave an
      // unconfirmed AI-authored change in the branch everyone else deploys from.
      let rolledBack = false;
      try {
        await git(worktree, ['revert', '--no-edit', commitSha]);
        const revertSha = (await git(worktree, ['rev-parse', 'HEAD'])).trim();
        await git(worktree, ['push', 'origin', `${revertSha}:refs/heads/main`]);
        rolledBack = true;
      } catch { /* reported below; the confirm failure is the headline either way */ }
      await setDraftState(draftId, { status: 'failed', commitSha, testOutput: `${verifyOutput}\n\nconfirm failed: ${confirm.detail}\nrolled back: ${rolledBack}` });
      await recordDeployAudit(
        draft.workItemId,
        `Fix draft ${draftId} deployed as ${commitSha.slice(0, 8)} but could not be confirmed live (${confirm.detail}). Automatic revert ${rolledBack ? 'pushed' : 'FAILED — needs a human'}.`,
      );
      return { status: 'confirm_failed', detail: confirm.detail, rolledBack, commitSha };
    }

    await setDraftState(draftId, { status: 'deployed', commitSha, deployedAt: true });
    await recordDeployAudit(
      draft.workItemId,
      `Fix draft ${draftId} deployed and confirmed live as ${commitSha.slice(0, 8)}: ${confirm.detail}. Requested by ${actor}.`,
    );
    return { status: 'deployed', commitSha, output: verifyOutput };
  } finally {
    if (worktree) {
      await git(repoRoot, ['worktree', 'remove', '--force', worktree]).catch(() => {});
      await rm(worktree, { recursive: true, force: true }).catch(() => {});
    }
    await db.execute('SELECT RELEASE_LOCK(?)', [DEPLOY_LOCK_NAME]).catch(() => {});
  }
}
