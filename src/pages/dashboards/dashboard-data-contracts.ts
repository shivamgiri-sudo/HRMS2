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

export function buildRecruitmentFunnel(payload: unknown): RecruitmentFunnelStage[] {
  const record = asRecord(payload);
  const byStage = asRecord(record.by_stage);
  const firstCount = (...keys: string[]) => {
    for (const key of keys) {
      const value = asNumber(byStage[key] ?? record[key]);
      if (value !== null) return value;
    }
    return 0;
  };

  return [
    { label: "Applied", value: firstCount("applied", "total_candidates", "total_applications"), color: "#3b82f6" },
    { label: "Screened", value: firstCount("screened", "shortlisted", "Shortlisted"), color: "#6366f1" },
    { label: "HR Round", value: firstCount("hr_round", "hr interview", "hr_interview"), color: "#8b5cf6" },
    { label: "Skill Test", value: firstCount("skill_test", "assessment", "test"), color: "#a855f7" },
    { label: "Operations Round", value: firstCount("operations_round", "ops_round"), color: "#06b6d4" },
    { label: "Client Round", value: firstCount("client_round", "client_interview"), color: "#0891b2" },
    { label: "Selected", value: firstCount("selected", "Selected", "selected_candidates"), color: "#f59e0b" },
    { label: "Offered", value: firstCount("offered", "offer_extended", "offers_extended", "offers_today"), color: "#f97316" },
    { label: "Offer Accepted", value: firstCount("offer_accepted", "accepted"), color: "#84cc16" },
    { label: "Joined", value: firstCount("joined", "converted", "onboarded", "Onboarded"), color: "#22c55e" },
    { label: "Rejected", value: firstCount("rejected"), color: "#ef4444" },
    { label: "Dropped", value: firstCount("dropped", "drop_off"), color: "#dc2626" },
    { label: "No-show", value: firstCount("no_show", "noshow"), color: "#991b1b" },
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
