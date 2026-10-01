/**
 * Shared building blocks for the KPI catalogue seed: audience presets and the metric templates that recur across
 * processes (live inbound CDR, workforce, quality, generic sales / outbound / chat / email).
 *
 * Sources and formulas are the ones the existing dashboards really use (see each sourceRef); nothing here invents a
 * metric. A metric whose feed holds no rows today carries hasData:false so the page shows "no data", never 0.
 */
import type { AudienceDef, AudiencePreset, CatalogueKpiDef } from "./kpi-catalogue.types.js";

export const AUDIENCES: Record<AudiencePreset, AudienceDef> = {
  agent: { roles: ["employee", "agent", "trainee"], department: "operations", access: "view" },
  team_leader: { roles: ["team_leader", "team_lead", "tl", "manager", "assistant_manager"], department: "operations", access: "view" },
  process_manager: { roles: ["process_manager", "operations_manager"], department: "operations", access: "manage" },
  quality: { roles: ["qa", "quality_analyst", "qa_manager", "quality_lead", "branch_qa", "tq_head"], department: "quality", access: "view" },
  wfm: { roles: ["wfm", "wfm_spoc", "rta", "branch_wfm", "ho_wfm", "ho_rta"], department: "wfm", access: "view" },
  branch: { roles: ["branch_head", "branch_manager", "bm"], department: "operations", access: "view" },
  head_office: { roles: ["operations_head", "ho_operations", "ceo", "coo", "management"], department: "operations", access: "view" },
  trainer: { roles: ["trainer"], department: "training", access: "view" },
  admin: { roles: ["admin", "super_admin"], department: "operations", access: "manage" },
};

const LEADS: AudiencePreset[] = ["team_leader", "process_manager", "branch", "head_office", "admin"];
export const A_ALL: AudiencePreset[] = ["agent", ...LEADS];
export const A_LEADS = LEADS;
export const A_QUALITY: AudiencePreset[] = ["agent", "team_leader", "process_manager", "quality", "branch", "head_office", "admin"];
export const A_WFM: AudiencePreset[] = ["agent", "team_leader", "process_manager", "wfm", "branch", "head_office", "admin"];
export const A_MGMT: AudiencePreset[] = ["process_manager", "branch", "head_office", "admin"];

type Extra = Partial<CatalogueKpiDef>;

/** Compact definition helper. */
export function k(
  metricKey: string, name: string, theme: string,
  family: CatalogueKpiDef["family"], unit: CatalogueKpiDef["unit"], direction: CatalogueKpiDef["direction"],
  grain: CatalogueKpiDef["grain"], sourceKind: CatalogueKpiDef["sourceKind"], sourceRef: string, formula: string,
  freshness: CatalogueKpiDef["freshness"], dimensions: string[], audience: AudiencePreset[], extra: Extra = {},
): CatalogueKpiDef {
  return { metricKey, name, theme, family, unit, direction, grain, sourceKind, sourceRef, formula, freshness, dimensions, audience, ...extra };
}

const H = "higher_is_better" as const;
const L = "lower_is_better" as const;

