/**
 * Second half of the KPI catalogue seed: Lawyer Panel (LP), Dalmia, SBI Card, the inbound-only processes, the live
 * dialer processes (BLA/BLI/BLU, Reginald, Finnable) and the cross-process `_global` set (ops-command workforce KPIs,
 * trainer / LMS KPIs). Split from kpi-catalogue.seed.ts only to keep each file readable.
 */
import type { AudiencePreset, CatalogueProcessDef } from "./kpi-catalogue.types.js";
import { A_ALL, A_LEADS, A_MGMT, inboundKpis, k, qualityKpis, workforceKpis } from "./kpi-catalogue.library.js";

const H = "higher_is_better" as const;
const L = "lower_is_better" as const;
const TRAIN_AUD: AudiencePreset[] = ["agent", "team_leader", "trainer", "process_manager", "head_office", "admin"];
const TRAIN_LEAD: AudiencePreset[] = ["trainer", "process_manager", "head_office", "admin"];
const std = () => [...workforceKpis(), ...qualityKpis()];

function lpKpis(ref: string, onboarding: boolean) {
  const d = ["date", "week", "hour", "lead_source", "agent"];
  return [
    k("lp_unique_leadset", "Unique leadset", "outbound", "volume", "count", H, "both", "upload", ref, "COUNT(unique_flag = '1')", "upload", d, A_ALL),
    k("lp_overall_calls", "Overall calls", "outbound", "volume", "count", H, "both", "upload", ref, "COUNT(CDR rows)", "upload", d, A_ALL, { metricCode: "DIALS" }),
    k("lp_overall_connect_pct", "Overall connected %", "outbound", "rate", "percent", H, "both", "upload", ref, "connected / overall calls", "upload", d, A_ALL),
    k("lp_unique_connected", "Unique connected", "outbound", "volume", "count", H, "both", "upload", ref, "COUNT(connected AND unique_flag = '1')", "upload", d, A_ALL),
    k("lp_unique_connectivity_pct", "Unique connectivity %", "outbound", "rate", "percent", H, "both", "upload", ref, "unique connected / unique leadset", "upload", d, A_ALL),
    k("lp_login_count", "Login count", "workforce", "volume", "count", H, "process", "upload", ref, "COUNT(DISTINCT agent) with login", "upload", ["date"], A_MGMT),
    k("lp_shrinkage_pct", "Shrinkage %", "workforce", "rate", "percent", L, "both", "upload", ref, "(login - net login) / login", "upload", ["date", "agent"], A_ALL),
    k("lp_occupancy_pct", "Occupancy %", "workforce", "rate", "percent", H, "both", "upload", ref, "handle time / (login - break)", "upload", ["date", "agent"], A_ALL),
    k("lp_avg_talk_per_agent_day", "Average talk per agent-day", "outbound", "duration", "seconds", L, "both", "upload", ref, "SUM(talk) / agent-days", "upload", ["date", "agent"], A_ALL, { metricCode: "TALK_TIME" }),
    ...(onboarding ? [k("lp_qualified_handover", "Qualified and handed over", "funnel", "volume", "count", H, "both", "upload", ref, "COUNT(disposition = qualified and handed over)", "upload", d, A_ALL)] : []),
  ];
}

