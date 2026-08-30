// backend/src/modules/wfm/__tests__/floor-absence-pattern.test.ts
//
// Requirement 10 (Floor Absence Pattern Detection). Every test names the criterion it covers.
// The detector is pure, so nothing is mocked except the db module of
// attendance-threshold-config.service.ts, which is imported by the last test purely to assert
// that the duplicated 60-minute default (criterion 10.4) has not drifted from the DB-backed
// resolver's copy of it.
import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';

vi.mock('../../../db/mysql.js', () => ({
  db: { execute: vi.fn() },
}));

import {
  detectFloorAbsencePattern,
  DEFAULT_FLOOR_ABSENCE_CEILING_MINUTES,
  DEFAULT_REPEAT_THRESHOLD_COUNT,
  DEFAULT_ROLLING_WINDOW_DAYS,
  type FloorAbsenceDayInput,
  type FloorAbsenceDetectionInput,
} from '../floor-absence-pattern.js';
import type { Contribution } from '../canonical-productivity.js';

function magnitudeOnly(diallerSourceId: string, magnitudeMinutes: number): Contribution {
  // interval: null is the shape dialer_session_log / apr_manual_upload actually produce.
  return { diallerSourceId, interval: null, magnitudeMinutes };
}

function withInterval(diallerSourceId: string, startMinute: number, endMinute: number): Contribution {
  return { diallerSourceId, interval: { startMinute, endMinute }, magnitudeMinutes: endMinute - startMinute };
}

/** A day that, on its own defaults, is a criterion 10.1 occurrence. */
function day(overrides: Partial<FloorAbsenceDayInput> & { date: string }): FloorAbsenceDayInput {
  return {
    classification: 'present',
    biometricMinutes: 540,
    fullDayMinutes: 480,
    contributions: [magnitudeOnly('src-a', 20)],
    punchCount: null,
    firstPunchMinute: null,
    lastPunchMinute: null,
    ...overrides,
  };
}

function detectionInput(
  days: FloorAbsenceDayInput[],
  overrides: Partial<FloorAbsenceDetectionInput> = {},
): FloorAbsenceDetectionInput {
  return {
    employeeId: 'emp-1',
    payMonth: '2026-07',
    floorAbsenceCeilingMinutes: 60,
    days,
    // criterion 10.10's look-back needs a track record before the month's first date.
    priorDiallerActivityDates: ['2026-06-30'],
    ...overrides,
  };
}

function reasonFor(
  result: ReturnType<typeof detectFloorAbsencePattern>,
  date: string,
): string | undefined {
  return result.suppressions.find((s) => s.date === date)?.reason;
}

describe('detectFloorAbsencePattern — criterion 10.1 (full biometric day, low productivity)', () => {
  it('records an occurrence when biometric reaches the full-day threshold and canonical minutes fall below the ceiling', () => {
    const result = detectFloorAbsencePattern(detectionInput([day({ date: '2026-07-10' })]));

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({
      employeeId: 'emp-1',
      date: '2026-07-10',
      reason: 'productive_minutes_below_ceiling',
      biometricMinutes: 540,
      canonicalProductiveMinutes: 20,
      canonicalRule: 'max_contribution',
      appliedCeilingMinutes: 60,
      appliedFullDayMinutes: 480,
    });
    expect(result.occurrences[0].contributingSources).toEqual([
      { diallerSourceId: 'src-a', minutes: 20 },
    ]);
    expect(result.suppressions).toEqual([]);
  });

  it('records an occurrence when biometric is exactly at the full-day threshold ("reach", not exceed)', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10', biometricMinutes: 480 })]),
    );
    expect(result.occurrences).toHaveLength(1);
  });

  it('records no occurrence when biometric is one minute short of the full-day threshold', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10', biometricMinutes: 479 })]),
    );
    expect(result.occurrences).toEqual([]);
    expect(reasonFor(result, '2026-07-10')).toBe('biometric_below_full_day');
  });

  it('records no occurrence when there is no biometric record for the date at all', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10', biometricMinutes: null })]),
    );
    expect(result.occurrences).toEqual([]);
    expect(reasonFor(result, '2026-07-10')).toBe('biometric_below_full_day');
  });
});

