/**
 * The refusal paths are the point of this service, so they are what is pinned here.
 *
 * A test that only proved "a good diff deploys" would pass just as happily if every guard
 * were deleted. These assert the opposite: that a draft touching payroll, a draft whose
 * status was already consumed, an oversized diff and an unarmed pipeline each stop before
 * anything is pushed — and, in the unarmed case, that it still runs far enough to be useful.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const execFileMock = vi.fn();
const dbExecute = vi.fn();
const getFixDraftById = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (bin: string, args: string[], opts: unknown, cb: (e: unknown, r: unknown) => void) =>
    execFileMock(bin, args, opts, cb),
}));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: (...a: unknown[]) => dbExecute(...a) } }));
vi.mock('../mira-fix-draft.service.js', () => ({ getFixDraftById: (...a: unknown[]) => getFixDraftById(...a) }));

const ENV: Record<string, unknown> = {
  MIRA_AUTO_DEPLOY_ENABLED: false,
  MIRA_FIX_REPO_PATH: '/repo',
  MIRA_FIX_HEALTH_URL: 'http://127.0.0.1:5055',
  MIRA_FIX_VERIFY_COMMAND_BIN: 'npx',
  MIRA_FIX_VERIFY_COMMAND_ARGS: ['vitest', 'run'],
};
vi.mock('../../../config/env.js', () => ({ env: new Proxy({}, { get: (_t, k) => ENV[k as string] }) }));

const SAFE_DIFF = `diff --git a/src/pages/ExitPage.tsx b/src/pages/ExitPage.tsx
--- a/src/pages/ExitPage.tsx
+++ b/src/pages/ExitPage.tsx
@@ -1 +1 @@
-const q = name;
+const q = name.trim().toLowerCase();
`;

const PAYROLL_DIFF = `diff --git a/backend/src/modules/payroll/payrollCalculate.service.ts b/backend/src/modules/payroll/payrollCalculate.service.ts
--- a/backend/src/modules/payroll/payrollCalculate.service.ts
+++ b/backend/src/modules/payroll/payrollCalculate.service.ts
@@ -1 +1 @@
-const gross = basic + hra;
+const gross = basic + hra + 1;
`;

function draft(over: Record<string, unknown> = {}) {
  return {
    id: 'draft-1', workItemId: 'wi-1', status: 'drafted', targetFiles: ['src/pages/ExitPage.tsx'],
    diffText: SAFE_DIFF, model: 'test-model', safetyFlags: null, rejectedReason: null,
    createdAt: new Date().toISOString(), ...over,
  };
}

/** GET_LOCK acquires, every other statement is a no-op write. */
function lockAcquired() {
  dbExecute.mockImplementation(async (sql: string) => {
    if (String(sql).includes('GET_LOCK')) return [[{ got: 1 }]];
    return [[]];
  });
}

describe('mira fix deploy — the refusals', () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
    dbExecute.mockReset();
    getFixDraftById.mockReset();
    ENV.MIRA_AUTO_DEPLOY_ENABLED = false;
    lockAcquired();
    // Every git/verify child process succeeds unless a test says otherwise.
    execFileMock.mockImplementation((_bin, _args, _opts, cb) => cb(null, { stdout: 'ok', stderr: '' }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('refuses a diff touching payroll calculation, however well-formed', async () => {
    getFixDraftById.mockResolvedValue(draft({
      diffText: PAYROLL_DIFF,
      targetFiles: ['backend/src/modules/payroll/payrollCalculate.service.ts'],
    }));
    const { deployFixDraft } = await import('../mira-fix-deploy.service.js');
    const out = await deployFixDraft('draft-1');

    expect(out.status).toBe('guard_rejected');
    // The decisive part: no child process ran at all, so nothing was applied or pushed.
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('re-runs the deny-list against the diff, not the stored status', async () => {
    // status='drafted' claims it already passed. The diff says otherwise, and the diff wins.
    getFixDraftById.mockResolvedValue(draft({ status: 'drafted', diffText: PAYROLL_DIFF }));
    const { deployFixDraft } = await import('../mira-fix-deploy.service.js');

    expect((await deployFixDraft('draft-1')).status).toBe('guard_rejected');
  });

  it('refuses a draft that is not in drafted state', async () => {
    getFixDraftById.mockResolvedValue(draft({ status: 'deployed' }));
    const { deployFixDraft } = await import('../mira-fix-deploy.service.js');
    const out = await deployFixDraft('draft-1');

    expect(out.status).toBe('not_deployable');
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('refuses an oversized diff rather than shipping it unattended', async () => {
    getFixDraftById.mockResolvedValue(draft({ diffText: SAFE_DIFF + 'x'.repeat(61_000) }));
    const { deployFixDraft } = await import('../mira-fix-deploy.service.js');

    expect((await deployFixDraft('draft-1')).status).toBe('guard_rejected');
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('treats a failing verification command as failure and never pushes', async () => {
    ENV.MIRA_AUTO_DEPLOY_ENABLED = true;
    getFixDraftById.mockResolvedValue(draft());
    execFileMock.mockImplementation((bin: string, args: string[], _o: unknown, cb: (e: unknown, r: unknown) => void) => {
      if (bin === 'npx') return cb(Object.assign(new Error('1 test failed'), { stdout: 'FAIL', stderr: '' }), null);
      return cb(null, { stdout: 'ok', stderr: '' });
    });
    const { deployFixDraft } = await import('../mira-fix-deploy.service.js');
    const out = await deployFixDraft('draft-1');

    expect(out.status).toBe('verify_failed');
    const pushed = execFileMock.mock.calls.some(([, args]) => Array.isArray(args) && args[0] === 'push');
    expect(pushed).toBe(false);
  });

  it('treats a silent verification command as failure, not as success', async () => {
    ENV.MIRA_AUTO_DEPLOY_ENABLED = true;
    getFixDraftById.mockResolvedValue(draft());
    execFileMock.mockImplementation((bin: string, _args: string[], _o: unknown, cb: (e: unknown, r: unknown) => void) =>
      cb(null, { stdout: bin === 'npx' ? '   ' : 'ok', stderr: '' }));
    const { deployFixDraft } = await import('../mira-fix-deploy.service.js');

    expect((await deployFixDraft('draft-1')).status).toBe('verify_failed');
  });

  it('unarmed: applies and verifies, records the result, and stops before committing', async () => {
    ENV.MIRA_AUTO_DEPLOY_ENABLED = false;
    getFixDraftById.mockResolvedValue(draft());
    const { deployFixDraft } = await import('../mira-fix-deploy.service.js');
    const out = await deployFixDraft('draft-1');

    expect(out.status).toBe('dry_run_passed');
    const gitVerbs = execFileMock.mock.calls
      .filter(([bin]) => bin === 'git')
      .map(([, args]) => (Array.isArray(args) ? args[0] : ''));
    expect(gitVerbs).toContain('apply');       // it did the useful part
    expect(gitVerbs).not.toContain('commit');  // and none of the dangerous part
    expect(gitVerbs).not.toContain('push');
  });

  it('does not start a second deploy while one is running', async () => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (String(sql).includes('GET_LOCK')) return [[{ got: 0 }]];
      return [[]];
    });
    getFixDraftById.mockResolvedValue(draft());
    const { deployFixDraft } = await import('../mira-fix-deploy.service.js');
    const out = await deployFixDraft('draft-1');

    expect(out.status).toBe('not_deployable');
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
