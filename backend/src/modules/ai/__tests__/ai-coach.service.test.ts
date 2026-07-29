import { describe, expect, it } from 'vitest';
import {
  attendanceRate,
  buildDisciplinePoints,
  buildPerformancePoints,
  buildWellbeingPoints,
  buildGrowthPoints,
  buildTeamPoints,
  coachGreeting,
  firstName,
  lateRate,
  leaveBurn,
  nextTenureMilestone,
  punctualityTrend,
  renderCoachReport,
  scoreKpi,
  tenureMonths,
  type AttendanceWindow,
  type KpiSnapshot,
  type TeamMemberSignal,
} from '../ai-coach.service.js';

const window = (over: Partial<AttendanceWindow> = {}): AttendanceWindow => ({
  presentDays: 20, lateMarks: 0, absentDays: 0, lwpDays: 0, workingDays: 22, ...over,
});

const kpi = (over: Partial<KpiSnapshot> = {}): KpiSnapshot => ({
  metricName: 'Attendance Percentage', unit: 'percent', direction: 'higher_is_better',
  targetValue: 95, averageActual: 97, sampleCount: 20, minimumSampleSize: 10, expectedSampleCount: 22, ...over,
});

describe('rates', () => {
  it('never divides by zero working days', () => {
    expect(lateRate(window({ workingDays: 0 }))).toBe(0);
    expect(attendanceRate(window({ workingDays: 0 }))).toBe(0);
  });

  it('computes the share of working days', () => {
    expect(lateRate(window({ lateMarks: 11, workingDays: 22 }))).toBe(0.5);
  });
});

describe('punctualityTrend', () => {
  it('refuses to call a trend on thin windows', () => {
    expect(punctualityTrend(window({ workingDays: 4 }), window())).toBeNull();
    expect(punctualityTrend(window(), window({ workingDays: 4 }))).toBeNull();
  });

  it('reads a falling late rate as improving', () => {
    const trend = punctualityTrend(
      window({ lateMarks: 1, workingDays: 20 }),
      window({ lateMarks: 6, workingDays: 20 }),
    );
    expect(trend?.direction).toBe('improving');
  });

  it('treats a sub-2-point move as steady', () => {
    const trend = punctualityTrend(
      window({ lateMarks: 4, workingDays: 100 }),
      window({ lateMarks: 5, workingDays: 100 }),
    );
    expect(trend?.direction).toBe('steady');
  });
});

describe('scoreKpi', () => {
  it('will not score a feed below its minimum sample size', () => {
    expect(scoreKpi(kpi({ sampleCount: 9, minimumSampleSize: 10 })).status).toBe('insufficient_data');
  });

  it('scores higher_is_better against target', () => {
    const { status, attainment } = scoreKpi(kpi({ averageActual: 76, targetValue: 95 }));
    expect(status).toBe('below_target');
    expect(attainment).toBeCloseTo(0.8, 5);
  });

  it('inverts the ratio when lower is better', () => {
    const { status, attainment } = scoreKpi(
      kpi({ direction: 'lower_is_better', targetValue: 10, averageActual: 5 }),
    );
    expect(status).toBe('on_track');
    expect(attainment).toBeCloseTo(2, 5);
  });

  it('does not divide by a zero target', () => {
    expect(scoreKpi(kpi({ targetValue: 0 })).status).toBe('insufficient_data');
  });

  it('refuses to score a feed that covers too few working days', () => {
    // The real ATTENDANCE_PCT feed: 19 readings across 78 working days, and a
    // NULL minimum_sample_size that let it through the old floor.
    const sparse = kpi({ sampleCount: 19, expectedSampleCount: 78, minimumSampleSize: null, averageActual: 36.84 });
    expect(scoreKpi(sparse).status).toBe('insufficient_data');
  });

  it('scores once coverage is adequate', () => {
    expect(scoreKpi(kpi({ sampleCount: 60, expectedSampleCount: 78 })).status).toBe('on_track');
  });
});