describe('detectFloorAbsencePattern — the ceiling boundary (criterion 10.1 "fall below")', () => {
  it('one minute below the ceiling is an occurrence', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10', contributions: [magnitudeOnly('src-a', 59)] })]),
    );
    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0].canonicalProductiveMinutes).toBe(59);
  });

  it('exactly at the ceiling is NOT an occurrence — "fall below" is strict', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10', contributions: [magnitudeOnly('src-a', 60)] })]),
    );
    expect(result.occurrences).toEqual([]);
    expect(reasonFor(result, '2026-07-10')).toBe('productive_minutes_at_or_above_ceiling');
  });

  it('one minute above the ceiling is NOT an occurrence', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10', contributions: [magnitudeOnly('src-a', 61)] })]),
    );
    expect(result.occurrences).toEqual([]);
    expect(reasonFor(result, '2026-07-10')).toBe('productive_minutes_at_or_above_ceiling');
  });
});

describe('detectFloorAbsencePattern — criterion 10.4 (default ceiling)', () => {
  it('applies 60 minutes when no ceiling is configured', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10', contributions: [magnitudeOnly('src-a', 59)] })], {
        floorAbsenceCeilingMinutes: null,
      }),
    );
    expect(DEFAULT_FLOOR_ABSENCE_CEILING_MINUTES).toBe(60);
    expect(result.appliedCeilingMinutes).toBe(60);
    expect(result.occurrences).toHaveLength(1);
  });

  it('applies the default rather than a malformed stored ceiling (0 or negative)', () => {
    for (const bad of [0, -30, Number.NaN]) {
      const result = detectFloorAbsencePattern(
        detectionInput([day({ date: '2026-07-10' })], { floorAbsenceCeilingMinutes: bad }),
      );
      expect(result.appliedCeilingMinutes).toBe(60);
      expect(result.occurrences).toHaveLength(1);
    }
  });

  it('honours a configured ceiling above the default', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10', contributions: [magnitudeOnly('src-a', 90)] })], {
        floorAbsenceCeilingMinutes: 120,
      }),
    );
    expect(result.appliedCeilingMinutes).toBe(120);
    expect(result.occurrences).toHaveLength(1);
  });
});

describe('detectFloorAbsencePattern — criteria 10.3 and 10.11 (no evidence, no finding)', () => {
  it('records no occurrence when no registered source carried a record for the date', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10', contributions: [] })]),
    );
    expect(result.occurrences).toEqual([]);
    expect(reasonFor(result, '2026-07-10')).toBe('no_productivity_evidence');
  });

  it('treats a zero productivity figure as filler, not as a measurement (criterion 10.3)', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10', contributions: [magnitudeOnly('src-a', 0)] })]),
    );
    expect(result.occurrences).toEqual([]);
    expect(reasonFor(result, '2026-07-10')).toBe('no_productivity_evidence');
  });

  it('a negative or non-finite magnitude is not evidence either', () => {
    for (const junk of [-120, Number.NaN]) {
      const result = detectFloorAbsencePattern(
        detectionInput([day({ date: '2026-07-10', contributions: [magnitudeOnly('src-a', junk)] })]),
      );
      expect(result.occurrences).toEqual([]);
      expect(reasonFor(result, '2026-07-10')).toBe('no_productivity_evidence');
    }
  });
});

