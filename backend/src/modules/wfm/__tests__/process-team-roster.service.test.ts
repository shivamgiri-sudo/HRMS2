/**
 * WFM Roster Console merge Phase C: getProcessTeamRosterView classifies each team
 * member into one of 6 statuses — the 4 owner-requested colors (ON_TIME/green,
 * LATE/amber, ABSENT/red, ON_LEAVE/blue) plus 2 real neutral states resolved during
 * planning (WEEK_OFF_HOLIDAY, UPCOMING). All DB calls are mocked; the system clock is
 * pinned so "today" and "now" are deterministic for the UPCOMING/ABSENT boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockExecute, state } = vi.hoisted(() => {
  const state = {
    processName: 'Collections',
    rows: [] as any[],
  };
  const mockExecute = vi.fn(async (sql: string) => {
    const s = sql.trim().toUpperCase();
    if (s.startsWith('SELECT PROCESS_NAME FROM PROCESS_MASTER')) {
      return [[{ process_name: state.processName }]];
    }
    if (s.includes('FROM EMPLOYEES E') && s.includes('JOIN WFM_ROSTER_ASSIGNMENT RA')) {
      return [state.rows];
    }
    return [[]];
  });
  return { mockExecute, state };
});

vi.mock('../../../db/mysql.js', () => ({
  db: { execute: mockExecute },
}));

import { getProcessTeamRosterView } from '../process-team-roster.service.js';

function baseRow(overrides: Record<string, any>) {
  return {
    employee_id: 'e1',
    employee_code: 'MAS001',
    employee_name: 'Test Employee',
    branch_id: 'b1',
    branch_name: 'NOIDA',
    assignment_type: 'REGULAR',
    shift_start_time: '09:00:00',
    shift_end_time: '18:00:00',
    shift_name: 'Morning',
    template_start: null,
    template_end: null,
    first_in: null,
    last_out: null,
    leave_type_id: null,
    leave_name: null,
    ...overrides,
  };
}

describe('getProcessTeamRosterView', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 11, 10, 0, 0)); // 2026-09-11 10:00 local
    state.rows = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('classifies a today row as ON_TIME when clocked in within grace of shift start', async () => {
    state.rows = [baseRow({ first_in: '08:58:00', shift_start_time: '09:00:00' })];
    const result = await getProcessTeamRosterView('p1', '2026-09-11');
    expect(result.members[0].status).toBe('ON_TIME');
    expect(result.counts.onTime).toBe(1);
    expect(result.counts.total).toBe(1);
  });

  it('classifies a row as LATE when clocked in beyond grace and reports minutesLate', async () => {
    state.rows = [baseRow({ first_in: '09:20:00', shift_start_time: '09:00:00' })];
    const result = await getProcessTeamRosterView('p1', '2026-09-11');
    expect(result.members[0].status).toBe('LATE');
    expect(result.members[0].minutesLate).toBe(20);
    expect(result.counts.late).toBe(1);
  });

  it('classifies a today row with a due shift and no clock-in as ABSENT', async () => {
    state.rows = [baseRow({ first_in: null, shift_start_time: '08:00:00' })]; // due 2 hours ago
    const result = await getProcessTeamRosterView('p1', '2026-09-11');
    expect(result.members[0].status).toBe('ABSENT');
    expect(result.counts.absent).toBe(1);
  });

  it('classifies a today row with a not-yet-due shift and no clock-in as UPCOMING, not ABSENT', async () => {
    state.rows = [baseRow({ first_in: null, shift_start_time: '19:00:00' })]; // 9 hours from now
    const result = await getProcessTeamRosterView('p1', '2026-09-11');
    expect(result.members[0].status).toBe('UPCOMING');
    expect(result.counts.upcoming).toBe(1);
    expect(result.counts.absent).toBe(0);
  });

  it('classifies WEEK_OFF and HOLIDAY assignment types as WEEK_OFF_HOLIDAY', async () => {
    state.rows = [
      baseRow({ employee_id: 'e1', assignment_type: 'WEEK_OFF' }),
      baseRow({ employee_id: 'e2', assignment_type: 'HOLIDAY' }),
    ];
    const result = await getProcessTeamRosterView('p1', '2026-09-11');
    expect(result.members[0].status).toBe('WEEK_OFF_HOLIDAY');
    expect(result.members[1].status).toBe('WEEK_OFF_HOLIDAY');
    expect(result.counts.weekOffHoliday).toBe(2);
  });

  it('classifies LEAVE assignment type as ON_LEAVE and surfaces the resolved leave type name', async () => {
    state.rows = [baseRow({ assignment_type: 'LEAVE', leave_name: 'Casual Leave' })];
    const result = await getProcessTeamRosterView('p1', '2026-09-11');
    expect(result.members[0].status).toBe('ON_LEAVE');
    expect(result.members[0].leaveType).toBe('Casual Leave');
    expect(result.counts.onLeave).toBe(1);
  });

  it('falls back to a generic "Leave" label when no matching approved leave_request row resolves a specific type', async () => {
    state.rows = [baseRow({ assignment_type: 'LEAVE', leave_name: null })];
    const result = await getProcessTeamRosterView('p1', '2026-09-11');
    expect(result.members[0].status).toBe('ON_LEAVE');
    expect(result.members[0].leaveType).toBe('Leave');
  });

  it('classifies a PAST date row with no clock-in as ABSENT regardless of shift time (not UPCOMING)', async () => {
    state.rows = [baseRow({ first_in: null, shift_start_time: '19:00:00' })];
    const result = await getProcessTeamRosterView('p1', '2026-09-08');
    expect(result.members[0].status).toBe('ABSENT');
  });

  it('aggregates counts across a mixed roster and includes processName from process_master', async () => {
    state.rows = [
      baseRow({ employee_id: 'e1', first_in: '08:58:00', shift_start_time: '09:00:00' }), // ON_TIME
      baseRow({ employee_id: 'e2', first_in: '09:30:00', shift_start_time: '09:00:00' }), // LATE
      baseRow({ employee_id: 'e3', first_in: null, shift_start_time: '08:00:00' }), // ABSENT
      baseRow({ employee_id: 'e4', assignment_type: 'WEEK_OFF' }), // WEEK_OFF_HOLIDAY
      baseRow({ employee_id: 'e5', assignment_type: 'LEAVE', leave_name: 'Sick Leave' }), // ON_LEAVE
      baseRow({ employee_id: 'e6', first_in: null, shift_start_time: '19:00:00' }), // UPCOMING
    ];
    const result = await getProcessTeamRosterView('p1', '2026-09-11');
    expect(result.processName).toBe('Collections');
    expect(result.counts).toEqual({
      onTime: 1, late: 1, absent: 1, onLeave: 1, weekOffHoliday: 1, upcoming: 1, total: 6,
    });
  });
});
