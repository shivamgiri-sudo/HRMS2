import { describe, it, expect } from 'vitest';
import {
  joinBucketFor,
  emptyBucketTally,
  classifyAppointmentLetter,
  severityForCount,
  APPOINTMENT_LETTER_SLA_DAYS,
  JOIN_BUCKETS,
} from '../ops-control-tower.logic.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('joinBucketFor', () => {
  it('buckets 0 as Same day and 1-5 as -1..-5', () => {
    expect(joinBucketFor(0)).toBe('Same day');
    expect(joinBucketFor(1)).toBe('-1');
    expect(joinBucketFor(5)).toBe('-5');
  });

  it('buckets anything past 5 days as >5', () => {
    expect(joinBucketFor(6)).toBe('>5');
    expect(joinBucketFor(40)).toBe('>5');
  });

  it('treats a negative lag (joined before the code existed) as Same day, not a crash', () => {
    expect(joinBucketFor(-2)).toBe('Same day');
  });
});

describe('emptyBucketTally', () => {
  it('has one zeroed slot per bucket, in display order', () => {
    const tally = emptyBucketTally();
    expect(Object.keys(tally)).toEqual([...JOIN_BUCKETS]);
    expect(Object.values(tally).every((v) => v === 0)).toBe(true);
  });
});

describe('classifyAppointmentLetter', () => {
  const createdAtMs = Date.UTC(2026, 8, 15); // 15 Sep

  it('is due, not pending, before Day 7', () => {
    const r = classifyAppointmentLetter({ createdAtMs, signedAtMs: null, nowMs: createdAtMs + 3 * DAY_MS });
    expect(r).toMatchObject({ status: 'due', pending: false, daysOverdue: null });
  });

  it('is on time exactly at the Day-7 deadline', () => {
    const dueAt = createdAtMs + APPOINTMENT_LETTER_SLA_DAYS * DAY_MS;
    expect(classifyAppointmentLetter({ createdAtMs, signedAtMs: dueAt, nowMs: dueAt }).status).toBe('signed_on_time');
  });

  it('is overdue and pending one millisecond past Day 7 with nothing signed', () => {
    const dueAt = createdAtMs + APPOINTMENT_LETTER_SLA_DAYS * DAY_MS;
    const r = classifyAppointmentLetter({ createdAtMs, signedAtMs: null, nowMs: dueAt + 1 });
    expect(r.status).toBe('overdue');
    expect(r.pending).toBe(true);
    expect(r.daysOverdue).toBe(0);
  });

  it('reports whole days overdue', () => {
    const dueAt = createdAtMs + APPOINTMENT_LETTER_SLA_DAYS * DAY_MS;
    const r = classifyAppointmentLetter({ createdAtMs, signedAtMs: null, nowMs: dueAt + 5 * DAY_MS + 1 });
    expect(r.daysOverdue).toBe(5);
  });

  it('is signed_late when it eventually gets signed after Day 7 — and never pending', () => {
    const dueAt = createdAtMs + APPOINTMENT_LETTER_SLA_DAYS * DAY_MS;
    const r = classifyAppointmentLetter({ createdAtMs, signedAtMs: dueAt + 2 * DAY_MS, nowMs: dueAt + 3 * DAY_MS });
    expect(r.status).toBe('signed_late');
    expect(r.pending).toBe(false);
  });
});

describe('severityForCount', () => {
  it('is none at zero, low under the medium threshold, medium under high, high at or above', () => {
    expect(severityForCount(0, 3, 8)).toBe('none');
    expect(severityForCount(2, 3, 8)).toBe('low');
    expect(severityForCount(3, 3, 8)).toBe('medium');
    expect(severityForCount(7, 3, 8)).toBe('medium');
    expect(severityForCount(8, 3, 8)).toBe('high');
  });
});