describe('detectFloorAbsencePattern — criterion 10.5 (two-punch pattern)', () => {
  it('records the two-punch reason when two punches span a full day and every reporting source is below the ceiling', () => {
    // Per-source minutes are 50 and 50 (both below the 60 ceiling) while the union is 90, so
    // criterion 10.1 does not fire. Criterion 10.5 does, and dictates the stated reason.
    const result = detectFloorAbsencePattern(
      detectionInput([
        day({
          date: '2026-07-10',
          contributions: [withInterval('src-a', 0, 50), withInterval('src-b', 40, 90)],
          punchCount: 2,
          firstPunchMinute: 540,
          lastPunchMinute: 1080,
        }),
      ]),
    );

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({
      reason: 'two_punch_full_span',
      punchSpanMinutes: 540,
      canonicalProductiveMinutes: 90,
      canonicalRule: 'interval_union',
    });
    expect(result.occurrences[0].contributingSources).toEqual([
      { diallerSourceId: 'src-a', minutes: 50 },
      { diallerSourceId: 'src-b', minutes: 50 },
    ]);
  });

  it('does not fire the two-punch branch when the punch span is short of the full-day threshold', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([
        day({
          date: '2026-07-10',
          biometricMinutes: 400,
          contributions: [withInterval('src-a', 0, 50), withInterval('src-b', 40, 90)],
          punchCount: 2,
          firstPunchMinute: 540,
          lastPunchMinute: 1019,
        }),
      ]),
    );
    expect(result.occurrences).toEqual([]);
    expect(reasonFor(result, '2026-07-10')).toBe('biometric_below_full_day');
  });

  it('does not fire the two-punch branch on more than two punches', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([
        day({
          date: '2026-07-10',
          contributions: [withInterval('src-a', 0, 50), withInterval('src-b', 40, 90)],
          punchCount: 4,
          firstPunchMinute: 540,
          lastPunchMinute: 1080,
        }),
      ]),
    );
    expect(result.occurrences).toEqual([]);
    expect(reasonFor(result, '2026-07-10')).toBe('productive_minutes_at_or_above_ceiling');
  });

  it('does not fire the two-punch branch when one reporting source is at or above the ceiling', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([
        day({
          date: '2026-07-10',
          contributions: [withInterval('src-a', 0, 50), withInterval('src-b', 40, 100)],
          punchCount: 2,
          firstPunchMinute: 540,
          lastPunchMinute: 1080,
        }),
      ]),
    );
    expect(result.occurrences).toEqual([]);
    expect(reasonFor(result, '2026-07-10')).toBe('productive_minutes_at_or_above_ceiling');
  });
});

describe('detectFloorAbsencePattern — criterion 10.10 (30-day dialler look-back)', () => {
  it('records no occurrence when no registered source carried a record in the preceding 30 days', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10' })], { priorDiallerActivityDates: [] }),
    );
    expect(result.occurrences).toEqual([]);
    expect(reasonFor(result, '2026-07-10')).toBe('no_dialler_activity_in_lookback');
  });

  it('activity exactly 30 days before the date satisfies the look-back', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-31' })], { priorDiallerActivityDates: ['2026-07-01'] }),
    );
    expect(result.occurrences).toHaveLength(1);
  });

  it('activity 31 days before the date does not satisfy the look-back', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-31' })], { priorDiallerActivityDates: ['2026-06-30'] }),
    );
    expect(result.occurrences).toEqual([]);
    expect(reasonFor(result, '2026-07-31')).toBe('no_dialler_activity_in_lookback');
  });

  it('an earlier date inside the month supplies the look-back activity for a later one', () => {
    const result = detectFloorAbsencePattern(
      detectionInput(
        [
          day({ date: '2026-07-02', contributions: [magnitudeOnly('src-a', 300)] }),
          day({ date: '2026-07-09' }),
        ],
        { priorDiallerActivityDates: [] },
      ),
    );
    expect(result.occurrences.map((o) => o.date)).toEqual(['2026-07-09']);
    // 07-02 itself has no history behind it, which is exactly what criterion 10.10 says.
    expect(reasonFor(result, '2026-07-02')).toBe('no_dialler_activity_in_lookback');
  });
});

describe('detectFloorAbsencePattern — criterion 6.7 with 10.6 (non-working classifications)', () => {
  it('records no occurrence on approved leave, holiday or week off even when the minutes would qualify', () => {
    for (const classification of ['leave_approved', 'holiday', 'week_off'] as const) {
      const result = detectFloorAbsencePattern(
        detectionInput([day({ date: '2026-07-10', classification })]),
      );
      expect(result.occurrences).toEqual([]);
      expect(reasonFor(result, '2026-07-10')).toBe('non_working_classification');
      expect(result.varianceRequests).toEqual([]);
    }
  });

  it('still records an occurrence on a worked week off (week_off_worked) — the floor was staffed that day', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10', classification: 'week_off_worked' })]),
    );
    expect(result.occurrences).toHaveLength(1);
  });
});

