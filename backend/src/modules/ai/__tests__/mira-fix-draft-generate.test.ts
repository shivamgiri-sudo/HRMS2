import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveWorkingProvider: vi.fn(),
  buildContextBundle: vi.fn(),
  createFixDraft: vi.fn(),
}));

vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));
vi.mock('../mira-issue-triage.service.js', () => ({
  TRIAGE_AUDIT_ACTION: 'mira_ai_triage',
  resolveWorkingProvider: mocks.resolveWorkingProvider,
}));
vi.mock('../mira-fix-draft-context.js', () => ({ buildContextBundle: mocks.buildContextBundle }));
vi.mock('../mira-fix-draft.service.js', () => ({ createFixDraft: mocks.createFixDraft }));

import { generateFixDraftForWorkItem, parseDiagnosisRemark } from '../mira-fix-draft-generate.service.js';

/** Exactly what writeTriageAudit() (mira-issue-triage.service.ts) builds — a regression
 * pin: if that format ever changes without updating this, the tests here fail loudly
 * instead of the parser silently seeing every diagnosis as "no_diagnosis" in production. */
function realDiagnosisRemark(opts: {
  category: string;
  confidence: string;
  actionable: boolean;
  rootCause: string;
  nextStep: string;
}): string {
  return `AI-drafted diagnosis (${opts.category}, confidence ${opts.confidence}, actionable=${opts.actionable}): ${opts.rootCause} — Suggested next step: ${opts.nextStep} — This is an AI-generated hypothesis for human review, not an applied fix.`;
}