/** Live inbound CDR block (dialer_db.cdr_in_*; call-master inbound-projects + process-live-dashboard/inbound.service). */
export function inboundKpis(cdrTable: string, opts: { fcr?: boolean } = {}): CatalogueKpiDef[] {
  const ref = `dialer_db.${cdrTable} via call-master/inbound-projects`;
  const dims = ["date", "hour", "campaign", "agent"];
  const out = [
    k("in_offered", "Calls offered", "inbound", "volume", "count", H, "both", "dialer_live", ref, "COUNT(calls offered)", "realtime", dims, A_ALL),
    k("in_answered", "Calls answered", "inbound", "volume", "count", H, "both", "dialer_live", ref, "COUNT(calls answered by agent)", "realtime", dims, A_ALL),
    k("in_abandoned", "Calls abandoned", "inbound", "volume", "count", L, "process", "dialer_live", ref, "offered - answered", "realtime", dims, A_MGMT),
    k("in_answer_level_pct", "Answer level %", "inbound", "rate", "percent", H, "both", "dialer_live", ref, "answered / offered", "realtime", dims, A_ALL),
    k("in_service_level_pct", "Service level %", "inbound", "rate", "percent", H, "both", "dialer_live", ref, "answered within threshold / answered (threshold 20s pattern A, 30s pattern B)", "realtime", dims, A_ALL),
    k("in_abandon_pct", "Abandon %", "inbound", "rate", "percent", L, "process", "dialer_live", ref, "abandoned / offered", "realtime", dims, A_MGMT),
    k("in_aht_sec", "Average handle time (AHT)", "inbound", "duration", "seconds", L, "both", "dialer_live", ref, "(talk + hold + ACW) / handled", "realtime", dims, A_ALL, { metricCode: "AHT" }),
    k("in_talk_sec", "Talk time", "inbound", "duration", "seconds", L, "both", "dialer_live", ref, "SUM(talk seconds) per agent / period", "realtime", dims, A_ALL, { metricCode: "TALK_TIME" }),
    k("in_acw_sec", "After-call work (ACW)", "inbound", "duration", "seconds", L, "both", "dialer_live", ref, "AVG(wrap seconds)", "realtime", dims, A_ALL, { metricCode: "ACW" }),
    k("in_hold_sec", "Hold time", "inbound", "duration", "seconds", L, "both", "dialer_live", ref, "AVG(hold seconds)", "realtime", dims, A_ALL, { metricCode: "HOLD_TIME" }),
    k("in_unique_callers", "Unique callers", "inbound", "volume", "count", H, "process", "dialer_live", ref, "COUNT(DISTINCT caller number)", "realtime", ["date", "campaign"], A_MGMT),
    k("in_repeat_pct", "Repeat callers %", "inbound", "rate", "percent", L, "process", "dialer_live", ref, "repeat callers / unique callers", "realtime", ["date", "campaign"], A_MGMT),
    k("in_agents_logged_in", "Agents logged in vs required", "inbound", "volume", "count", H, "process", "dialer_live", ref, "distinct handled agents / required headcount (project mandate)", "realtime", ["date", "hour"], A_MGMT),
  ];
  if (opts.fcr) out.push(k("in_fcr_pct", "First contact resolution %", "inbound", "rate", "percent", H, "both", "dialer_live", ref, "calls resolved on first contact / handled", "realtime", ["date", "agent"], A_ALL, { metricCode: "FCR" }));
  return out;
}

/** Workforce block common to every agent-level process (attendance_daily_record, APR, break_sessions, RTA). */
export function workforceKpis(): CatalogueKpiDef[] {
  return [
    k("wf_attendance_pct", "Attendance %", "workforce", "rate", "percent", H, "both", "daily_sync", "kpi_daily_actual ATTENDANCE_PCT <- attendance_daily_record", "P/PRESENT = 100, half day = 50; week-off, holiday, leave skipped", "daily", ["date", "agent", "team", "branch"], A_WFM, { metricCode: "ATTENDANCE_PCT" }),
    k("wf_login_hours", "Login hours", "workforce", "duration", "hours", H, "employee", "daily_sync", "attendance_daily_record.dialler_minutes", "dialler_minutes / 60", "daily", ["date", "agent"], A_WFM),
    k("wf_late_login_pct", "Late login %", "workforce", "rate", "percent", L, "both", "daily_sync", "attendance_daily_record.late_mark", "late days / present days", "daily", ["date", "agent", "team"], A_WFM),
    k("wf_break_minutes", "Break / AUX minutes", "workforce", "duration", "minutes", L, "employee", "daily_sync", "break_sessions / break_daily_summary", "SUM(duration_seconds)/60 per shift", "hourly", ["date", "agent", "break_type"], A_WFM),
    k("wf_occupancy_pct", "Occupancy %", "workforce", "rate", "percent", H, "both", "derived", "process-dashboard APR (pd.metrics)", "(talk + dispo) / (talk + wait + dispo)", "hourly", ["date", "hour", "agent", "team"], A_WFM, { notes: "Derived from APR; kpi_metric_master has no OCCUPANCY metric." }),
    k("wf_utilization_pct", "Utilization %", "workforce", "rate", "percent", H, "both", "derived", "process-dashboard APR (pd.metrics)", "(talk + wait + dispo) / login", "hourly", ["date", "agent", "team"], A_WFM),
    k("wf_adherence_pct", "Schedule adherence %", "workforce", "rate", "percent", H, "both", "daily_sync", "wfm_rta_exception / roster", "in-adherence minutes / scheduled minutes", "daily", ["date", "agent", "team"], A_WFM, { metricCode: "ADHERENCE", hasData: false, notes: "Defined in kpi_metric_master but no rows are produced yet." }),
    k("wf_shrinkage_pct", "Shrinkage %", "workforce", "rate", "percent", L, "process", "daily_sync", "employee_performance_daily_snapshot.team_shrinkage_pct", "(login - net login) / login", "daily", ["date", "team", "branch"], A_MGMT, { metricCode: "SHRINKAGE", hasData: false, notes: "Defined but not yet populated." }),
  ];
}