describe('detectFloorAbsencePattern — criterion 10.6 with 6.8 (Variance_Record request and disposition)', () => {
  it('emits exactly one always-queued Variance_Record request per occurrence', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10' }), day({ date: '2026-07-11' })]),
    );
    expect(result.occurrences).toHaveLength(2);
    expect(result.varianceRequests).toEqual([
      {
        employeeId: 'emp-1',
        date: '2026-07-10',
        reason: 'productive_minutes_below_ceiling',
        isFloorAbsence: true,
        dispositionHint: 'queued_for_dual_review',
      },
      {
        employeeId: 'emp-1',
        date: '2026-07-11',
        reason: 'productive_minutes_below_ceiling',
        isFloorAbsence: true,
        dispositionHint: 'queued_for_dual_review',
      },
    ]);
  });
});

describe('detectFloorAbsencePattern — criteria 10.7 and 10.8 (repeat count over a rolling window)', () => {
  it('marks the employee a repeat subject at three occurrences within 30 days and names both recipients', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-05' }), day({ date: '2026-07-12' }), day({ date: '2026-07-20' })]),
    );

    expect(result.occurrences).toHaveLength(3);
    expect(result.repeat.isRepeatSubject).toBe(true);
    expect(result.repeat.appliedThresholdCount).toBe(DEFAULT_REPEAT_THRESHOLD_COUNT);
    expect(result.repeat.appliedRollingWindowDays).toBe(DEFAULT_ROLLING_WINDOW_DAYS);
    expect(result.repeat.triggeringWindow).toEqual({
      startDate: '2026-06-21',
      endDate: '2026-07-20',
      occurrenceDates: ['2026-07-05', '2026-07-12', '2026-07-20'],
    });
    expect(result.repeat.notifyRoles).toEqual(['branch_head', 'wfm_head']);
  });

  it('does not mark a repeat subject on two occurrences', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-05' }), day({ date: '2026-07-12' })]),
    );
    expect(result.occurrences).toHaveLength(2);
    expect(result.repeat.isRepeatSubject).toBe(false);
    expect(result.repeat.triggeringWindow).toBeNull();
    expect(result.repeat.notifyRoles).toEqual([]);
  });

  it('does not mark a repeat subject when three occurrences do not fit one 30-day window', () => {
    // 07-01, 07-16 and 07-31 span 31 days inclusive, so no 30-day window holds all three, and
    // no window holds three. The window is 30 days INCLUSIVE of the date closing it.
    const result = detectFloorAbsencePattern(
      detectionInput(
        [day({ date: '2026-07-01' }), day({ date: '2026-07-16' }), day({ date: '2026-07-31' })],
        { priorDiallerActivityDates: ['2026-06-30', '2026-07-15', '2026-07-30'] },
      ),
    );
    expect(result.occurrences).toHaveLength(3);
    expect(result.repeat.isRepeatSubject).toBe(false);
  });

  it('counts occurrences carried in from before the Pay_Month', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-02' })], {
        priorOccurrenceDates: ['2026-06-20', '2026-06-28'],
      }),
    );
    expect(result.occurrences).toHaveLength(1);
    expect(result.repeat.isRepeatSubject).toBe(true);
    expect(result.repeat.triggeringWindow?.occurrenceDates).toEqual([
      '2026-06-20',
      '2026-06-28',
      '2026-07-02',
    ]);
  });

  it('honours a configured repeat threshold and window', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-05' }), day({ date: '2026-07-06' })], {
        repeatThresholdCount: 2,
        rollingWindowDays: 7,
      }),
    );
    expect(result.repeat.isRepeatSubject).toBe(true);
    expect(result.repeat.appliedThresholdCount).toBe(2);
    expect(result.repeat.appliedRollingWindowDays).toBe(7);
  });

  it('a week off between occurrences neither breaks nor suppresses the count — the pattern is a count, not a run', () => {
    // The reading this module implements: Requirement 10 describes no consecutive-day run, so a
    // week off sitting between occurrences is irrelevant to the repeat count. Here 07-06, 07-08
    // and 07-09 are occurrences with a week off on 07-07; the week off is suppressed as a day
    // and changes nothing about the count.
    const result = detectFloorAbsencePattern(
      detectionInput([
        day({ date: '2026-07-06' }),
        day({ date: '2026-07-07', classification: 'week_off' }),
        day({ date: '2026-07-08' }),
        day({ date: '2026-07-09' }),
      ]),
    );
    expect(result.occurrences.map((o) => o.date)).toEqual(['2026-07-06', '2026-07-08', '2026-07-09']);
    expect(reasonFor(result, '2026-07-07')).toBe('non_working_classification');
    expect(result.repeat.isRepeatSubject).toBe(true);
  });

  it('a fully worked day between occurrences likewise neither breaks nor suppresses the count', () => {
    // Same shape as the week-off case but with a genuinely productive day in the middle. Under
    // a consecutive-run reading these two tests would disagree; under the count reading they
    // agree, which is the whole point of choosing it.
    const result = detectFloorAbsencePattern(
      detectionInput([
        day({ date: '2026-07-06' }),
        day({ date: '2026-07-07', contributions: [magnitudeOnly('src-a', 460)] }),
        day({ date: '2026-07-08' }),
        day({ date: '2026-07-09' }),
      ]),
    );
    expect(result.occurrences.map((o) => o.date)).toEqual(['2026-07-06', '2026-07-08', '2026-07-09']);
    expect(reasonFor(result, '2026-07-07')).toBe('productive_minutes_at_or_above_ceiling');
    expect(result.repeat.isRepeatSubject).toBe(true);
  });
});