export const SEED_PROCESSES_B: CatalogueProcessDef[] = [
  { processKey: "lp_feedback", processName: "Lawyer Panel - Feedback", processCodes: ["ERESOLUTION", "BSS_OB_NOIDA_1005"],
    kpis: [...lpKpis("db_masmis.lp_feedback_apr + lp_feedback_cdr (lp-call-dashboard.shared)", false), ...std()] },
  { processKey: "lp_onboarding", processName: "Lawyer Panel - Onboarding", processCodes: ["ERESOLUTION", "BSS_OB_NOIDA_1005"],
    kpis: [...lpKpis("db_masmis.lp_onboarding_apr + lp_onboarding_cdr (lp-call-dashboard.shared)", true), ...std()] },
  {
    processKey: "dalmia", processName: "Dalmia Cement", processCodes: ["DALMIA_CEMENT"],
    kpis: [
      ...inboundKpis("cdr_in_249"),
      k("dm_tagging_pct", "Tagging %", "inbound", "rate", "percent", H, "process", "upload", "db_masmis.dalmia_dd_raw", "tagged calls / calls", "upload", ["date", "language"], A_MGMT),
      k("dm_qrc", "QRC mix (Query / Request / Complaint)", "inbound", "volume", "count", L, "process", "upload", "db_masmis.dalmia_dd_raw (SUB SCENARIO 1)", "COUNT by QRC class", "upload", ["date"], A_MGMT),
      k("dm_leads_connected", "Leads connected / qualified", "funnel", "volume", "count", H, "process", "upload", "db_masmis.dalmia_dd_raw (by lead source)", "data received -> connected -> qualified", "upload", ["date", "lead_source"], A_MGMT),
      k("dm_outbound_connect_pct", "Outbound connect %", "outbound", "rate", "percent", H, "process", "upload", "db_masmis.dalmia_outbound_raw", "connected / unique calls", "upload", ["date"], A_MGMT),
      k("dm_utilization_pct", "Utilization %", "workforce", "rate", "percent", H, "process", "upload", "db_masmis.dalmia_apr_raw", "utilisation from APR", "upload", ["date"], A_MGMT, { notes: "Aggregate only: no agent breakdown exists." }),
      ...std(),
    ],
  },
  {
    processKey: "sbi_card", processName: "SBI Card Collections", processCodes: ["SBI_CARD"],
    kpis: [
      k("sbi_agent_calls", "Agent calls", "collections", "volume", "count", H, "both", "upload", "db_masmis.sbi_card_agent_mis", "SUM(calls)", "upload", ["date", "agent", "team", "campaign"], A_ALL, { metricCode: "COLLECTION_CALLS" }),
      k("sbi_agent_contacts", "Agent contacts", "collections", "volume", "count", H, "both", "upload", "db_masmis.sbi_card_agent_mis", "SUM(contacts)", "upload", ["date", "agent", "team"], A_ALL, { metricCode: "COLLECTION_CONTACTS" }),
      k("sbi_agent_contact_rate", "Contact rate %", "collections", "rate", "percent", H, "both", "derived", "db_masmis.sbi_card_agent_mis", "contacts / calls", "upload", ["date", "agent", "team"], A_ALL, { metricCode: "COLLECTION_CONTACT_RATE" }),
      k("sbi_agent_ptp", "Promise-to-pay (PTP)", "collections", "volume", "count", H, "both", "upload", "db_masmis.sbi_card_agent_mis", "SUM(ptp)", "upload", ["date", "agent", "team"], A_ALL, { metricCode: "COLLECTION_PTP" }),
      k("sbi_agent_pad", "Payment after dial (PAD)", "collections", "volume", "count", H, "both", "upload", "db_masmis.sbi_card_agent_mis", "SUM(pad)", "upload", ["date", "agent", "team"], A_ALL, { metricCode: "COLLECTION_PAD" }),
      k("sbi_agent_amount", "Amount collected", "collections", "volume", "currency", H, "both", "upload", "db_masmis.sbi_card_agent_mis", "SUM(amt_collected)", "upload", ["date", "agent", "team", "bucket"], A_ALL, { metricCode: "COLLECTION_AMOUNT" }),
      k("sbi_downtime_min", "Dialer downtime", "workforce", "duration", "minutes", L, "process", "upload", "db_masmis.sbi_card_downtime", "SUM(downtime minutes)", "upload", ["date"], A_MGMT),
      ...std(),
    ],
  },
  { processKey: "du_bangladesh", processName: "DU Bangladesh", processCodes: ["DU_DIGITAL", "BSS_IB_NOIDA_654"], kpis: [...inboundKpis("cdr_in_4"), ...std()] },
  { processKey: "viega", processName: "Viega", processCodes: ["VIEGA"], kpis: [...inboundKpis("cdr_in_249"), ...std()] },
  { processKey: "exicom", processName: "Exicom", processCodes: ["EXICOM"], kpis: [...inboundKpis("cdr_in_9"), ...std()] },
  {
    processKey: "bla_bli_blu", processName: "Bla Bli Blu (live dialer)", processCodes: ["BLA_BLI_BLU"],
    kpis: [
      ...inboundKpis("cdr_in_10_4"),
      k("bbb_apr_wait_talk_dispo", "APR wait / talk / dispo / pause", "workforce", "duration", "seconds", H, "employee", "dialer_live", "dialer_db.vicidial_agent_log_10_4 (inbound.service APR)", "SUM per agent by pause code (LB/TB/WB)", "realtime", ["date", "agent", "pause_code"], A_ALL),
      k("bbb_disposition_mix", "Disposition mix", "inbound", "volume", "count", H, "process", "dialer_live", "dialer_db.data_master_in Category1/2", "COUNT by disposition", "realtime", ["date", "category"], A_MGMT),
      ...std(),
    ],
  },
  {
    processKey: "reginald", processName: "Reginald (live dialer)", processCodes: ["REGINALD"],
    kpis: [
      k("rg_cart_calls", "Cart calls (ABC campaigns)", "outbound", "volume", "count", H, "both", "dialer_live", "dialer_db.cdr_ob_25 (reginald-cart.service)", "COUNT(calls)", "realtime", ["date", "agent", "campaign"], A_ALL, { metricCode: "DIALS" }),
      k("rg_cart_connected", "Cart connected", "outbound", "volume", "count", H, "both", "dialer_live", "dialer_db.cdr_ob_25", "COUNT(connected)", "realtime", ["date", "agent"], A_ALL),
      k("rg_cart_apr", "Analyst APR (login / talk / pause)", "workforce", "duration", "seconds", H, "employee", "dialer_live", "dialer_db.vicidial_agent_log_10_25", "SUM per analyst", "realtime", ["date", "agent"], A_ALL),
      ...std(),
    ],
  },
  {
    processKey: "finnable", processName: "Finnable (live dialer)", processCodes: ["FINNABLE"],
    kpis: [
      k("fn_apr_login", "Agent login / talk / pause", "workforce", "duration", "seconds", H, "employee", "dialer_live", "dialer_db.vicidial_agent_log_10_25 campaign FINNABLE (apr.service)", "SUM per agent", "realtime", ["date", "agent"], A_ALL),
      ...std(),
    ],
  },
  {
    processKey: "_global", processName: "All processes (operations, workforce, training)", processCodes: [],
    kpis: [
      k("g_headcount", "Headcount", "workforce", "volume", "count", H, "process", "derived", "employees (ops-command)", "COUNT(active employees)", "daily", ["branch", "process", "lob", "team"], [...A_MGMT, "wfm"] as AudiencePreset[]),
      k("g_attendance_pct", "Attendance %", "workforce", "rate", "percent", H, "process", "derived", "ops-command attendance tab", "present / planned", "daily", ["branch", "process", "lob", "team", "analyst"], [...A_LEADS, "wfm"] as AudiencePreset[]),
      k("g_live_login_pct", "Live login % (planned vs logged in)", "workforce", "rate", "percent", H, "process", "derived", "ops-command Live Today tab", "logged in / planned", "hourly", ["branch", "process", "team"], [...A_LEADS, "wfm"] as AudiencePreset[]),
      k("g_attrition_pct", "Attrition %", "workforce", "rate", "percent", L, "process", "derived", "ops-command attrition tab", "exits / average headcount", "daily", ["branch", "process", "lob"], A_MGMT),
      k("g_pip_count", "Agents on PIP", "workforce", "volume", "count", L, "process", "derived", "employee_performance_daily_snapshot.pip_status", "COUNT(pip_status active)", "daily", ["branch", "process", "team"], A_LEADS),
      k("g_training_at_risk", "Training at risk", "training", "volume", "count", L, "process", "derived", "ops-command quality tab", "agents with open training need / total", "daily", ["branch", "process"], [...A_MGMT, "trainer", "quality"] as AudiencePreset[]),
      k("t_course_completion_pct", "Course completion %", "training", "rate", "percent", H, "both", "daily_sync", "lms_learner_progress", "completed / assigned", "daily", ["date", "course", "batch", "agent"], TRAIN_AUD),
      k("t_assessment_score", "Assessment score", "training", "rate", "percent", H, "both", "daily_sync", "lms_assessment_scores", "AVG(score)", "daily", ["date", "course", "batch", "agent"], TRAIN_AUD),
      k("t_certification_pct", "Certified %", "training", "rate", "percent", H, "both", "daily_sync", "lms_certification_snapshot", "certified / required", "daily", ["batch", "process"], TRAIN_LEAD),
    ],
  },
];
