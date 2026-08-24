/**
 * AI Insights Engine — deterministic, data-grounded insight generation for
 * dashboard `<AIInsightPanel>` widgets.
 *
 * `POST /api/ai/insights` previously returned `{ insights: [] }` unconditionally
 * for every context_type, ignoring the request body entirely — every "AI Brief"
 * panel across the app (KPI, attendance, leave, ATS, exit risk, CEO dashboard,
 * WFM roster, quality/operations) silently showed nothing, regardless of the
 * real numbers already computed and sent by the frontend.
 *
 * This engine is intentionally rule-based rather than LLM-backed: every insight
 * is derived directly from the numeric fields the caller already sent (the same
 * numbers rendered on the dashboard itself), so it can never fabricate a claim,
 * never costs an external API call on every dashboard load, and always responds
 * instantly. If a real LLM-authored narrative is wanted later, this is the seam
 * to call `aiProviderRegistry` from — the analyzers below can stay as a fast,
 * free, always-available fallback when a provider call fails or isn't configured.
 */

export type InsightSeverity = 'critical' | 'warning' | 'info' | 'success';

export interface AiInsight {
  id: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  action_label?: string;
  action_url?: string;
}

type InsightData = Record<string, unknown>;

function num(data: InsightData, key: string): number | null {
  const v = data[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pct(n: number | null): string {
  return n === null ? 'n/a' : `${Math.round(n * 10) / 10}%`;
}

let counter = 0;
function makeId(contextType: string): string {
  counter = (counter + 1) % 100000;
  return `${contextType}-${Date.now()}-${counter}`;
}

// ─── performance_kpi (My KPI dashboard, Unified Performance Command Centre) ───
function analyzePerformanceKpi(data: InsightData, contextType: string): AiInsight[] {
  const insights: AiInsight[] = [];
  const overallScore = num(data, 'overall_score');
  const overallRating = data['overall_rating'];
  const totalKpis = num(data, 'total_kpis') ?? 0;
  const kpisWithData = num(data, 'kpis_with_data') ?? 0;
  const onTarget = num(data, 'on_target_count') ?? 0;
  const below60 = num(data, 'below_60_count') ?? 0;

  if (totalKpis === 0) {
    insights.push({
      id: makeId(contextType),
      severity: 'info',
      title: 'No KPIs configured yet',
      body: 'Your role, department, process or cost centre does not have KPI targets assigned yet. Ask your manager or HR to configure them so this brief can start tracking your performance.',
    });
    return insights;
  }

  if (kpisWithData < totalKpis) {
    const missing = totalKpis - kpisWithData;
    insights.push({
      id: makeId(contextType),
      severity: missing === totalKpis ? 'warning' : 'info',
      title: `${missing} of ${totalKpis} KPI${missing === 1 ? '' : 's'} still has no data`,
      body:
        missing === totalKpis
          ? 'None of your configured KPIs have recorded any activity yet for this period — scores below are not yet meaningful.'
          : `${kpisWithData} of ${totalKpis} KPIs have data so far this period. The rest will populate as more activity is recorded.`,
    });
  }

  if (overallScore !== null) {
    if (overallScore >= 90) {
      insights.push({
        id: makeId(contextType),
        severity: 'success',
        title: `Strong overall performance — ${pct(overallScore)}`,
        body: `Your blended score is ${pct(overallScore)}${overallRating ? ` (rated ${overallRating})` : ''}, with ${onTarget} of ${totalKpis} KPIs on target. Keep this up.`,
      });
    } else if (overallScore < 60) {
      insights.push({
        id: makeId(contextType),
        severity: 'critical',
        title: `Overall score needs attention — ${pct(overallScore)}`,
        body: `Your blended score is ${pct(overallScore)}${overallRating ? ` (rated ${overallRating})` : ''}. ${below60} of ${totalKpis} KPIs are below the 60% band — open each card's daily breakdown to see which days are dragging the average down.`,
        action_label: 'View lowest metric',
      });
    } else {
      insights.push({
        id: makeId(contextType),
        severity: 'warning',
        title: `Overall performance is middling — ${pct(overallScore)}`,
        body: `Your blended score is ${pct(overallScore)}${overallRating ? ` (rated ${overallRating})` : ''}. ${onTarget} of ${totalKpis} KPIs are on target; focus on the ones furthest from goal to move the average up.`,
      });
    }
  }

  if (below60 > 0 && overallScore !== null && overallScore >= 60) {
    insights.push({
      id: makeId(contextType),
      severity: 'warning',
      title: `${below60} metric${below60 === 1 ? '' : 's'} pulling your average down`,
      body: `Even though your overall score is healthy, ${below60} individual KPI${below60 === 1 ? ' is' : 's are'} scoring under 60%. Clearing those up is the fastest way to move from your current band into the next one.`,
    });
  }

  return insights;
}

// ─── attendance_pattern ─────────────────────────────────────────────────────
function analyzeAttendancePattern(data: InsightData, contextType: string): AiInsight[] {
  const insights: AiInsight[] = [];
  const presentDays = num(data, 'present_days');
  const totalWorkingDays = num(data, 'total_working_days');
  const lwpDays = num(data, 'lwp_days') ?? 0;
  const lateMarks = num(data, 'late_marks') ?? 0;
  const totalHours = num(data, 'total_hours');

  if (presentDays === null || totalWorkingDays === null || totalWorkingDays === 0) {
    insights.push({
      id: makeId(contextType),
      severity: 'info',
      title: 'Not enough attendance data yet',
      body: 'Once punches are recorded for this period, this brief will summarise your attendance pattern.',
    });
    return insights;
  }

  const attendancePct = (presentDays / totalWorkingDays) * 100;
  const avgHoursPerDay = presentDays > 0 && totalHours !== null ? totalHours / presentDays : null;

  if (attendancePct >= 95) {
    insights.push({
      id: makeId(contextType),
      severity: 'success',
      title: `Excellent attendance — ${pct(attendancePct)}`,
      body: `Present ${presentDays} of ${totalWorkingDays} working days this period${lwpDays > 0 ? `, with ${lwpDays} LWP day${lwpDays === 1 ? '' : 's'}` : ' with no unpaid leave'}.`,
    });
  } else if (attendancePct < 80) {
    insights.push({
      id: makeId(contextType),
      severity: 'critical',
      title: `Attendance is low — ${pct(attendancePct)}`,
      body: `Present ${presentDays} of ${totalWorkingDays} working days${lwpDays > 0 ? `, including ${lwpDays} LWP day${lwpDays === 1 ? '' : 's'}` : ''}. This is below the healthy range and may affect your attendance-linked KPI score.`,
    });
  } else {
    insights.push({
      id: makeId(contextType),
      severity: 'info',
      title: `Attendance is ${pct(attendancePct)} this period`,
      body: `Present ${presentDays} of ${totalWorkingDays} working days${lwpDays > 0 ? `, with ${lwpDays} LWP day${lwpDays === 1 ? '' : 's'}` : ''}.`,
    });
  }

  if (lateMarks > 0) {
    insights.push({
      id: makeId(contextType),
      severity: lateMarks >= 5 ? 'warning' : 'info',
      title: `${lateMarks} late mark${lateMarks === 1 ? '' : 's'} this period`,
      body:
        lateMarks >= 5
          ? 'This is a notable number of late arrivals for the period — repeated lateness can affect your attendance rating.'
          : 'A small number of late arrivals recorded this period.',
    });
  }

  if (avgHoursPerDay !== null && presentDays > 0) {
    if (avgHoursPerDay < 7.5) {
      insights.push({
        id: makeId(contextType),
        severity: 'warning',
        title: `Average ${avgHoursPerDay.toFixed(1)} hrs/day logged`,
        body: 'Your average logged hours on present days is under the typical 8-hour shift — check for missed punch-outs if this looks wrong.',
      });
    }
  }

  return insights;
}

// ─── employee_self (leave) ──────────────────────────────────────────────────
function analyzeEmployeeSelfLeave(data: InsightData, contextType: string): AiInsight[] {
  const insights: AiInsight[] = [];
  const total = num(data, 'total_requests') ?? 0;
  const pending = num(data, 'pending_requests') ?? 0;
  const approved = num(data, 'approved_count') ?? 0;
  const rejected = num(data, 'rejected_count') ?? 0;

  if (total === 0) {
    insights.push({
      id: makeId(contextType),
      severity: 'info',
      title: 'No leave requests yet',
      body: 'You have not filed any leave requests. This brief will summarise your leave pattern once you do.',
    });
    return insights;
  }

  if (pending > 0) {
    insights.push({
      id: makeId(contextType),
      severity: pending >= 3 ? 'warning' : 'info',
      title: `${pending} leave request${pending === 1 ? '' : 's'} awaiting decision`,
      body: `You have ${pending} pending request${pending === 1 ? '' : 's'} out of ${total} total. Follow up with your manager if any have been open for a while.`,
    });
  }

  if (rejected > 0) {
    const rejectRate = (rejected / total) * 100;
    insights.push({
      id: makeId(contextType),
      severity: rejectRate >= 30 ? 'warning' : 'info',
      title: `${rejected} of ${total} requests rejected`,
      body: `Your rejection rate this period is ${pct(rejectRate)}. If a pattern is emerging, check with your manager on the reason before your next request.`,
    });
  }

  if (pending === 0 && rejected === 0 && approved > 0) {
    insights.push({
      id: makeId(contextType),
      severity: 'success',
      title: 'All leave requests cleared',
      body: `All ${approved} of your leave request${approved === 1 ? '' : 's'} this period ${approved === 1 ? 'has' : 'have'} been approved with none pending or rejected.`,
    });
  }

  return insights;
}

// ─── Generic fallback for context types without a bespoke analyzer ─────────
// Covers: ats_pipeline, exit_risk, ceo_dashboard, wfm_roster, quality_operations,
// and any future context_type the frontend starts sending. Reads whatever
// numeric/percentage-looking fields were actually sent rather than guessing at
// a schema — always grounded in real caller data, never fabricated.
function analyzeGeneric(data: InsightData, contextType: string): AiInsight[] {
  const entries = Object.entries(data).filter(
    ([, v]) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '')
  );

  if (entries.length === 0) {
    return [
      {
        id: makeId(contextType),
        severity: 'info',
        title: 'No data available yet',
        body: 'This brief will populate once there is enough activity to summarise.',
      },
    ];
  }

  // Flag any field that looks like a rate/percentage/score sitting in a risky band.
  // Some metrics are "higher is worse" (risk, attrition, fraud, shrinkage...);
  // everything else defaults to "higher is better" (conversion, quality, CSAT...).
  // Getting this backwards would tell a CEO "shrinkage is below target" when 31%
  // shrinkage is actually the bad case — worse than staying silent, so this list
  // is checked first and is deliberately over-inclusive of BPO/HR terms.
  const HIGHER_IS_WORSE = /risk|attrition|rejection|fatal|error|fraud|shrinkage|overtime|absentee|turnover|complaint|escalation|defect|delay|breach|churn|gap/i;
  const insights: AiInsight[] = [];
  for (const [key, value] of entries) {
    if (typeof value !== 'number') continue;
    const label = key.replace(/_/g, ' ');
    const looksLikePercent = /pct|percent|rate|score/i.test(key) && value >= 0 && value <= 100;
    if (!looksLikePercent) continue;
    if (HIGHER_IS_WORSE.test(key) && value >= 30) {
      insights.push({
        id: makeId(contextType),
        severity: value >= 60 ? 'critical' : 'warning',
        title: `${label} is elevated — ${pct(value)}`,
        body: `${label} is currently at ${pct(value)}, which is worth a closer look on the full dashboard.`,
      });
    } else if (!HIGHER_IS_WORSE.test(key) && value < 60) {
      insights.push({
        id: makeId(contextType),
        severity: value < 40 ? 'critical' : 'warning',
        title: `${label} is below target — ${pct(value)}`,
        body: `${label} is currently at ${pct(value)}. Check the underlying breakdown on the full dashboard.`,
      });
    } else if (!HIGHER_IS_WORSE.test(key) && value >= 90) {
      insights.push({
        id: makeId(contextType),
        severity: 'success',
        title: `${label} is strong — ${pct(value)}`,
        body: `${label} is currently at ${pct(value)}.`,
      });
    }
  }

  if (insights.length === 0) {
    insights.push({
      id: makeId(contextType),
      severity: 'info',
      title: 'No anomalies detected',
      body: 'Nothing in the current numbers stands out as needing attention right now.',
    });
  }

  return insights.slice(0, 4);
}

const ANALYZERS: Record<string, (data: InsightData, contextType: string) => AiInsight[]> = {
  performance_kpi: analyzePerformanceKpi,
  attendance_pattern: analyzeAttendancePattern,
  employee_self: analyzeEmployeeSelfLeave,
};

/**
 * Generate insights for a dashboard `<AIInsightPanel>` request. Never throws —
 * an unrecognised context_type or sparse data falls through to the generic
 * analyzer, which always returns at least one honest, data-grounded insight
 * (or an explicit "no data yet" info card) rather than an empty array.
 */
export function generateInsights(contextType: string, data: InsightData): AiInsight[] {
  const analyzer = ANALYZERS[contextType] ?? analyzeGeneric;
  try {
    const result = analyzer(data, contextType);
    return result.length > 0 ? result : analyzeGeneric(data, contextType);
  } catch {
    // Defensive: a malformed payload must never 500 a dashboard panel.
    return analyzeGeneric(data, contextType);
  }
}