describe('detectFloorAbsencePattern — totality (empty month, gaps, bad dates)', () => {
  it('an empty month returns an empty result rather than throwing', () => {
    const result = detectFloorAbsencePattern(detectionInput([]));
    expect(result).toEqual({
      employeeId: 'emp-1',
      payMonth: '2026-07',
      appliedCeilingMinutes: 60,
      occurrences: [],
      suppressions: [],
      duplicateDates: [],
      varianceRequests: [],
      repeat: {
        isRepeatSubject: false,
        appliedThresholdCount: 3,
        appliedRollingWindowDays: 30,
        triggeringWindow: null,
        notifyRoles: [],
      },
    });
  });

  it('a month with gaps (most dates simply absent) evaluates the supplied dates only', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-03' }), day({ date: '2026-07-27' })]),
    );
    expect(result.occurrences.map((o) => o.date)).toEqual(['2026-07-03', '2026-07-27']);
    expect(result.suppressions).toEqual([]);
  });

  it('an unparseable or impossible date is suppressed, not guessed and not thrown', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([
        day({ date: '2026-07-10' }),
        day({ date: '2026-02-30' }),
        day({ date: '10-07-2026' }),
        day({ date: '' }),
      ]),
    );
    expect(result.occurrences.map((o) => o.date)).toEqual(['2026-07-10']);
    expect(result.suppressions.filter((s) => s.reason === 'invalid_date').map((s) => s.date).sort()).toEqual(
      ['', '10-07-2026', '2026-02-30'],
    );
  });

  it('a leap day is a valid date', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2028-02-29' })], { priorDiallerActivityDates: ['2028-02-28'] }),
    );
    expect(result.occurrences.map((o) => o.date)).toEqual(['2028-02-29']);
  });
});

describe('detectFloorAbsencePattern — duplicate dates', () => {
  it('collapses byte-identical duplicate rows to one occurrence and reports the collapse', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([day({ date: '2026-07-10' }), day({ date: '2026-07-10' })]),
    );
    expect(result.occurrences).toHaveLength(1);
    expect(result.varianceRequests).toHaveLength(1);
    expect(result.duplicateDates).toEqual([
      { date: '2026-07-10', entryCount: 2, resolution: 'collapsed_identical' },
    ]);
  });

  it('treats duplicate rows differing only in contribution order as identical', () => {
    const a = magnitudeOnly('src-a', 20);
    const b = magnitudeOnly('src-b', 15);
    const result = detectFloorAbsencePattern(
      detectionInput([
        day({ date: '2026-07-10', contributions: [a, b] }),
        day({ date: '2026-07-10', contributions: [b, a] }),
      ]),
    );
    expect(result.occurrences).toHaveLength(1);
    expect(result.duplicateDates[0].resolution).toBe('collapsed_identical');
  });

  it('suppresses a date whose duplicate rows disagree rather than picking one', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([
        day({ date: '2026-07-10' }),
        day({ date: '2026-07-10', contributions: [magnitudeOnly('src-a', 400)] }),
      ]),
    );
    expect(result.occurrences).toEqual([]);
    expect(reasonFor(result, '2026-07-10')).toBe('conflicting_duplicate_date');
    expect(result.duplicateDates).toEqual([
      { date: '2026-07-10', entryCount: 2, resolution: 'suppressed_conflicting' },
    ]);
  });

  it('never lets one date count twice toward the repeat threshold', () => {
    const result = detectFloorAbsencePattern(
      detectionInput([
        day({ date: '2026-07-10' }),
        day({ date: '2026-07-10' }),
        day({ date: '2026-07-10' }),
      ]),
    );
    expect(result.occurrences).toHaveLength(1);
    expect(result.repeat.isRepeatSubject).toBe(false);
  });
});