describe('parseDiagnosisRemark — pinned against the real writeTriageAudit() format', () => {
  it('parses a genuine_bug, actionable=true remark correctly', () => {
    const remark = realDiagnosisRemark({
      category: 'genuine_bug', confidence: 'high', actionable: true,
      rootCause: 'The proxy target used localhost, hitting a DNS race.',
      nextStep: 'Point the proxy at 127.0.0.1 instead.',
    });
    const parsed = parseDiagnosisRemark(remark);
    expect(parsed).not.toBeNull();
    expect(parsed?.category).toBe('genuine_bug');
    expect(parsed?.confidence).toBe('high');
    expect(parsed?.actionable).toBe(true);
    expect(parsed?.rootCauseHypothesis).toBe('The proxy target used localhost, hitting a DNS race.');
    expect(parsed?.suggestedNextStep).toBe('Point the proxy at 127.0.0.1 instead.');
  });

  it('parses actionable=false correctly, not just falsy', () => {
    const remark = realDiagnosisRemark({
      category: 'needs_human_judgment', confidence: 'low', actionable: false,
      rootCause: 'Unclear whether this is a policy question.', nextStep: 'Ask HR.',
    });
    expect(parseDiagnosisRemark(remark)?.actionable).toBe(false);
  });

  it('returns null for a remark that is not a diagnosis (e.g. a rejected-injection audit entry)', () => {
    expect(parseDiagnosisRemark('Not analysed — failed prompt-injection guard: ...')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(parseDiagnosisRemark('')).toBeNull();
    expect(parseDiagnosisRemark('random unrelated text')).toBeNull();
  });
});

describe('generateFixDraftForWorkItem', () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.resolveWorkingProvider.mockReset();
    mocks.buildContextBundle.mockReset().mockReturnValue([]);
    mocks.createFixDraft.mockReset();
  });

  it('returns no_diagnosis when there is no triage audit row at all', async () => {
    mocks.execute.mockResolvedValueOnce([[], []]); // no remarks row
    const outcome = await generateFixDraftForWorkItem('wi-1');
    expect(outcome).toEqual({ status: 'no_diagnosis' });
    expect(mocks.resolveWorkingProvider).not.toHaveBeenCalled();
  });

  it('refuses a needs_human_judgment diagnosis WITHOUT ever calling the AI provider', async () => {
    mocks.execute.mockResolvedValueOnce([[{
      remarks: realDiagnosisRemark({
        category: 'needs_human_judgment', confidence: 'low', actionable: false,
        rootCause: 'unclear', nextStep: 'ask a human',
      }),
    }], []]);
    const outcome = await generateFixDraftForWorkItem('wi-2');
    expect(outcome.status).toBe('not_eligible');
    expect(mocks.resolveWorkingProvider).not.toHaveBeenCalled();
    expect(mocks.createFixDraft).not.toHaveBeenCalled();
  });

  it('refuses a genuine_bug diagnosis that is NOT actionable, without calling the AI provider', async () => {
    mocks.execute.mockResolvedValueOnce([[{
      remarks: realDiagnosisRemark({
        category: 'genuine_bug', confidence: 'low', actionable: false,
        rootCause: 'maybe a bug', nextStep: 'investigate further',
      }),
    }], []]);
    const outcome = await generateFixDraftForWorkItem('wi-3');
    expect(outcome.status).toBe('not_eligible');
    expect(mocks.resolveWorkingProvider).not.toHaveBeenCalled();
  });

  it('returns ai_unavailable when no provider is usable, for an eligible diagnosis', async () => {
    mocks.execute
      .mockResolvedValueOnce([[{
        remarks: realDiagnosisRemark({
          category: 'genuine_bug', confidence: 'high', actionable: true,
          rootCause: 'root cause', nextStep: 'next step',
        }),
      }], []])
      .mockResolvedValueOnce([[{ description: 'the bug report text' }], []]);
    mocks.resolveWorkingProvider.mockResolvedValueOnce(null);

    const outcome = await generateFixDraftForWorkItem('wi-4');
    expect(outcome).toEqual({ status: 'ai_unavailable' });
    expect(mocks.createFixDraft).not.toHaveBeenCalled();
  });

  it('returns model_declined when the model outputs NO_SAFE_DIFF instead of a diff', async () => {
    mocks.execute
      .mockResolvedValueOnce([[{
        remarks: realDiagnosisRemark({
          category: 'genuine_bug', confidence: 'high', actionable: true,
          rootCause: 'root cause', nextStep: 'next step',
        }),
      }], []])
      .mockResolvedValueOnce([[{ description: 'the bug report text' }], []]);
    mocks.resolveWorkingProvider.mockResolvedValueOnce({
      key: 'claude',
      generateText: vi.fn().mockResolvedValue({
        answer: 'NO_SAFE_DIFF: the fix requires changing payroll calculation logic',
        safetyBlocked: false,
      }),
    });

    const outcome = await generateFixDraftForWorkItem('wi-5');
    expect(outcome.status).toBe('model_declined');
    if (outcome.status === 'model_declined') {
      expect(outcome.reason).toContain('payroll');
    }
    expect(mocks.createFixDraft).not.toHaveBeenCalled();
  });

  it('drafts successfully on the happy path, passing the diff through to createFixDraft', async () => {
    mocks.execute
      .mockResolvedValueOnce([[{
        remarks: realDiagnosisRemark({
          category: 'genuine_bug', confidence: 'high', actionable: true,
          rootCause: 'root cause', nextStep: 'next step',
        }),
      }], []])
      .mockResolvedValueOnce([[{ description: 'the bug report text' }], []]);
    const fakeDiff = 'diff --git a/src/pages/Foo.tsx b/src/pages/Foo.tsx\n--- a/src/pages/Foo.tsx\n+++ b/src/pages/Foo.tsx\n@@ -1,1 +1,2 @@\n+fix\n';
    mocks.resolveWorkingProvider.mockResolvedValueOnce({
      key: 'openrouter',
      generateText: vi.fn().mockResolvedValue({ answer: fakeDiff, safetyBlocked: false }),
    });
    mocks.createFixDraft.mockResolvedValueOnce({ id: 'draft-1', status: 'drafted' });

    const outcome = await generateFixDraftForWorkItem('wi-6');
    expect(outcome).toEqual({ status: 'drafted', draft: { id: 'draft-1', status: 'drafted' } });
    expect(mocks.createFixDraft).toHaveBeenCalledWith({ workItemId: 'wi-6', diffText: fakeDiff.trim(), model: 'openrouter' });
  });

  it('strips a markdown fence around the diff before handing it to createFixDraft', async () => {
    mocks.execute
      .mockResolvedValueOnce([[{
        remarks: realDiagnosisRemark({
          category: 'genuine_bug', confidence: 'high', actionable: true,
          rootCause: 'root cause', nextStep: 'next step',
        }),
      }], []])
      .mockResolvedValueOnce([[{ description: 'the bug report text' }], []]);
    const rawDiff = 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n+y\n';
    mocks.resolveWorkingProvider.mockResolvedValueOnce({
      key: 'claude',
      generateText: vi.fn().mockResolvedValue({ answer: '```diff\n' + rawDiff + '```', safetyBlocked: false }),
    });
    mocks.createFixDraft.mockResolvedValueOnce({ id: 'draft-2', status: 'drafted' });

    await generateFixDraftForWorkItem('wi-7');
    const call = mocks.createFixDraft.mock.calls[0][0];
    expect(call.diffText).toBe(rawDiff.trim());
  });

  it('returns ai_error when the provider throws', async () => {
    mocks.execute
      .mockResolvedValueOnce([[{
        remarks: realDiagnosisRemark({
          category: 'genuine_bug', confidence: 'high', actionable: true,
          rootCause: 'root cause', nextStep: 'next step',
        }),
      }], []])
      .mockResolvedValueOnce([[{ description: 'the bug report text' }], []]);
    mocks.resolveWorkingProvider.mockResolvedValueOnce({
      key: 'claude',
      generateText: vi.fn().mockRejectedValue(new Error('provider timed out')),
    });

    const outcome = await generateFixDraftForWorkItem('wi-8');
    expect(outcome.status).toBe('ai_error');
    if (outcome.status === 'ai_error') {
      expect(outcome.message).toContain('provider timed out');
    }
  });

  it('returns ai_error when the provider safety-blocks the request', async () => {
    mocks.execute
      .mockResolvedValueOnce([[{
        remarks: realDiagnosisRemark({
          category: 'genuine_bug', confidence: 'high', actionable: true,
          rootCause: 'root cause', nextStep: 'next step',
        }),
      }], []])
      .mockResolvedValueOnce([[{ description: 'the bug report text' }], []]);
    mocks.resolveWorkingProvider.mockResolvedValueOnce({
      key: 'claude',
      generateText: vi.fn().mockResolvedValue({ answer: 'refused', safetyBlocked: true }),
    });

    const outcome = await generateFixDraftForWorkItem('wi-9');
    expect(outcome.status).toBe('ai_error');
    expect(mocks.createFixDraft).not.toHaveBeenCalled();
  });
});
