import { describe, expect, it } from 'vitest';
import {
  DAILY_ANALYST_TARGET, achievementPct, connectPct, dailyTarget, datesBetween, eligibleDayFraction,
  gap, momPct, monthLabel, monthSlicesUntil, periodTarget, utilizationPct, weightedAvg,
} from '../reginald-metrics.js';

describe('Reginald analyst target (REG-04)', () => {
  it('is 13,500 per present day and 40,500 for three present days', () => {
    expect(DAILY_ANALYST_TARGET).toBe(13500);
    const days = ['present', 'present', 'week_off_worked'];
    expect(days.map(s => dailyTarget(s))).toEqual([13500, 13500, 13500]);
    expect(periodTarget(days.reduce((s, d) => s + eligibleDayFraction(d), 0))).toBe(40500);
  });

  it('earns no target on absent / leave / holiday / week-off / missing punch / no record', () => {
    for (const s of ['absent', 'leave_approved', 'holiday', 'week_off', 'missing_punch', 'unreconciled', '', null, undefined]) {
      expect(dailyTarget(s)).toBe(0);
    }
    const days = ['present', 'absent', 'present', 'present'];
    expect(days.reduce((t, d) => t + dailyTarget(d), 0)).toBe(40500);
  });

  it('counts a half day as half, like the HRMS attendance numerator', () => {
    expect(eligibleDayFraction('half_day')).toBe(0.5);
    expect(dailyTarget('HALF_DAY')).toBe(6750);
  });

  it('gap and achievement follow the KPI sheet examples', () => {
    expect(gap(12150, 13500)).toBe(-1350);
    expect(achievementPct(12150, 13500)).toBe(90);
    expect(gap(15000, 13500)).toBe(1500);
  });

  it('returns N/A (null) achievement when there is no target', () => {
    expect(achievementPct(500, 0)).toBeNull();
    expect(achievementPct(0, 0)).toBeNull();
  });
});

describe('Connect % (unique connect / unique dialed)', () => {
  it('uses unique counts and guards a zero denominator', () => {
    expect(connectPct(45, 180)).toBe(25);
    expect(connectPct(0, 0)).toBe(0);
    expect(connectPct(1, 3)).toBe(33.33);
  });
});

describe('MoM change %', () => {
  it('is (current - previous) / previous', () => {
    expect(momPct(110, 100)).toBe(10);
    expect(momPct(80, 100)).toBe(-20);
  });
  it('is N/A when the previous month is zero or missing', () => {
    expect(momPct(50, 0)).toBeNull();
    expect(momPct(50, null)).toBeNull();
    expect(momPct(50, undefined)).toBeNull();
  });
});

describe('weighted averages and utilization', () => {
  it('averages over the pooled denominator, not an average of averages', () => {
    // Day A: 10 calls, 600 s talk (avg 60). Day B: 90 calls, 1800 s (avg 20).
    // Average of averages would be 40; the weighted average is 24.
    expect(weightedAvg(600 + 1800, 10 + 90)).toBe(24);
    expect(weightedAvg(100, 0)).toBe(0);
  });
  it('utilization = (talk + wait) / net login', () => {
    expect(utilizationPct(3000, 1500, 6000)).toBe(75);
    expect(utilizationPct(10, 10, 0)).toBe(0);
  });
});

describe('month slices', () => {
  it('lists every month in range, empty ones included, but never a future month', () => {
    const s = monthSlicesUntil('2026-08-10', '2026-12-31', '2026-10-13');
    expect(s.map(x => x.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(s[0]).toEqual({ month: '2026-08', from: '2026-08-10', to: '2026-08-31' });
    expect(s[2].to).toBe('2026-10-13');
    expect(monthSlicesUntil('2026-11-01', '2026-11-30', '2026-10-13')).toEqual([]);
  });
  it('crosses a year end and labels months', () => {
    expect(monthSlicesUntil('2025-12-01', '2026-01-31', '2026-10-13').map(x => x.month)).toEqual(['2025-12', '2026-01']);
    expect(monthLabel('2026-09')).toBe('Sep-26');
  });
  it('lists dates inclusively', () => {
    expect(datesBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });
});
