import { describe, it, expect } from 'vitest';
import { generateInsights } from '../ai-insights-engine.js';

describe('generateInsights', () => {
  it('never returns an empty array for a known context_type with data', () => {
    const insights = generateInsights('performance_kpi', {
      overall_score: 45,
      overall_rating: 'C',
      total_kpis: 5,
      kpis_with_data: 5,
      on_target_count: 1,
      below_60_count: 3,
    });
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.some((i) => i.severity === 'critical')).toBe(true);
  });

  it('flags zero-KPI state honestly instead of fabricating a score insight', () => {
    const insights = generateInsights('performance_kpi', { total_kpis: 0 });
    expect(insights.length).toBe(1);
    expect(insights[0].title).toMatch(/No KPIs configured/i);
  });

  it('rates strong attendance as success and low attendance as critical', () => {
    const good = generateInsights('attendance_pattern', {
      present_days: 22, total_working_days: 22, lwp_days: 0, late_marks: 0, total_hours: 176,
    });
    expect(good[0].severity).toBe('success');

    const bad = generateInsights('attendance_pattern', {
      present_days: 10, total_working_days: 22, lwp_days: 5, late_marks: 2, total_hours: 80,
    });
    expect(bad[0].severity).toBe('critical');
  });

  it('summarises leave requests honestly, including the no-requests-yet case', () => {
    const none = generateInsights('employee_self', { total_requests: 0, pending_requests: 0, approved_count: 0, rejected_count: 0 });
    expect(none[0].title).toMatch(/No leave requests/i);

    const pending = generateInsights('employee_self', { total_requests: 5, pending_requests: 3, approved_count: 2, rejected_count: 0 });
    expect(pending.some((i) => i.title.includes('awaiting decision') || i.body.includes('pending'))).toBe(true);
  });

  it('falls back to a generic, data-grounded analyzer for unknown context types', () => {
    const insights = generateInsights('ceo_dashboard', { attrition_rate: 42, revenue: 100000 });
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.some((i) => i.title.toLowerCase().includes('attrition'))).toBe(true);
  });

  it('does not invert "higher is worse" metrics like shrinkage/fraud into a false "below target" claim', () => {
    // A regression case: 31% shrinkage and a 12% fraud score are both BAD (high),
    // not "below target" — the generic analyzer must flag them as elevated, not
    // low, or it tells the reader the exact opposite of what the number means.
    const insights = generateInsights('wfm_roster', { shrinkage_pct: 31, fraud_score: 45 });
    const shrinkage = insights.find((i) => i.title.toLowerCase().includes('shrinkage'));
    const fraud = insights.find((i) => i.title.toLowerCase().includes('fraud'));
    expect(shrinkage?.title.toLowerCase()).toContain('elevated');
    expect(shrinkage?.title.toLowerCase()).not.toContain('below target');
    expect(fraud?.title.toLowerCase()).toContain('elevated');
    expect(fraud?.title.toLowerCase()).not.toContain('below target');
  });

  it('never throws and never returns [] even with an empty payload', () => {
    const insights = generateInsights('quality_operations', {});
    expect(Array.isArray(insights)).toBe(true);
    expect(insights.length).toBeGreaterThan(0);
  });
});
