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

export function normalizeQualityDashboardData(
  summaryPayload: unknown,
  trendPayload: unknown,
  agentsPayload: unknown,
): JsonRecord {
  const summaryEnvelope = asRecord(summaryPayload);
  const summary = asRecord(summaryEnvelope.summary ?? summaryEnvelope.data ?? summaryEnvelope);
  const totalCalls = asNumber(summary.total_calls);
  const auditedCalls = asNumber(summary.audited_calls ?? summary.total_audits);
  const parameterFails = asArray(summaryEnvelope.parameter_fails);
  const failRates = parameterFails
    .map((row) => asNumber(row.fail_rate))
    .filter((value): value is number => value !== null);
  const summaryFailRates = Object.entries(summary)
    .filter(([key]) => key.startsWith("fail_rate_"))
    .map(([, value]) => asNumber(value))
    .filter((value): value is number => value !== null);
  const rates = failRates.length > 0 ? failRates : summaryFailRates;
  const failRate = rates.length > 0
    ? Math.round((rates.reduce((sum, value) => sum + value, 0) / rates.length) * 10) / 10
    : asNumber(summary.fail_rate ?? summary.failure_rate);

  const trendEnvelope = asRecord(trendPayload);
  const scoreTrend = asArray(trendEnvelope.trend ?? trendEnvelope.data).map((row) => ({
    label: String(row.date ?? row.period ?? row.label ?? ""),
    value: asNumber(row.avg_score ?? row.score ?? row.value) ?? 0,
  }));

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
    avg_score: asNumber(summary.avg_quality_score ?? summary.avg_score ?? summary.average_score),
    total_audits: auditedCalls,
    fail_rate: failRate,
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
