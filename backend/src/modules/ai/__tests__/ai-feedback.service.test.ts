import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));

import { detectFeedbackIntent, describeFeedbackForHistory, logFeedback } from '../ai-feedback.service.js';

describe('detectFeedbackIntent', () => {
  it('does not fire on a plain question with no system name and no feedback wording', () => {
    expect(detectFeedbackIntent('what is my leave balance').isFeedback).toBe(false);
  });

  it('does not fire on a bare "complaint" with no system name — self-account support intent owns this', () => {
    expect(detectFeedbackIntent('I want to check my complaints').isFeedback).toBe(false);
  });

  it('does not fire on a bare "bug" mention with no system name', () => {
    expect(detectFeedbackIntent('there is a bug in the software I use at home').isFeedback).toBe(false);
  });

  it('fires as a bug report when the system is named alongside bug wording', () => {
    const result = detectFeedbackIntent('HRMS has a bug, the leave page is broken');
    expect(result.isFeedback).toBe(true);
    expect(result.category).toBe('bug');
  });

  it('fires as a bug report when Mira itself is named as not working', () => {
    const result = detectFeedbackIntent('Mira is not working properly today');
    expect(result.isFeedback).toBe(true);
    expect(result.category).toBe('bug');
  });

  it('fires as a complaint when the system is named alongside complaint wording', () => {
    const result = detectFeedbackIntent('I have a complaint about the HRMS system');
    expect(result.isFeedback).toBe(true);
    expect(result.category).toBe('complaint');
  });

  it('fires as a suggestion when the system is named alongside suggestion wording', () => {
    const result = detectFeedbackIntent('I have a suggestion to improve the HRMS portal');
    expect(result.isFeedback).toBe(true);
    expect(result.category).toBe('suggestion');
  });

  it('fires as feedback when the system is named alongside bare feedback wording', () => {
    const result = detectFeedbackIntent('I want to give feedback on Mira');
    expect(result.isFeedback).toBe(true);
    expect(result.category).toBe('feedback');
  });

  it('fires on an explicit "file a complaint" phrase even without naming the system in the same breath', () => {
    const result = detectFeedbackIntent('can I file a complaint please');
    expect(result.isFeedback).toBe(true);
    expect(result.category).toBe('complaint');
  });

  it('fires on an explicit "submit feedback" phrase', () => {
    const result = detectFeedbackIntent('I would like to submit feedback');
    expect(result.isFeedback).toBe(true);
    expect(result.category).toBe('feedback');
  });

  it('bug wording takes priority over suggestion/feedback wording when multiple are present', () => {
    const result = detectFeedbackIntent('HRMS feedback: the leave page is broken, please fix this bug');
    expect(result.category).toBe('bug');
  });
});

describe('describeFeedbackForHistory', () => {
  it('never includes the raw category label\'s underlying question text — topic only', () => {
    const summary = describeFeedbackForHistory('complaint');
    expect(summary).toContain('complaint');
    expect(summary).not.toContain('manager');
  });
});

describe('logFeedback', () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.execute.mockResolvedValue([{}]);
  });

  // Param order: [id, title, description, entity_id, priority, created_by] — id and
  // entity_id are the same generated UUID (self-referencing, see ai-feedback.service.ts's
  // comment on why: it's what lets Work Inbox's timeline panel find this item's
  // work_item_audit_log rows, the same pattern getTimeline() already uses for
  // 'incentive'/'incentive_batch').
  it('inserts a work_item row assigned to super_admin with the right category priority', async () => {
    const result = await logFeedback('user-1', 'HRMS has a bug in the leave page', 'bug');
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(sql).toContain('INSERT INTO work_item');
    expect(sql).toContain("assigned_to_role");
    expect(sql).toContain("'super_admin'");
    expect(params[0]).toBe(params[3]); // id === entity_id, self-referencing
    expect(params[4]).toBe('high'); // bug -> high priority
    expect(params[5]).toBe('user-1'); // created_by
    expect(result.answer).toContain('logged');
    expect(result.actions?.[0]?.url).toBe('/work-inbox');
  });

  it('uses medium priority for suggestion/feedback categories', async () => {
    await logFeedback('user-2', 'I have a suggestion for HRMS', 'suggestion');
    const [, params] = mocks.execute.mock.calls[0];
    expect(params[4]).toBe('medium');
  });

  it('uses high priority for complaint category', async () => {
    await logFeedback('user-3', 'complaint about the HRMS portal', 'complaint');
    const [, params] = mocks.execute.mock.calls[0];
    expect(params[4]).toBe('high');
  });

  it('returns a graceful failure response, not a throw, when the insert fails', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('connection lost'));
    const result = await logFeedback('user-4', 'HRMS has a bug', 'bug');
    expect(result.answer).toContain("couldn't save");
    expect(result.actions ?? []).toEqual([]);
  });

  it('truncates a very long feedback message before storing it', async () => {
    const long = 'HRMS bug: ' + 'x'.repeat(5000);
    await logFeedback('user-5', long, 'bug');
    const [, params] = mocks.execute.mock.calls[0];
    expect(String(params[2]).length).toBeLessThanOrEqual(4000);
  });
});
