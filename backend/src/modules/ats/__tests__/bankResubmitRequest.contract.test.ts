import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Fix for the 31-row backlog found 2026-09-07: candidates/employees whose
 * verified bank account number was lost to two now-fixed write bugs. Since
 * only a hash and last-4 survive (neither reversible), the only real
 * recovery is asking the person to re-type it — this is that request.
 */
const onboardingService = readFileSync(
  resolve(process.cwd(), 'src/modules/ats/ats.onboarding.service.ts'),
  'utf8',
);
const emailService = readFileSync(
  resolve(process.cwd(), 'src/modules/ats/ats.email.service.ts'),
  'utf8',
);

describe('sendBankResubmitRequest', () => {
  it('mints a fresh 15-day token rather than reusing a stale one', () => {
    const fn = onboardingService.slice(onboardingService.indexOf('export async function sendBankResubmitRequest'));
    const body = fn.slice(0, fn.indexOf('\n// ── Token Validation'));
    expect(body).toContain('randomUUID() + \'-\' + randomUUID()');
    expect(body).toContain('15 * 24 * 60 * 60 * 1000');
    expect(body).toContain('ON DUPLICATE KEY UPDATE');
  });

  it('never touches ats_candidate.profile_status or writes a stage-log row', () => {
    const fn = onboardingService.slice(onboardingService.indexOf('export async function sendBankResubmitRequest'));
    const body = fn.slice(0, fn.indexOf('\n// ── Token Validation'));
    expect(body).not.toContain('profile_status');
    expect(body).not.toContain('ats_candidate_stage_log');
  });

  it('refuses a candidate marked not_joining', () => {
    const fn = onboardingService.slice(onboardingService.indexOf('export async function sendBankResubmitRequest'));
    const body = fn.slice(0, fn.indexOf('\n// ── Token Validation'));
    expect(body).toContain("candidate_status === 'not_joining'");
    expect(body).toContain('statusCode: 409');
  });

  it('sends the targeted bank-resubmit email, not the generic onboarding-invite one', () => {
    const fn = onboardingService.slice(onboardingService.indexOf('export async function sendBankResubmitRequest'));
    const body = fn.slice(0, fn.indexOf('\n// ── Token Validation'));
    expect(body).toContain('sendBankResubmitEmail(');
    expect(body).not.toContain('sendOnboardingTokenEmail(');
  });

  it('uses email only — SMS/WhatsApp are deliberately not attempted', () => {
    const fn = onboardingService.slice(onboardingService.indexOf('export async function sendBankResubmitRequest'));
    const body = fn.slice(0, fn.indexOf('\n// ── Token Validation'));
    expect(body).not.toContain("providerFactory.getProvider('sms')");
    expect(body).not.toContain("providerFactory.getProvider('whatsapp')");
  });
});

describe('sendBankResubmitEmail', () => {
  it('names the one thing needed without mentioning a system bug', () => {
    const fn = emailService.slice(emailService.indexOf('export async function sendBankResubmitEmail'));
    const body = fn.slice(0, fn.indexOf('\nexport async function sendOfferReviewEmail'));
    expect(body).toContain('re-confirm your bank account number');
    expect(body.toLowerCase()).not.toContain('bug');
    expect(body.toLowerCase()).not.toContain('error');
  });
});
