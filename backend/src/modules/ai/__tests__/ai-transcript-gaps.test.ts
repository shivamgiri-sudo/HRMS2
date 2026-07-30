import { describe, expect, it } from 'vitest';
import { detectMiraIntent } from '../ai-account.service.js';
import { COMPANY_SYSTEM_INSTRUCTION } from '../ai-company-knowledge.service.js';

/**
 * Every question here was asked by a real user in a real session and answered
 * with "I couldn't find that in HRMS or the approved MAS Callnet sources."
 * They are kept verbatim, speech-to-text mangling included, because that is the
 * form they actually arrive in.
 */
describe('questions that were refused in a live session', () => {
  it.each([
    ["what's my end time today", 'roster'],
    ['what is my shift end time', 'roster'],
    ['when does my shift end', 'roster'],
    ['what time do i end today', 'roster'],
    ['any unread inbox item', 'pending_actions'],
    // Speech-to-text splits "inbox" into two words.
    ['any unread work in box item', 'pending_actions'],
    ['can you tell me status of my team', 'coach'],
    // "highlight in low light" is how "highlights and lowlights" comes through.
    ["what's the highlight in low light for yesterday", 'coach'],
    ['show me the highlights and lowlights', 'coach'],
    ['how is my team doing', 'coach'],
  ])('%s now routes to %s', (question, intent) => {
    expect(detectMiraIntent(question)).toBe(intent);
  });
});

describe('questions that already worked keep working', () => {
  it.each([
    ["what's my punching time today", 'attendance'],
    ['is there any approval pending from my end', 'pending_actions'],
    ['show my attendance for today', 'attendance'],
    ['my leave balance', 'leave'],
    ['show my latest salary breakup', 'salary'],
    ['coach me', 'coach'],
    ['my roster', 'roster'],
  ])('%s still routes to %s', (question, intent) => {
    expect(detectMiraIntent(question)).toBe(intent);
  });

  it.each([
    'attendance of Rahul',
    'salary for Priya',
    'payslip for the other employee',
    'show me his salary',
  ])('still refuses %s', (question) => {
    expect(detectMiraIntent(question)).toBe('scope_violation');
  });

  /**
   * Known gap, pre-existing and unchanged by the patterns added here: the guard
   * matches "<subject> of <person>" but not the reverse orderings, so
   * "status of Rahul attendance" and "show me Rahul leave balance" are not
   * refused. Verified identical on origin/main before these changes.
   *
   * It is not a disclosure. These route to the self-account handler, which reads
   * the caller's own employee id and ignores the name entirely — the asker gets
   * their own attendance, not Rahul's. Recorded so the gap is visible and so
   * nobody reads the refusal list above as complete.
   */
  it.each([
    'status of Rahul attendance',
    'Rahul attendance status',
    'show me Rahul leave balance',
  ])('does not yet refuse %s, but answers about the caller only', (question) => {
    expect(detectMiraIntent(question)).not.toBe('scope_violation');
  });
});

describe('the assistant does not describe its own plumbing', () => {
  /**
   * A live session produced: "For personal HR questions like your work schedule,
   * please use the secure self-account service." The model was repeating an
   * internal routing rule back to the user — and the self-account service is
   * Mira, so it read as being told to go and use the thing they were using.
   */
  it('no longer instructs the model in words it can repeat as advice', () => {
    expect(COMPANY_SYSTEM_INSTRUCTION).not.toMatch(/must be answered only by the secure self-account service/i);
  });

  it('forbids naming internal components to the user', () => {
    expect(COMPANY_SYSTEM_INSTRUCTION).toMatch(/never describe how this system is built/i);
    expect(COMPANY_SYSTEM_INSTRUCTION).toMatch(/telling them to use "the self-account service" is telling them to use you/i);
  });

  it('keeps the privacy rule it was tangled up with', () => {
    expect(COMPANY_SYSTEM_INSTRUCTION).toMatch(/Never request or reveal another employee's personal information/);
  });
});
