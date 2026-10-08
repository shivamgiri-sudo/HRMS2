import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));

import { createFixDraft, listFixDraftsForWorkItem, getFixDraftById } from '../mira-fix-draft.service.js';

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

describe('listFixDraftsForWorkItem', () => {
  beforeEach(() => mocks.execute.mockReset());

  it('maps rows back into FixDraft shape, most recent first per the query order', async () => {
    mocks.execute.mockResolvedValueOnce([[
      {
        id: 'd-2', work_item_id: 'wi-1', status: 'drafted',
        target_files: JSON.stringify(['src/pages/Foo.tsx']),
        diff_text: 'diff --git a/src/pages/Foo.tsx b/src/pages/Foo.tsx\n',
        model: 'claude', safety_flags: null, rejected_reason: null,
        created_at: '2026-08-13T10:00:00.000Z',
      },
      {
        id: 'd-1', work_item_id: 'wi-1', status: 'rejected',
        target_files: JSON.stringify([]),
        diff_text: 'not a real diff',
        model: null,
        safety_flags: JSON.stringify([{ file: 'x.sql', reason: 'touches a database migration' }]),
        rejected_reason: 'x.sql: touches a database migration',
        created_at: '2026-08-13T09:00:00.000Z',
      },
    ], []]);

    const drafts = await listFixDraftsForWorkItem('wi-1');
    expect(drafts).toHaveLength(2);
    expect(drafts[0].id).toBe('d-2');
    expect(drafts[0].targetFiles).toEqual(['src/pages/Foo.tsx']);
    expect(drafts[1].id).toBe('d-1');
    expect(drafts[1].status).toBe('rejected');
    expect(drafts[1].safetyFlags).toEqual(['x.sql']);

    const [sql, params] = mocks.execute.mock.calls[0];
    expect(sql).toContain('WHERE work_item_id = ?');
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(params).toEqual(['wi-1']);
  });

  it('returns an empty array for a work item with no drafts, not an error', async () => {
    mocks.execute.mockResolvedValueOnce([[], []]);
    expect(await listFixDraftsForWorkItem('wi-none')).toEqual([]);
  });
});

describe('getFixDraftById', () => {
  beforeEach(() => mocks.execute.mockReset());

  it('returns the mapped draft when it exists', async () => {
    mocks.execute.mockResolvedValueOnce([[{
      id: 'd-1', work_item_id: 'wi-1', status: 'drafted',
      target_files: JSON.stringify(['a.ts']), diff_text: 'diff --git a/a.ts b/a.ts\n',
      model: 'claude', safety_flags: null, rejected_reason: null,
      created_at: '2026-08-13T10:00:00.000Z',
    }], []]);
    const draft = await getFixDraftById('d-1');
    expect(draft?.id).toBe('d-1');
    expect(draft?.targetFiles).toEqual(['a.ts']);
  });

  it('returns null when the draft does not exist, not a throw', async () => {
    mocks.execute.mockResolvedValueOnce([[], []]);
    expect(await getFixDraftById('nope')).toBeNull();
  });
});