describe('detectFloorAbsencePattern — order independence and purity', () => {
  const days = [
    day({ date: '2026-07-06' }),
    day({ date: '2026-07-07', classification: 'week_off' }),
    day({ date: '2026-07-12', contributions: [magnitudeOnly('src-a', 300)] }),
    day({ date: '2026-07-18' }),
    day({ date: '2026-07-25', contributions: [] }),
    day({ date: '2026-07-28' }),
  ];

  it('the same days in reverse order produce an identical result', () => {
    const forward = detectFloorAbsencePattern(detectionInput(days));
    const reversed = detectFloorAbsencePattern(detectionInput([...days].reverse()));
    expect(reversed).toEqual(forward);
  });

  it('any permutation of the days produces an identical result', () => {
    // Ordering independence as a property: the detector sorts its own input, so no caller's
    // query ORDER BY can change who gets flagged.
    const dayArb = fc
      .uniqueArray(fc.integer({ min: 1, max: 28 }), { minLength: 0, maxLength: 12 })
      .chain((daysOfMonth) =>
        fc.tuple(
          fc.constant(daysOfMonth),
          fc.array(fc.integer({ min: 0, max: 200 }), {
            minLength: daysOfMonth.length,
            maxLength: daysOfMonth.length,
          }),
          fc.array(fc.integer({ min: 0, max: 600 }), {
            minLength: daysOfMonth.length,
            maxLength: daysOfMonth.length,
          }),
        ),
      )
      .map(([daysOfMonth, minutes, biometric]) =>
        daysOfMonth.map((dayOfMonth, i) =>
          day({
            date: `2026-07-${String(dayOfMonth).padStart(2, '0')}`,
            biometricMinutes: biometric[i],
            contributions: minutes[i] === 0 ? [] : [magnitudeOnly('src-a', minutes[i])],
          }),
        ),
      );

    fc.assert(
      fc.property(
        dayArb.chain((built) =>
          fc.tuple(
            fc.constant(built),
            built.length > 0
              ? fc.shuffledSubarray(built, { minLength: built.length, maxLength: built.length })
              : fc.constant(built),
          ),
        ),
        ([original, shuffled]) => {
          const a = detectFloorAbsencePattern(detectionInput(original));
          const b = detectFloorAbsencePattern(detectionInput(shuffled));
          expect(b).toEqual(a);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('two runs over unchanged input return the same result and the input is never mutated', () => {
    const snapshot = JSON.stringify(days);
    const first = detectFloorAbsencePattern(detectionInput(days));
    const second = detectFloorAbsencePattern(detectionInput(days));
    expect(second).toEqual(first);
    expect(JSON.stringify(days)).toBe(snapshot);
  });
});

describe('criterion 10.4 default has not drifted from the DB-backed resolver', () => {
  it('matches DEFAULT_THRESHOLD_MINUTES.floor_absence_ceiling', async () => {
    const { DEFAULT_THRESHOLD_MINUTES } = await import('../attendance-threshold-config.service.js');
    expect(DEFAULT_FLOOR_ABSENCE_CEILING_MINUTES).toBe(
      DEFAULT_THRESHOLD_MINUTES.floor_absence_ceiling,
    );
  });
});