/** Quality block (qa_audit / call-master). */
export function qualityKpis(): CatalogueKpiDef[] {
  const dims = ["date", "agent", "team", "scenario"];
  return [
    k("q_qa_score_pct", "QA score %", "quality", "rate", "percent", H, "both", "daily_sync", "qa_audit.quality_percentage / call_quality_assessment", "AVG(quality_percentage)", "daily", dims, A_QUALITY, { metricCode: "QUALITY_SCORE" }),
    k("q_fatal_pct", "Fatal rate %", "quality", "rate", "percent", L, "both", "daily_sync", "qa_audit.fatal_triggered", "fatal audits / total audits", "daily", dims, A_QUALITY, { metricCode: "FATAL_RATE" }),
    k("q_tq_share_pct", "Top-quartile (TQ) agents %", "quality", "rate", "percent", H, "process", "derived", "call-master tq/mq/bq buckets", "agents with QA >= 80 / audited agents", "daily", ["date", "team"], ["quality", "process_manager", "branch", "head_office", "admin"]),
    k("q_bq_share_pct", "Bottom-quartile (BQ) agents %", "quality", "rate", "percent", L, "process", "derived", "call-master tq/mq/bq buckets", "agents with QA < 60 / audited agents", "daily", ["date", "team"], ["quality", "process_manager", "branch", "head_office", "admin"]),
    k("q_cx_score", "Customer experience score", "quality", "rate", "percent", H, "both", "derived", "call-master avg_cx", "mean of CX parameter flags / 5", "daily", dims, A_QUALITY),
    k("q_compliance_pct", "Compliance %", "quality", "rate", "percent", H, "both", "derived", "call-master avg_compliance", "mean of compliance parameter flags / 5", "daily", dims, A_QUALITY),
    k("q_audits_done", "Audits completed", "quality", "volume", "count", H, "both", "daily_sync", "qa_audit", "COUNT(audits)", "daily", ["date", "agent", "auditor"], ["quality", "process_manager", "head_office", "admin"]),
  ];
}

/** Generic agent-level outbound calling block (dials, connect, talk). */
export function outboundKpis(ref: string, fresh: CatalogueKpiDef["freshness"] = "upload"): CatalogueKpiDef[] {
  const d = ["date", "hour", "agent", "team", "campaign"];
  return [
    k("ob_dials", "Dials", "outbound", "volume", "count", H, "both", "upload", ref, "COUNT(dial rows)", fresh, d, A_ALL, { metricCode: "DIALS" }),
    k("ob_connected", "Connected calls", "outbound", "volume", "count", H, "both", "upload", ref, "COUNT(connected dials)", fresh, d, A_ALL),
    k("ob_connect_pct", "Connect %", "outbound", "rate", "percent", H, "both", "upload", ref, "connected / dials", fresh, d, A_ALL),
    k("ob_avg_talk_sec", "Average talk time", "outbound", "duration", "seconds", L, "both", "upload", ref, "SUM(talk) / connected", fresh, d, A_ALL, { metricCode: "TALK_TIME" }),
    k("ob_calls_per_login_hr", "Calls per login hour", "outbound", "rate", "ratio", H, "both", "derived", "process-dashboard (pd.metrics)", "calls / (login seconds / 3600)", fresh, d, A_ALL),
  ];
}