describe('leaveBurn', () => {
  it('flags an untouched allocation', () => {
    const burn = leaveBurn([{ leaveName: 'CL', allocated: 12, used: 0, available: 12 }]);
    expect(burn.untouched).toBe(true);
    expect(burn.burnRate).toBe(0);
  });

  it('sums across leave types', () => {
    const burn = leaveBurn([
      { leaveName: 'CL', allocated: 4, used: 3.5, available: 0.5 },
      { leaveName: 'EL', allocated: 18, used: 14, available: 4 },
    ]);
    expect(burn.allocated).toBe(22);
    expect(burn.used).toBe(17.5);
    expect(burn.untouched).toBe(false);
  });
});

describe('tenure', () => {
  it('does not count a month before its anniversary day', () => {
    expect(tenureMonths(new Date('2026-01-20'), new Date('2026-07-19'))).toBe(5);
    expect(tenureMonths(new Date('2026-01-20'), new Date('2026-07-20'))).toBe(6);
  });

  it('never returns a negative tenure', () => {
    expect(tenureMonths(new Date('2026-08-01'), new Date('2026-07-01'))).toBe(0);
  });

  it('announces only milestones within three months', () => {
    expect(nextTenureMilestone(10)?.label).toBe('1 year');
    expect(nextTenureMilestone(2)).toBeNull();
  });
});

describe('coach points', () => {
  it('says so plainly when no KPI feed exists', () => {
    const points = buildPerformancePoints([]);
    expect(points[0].headline).toMatch(/no kpi feed/i);
    expect(points[0].tone).toBe('watch');
  });

  it('reports a sparse feed as unscorable rather than bad', () => {
    const points = buildPerformancePoints([kpi({ sampleCount: 3, minimumSampleSize: 10, expectedSampleCount: 22, averageActual: 36 })]);
    expect(points[0].headline).toMatch(/not enough data/i);
    expect(points[0].detail).not.toMatch(/% of target/);
  });

  it('celebrates a clean punctuality window', () => {
    const points = buildDisciplinePoints(window({ lateMarks: 0 }), window());
    expect(points[0].tone).toBe('celebrate');
  });

  it('raises LWP as its own action item', () => {
    const points = buildDisciplinePoints(window({ lwpDays: 2 }), window());
    expect(points.some((p) => /loss of pay/i.test(p.headline))).toBe(true);
  });

  it('nudges someone who has taken no leave at all', () => {
    const points = buildWellbeingPoints([{ leaveName: 'EL', allocated: 18, used: 0, available: 18 }]);
    expect(points[0].headline).toMatch(/not taken a single day/i);
  });

  it('renders every populated lens under its own heading', () => {
    const body = renderCoachReport([
      ...buildPerformancePoints([kpi()]),
      ...buildDisciplinePoints(window(), window()),
      ...buildWellbeingPoints([{ leaveName: 'EL', allocated: 18, used: 4, available: 14 }]),
      ...buildGrowthPoints(14),
    ]);
    expect(body).toContain('**Performance**');
    expect(body).toContain('**Attendance and discipline**');
    expect(body).toContain('**Wellbeing**');
    expect(body).toContain('**Growth**');
  });
});

