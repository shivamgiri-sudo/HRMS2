import { describe, it, expect } from 'vitest';
import {
  NUDGEABLE_ISSUES,
  isNudgeableIssue,
  ageingBucket,
  cooldownState,
  buildNudgeMessage,
  NUDGE_COOLDOWN_MS,
} from '../ops-nudge.logic.js';

describe('isNudgeableIssue', () => {
  it('accepts joiner-actionable issues only', () => {
    for (const i of NUDGEABLE_ISSUES) expect(isNudgeableIssue(i)).toBe(true);
    expect(isNudgeableIssue('attendance-mismatch')).toBe(false);
    expect(isNudgeableIssue('fnf-pending')).toBe(false);
    expect(isNudgeableIssue('it-provisioning-pending')).toBe(false);
    expect(isNudgeableIssue('nope')).toBe(false);
  });
});

describe('ageingBucket', () => {
  it('buckets by days open', () => {
    expect(ageingBucket(0)).toBe('0-2');
    expect(ageingBucket(2)).toBe('0-2');
    expect(ageingBucket(3)).toBe('3-7');
    expect(ageingBucket(7)).toBe('3-7');
    expect(ageingBucket(8)).toBe('8+');
    expect(ageingBucket(-4)).toBe('0-2');
  });
});

describe('cooldownState', () => {
  const now = 1_000_000_000_000;
  it('never nudged => due', () => {
    expect(cooldownState(null, now)).toEqual({ due: true, nextEligibleMs: now });
  });
  it('sent <24h ago => not due, reports when eligible', () => {
    const last = now - 3 * 60 * 60 * 1000;
    const r = cooldownState(last, now);
    expect(r.due).toBe(false);
    expect(r.nextEligibleMs).toBe(last + NUDGE_COOLDOWN_MS);
  });
  it('sent exactly 24h ago => due', () => {
    expect(cooldownState(now - NUDGE_COOLDOWN_MS, now).due).toBe(true);
  });
});

describe('buildNudgeMessage', () => {
  it.each(NUDGEABLE_ISSUES)('%s names the joiner and the task', (issue) => {
    const m = buildNudgeMessage(issue, { name: 'Asha Rao', daysOpen: 4, link: 'https://x/y' });
    expect(m).toContain('Asha Rao');
    expect(m).toContain('https://x/y');
    expect(m.length).toBeGreaterThan(40);
  });
  it('omits the link line when none supplied', () => {
    const m = buildNudgeMessage('digilocker-pending', { name: 'A', daysOpen: 1, link: null });
    expect(m).not.toContain('http');
  });
});

import { ESCALATE_AFTER_SENDS, escalationTitle, shouldEscalate } from '../ops-nudge.logic.js';

describe('escalation rule', () => {
  it('escalates from the third delivered nudge, once', () => {
    expect(ESCALATE_AFTER_SENDS).toBe(3);
    expect(shouldEscalate(2, false)).toBe(false);
    expect(shouldEscalate(3, false)).toBe(true);
    expect(shouldEscalate(7, false)).toBe(true);
    expect(shouldEscalate(7, true)).toBe(false);
  });
  it('names the joiner, the task and the count', () => {
    expect(escalationTitle('Asha Rao', 'docs-pending', 3)).toBe('Asha Rao still needs to upload your pending joining documents after 3 reminders - please follow up');
  });
});