/** Generic sales block. */
export function salesKpis(ref: string, fresh: CatalogueKpiDef["freshness"] = "upload", dims: string[] = ["date", "agent", "team", "lob"]): CatalogueKpiDef[] {
  return [
    k("sl_sales_count", "Sales / orders", "sales", "volume", "count", H, "both", "upload", ref, "COUNT(DISTINCT order_id) where sale made", fresh, dims, A_ALL, { metricCode: "SALES_COUNT" }),
    k("sl_revenue", "Revenue", "sales", "volume", "currency", H, "both", "upload", ref, "SUM(order amount)", fresh, dims, A_ALL, { metricCode: "REVENUE" }),
    k("sl_aov", "Average order value (AOV)", "sales", "volume", "currency", H, "both", "derived", ref, "revenue / orders", fresh, dims, A_ALL, { metricCode: "AOV" }),
    k("sl_conversion_pct", "Conversion %", "sales", "rate", "percent", H, "both", "derived", ref, "sales / connected (or / calls when connected is unmapped)", fresh, dims, A_ALL, { metricCode: "CONVERSION_RATE" }),
    k("sl_target_ach_pct", "Target achievement %", "sales", "rate", "percent", H, "both", "derived", ref, "revenue / (monthly target prorated by days)", fresh, dims, A_ALL),
    k("sl_rev_per_agent", "Revenue per agent", "sales", "volume", "currency", H, "process", "derived", ref, "revenue / active agents", fresh, ["date", "team", "lob"], A_MGMT),
  ];
}

export function prepaidRtoKpis(ref: string, fresh: CatalogueKpiDef["freshness"] = "upload"): CatalogueKpiDef[] {
  return [
    k("sl_prepaid_pct", "Prepaid %", "sales", "rate", "percent", H, "both", "upload", ref, "prepaid orders / orders", fresh, ["date", "agent", "lob"], A_ALL, { notes: "Derived: prepaid = 100 - COD_SHARE. Not mapped to COD_SHARE itself because that metric has the opposite direction." }),
    k("sl_rto_pct", "RTO %", "sales", "rate", "percent", L, "both", "upload", ref, "RTO orders / orders", fresh, ["date", "agent", "lob"], A_ALL, { metricCode: "RTO_RATE" }),
  ];
}

/** Chat support block. `feed` maps the KPIs to metric codes once an upload feed writes per-agent rows for that process. */
export function chatKpis(ref: string, frtSec = 60, feed = false): CatalogueKpiDef[] {
  const d = ["date", "agent", "team", "lob"];
  return [
    k("ch_tickets", "Chat tickets", "chat", "volume", "count", H, "both", "upload", ref, "COUNT(tickets)", "upload", d, A_ALL, feed ? { metricCode: "CHAT_TICKETS" } : {}),
    k("ch_resolved_pct", "Resolved %", "chat", "rate", "percent", H, "both", "upload", ref, "resolved tickets / tickets", "upload", d, A_ALL, feed ? { metricCode: "CHAT_RESOLVED_PCT" } : {}),
    ...(feed ? [k("ch_frt_min", "Average first response time", "chat", "duration", "minutes", L, "both", "upload", ref, "AVG(frt_1) in minutes", "upload", d, A_ALL, { metricCode: "CHAT_FRT_MIN" })] : []),
    k("ch_frt_in_tat_pct", `First response within ${frtSec}s %`, "chat", "rate", "percent", H, "both", "upload", ref, `tickets with first response <= ${frtSec}s / tickets`, "upload", d, A_ALL),
    k("ch_resolution_time_sec", "Resolution time", "chat", "duration", "seconds", L, "both", "upload", ref, "AVG(resolution time)", "upload", d, A_ALL),
    k("ch_repeat_pct", "Repeat chat %", "chat", "rate", "percent", L, "process", "upload", ref, "repeat contacts (by phone) / unique", "upload", ["date", "lob"], A_MGMT),
  ];
}
