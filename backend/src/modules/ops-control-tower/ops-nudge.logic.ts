// Pure rules for Ops Control Tower joiner nudges (no DB, no clock — `nowMs` is always passed in).

export const NUDGEABLE_ISSUES = [
  'account-details-missing',
  'docs-pending',
  'penny-drop-missing',
  'digilocker-pending',
  'esign-pending',
  'appointment-letter',
  'bgv-pending',
] as const;
export type NudgeableIssue = (typeof NUDGEABLE_ISSUES)[number];

export function isNudgeableIssue(v: string): v is NudgeableIssue {
  return (NUDGEABLE_ISSUES as readonly string[]).includes(v);
}

/**
 * Issues also chased by the payroll pendency reminder EMAILS (payroll/pendency, pendency_reminder_log).
 * The two senders share one contact ledger for these items so a joiner is not messaged twice in a
 * day: each side counts the other's sent rows toward its own gap/cooldown.
 */
export const SHARED_PENDENCY_KIND: Partial<Record<NudgeableIssue, 'bank_account' | 'digilocker'>> = {
  'account-details-missing': 'bank_account',
  'digilocker-pending': 'digilocker',
};
export const NUDGE_ISSUE_FOR_PENDENCY_KIND: Record<'bank_account' | 'digilocker', NudgeableIssue> = {
  bank_account: 'account-details-missing',
  digilocker: 'digilocker-pending',
};

export const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type AgeingBucket = '0-2' | '3-7' | '8+';

export function ageingBucket(daysOpen: number): AgeingBucket {
  if (daysOpen >= 8) return '8+';
  if (daysOpen >= 3) return '3-7';
  return '0-2';
}

/** Cooldown keyed on the last *successful* send only — failed/unconfigured attempts never block a retry. */
export function cooldownState(
  lastSentMs: number | null,
  nowMs: number,
): { due: boolean; nextEligibleMs: number } {
  if (lastSentMs === null) return { due: true, nextEligibleMs: nowMs };
  const nextEligibleMs = lastSentMs + NUDGE_COOLDOWN_MS;
  return { due: nowMs >= nextEligibleMs, nextEligibleMs };
}

const TASK_TEXT: Record<NudgeableIssue, string> = {
  'account-details-missing': 'add your bank account details',
  'docs-pending': 'upload your pending joining documents',
  'penny-drop-missing': 'complete your bank account verification',
  'digilocker-pending': 'complete your DigiLocker verification',
  'esign-pending': 'e-sign your joining documents',
  'appointment-letter': 'e-sign your appointment letter',
  'bgv-pending': 'complete your background verification',
};

export function buildNudgeMessage(
  issue: NudgeableIssue,
  ctx: { name: string; daysOpen: number; link: string | null },
): string {
  const lines = [
    `Hi ${ctx.name},`,
    '',
    `Your joining formalities are still pending. Please ${TASK_TEXT[issue]} at the earliest.`,
  ];
  if (ctx.link) lines.push('', `Continue here: ${ctx.link}`);
  lines.push('', '— MAS Callnet HR');
  return lines.join('\n');
}

/** After this many delivered nudges for one joiner and issue with the item still open, the branch head is told. */
export const ESCALATE_AFTER_SENDS = 3;

export function shouldEscalate(sentCount: number, alreadyEscalated: boolean): boolean {
  return !alreadyEscalated && sentCount >= ESCALATE_AFTER_SENDS;
}

export function escalationTitle(name: string, issue: NudgeableIssue, sentCount: number): string {
  return `${name} still needs to ${TASK_TEXT[issue]} after ${sentCount} reminders - please follow up`;
}