describe('team coaching', () => {
  const member = (over: Partial<TeamMemberSignal> = {}): TeamMemberSignal => ({
    employeeId: 'e1', name: 'Asha', lateMarks: 0, lwpDays: 0, presentDays: 20, workingDays: 22, ...over,
  });

  it('says so when the scope resolves nobody', () => {
    expect(buildTeamPoints([])[0].headline).toMatch(/no team members/i);
  });

  it('celebrates a team with no late marks', () => {
    const points = buildTeamPoints([member(), member({ employeeId: 'e2', name: 'Bilal' })]);
    expect(points.some((p) => /nobody in your team carries a late mark/i.test(p.headline))).toBe(true);
  });

  it('names the worst offenders but caps the list at three', () => {
    const team = ['A', 'B', 'C', 'D'].map((name, i) =>
      member({ employeeId: `e${i}`, name, lateMarks: 4 - i }));
    const late = buildTeamPoints(team).find((p) => /have late marks/i.test(p.headline));
    expect(late?.detail).toContain('A');
    expect(late?.detail).not.toContain('D');
  });

  it('escalates when more than half the team is late', () => {
    const team = [member({ lateMarks: 3 }), member({ employeeId: 'e2', name: 'B', lateMarks: 2 }), member({ employeeId: 'e3', name: 'C' })];
    const late = buildTeamPoints(team).find((p) => /have late marks/i.test(p.headline));
    expect(late?.tone).toBe('act');
  });

  it('surfaces team LWP as an action', () => {
    const points = buildTeamPoints([member({ lwpDays: 1.5 })]);
    expect(points.some((p) => p.tone === 'act' && /loss-of-pay/i.test(p.headline))).toBe(true);
  });

  it('flags members below 80% attendance under wellbeing', () => {
    const points = buildTeamPoints([member({ presentDays: 10, workingDays: 22 })]);
    const thin = points.find((p) => /below 80% attendance/i.test(p.headline));
    expect(thin?.lens).toBe('wellbeing');
  });

  it('reports the true scope size and says the list is capped', () => {
    const sample = Array.from({ length: 3 }, (_, i) => member({ employeeId: `e${i}`, name: `M${i}` }));
    const head = buildTeamPoints(sample, 1343)[0];
    expect(head.headline).toContain('1343 people');
    expect(head.detail).toMatch(/first 3 by name/i);
    expect(head.detail).toMatch(/not the whole scope/i);
  });

  it('does not claim truncation when the list is complete', () => {
    const head = buildTeamPoints([member(), member({ employeeId: 'e2', name: 'B' })])[0];
    expect(head.detail).not.toMatch(/not the whole scope/i);
  });

  it('names the largest LWP holders first, with their days', () => {
    const team = [
      member({ employeeId: 'a', name: 'Small', lwpDays: 1 }),
      member({ employeeId: 'b', name: 'Big', lwpDays: 20.5 }),
      member({ employeeId: 'c', name: 'Mid', lwpDays: 8 }),
    ];
    const lwp = buildTeamPoints(team).find((p) => /loss-of-pay/i.test(p.headline));
    expect(lwp?.detail).toMatch(/Big \(20\.5d\).*Mid \(8d\).*Small/);
  });

  it('names the lowest attendance first, with the percentage', () => {
    const team = [
      member({ employeeId: 'a', name: 'Half', presentDays: 11, workingDays: 22 }),
      member({ employeeId: 'b', name: 'Zero', presentDays: 0, workingDays: 22 }),
    ];
    const thin = buildTeamPoints(team).find((p) => /below 80% attendance/i.test(p.headline));
    expect(thin?.detail).toMatch(/Zero \(0%\).*Half \(50%\)/);
  });

  it('ignores members with no working days when judging punctuality', () => {
    const points = buildTeamPoints([member({ workingDays: 0, presentDays: 0 })]);
    expect(points.some((p) => /below 80% attendance/i.test(p.headline))).toBe(false);
  });
});

describe('personalisation', () => {
  it('uses the first name only, normalised', () => {
    expect(firstName('SHIVAM SHIV GIRI')).toBe('Shivam');
    expect(firstName('   ')).toBeNull();
  });

  it('addresses the person and places them', () => {
    const line = coachGreeting({ fullName: 'SHIVAM SHIV GIRI', branchName: 'NOIDA-2', processName: 'BACK OFFICE' }, 2);
    expect(line).toContain('Shivam');
    expect(line).toContain('BACK OFFICE at NOIDA-2');
    expect(line).toMatch(/2 things are worth your attention/);
  });

  it('reads naturally when nothing needs action', () => {
    expect(coachGreeting({ fullName: 'Asha' }, 0)).toMatch(/nothing here needs chasing/i);
  });

  it('frames a manager view as self-then-team', () => {
    expect(coachGreeting({ fullName: 'Asha', isTeamView: true }, 1)).toMatch(/your own record first, then your team/i);
  });

  it('degrades gracefully with no name or place', () => {
    expect(coachGreeting({}, 0)).toMatch(/^Here is your coaching read/);
  });
});
