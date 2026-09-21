import { describe, it, expect } from 'vitest';
import {
  addDays,
  classifyCell,
  currentWeekStart,
  deadlineMs,
  planEscalations,
  stageTriggerMs,
  weekStartOf,
  weekWindow,
  istEpoch,
  type EscalationStage,
} from '../roster-upload-tracker.logic.js';

// W/C Monday 21 Sep 2026 → deadline Sunday 20 Sep 2026 18:00 IST.
const WEEK = '2026-09-21';
const at = (date: string, hour: number, minute = 0) => istEpoch(date, hour) + minute * 60_000;

describe('week arithmetic', () => {
  it('finds the Monday of any day in the week', () => {
    expect(weekStartOf('2026-09-21')).toBe('2026-09-21'); // Monday
    expect(weekStartOf('2026-09-24')).toBe('2026-09-21'); // Thursday
    expect(weekStartOf('2026-09-27')).toBe('2026-09-21'); // Sunday belongs to the week that started Monday
    expect(weekStartOf('2026-09-28')).toBe('2026-09-28');
  });

  it('adds days across a month boundary', () => {
    expect(addDays('2026-09-28', 7)).toBe('2026-10-05');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
  });

  it('reads the current week in IST, not UTC', () => {
    // Sun 20 Sep 2026 22:00 UTC is already Mon 21 Sep 03:30 IST
    expect(currentWeekStart(Date.UTC(2026, 8, 20, 22, 0))).toBe('2026-09-21');
    expect(currentWeekStart(Date.UTC(2026, 8, 20, 10, 0))).toBe('2026-09-14');
  });

  it('builds consecutive week starts', () => {
    expect(weekWindow('2026-09-07', 3)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21']);
  });

  it('puts the deadline on the Sunday before at 18:00 IST', () => {
    expect(deadlineMs(WEEK)).toBe(Date.UTC(2026, 8, 20, 12, 30)); // 18:00 IST = 12:30 UTC
  });
});

describe('classifyCell', () => {
  const base = { expected: 45, covered: 45, weekStart: WEEK, firstCommitAtMs: null };

  it('is uploaded when full coverage landed before the deadline', () => {
    const r = classifyCell({ ...base, fullCoverageAtMs: at('2026-09-19', 11), nowMs: at('2026-09-21', 9) });
    expect(r.status).toBe('uploaded');
  });

  it('treats exactly 18:00 Sunday as on time and 18:01 as delayed', () => {
    const now = at('2026-09-21', 9);
    expect(classifyCell({ ...base, fullCoverageAtMs: at('2026-09-20', 18), nowMs: now }).status).toBe('uploaded');
    const late = classifyCell({ ...base, fullCoverageAtMs: at('2026-09-20', 18, 1), nowMs: now });
    expect(late.status).toBe('delayed');
  });

  it('reports how many hours late a delayed upload was', () => {
    const r = classifyCell({ ...base, fullCoverageAtMs: at('2026-09-21', 10, 30), nowMs: at('2026-09-21', 12) });
    expect(r.status).toBe('delayed');
    expect(r.hoursLate).toBe(16.5);
  });

  it('is missing once the deadline passed with nothing uploaded', () => {
    const r = classifyCell({ ...base, covered: 0, fullCoverageAtMs: null, nowMs: at('2026-09-21', 18) });
    expect(r.status).toBe('missing');
    expect(r.hoursLate).toBe(24);
  });

  it('is due, with the time left, before the deadline', () => {
    const r = classifyCell({ ...base, covered: 0, fullCoverageAtMs: null, nowMs: at('2026-09-18', 18) });
    expect(r.status).toBe('due');
    expect(r.hoursToDeadline).toBe(48);
  });

  it('is partial when only some of the employees are covered — before or after the deadline', () => {
    const before = classifyCell({ ...base, covered: 38, fullCoverageAtMs: null, nowMs: at('2026-09-19', 9) });
    const after = classifyCell({ ...base, covered: 38, fullCoverageAtMs: null, nowMs: at('2026-09-21', 9) });
    expect(before.status).toBe('partial');
    expect(after.status).toBe('partial');
    expect(after.hoursLate).toBe(15);
  });

  it('never calls a process with no employees uploaded', () => {
    const r = classifyCell({ ...base, expected: 0, covered: 0, fullCoverageAtMs: null, nowMs: at('2026-09-19', 9) });
    expect(r.status).toBe('due');
  });
});

describe('stage triggers', () => {
  it('fires Fri 10:00, Sun 12:00, Sun 18:00 and Mon 10:00 IST', () => {
    expect(stageTriggerMs(WEEK, 'reminder')).toBe(at('2026-09-18', 10));
    expect(stageTriggerMs(WEEK, 'heads_up')).toBe(at('2026-09-20', 12));
    expect(stageTriggerMs(WEEK, 'missing')).toBe(deadlineMs(WEEK));
    expect(stageTriggerMs(WEEK, 'escalated')).toBe(at('2026-09-21', 10));
  });
});

describe('planEscalations', () => {
  const cell = (status: 'due' | 'partial' | 'missing' | 'delayed' | 'uploaded', sent: EscalationStage[] = []) => ({
    key: 'k',
    weekStart: WEEK,
    status,
    sentStages: new Set(sent),
  });

  it('sends nothing before the Friday reminder', () => {
    expect(planEscalations([cell('due')], at('2026-09-18', 9, 59))).toEqual([]);
  });

  it('walks the ladder as time passes', () => {
    expect(planEscalations([cell('due')], at('2026-09-18', 10))).toEqual([{ key: 'k', stage: 'reminder' }]);
    expect(planEscalations([cell('due', ['reminder'])], at('2026-09-20', 12))).toEqual([{ key: 'k', stage: 'heads_up' }]);
    expect(planEscalations([cell('missing', ['reminder', 'heads_up'])], at('2026-09-20', 18))).toEqual([
      { key: 'k', stage: 'missing' },
    ]);
    expect(planEscalations([cell('missing', ['missing'])], at('2026-09-21', 10))).toEqual([
      { key: 'k', stage: 'escalated' },
    ]);
  });

  it('sends only the highest owed stage when switched on late', () => {
    expect(planEscalations([cell('missing')], at('2026-09-21', 11))).toEqual([{ key: 'k', stage: 'escalated' }]);
  });

  it('never repeats a stage already sent', () => {
    expect(planEscalations([cell('missing', ['escalated'])], at('2026-09-21', 15))).toEqual([]);
  });

  it('keeps chasing a partial upload', () => {
    expect(planEscalations([cell('partial')], at('2026-09-21', 11))).toEqual([{ key: 'k', stage: 'escalated' }]);
  });

  it('is silent for an on-time upload', () => {
    expect(planEscalations([cell('uploaded')], at('2026-09-21', 11))).toEqual([]);
  });

  it('sends one "uploaded late" note, and only if someone was alerted first', () => {
    expect(planEscalations([cell('delayed', ['missing'])], at('2026-09-21', 12))).toEqual([
      { key: 'k', stage: 'late_upload' },
    ]);
    expect(planEscalations([cell('delayed', ['missing', 'late_upload'])], at('2026-09-21', 13))).toEqual([]);
    expect(planEscalations([cell('delayed')], at('2026-09-21', 12))).toEqual([]);
  });
});
