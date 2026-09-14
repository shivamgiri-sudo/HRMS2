type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function titleCase(value: unknown): string {
  return String(value ?? "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

export function deduplicateQualityRows(rows: JsonRecord[]): JsonRecord[] {
  const seen = new Set<string>();
  return rows.filter((row, index) => {
    const stableId = row.id
      ?? row.audit_id
      ?? row.defect_id
      ?? row.employee_id
      ?? row.agent_id
      ?? row.agent_code
      ?? row.category
      ?? row.defect_type;
    const key = stableId === null || stableId === undefined || stableId === ""
      ? `row-${index}`
      : String(stableId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface RecruitmentFunnelStage {
  label: string;
  value: number;
  color: string;
}

export interface AtsStageSnapshot {
  applications: number | null;
  screened: number | null;
  interviewed: number | null;
  offered: number | null;
  joined: number | null;
}

/**
 * Derives five stage counts from the ATS's raw by_stage breakdown.
 *
 * by_stage's keys are the literal current_stage values candidates are sitting in right
 * now — "Applied", "Round1-HRScreening", "Interview-SkillTest", "Offered", "converted" —
 * not a normalized vocabulary, and casing is genuinely inconsistent in the underlying
 * data itself (Title Case from the candidate web form, snake_case from later ATS
 * workflow stages). buildRecruitmentFunnel below used to look up exact keys like
 * "hr_round", "skill_test" and "offered" (lowercase) against this object — none of which
 * exist verbatim — so 9 of its 12 bars always evaluated to 0 and the Recruiter
 * Dashboard's panel showed "Recruitment funnel source unavailable" while the ATS held a
 * real, populated pipeline (38,191 candidates, 1,272 at Offered, verified 2026-08-27).
 * Matching here is case-insensitive substring matching against the real observed stage
 * names, the same technique already proven correct on the HR Dashboard's own funnel.
 *
 * These five are DISJOINT current-stage buckets, not sequential pass-through counts: a
 * candidate who has reached Offered is no longer counted under Interviewed, so Offered
 * can legitimately exceed Interviewed without anything being wrong — it says more people
 * are sitting at Offered right now than are sitting at Interview right now, not that more
 * people were ever interviewed. Present this as a stage snapshot, not a funnel implying
 * monotonic drop-off; ats_candidate_stage_log, the one table that could reconstruct a true
 * sequential funnel, covers only 1,903 of 38,191 candidates (5%) and is not a usable
 * source for one yet.
 */
export function deriveAtsStageSnapshot(byStagePayload: unknown, totalCandidates: number | null): AtsStageSnapshot {
  const byStage = asRecord(byStagePayload);
  const stageSum = (...needles: string[]) =>
    Object.entries(byStage).reduce((sum, [name, count]) => {
      const normalized = name.toLowerCase();
      return needles.some((needle) => normalized.includes(needle)) ? sum + (asNumber(count) ?? 0) : sum;
    }, 0);

  return {
    applications: totalCandidates,
    screened: stageSum("screening") || null,
    interviewed: stageSum("interview", "skill test", "op's", "round 2", "round 3", "client") || null,
    offered: stageSum("offer") || null,
    joined: stageSum("onboard", "joined", "converted", "payroll_validated") || null,
  };
}

export function buildRecruitmentFunnel(payload: unknown): RecruitmentFunnelStage[] {
  const record = asRecord(payload);
  const totalCandidates = asNumber(record.total_candidates ?? record.total_applications);
  const snapshot = deriveAtsStageSnapshot(record.by_stage, totalCandidates);

  return [
    { label: "Applications", value: snapshot.applications ?? 0, color: "#3b82f6" },
    { label: "Screened", value: snapshot.screened ?? 0, color: "#6366f1" },
    { label: "Interviewed", value: snapshot.interviewed ?? 0, color: "#a855f7" },
    { label: "Offered", value: snapshot.offered ?? 0, color: "#f97316" },
    { label: "Joined", value: snapshot.joined ?? 0, color: "#22c55e" },
  ];
}

export function normalizeItProvisioningQueue(payload: unknown, today: string): JsonRecord {
  const envelope = asRecord(payload);
  const rows = asArray(envelope.data ?? payload);
  const pending = rows.filter((row) => ["pending", "pending_unassigned"].includes(String(row.status ?? "").toLowerCase()));
  const completed = rows.filter((row) => ["actioned", "confirmed"].includes(String(row.status ?? "").toLowerCase()));
  const taskCount = (patterns: string[]) => pending.filter((row) => {
    const task = String(row.task_code ?? "").toLowerCase();
    return patterns.some((pattern) => task.includes(pattern));
  }).length;
  const pendingEmployees = new Set(
    pending.map((row) => row.employee_id).filter((id) => id !== null && id !== undefined).map(String),
  );

  return {
    pending_total: pendingEmployees.size,
    pending_domain: taskCount(["domain", "login"]),
    pending_email: taskCount(["email"]),
    pending_asset: taskCount(["asset"]),
    pending_biometric: taskCount(["biometric"]),
    pending_id_card: taskCount(["id_card", "idcard"]),
    overdue: pending.filter((row) => {
      const due = String(row.sla_due_at ?? "").slice(0, 10);
      return Boolean(due) && due < today;
    }).length,
    completed_today: completed.filter((row) =>
      String(row.actioned_at ?? row.updated_at ?? "").slice(0, 10) === today
    ).length,
    pending_joiners: pending,
    recent_completed: completed.slice(0, 5),
    source_total: asNumber(envelope.total),
  };
}

export function normalizeQualityDashboardData(
  summaryPayload: unknown,
  trendPayload: unknown,
  agentsPayload: unknown,
): JsonRecord {
  const summaryEnvelope = asRecord(summaryPayload);
  const summary = asRecord(summaryEnvelope.summary ?? summaryEnvelope.data ?? summaryEnvelope);
  // The backend now returns summary:null plus unavailableSources when the upstream audit
  // database is down, instead of a full set of zeros that read as "0% quality". Carry the
  // reason through so the layout states it rather than showing dashes with no explanation.
  const unavailableReason = summaryEnvelope.unavailableSources
    ? String(asRecord(summaryEnvelope.unavailableSources).quality ?? "Quality source unavailable")
    : null;
  const sourceLatest = summaryEnvelope.source
    ? (asRecord(summaryEnvelope.source).latest_record ?? null)
    : null;
  const totalCalls = asNumber(summary.total_calls);
  const auditedCalls = asNumber(summary.audited_calls ?? summary.total_audits);
  const failedAudits = asNumber(summary.failed_audits ?? summary.failed_count);
  const parameterFails = asArray(summaryEnvelope.parameter_fails);
  const failRate = failedAudits !== null && auditedCalls !== null && auditedCalls > 0
    ? Math.round((failedAudits / auditedCalls) * 1000) / 10
    : asNumber(summary.weighted_fail_rate ?? summary.fail_rate ?? summary.failure_rate);

  const trendEnvelope = asRecord(trendPayload);
  const scoreTrend = asArray(trendEnvelope.trend ?? trendEnvelope.data)
    .map((row) => ({
      label: String(row.date ?? row.period ?? row.label ?? ""),
      value: asNumber(row.avg_score ?? row.score ?? row.value),
    }))
    .filter((point): point is { label: string; value: number } => point.value !== null);

  const agentsEnvelope = asRecord(agentsPayload);
  const bottomAgents = asArray(agentsEnvelope.agents ?? agentsEnvelope.data)
    .map((row) => ({
      agent_code: row.agent_code,
      agent_name: row.agent_name,
      process: row.process ?? row.campaign,
      score: asNumber(row.avg_score ?? row.quality_score ?? row.score),
      fail_count: asNumber(row.calls_below_50 ?? row.fail_count),
    }))
    .sort((left, right) => (left.score ?? Number.POSITIVE_INFINITY) - (right.score ?? Number.POSITIVE_INFINITY));

  return {
    unavailable_reason: unavailableReason,
    source_latest_record: sourceLatest,
    avg_score: asNumber(summary.avg_quality_score ?? summary.avg_score ?? summary.average_score),
    total_audits: auditedCalls,
    fail_rate: failRate,
    passed_audits: asNumber(summary.passed_audits ?? summary.passed_count),
    failed_audits: failedAudits,
    pending_audits: totalCalls !== null && auditedCalls !== null
      ? Math.max(totalCalls - auditedCalls, 0)
      : asNumber(summary.pending_audits ?? summary.queue_size),
    score_trend: scoreTrend,
    defects: parameterFails.map((row) => {
      const count = asNumber(row.fail_rate);
      return {
        category: titleCase(row.param),
        count,
        severity: count !== null && count >= 50 ? "critical" : count !== null && count >= 25 ? "high" : "low",
      };
    }),
    bottom_agents: bottomAgents,
  };
}

export function normalizeExecutiveQualityData(payload: unknown): JsonRecord {
  const envelope = asRecord(payload);
  const data = asRecord(envelope.data ?? envelope);
  const metrics = asRecord(data.metrics);
  const risk = asRecord(data.risk_summary);
  const critical = asNumber(risk.critical_agents_count);
  const atRisk = asNumber(risk.at_risk_agents_count);

  return {
    org_quality_score: asNumber(metrics.overall_quality_score ?? data.org_quality_score),
    target_score: asNumber(metrics.target_quality_score ?? data.target_score),
    // quality-executive.routes.ts catches a failed query and answers HTTP 200 with a
    // zero-filled body carrying data_status: 'UNAVAILABLE'. Both fields were dropped
    // here, so a dead audit source rendered as a genuine org quality score of 0.
    data_status: data.data_status ?? null,
    note: data.note ?? null,
    risk_agents: critical === null && atRisk === null
      ? null
      : (critical ?? 0) + (atRisk ?? 0),
    processes: asArray(data.process_performance ?? data.processes).map((row) => ({
      process: row.process ?? row.process_name,
      avg_score: asNumber(row.avg_quality ?? row.avg_score ?? row.score),
      agent_count: asNumber(row.agent_count ?? row.agents),
      calls: asNumber(row.calls_handled ?? row.calls ?? row.audit_count),
      status: row.status,
    })),
  };
}

export function normalizeOrgKpiData(payload: unknown): JsonRecord {
  const envelope = asRecord(payload);
  const data = asRecord(envelope.data ?? envelope);
  const summary = asRecord(data.summary);
  const processRows = asArray(data.by_process ?? data.processSummaries)
    .map((row) => ({
      name: row.label ?? row.processName ?? row.process_name,
      score: asNumber(row.avg_score ?? row.avgScore ?? row.score),
      agents: asNumber(row.agents ?? row.agentCount),
    }))
    .filter((row) => row.score !== null)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
  const score = asNumber(summary.org_avg_score ?? data.orgAvgScore ?? data.org_average_score);

  return {
    period: data.period ?? data.periodLabel,
    org_average_score: score,
    score,
    // /api/kpi/org-summary does not compute a composite KPI score — no such number exists
    // in this database (kpi_daily_actual.actual_value mixes percent, seconds, count and
    // currency in one column). It picks a single NAMED headline metric and returns which
    // one it picked. Dropping metric_name here is what let a 9.10 sales-conversion rate
    // render as "Org Avg KPI Score 9.10 /100" on the CEO dashboard.
    metric_name: summary.metric_name ?? null,
    metric_code: summary.metric_code ?? null,
    metric_unit: summary.metric_unit ?? null,
    // A failed source and an empty month are different answers; the endpoint says which,
    // and the panel could not tell the reader because this never came through.
    unavailable: asRecord(data.unavailableSources).kpi ?? null,
    employees_scored: asNumber(summary.employees_scored ?? data.totalAgentsScored),
    best_process: processRows[0] ?? null,
    needs_attention: processRows.at(-1) ?? null,
    processes: processRows,
    trend: asArray(data.trend).map((row) => ({
      label: String(row.period ?? row.label ?? ""),
      value: asNumber(row.avg_score ?? row.score ?? row.value) ?? 0,
    })),
  };
}

export function mergeRecruiterDashboardData(
  atsPayload: unknown,
  hiringPayload: unknown,
): JsonRecord {
  const atsEnvelope = asRecord(atsPayload);
  const ats = asRecord(atsEnvelope.data ?? atsEnvelope);
  const hiringEnvelope = asRecord(hiringPayload);
  const hiring = asRecord(hiringEnvelope.data ?? hiringEnvelope);
  const metrics = asRecord(hiring.metrics);

  return {
    ...ats,
    walkins_today: asNumber(metrics.walkins),
    offers_today: asNumber(metrics.offer_letter_issued),
    joined_today: asNumber(metrics.joined),
    hiring_dashboard: hiring,
  };
}
