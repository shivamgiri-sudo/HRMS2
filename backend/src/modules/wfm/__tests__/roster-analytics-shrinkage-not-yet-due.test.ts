/**
 * Regression test for the "shift not started yet = 100% shrinkage" bug found live 2026-09-11 on
 * Roster Analytics / Roster Command Center. getWeeklyShrinkageIntelligence's real bug: any row
 * with no clock-in was counted as an "unplanned absence" unconditionally, even when the row's
 * roster_date is today and the shift's scheduled start time hasn't arrived yet — so a branch
 * whose next shift starts at 19:00 read as 100% shrinkage all afternoon. All DB calls are mocked;
 * the system clock is pinned so "today" and "now" are deterministic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockExecute, state } = vi.hoisted(() => {
  const state = {
    branchName: 'NOIDA',
    rows: [] as any[],
    mandateRows: [] as any[],
  };
  const mockExecute = vi.fn(async (sql: string) => {
    const s = sql.trim().toUpperCase();
    if (s.startsWith('SELECT ID, BRANCH_NAME FROM BRANCH_MASTER')) {
      return [[{ id: 'branch-1', branch_name: state.branchName }]];
    }
    if (s.includes('FROM EMPLOYEES E') && s.includes('JOIN WFM_ROSTER_ASSIGNMENT RA')) {
      return [state.rows];
    }
    if (s.startsWith('SELECT SHRINKAGE_BUFFER_PCT')) {
      return [state.mandateRows];
    }
    return [[]];
  });
  return { mockExecute, state };
});

vi.mock('../../../db/mysql.js', () => ({
  db: { execute: mockExecute },
}));

import { getWeeklyShrinkageIntelligence } from '../roster-analytics.service.js';

describe('getWeeklyShrinkageIntelligence — shift-not-yet-due exclusion', () => {
  beforeEach(() => {
    // Pin "now" to 2026-09-11 10:00 IST-equivalent local time. Tests run in the host's local TZ
    // (matches how the service itself calls new Date() with no TZ conversion), so this fixes
    // "today" and "current time of day" without depending on the runner's real clock.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 11, 10, 0, 0)); // month is 0-indexed: 8 = September
    state.rows = [];
    state.mandateRows = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('excludes a today row whose shift has not started yet from the shrinkage denominator', async () => {
    state.rows = [
      {
        employee_id: 'e1',
        reporting_manager_id: 'm1',
        process_id: 'p1',
        manager_name: 'Manager One',
        process_name: 'Process One',
        roster_date: '2026-09-11', // today, per pinned clock
        assignment_type: 'SHIFT',
        shift_start_time: '19:00:00', // 9 hours from now — not due
        shift_end_time: '04:00:00',
        template_start: null,
        template_end: null,
        first_in: null,
        last_out: null,
        total_hours: null,
      },
    ];

    const result = await getWeeklyShrinkageIntelligence('branch-1', '2026-09-07');

    expect(result.breakdown.total.count).toBe(0);
    expect(result.breakdown.unplannedAbsence.count).toBe(0);
    const today = result.dayOfWeekPattern.find((d) => d.day === 'Friday');
    expect(today?.shrinkagePct).toBe(0);
  });

  it('still counts a today row as an unplanned absence once its shift is due', async () => {
    state.rows = [
      {
        employee_id: 'e2',
        reporting_manager_id: 'm1',
        process_id: 'p1',
        manager_name: 'Manager One',
        process_name: 'Process One',
        roster_date: '2026-09-11',
        assignment_type: 'SHIFT',
        shift_start_time: '08:00:00', // 2 hours ago — due
        shift_end_time: '17:00:00',
        template_start: null,
        template_end: null,
        first_in: null,
        last_out: null,
        total_hours: null,
      },
    ];

    const result = await getWeeklyShrinkageIntelligence('branch-1', '2026-09-07');

    expect(result.breakdown.unplannedAbsence.count).toBe(1);
  });

  it('still counts a PAST date row with no clock-in as an unplanned absence regardless of time of day', async () => {
    state.rows = [
      {
        employee_id: 'e3',
        reporting_manager_id: 'm1',
        process_id: 'p1',
        manager_name: 'Manager One',
        process_name: 'Process One',
        roster_date: '2026-09-08', // a past day within the same requested week, fully elapsed
        assignment_type: 'SHIFT',
        shift_start_time: '19:00:00', // would look "not yet due" if today's clock were wrongly applied
        shift_end_time: '04:00:00',
        template_start: null,
        template_end: null,
        first_in: null,
        last_out: null,
        total_hours: null,
      },
    ];

    const result = await getWeeklyShrinkageIntelligence('branch-1', '2026-09-07');

    expect(result.breakdown.unplannedAbsence.count).toBe(1);
  });
});
