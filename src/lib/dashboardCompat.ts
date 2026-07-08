type Metric = {
  value?: number | null;
  detail?: Record<string, number | null | undefined>;
};

type DashboardPayload = {
  data?: {
    metrics?: Record<string, Metric>;
    [key: string]: unknown;
  };
  metrics?: Record<string, Metric>;
  [key: string]: unknown;
};

function metric(metrics: Record<string, Metric> | undefined, key: string): Metric {
  return metrics?.[key] ?? {};
}

function value(m: Metric): number | null {
  return m.value ?? null;
}

function detail(m: Metric, key: string): number | null {
  return m.detail?.[key] ?? null;
}

export function normalizeDashboardSummary<T>(dashboardCode: string, payload: DashboardPayload): T {
  const data = payload.data ?? payload;
  const metrics = data.metrics;
  if (!metrics) return data as T;

  const hc = metric(metrics, "hc");
  const onb = metric(metrics, "onb");
  const att = metric(metrics, "att");
  const payroll = metric(metrics, "payroll");
  const incentive = metric(metrics, "incentive");
  const tat = metric(metrics, "tat");
  const resign = metric(metrics, "resign");
  const dpdp = metric(metrics, "dpdp");
  const appointmentEsign = metric(metrics, "appointmentEsign");
  const bgv = metric(metrics, "bgv");
  const nm = metric(metrics, "nm");
  const joiningDocEsign = metric(metrics, "joiningDocEsign");

  if (dashboardCode === "CEO_DASHBOARD") {
    return {
      headcount: { active: detail(hc, "active") ?? value(hc) },
      onboarding: {
        submitted: detail(onb, "submitted"),
        pending: detail(onb, "pending") ?? value(onb),
        stuck: detail(onb, "stuck"),
      },
      bgv: { pending: detail(bgv, "pending") ?? value(bgv) },
      nameMismatch: { blocking: detail(nm, "blocking") ?? value(nm) },
      tat: { breached: detail(tat, "breached") },
      incentive: { pendingAmount: detail(incentive, "pendingAmount") },
      payroll: {
        readyPct:
          detail(payroll, "total") && detail(payroll, "readyCount") != null
            ? Math.round((Number(detail(payroll, "readyCount")) / Math.max(Number(detail(payroll, "total")), 1)) * 100)
            : value(payroll),
      },
      resignation: { pendingDiscussion: detail(resign, "pendingDiscussion") },
      dpdp: {
        pending: detail(dpdp, "pending") ?? value(dpdp),
        overdue: detail(dpdp, "overdue"),
        holdsActive: detail(dpdp, "holdsActive"),
      },
      appointmentEsign: {
        pending: detail(appointmentEsign, "pending") ?? value(appointmentEsign),
        candidatePending: detail(appointmentEsign, "candidatePending"),
        companyPending: detail(appointmentEsign, "companyPending"),
      },
    } as T;
  }

  if (dashboardCode === "HR_DASHBOARD") {
    return {
      onboarding: {
        submitted: detail(onb, "submitted"),
        pending: detail(onb, "pending") ?? value(onb),
        stuck: detail(onb, "stuck"),
      },
      bgvPending: detail(bgv, "pending") ?? value(bgv),
      resignationDiscussionPending: detail(resign, "pendingDiscussion") ?? value(resign),
      dpdpWithdrawals: detail(dpdp, "pending") ?? value(dpdp),
      dpdpOverdue: detail(dpdp, "overdue"),
      appointmentEsignPending: detail(appointmentEsign, "pending") ?? value(appointmentEsign),
      joiningDocEsignPending: detail(joiningDocEsign, "pending") ?? value(joiningDocEsign),
      joiningDocEsignOverdue: detail(joiningDocEsign, "overdue"),
    } as T;
  }

  if (dashboardCode === "PAYROLL_HR_DASHBOARD") {
    const readyCount = Number(detail(payroll, "readyCount") ?? value(payroll) ?? 0);
    const blockerCount = Number(detail(payroll, "blockerCount") ?? 0);
    const total = readyCount + blockerCount;
    return {
      readinessScore: total > 0 ? Math.round((readyCount / total) * 100) : 0,
      breakdown: [
        { name: "Ready", value: total > 0 ? Math.round((readyCount / total) * 100) : 0 },
        { name: "Blocked", value: total > 0 ? Math.round((blockerCount / total) * 100) : 0 },
      ],
      blockers: {
        missingBank: detail(payroll, "missingBank") ?? 0,
        missingPan: detail(payroll, "missingPan") ?? 0,
        missingUan: detail(payroll, "missingUan") ?? 0,
        statutoryIncomplete: blockerCount,
      },
      jclrPending: detail(onb, "pending") ?? 0,
      nameMismatchBlocking: detail(nm, "blocking") ?? 0,
      onboardingValidationPending: detail(onb, "pending") ?? 0,
      appointmentEsignPending: detail(appointmentEsign, "pending") ?? value(appointmentEsign),
      appointmentCandidatePending: detail(appointmentEsign, "candidatePending"),
      appointmentCompanyPending: detail(appointmentEsign, "companyPending"),
    } as T;
  }

  if (dashboardCode === "WFM_DASHBOARD") {
    return {
      requiredHc: detail(hc, "required"),
      availableHc: detail(hc, "available") ?? detail(hc, "active") ?? value(hc),
      attendanceRate: detail(att, "attendanceRate") ?? value(att),
      missingPunch: detail(att, "missedPunch"),
    } as T;
  }

  if (dashboardCode === "MANAGEMENT_DASHBOARD") {
    return {
      teamMembers: detail(hc, "active") ?? value(hc),
      attendanceRate: detail(att, "attendanceRate") ?? value(att),
      presentToday: detail(att, "present"),
      absentToday: detail(att, "absent"),
      lateToday: detail(att, "late"),
      missingPunch: detail(att, "missedPunch"),
      onboardingPending: detail(onb, "pending") ?? value(onb),
      resignationPending: detail(resign, "pendingDiscussion") ?? value(resign),
      dpdpWithdrawals: detail(dpdp, "pending") ?? value(dpdp),
      workItems: data.workItems,
    } as T;
  }

  return data as T;
}
