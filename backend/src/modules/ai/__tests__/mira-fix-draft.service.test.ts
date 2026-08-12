import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));

import { createFixDraft } from '../mira-fix-draft.service.js';

function diffFor(path: string): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,2 @@\n+added\n`;
}

describe('createFixDraft', () => {
  beforeEach(() => mocks.execute.mockReset().mockResolvedValue([{ affectedRows: 1 }, []]));

  it('records a safe diff as drafted, with no rejection reason', async () => {
    const draft = await createFixDraft({
      workItemId: 'wi-1',
      diffText: diffFor('src/pages/NativeWorkInbox.tsx'),
      model: 'test-model',
    });
    expect(draft.status).toBe('drafted');
    expect(draft.rejectedReason).toBeNull();
    expect(draft.targetFiles).toContain('src/pages/NativeWorkInbox.tsx');

    const [sql, params] = mocks.execute.mock.calls[0];
    expect(sql).toContain('INSERT INTO mira_fix_draft');
    expect(params[2]).toBe('drafted'); // status
    expect(params[7]).toBeNull(); // rejected_reason
  });

  it('records a payroll-touching diff as rejected, with the reason preserved', async () => {
    const draft = await createFixDraft({
      workItemId: 'wi-2',
      diffText: diffFor('backend/src/modules/payroll/payrollCalculate.service.ts'),
    });
    expect(draft.status).toBe('rejected');
    expect(draft.rejectedReason).toContain('payroll');

    const [, params] = mocks.execute.mock.calls[0];
    expect(params[2]).toBe('rejected');
    expect(params[7]).toContain('payroll');
  });

  it('never lets a denied diff through even when workItemId/model vary', async () => {
    const draft = await createFixDraft({
      workItemId: 'wi-3',
      diffText: diffFor('backend/src/middleware/requireRole.ts'),
      model: 'openrouter/some-model',
    });
    expect(draft.status).toBe('rejected');
  });
});
