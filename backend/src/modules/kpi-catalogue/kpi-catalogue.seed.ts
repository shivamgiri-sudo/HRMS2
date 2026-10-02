/**
 * The reviewable per-process, per-role KPI map. Every entry mirrors what an existing dashboard already computes
 * (Process Performance V2, call master, process-operations, process-dashboard, live dashboards, ops-command) - the
 * source file is named in `sourceRef`. `npm run kpi:catalogue-map` renders this as Markdown; POST
 * /api/kpi-catalogue/sync loads it into kpi_catalogue idempotently.
 *
 * Process-level KPIs from the client "Process KPI's" registry are derived from PROCESS_KPI_REGISTRY rather than
 * copied, so the two cannot disagree.
 */
import { PROCESS_KPI_REGISTRY } from "../process-performance/kpi-metric-registry.js";
import type { CatalogueKpiDef, CatalogueProcessDef } from "./kpi-catalogue.types.js";
import {
  A_ALL, A_MGMT, chatKpis, inboundKpis, k, outboundKpis, prepaidRtoKpis, qualityKpis, salesKpis, workforceKpis,
} from "./kpi-catalogue.library.js";
import { SEED_PROCESSES_B } from "./kpi-catalogue.seed-b.js";

const H = "higher_is_better" as const;
const L = "lower_is_better" as const;
const std = () => [...workforceKpis(), ...qualityKpis()];

function fromRegistry(): CatalogueProcessDef[] {
  return PROCESS_KPI_REGISTRY.map((set) => {
    const kpis: CatalogueKpiDef[] = set.metrics.map((m) => {
      const sourceKind = m.cdrSource ? "dialer_live" : m.kpiMetricCode ? "daily_sync" : m.processSource ? "upload" : "manual";
      const noData = !m.cdrSource && !m.kpiMetricCode && !m.processSource;
      return k(
        m.metricKey, `${m.label} (${m.lobLabel})`, m.cdrSource ? "inbound" : "client_sla", m.family, m.unit, m.direction,
        "process", sourceKind,
        m.cdrSource ? `dialer_db.${m.cdrSource.table} campaign ${m.cdrSource.campaigns.join(",")} (${m.cdrSource.field})`
          : m.kpiMetricCode ? `kpi_daily_actual ${m.kpiMetricCode}` : "process_metric_actual (hand-entered / uploaded / Studio process grain)",
        `Client SLA target ${m.target ?? "n/a"} from the Process KPI sheet`,
        m.cdrSource ? "realtime" : "upload", ["date", "lob"], A_MGMT,
        { metricCode: m.kpiMetricCode, defaultTarget: m.target, hasData: !(noData || (!m.kpiMetricCode && !m.cdrSource)), notes: m.notTrackedNote },
      );
    });
    return { processKey: set.processCode.toLowerCase(), processName: `${set.billingName} / ${set.projectName}`, processCodes: [set.processCode], kpis };
  });
}

const PRIMARY: CatalogueProcessDef[] = [
  {
    processKey: "bellavita", processName: "Bellavita", processCodes: ["BELLA_VITA"],
    kpis: [
      ...salesKpis("db_masmis.bb_sale + bb_apr (bellavita-sale-dashboard.service)", "upload", ["date", "lob", "agent", "sale_source"]),
      ...prepaidRtoKpis("db_masmis.bb_sale"),
      k("bb_sale_net_turnover", "Net turnover", "sales", "volume", "currency", H, "process", "upload", "db_masmis.bb_sale", "turnover - cancelled / RTO value", "upload", ["date", "lob"], A_MGMT),
      k("bb_cart_unique_connected", "Cart unique connected", "abandon_cart", "volume", "count", H, "both", "upload", "db_masmis.bb_cart + bb_apr", "COUNT(DISTINCT cart_id) connected", "upload", ["date", "agent"], A_ALL),
      k("bb_cart_connect_pct", "Cart connect %", "abandon_cart", "rate", "percent", H, "both", "upload", "db_masmis.bb_cart", "unique connected / base workable cases", "upload", ["date", "agent"], A_ALL),
      k("bb_cart_same_day_connect", "Cart same-day connect", "abandon_cart", "volume", "count", H, "both", "upload", "db_masmis.bb_cart", "unique connected on allocation day", "upload", ["date", "agent"], A_ALL),
      k("bb_cart_cpa", "Cart cases per agent (CPA)", "abandon_cart", "rate", "ratio", H, "process", "derived", "db_masmis.bb_cart + bb_apr", "base cases / agents logged in", "upload", ["date"], A_MGMT),
      k("bb_cart_value", "Cart value recovered", "abandon_cart", "volume", "currency", H, "both", "upload", "db_masmis.bb_cart", "SUM(cart value) of converted carts", "upload", ["date", "agent"], A_ALL),
      k("bb_chat_frt_pct", "Chat first response in TAT %", "chat", "rate", "percent", H, "both", "upload", "db_masmis.new_bb_chat (bellavita-chat-overview)", "FRT within target / chats", "upload", ["date", "agent", "chat_type"], A_ALL),
      k("bb_chat_repeat_72", "Chat repeat 24/48/72h %", "chat", "rate", "percent", L, "process", "upload", "db_masmis.new_bb_chat", "repeat contacts within window / unique", "upload", ["date"], A_MGMT),
      k("bb_chat_conversion", "Chat conversion (unique)", "chat", "rate", "percent", H, "both", "upload", "db_masmis.new_bb_chat + bb_sale (campaign Chat)", "orders / unique chats", "upload", ["date", "agent"], A_ALL),
      ...chatKpis("db_masmis.bb_chat (bellavita-chat-dashboard.service)", 60, true),
      ...inboundKpis("cdr_in_11_5"),
      ...std(),
    ],
  },
  {
    processKey: "gnc", processName: "GNC", processCodes: ["GNC", "GUARDIAN_HC"], // GNC sale agents sit on GUARDIAN_HC (15 of 15 active, traced in prod 2026-10-02)
    kpis: [
      ...salesKpis("db_masmis.gnc_sale + gnc_allocation + gnc_apr (gnc-sale-dashboard.service)", "upload", ["date", "campaign", "team", "agent"]),
      k("gnc_alloc_connected", "Allocation connected", "allocation", "volume", "count", H, "both", "upload", "db_masmis.gnc_allocation", "COUNT(connected allocations)", "upload", ["date", "agent", "campaign"], A_ALL),
      k("gnc_alloc_same_day", "Same-day connected", "allocation", "rate", "percent", H, "both", "upload", "db_masmis.gnc_allocation", "connected on allocation day / allocated", "upload", ["date", "agent"], A_ALL),
      k("gnc_cart_conversion", "Abandon-cart conversion %", "abandon_cart", "rate", "percent", H, "both", "upload", "db_masmis.gnc_allocation + gnc_sale (campaign Abandon Cart)", "sales / connected", "upload", ["date", "agent"], A_ALL),
      k("gnc_prepaid_pct", "Prepaid %", "sales", "rate", "percent", H, "both", "upload", "db_masmis.gnc_sale", "prepaid orders / orders", "upload", ["date", "agent", "campaign"], A_ALL),
      k("gnc_lob_target_ach", "LOB monthly target achievement %", "sales", "rate", "percent", H, "both", "derived", "mas_hrms.gnc_lob_target (gnc-targets.service)", "revenue / (per-agent or fixed target x days)", "upload", ["month", "lob", "agent"], A_ALL, { notes: "Percentage of target; the underlying REVENUE actual is a currency metric." }),
      k("gnc_chat_resp_pct", "Chat response in TAT (60 min) %", "chat", "rate", "percent", H, "both", "upload", "db_masmis.gnc_chat", "responses within 60 min / tickets", "upload", ["date", "agent", "qrc_bucket"], A_ALL),
      ...chatKpis("db_masmis.gnc_chat (gnc-chat-dashboard.service)", 60),
      ...inboundKpis("cdr_in_4"),
      ...std(),
    ],
  },
  {
    processKey: "neemans", processName: "Neemans", processCodes: ["NEEMANS"],
    kpis: [
      ...salesKpis("db_masmis.neemans_sale_raw + neemans_allocation + neemans_apr (neemans-performance-dashboard)", "upload", ["date", "agent", "team"]),
      ...prepaidRtoKpis("db_masmis.neemans_sale_raw (final_status RTO)"),
      k("nm_alloc_connect_pct", "Allocation connect %", "allocation", "rate", "percent", H, "both", "upload", "db_masmis.neemans_allocation", "connected / allocated (calling_status)", "upload", ["date", "agent", "sub_scenario"], A_ALL),
      k("nm_target_vs_ach", "Target vs achievement", "sales", "rate", "percent", H, "both", "derived", "nms_Agent_Details.monthly_target + neemans_month_targets", "revenue / monthly target", "upload", ["month", "agent"], A_ALL),
      k("nm_chat_csat", "Chat CSAT", "chat", "rate", "ratio", H, "both", "upload", "db_masmis.neemans_chat", "AVG(csat)", "upload", ["date", "agent"], A_ALL, { hasData: false, notes: "neemans_chat holds only a handful of rows." }),
      k("nm_cart_value", "Abandoned cart value", "abandon_cart", "volume", "currency", H, "both", "upload", "db_masmis.neemans_cart", "SUM(cart value) by disposition", "upload", ["date", "agent"], A_ALL, { hasData: false, notes: "neemans_cart has 0 rows." }),
      ...inboundKpis("cdr_in_249", { fcr: true }),
      ...std(),
    ],
  },
  {
    processKey: "appreciate_health", processName: "Appreciate Wealth", processCodes: ["APPRICIATE_WEALTH", "BSS_OB_NOIDA_923"],
    kpis: [
      k("aw_calling_ach_pct", "Calling achievement %", "outbound", "rate", "percent", H, "both", "upload", "db_masmis.aw_out / aw_billing (appreciate-wealth-outbound-center)", "calls / calling target", "upload", ["date", "agent", "lob"], A_ALL),
      k("aw_connectivity_pct", "Connectivity %", "outbound", "rate", "percent", H, "both", "upload", "db_masmis.aw_billing + aw_out", "connected / dials", "upload", ["date", "agent"], A_ALL, { metricCode: "AW_CONNECT_PCT" }),
      k("aw_calls", "Calls", "outbound", "volume", "count", H, "both", "upload", "db_masmis.aw_billing + aw_out", "SUM(total_calls)", "upload", ["date", "agent", "lob"], A_ALL, { metricCode: "AW_CALLS" }),
      k("aw_connected", "Connected calls", "outbound", "volume", "count", H, "both", "upload", "db_masmis.aw_billing + aw_out", "SUM(connected_calls)", "upload", ["date", "agent", "lob"], A_ALL, { metricCode: "AW_CONNECTED" }),
      k("aw_avg_talk", "Average talk per connected call", "outbound", "duration", "seconds", L, "both", "upload", "db_masmis.aw_billing + aw_out", "SUM(total_talk_time) / connected calls", "upload", ["date", "agent"], A_ALL, { metricCode: "AW_AVG_TALK_SEC" }),
      k("aw_login_hours", "Login hours", "workforce", "duration", "hours", H, "employee", "upload", "db_masmis.aw_billing + aw_out", "SUM(total_login_time) / 3600", "upload", ["date", "agent"], A_ALL, { metricCode: "AW_LOGIN_HOURS" }),
      k("aw_aht_sec", "AHT (with / without pickup)", "outbound", "duration", "seconds", L, "both", "upload", "db_masmis.aw_billing", "(talk + wrap) / calls", "upload", ["date", "agent"], A_ALL, { metricCode: "AHT" }),
      k("aw_occupancy_pct", "Occupancy %", "workforce", "rate", "percent", H, "both", "upload", "db_masmis.aw_billing (talk / wrap / idle / pause / login)", "(talk + wrap) / (login - pause)", "upload", ["date", "agent"], A_ALL),
      k("aw_late_login_pct", "Late login %", "workforce", "rate", "percent", L, "both", "upload", "db_masmis.aw_billing login status", "late logins / days", "upload", ["date", "agent"], A_ALL),
      k("aw_wrap_break_exceed", "Wrap / break exceed", "workforce", "duration", "minutes", L, "both", "upload", "db_masmis.aw_billing", "minutes over wrap / break limit", "upload", ["date", "agent"], A_ALL),
      k("aw_product_ach_lrs", "Product achievement - LRS", "sales", "rate", "percent", H, "both", "upload", "db_masmis.aw_out sales outcomes", "LRS count / INR vs target", "upload", ["date", "agent"], A_ALL),
      k("aw_product_ach_trade", "Product achievement - Trade", "sales", "rate", "percent", H, "both", "upload", "db_masmis.aw_out sales outcomes", "Trade count / INR vs target", "upload", ["date", "agent"], A_ALL),
      k("aw_product_ach_mf", "Product achievement - Mutual Fund", "sales", "rate", "percent", H, "both", "upload", "db_masmis.aw_out sales outcomes", "MF count / INR vs target", "upload", ["date", "agent"], A_ALL),
      k("aw_inbound_al_pct", "Inbound answer level %", "inbound", "rate", "percent", H, "both", "upload", "db_masmis.aw_inbound", "answered / offered", "upload", ["date", "agent", "lob"], A_ALL),
      k("aw_cdr_aht", "CDR AHT / talk / wrap / hold", "inbound", "duration", "seconds", L, "both", "upload", "db_masmis.aw_new_cdr", "avg talk + wrap + hold", "upload", ["date", "agent", "call_type"], A_ALL),
      k("aw_productive_pct", "Productive %", "workforce", "rate", "percent", H, "both", "upload", "appreciate-wealth-control-center.service", "productive time / login time", "upload", ["date", "agent"], A_ALL),
      k("aw_billing_amount", "Billing amount (mandate x FTE rate)", "billing", "volume", "currency", H, "process", "upload", "db_masmis.aw_mandate", "mandate FTE x per-FTE rate", "upload", ["month", "lob"], A_MGMT),
      ...std(),
    ],
  },
  {
    processKey: "housing_owner", processName: "Housing Owner", processCodes: ["HOUSING_OWNER", "HOUSING_COM"], // staff sit on HOUSING_COM (105 active, verified in prod 2026-10-01)
    kpis: [
      ...salesKpis("db_masmis.owner_sale + Owner_cdr + owner_agent_details (housing-owner-dashboard.service)", "upload", ["date", "agent", "tl", "am"]),
      ...outboundKpis("db_masmis.Owner_cdr"),
      k("ho_bucket", "TQ / MQ / BQ bucket", "sales", "rate", "percent", H, "both", "derived", "housing-owner-dashboard.service", "achievement >= 80% TQ, 50-79% MQ, < 50% BQ", "upload", ["date", "agent", "tl", "am"], A_ALL),
      ...std(),
    ],
  },
  {
    processKey: "housing_premium", processName: "Housing Premium", processCodes: ["HOUSING_PREMIUM", "HOUSING_COM"], // staff sit on HOUSING_COM (105 active, verified in prod 2026-10-01)
    kpis: [
      ...salesKpis("db_masmis.pre_sale + pre_agent_details + Pre_cdr (housing-premium-dashboard.service)", "upload", ["date", "week", "slot", "agent", "tl", "center"]),
      ...outboundKpis("db_masmis.Pre_cdr"),
      k("hp_bucket", "TQ / MQ / BQ bucket", "sales", "rate", "percent", H, "both", "derived", "housing-premium-dashboard.service", "achievement >= 80% TQ, 50-79% MQ, < 50% BQ", "upload", ["date", "agent", "tl"], A_ALL),
      ...std(),
    ],
  },
  {
    processKey: "clovia", processName: "Clovia", processCodes: ["CLOVIA"],
    kpis: [
      ...inboundKpis("cdr_in_250"),
      k("cl_csat", "CSAT (IVR feedback)", "inbound", "rate", "percent", H, "process", "upload", "db_masmis.cl_feedback", "positive responses / responses; response rate", "upload", ["date", "lob"], A_MGMT),
      k("cl_rechurn_pct", "Rechurn calls %", "inbound", "rate", "percent", L, "process", "upload", "db_masmis.cl_rechurn_call", "rechurn / calls", "upload", ["date"], A_MGMT),
      k("cl_email_closure_pct", "Email closure %", "email", "rate", "percent", H, "both", "upload", "db_masmis.cl_email_raw", "closed / assigned", "upload", ["date", "agent"], A_ALL, { metricCode: "EMAIL_CLOSURE_PCT" }),
      k("cl_email_assigned", "Emails assigned", "email", "volume", "count", H, "both", "upload", "db_masmis.cl_email_raw", "SUM(total_mail_assigned)", "upload", ["date", "agent"], A_ALL, { metricCode: "EMAIL_ASSIGNED" }),
      k("cl_email_touch_pct", "Email touch %", "email", "rate", "percent", H, "both", "upload", "db_masmis.cl_email_raw", "touched / assigned", "upload", ["date", "agent"], A_ALL),
      k("cl_chat_accept_60", "Chat accepted within 60s %", "chat", "rate", "percent", H, "both", "upload", "db_masmis.cl_chat", "accepted <= 60s / chats", "upload", ["date", "agent"], A_ALL),
      k("cl_chat_rating", "Chat customer rating", "chat", "rate", "ratio", H, "both", "upload", "db_masmis.cl_chat", "AVG(star_rating_value)", "upload", ["date", "agent"], A_ALL, { metricCode: "CL_CHAT_RATING" }),
      k("cl_chats", "Chats handled", "chat", "volume", "count", H, "both", "upload", "db_masmis.cl_chat", "COUNT(chats) per agent-day", "upload", ["date", "agent"], A_ALL, { metricCode: "CL_CHATS" }),
      k("cl_chat_wait", "Chat wait to accept", "chat", "duration", "seconds", L, "both", "upload", "db_masmis.cl_chat", "AVG(wait_time)", "upload", ["date", "agent"], A_ALL, { metricCode: "CL_CHAT_WAIT_SEC" }),
      k("cl_out_connect_pct", "Outbound connect % (> 10s)", "outbound", "rate", "percent", H, "both", "upload", "db_masmis.cl_outbound", "connected dials / dials", "upload", ["date", "hour", "agent", "campaign"], A_ALL, { metricCode: "CL_OB_CONNECT_PCT" }),
      k("cl_out_dials", "Outbound dials", "outbound", "volume", "count", H, "both", "upload", "db_masmis.cl_outbound", "COUNT(dials) per agent-day", "upload", ["date", "agent", "campaign"], A_ALL, { metricCode: "CL_OB_DIALS" }),
      k("cl_out_avg_talk", "Outbound average talk", "outbound", "duration", "seconds", L, "both", "upload", "db_masmis.cl_outbound", "AVG(length_sec) of connected dials", "upload", ["date", "agent"], A_ALL, { metricCode: "CL_OB_AVG_TALK_SEC" }),
      ...std(),
    ],
  },
  {
    processKey: "birlanu", processName: "Birlanu", processCodes: ["BIRLANU"],
    kpis: [
      k("bi_enquiries", "Enquiries received", "funnel", "volume", "count", H, "process", "upload", "db_masmis.birlanu_sale", "COUNT(enquiries)", "upload", ["date", "brand", "product", "zone", "source"], A_MGMT),
      k("bi_connect_pct", "Enquiry connect %", "funnel", "rate", "percent", H, "both", "upload", "db_masmis.birlanu_sale", "connected / enquiries", "upload", ["date", "agent", "source"], A_ALL),
      k("bi_leads_qualified", "Leads qualified", "funnel", "volume", "count", H, "both", "upload", "db_masmis.birlanu_sale", "Sub Sub Calling Status = 'Lead assign to Sales team'", "upload", ["date", "agent", "source"], A_ALL),
      k("bi_conversion_pct", "Lead conversion %", "funnel", "rate", "percent", H, "both", "upload", "db_masmis.birlanu_sale", "leads converted / leads qualified", "upload", ["date", "agent"], A_ALL, { metricCode: "CONVERSION_RATE" }),
      k("bi_volume_mt", "Volume (MT)", "sales", "volume", "count", H, "process", "upload", "db_masmis.birlanu_sale", "SUM(volume MT)", "upload", ["month", "brand", "product", "zone"], A_MGMT),
      k("bi_value_lacs", "Value (INR lacs)", "sales", "volume", "currency", H, "process", "upload", "db_masmis.birlanu_sale", "SUM(value) / 100000", "upload", ["month", "brand", "product", "zone"], A_MGMT),
      k("bi_lead_tat_pct", "Lead TAT within target %", "funnel", "rate", "percent", H, "process", "upload", "db_masmis.birlanu_sale", "leads actioned within TAT / leads", "upload", ["date", "tat_bucket"], A_MGMT),
      k("bi_agent_productivity", "Agent productivity (APR)", "workforce", "rate", "ratio", H, "employee", "upload", "db_masmis.birlanu_apr", "login / talk per agent-day", "upload", ["date", "agent"], A_ALL, { hasData: false, notes: "birlanu_apr metric columns are NULL for all rows." }),
      ...std(),
    ],
  },
  {
    processKey: "satya_retail", processName: "Satya Retail", processCodes: ["SATYA_RETAIL", "BSS_OB_NOIDA_1045", "IDAM", "VST"], // Satya allocation agents sit on IDAM (4) and VST (2) (traced in prod 2026-10-02)
    kpis: [
      k("sr_allocated", "Shops allocated", "allocation", "volume", "count", H, "both", "upload", "db_masmis.satya_allocation", "COUNT(DISTINCT uid + unique_flag) per agent-day", "upload", ["date", "agent", "beat", "warehouse"], A_ALL, { metricCode: "SATYA_ALLOCATED" }),
      k("sr_calls_made", "Calls made", "outbound", "volume", "count", H, "both", "upload", "db_masmis.satya_cdr", "COUNT(call rows) per agent-day", "upload", ["date", "agent", "beat"], A_ALL, { metricCode: "SATYA_CALLS" }),
      k("sr_connected", "Connected", "outbound", "volume", "count", H, "both", "upload", "db_masmis.satya_allocation", "COUNT(DISTINCT uid + unique_flag where disposition = Connected)", "upload", ["date", "agent", "beat"], A_ALL, { metricCode: "SATYA_CONNECTED" }),
      k("sr_orders", "Orders placed", "sales", "volume", "count", H, "both", "upload", "db_masmis.satya_allocation", "COUNT(DISTINCT uid + unique_flag where sub_disposition = Order Placed)", "upload", ["date", "agent", "beat"], A_ALL, { metricCode: "SATYA_ORDERS" }),
      k("sr_conversion_pct", "Order conversion %", "sales", "rate", "percent", H, "both", "derived", "db_masmis.satya_allocation", "orders / connected", "upload", ["date", "agent"], A_ALL, { metricCode: "SATYA_CONVERSION_PCT" }),
      k("sr_pending", "Pending shops", "allocation", "volume", "count", L, "process", "upload", "db_masmis.satya_allocation", "allocated - attempted (excl. VDCL sentinel)", "upload", ["date", "beat"], A_MGMT),
      ...std(),
    ],
  },
];

/** Merges entries sharing a processKey (registry + hand-written + live-dialer lists); first metricKey wins. */
export function mergeProcesses(list: CatalogueProcessDef[]): CatalogueProcessDef[] {
  const byKey = new Map<string, CatalogueProcessDef>();
  for (const p of list) {
    const cur = byKey.get(p.processKey);
    if (!cur) { byKey.set(p.processKey, { ...p, kpis: [...p.kpis], processCodes: [...p.processCodes] }); continue; }
    const seen = new Set(cur.kpis.map((x) => x.metricKey));
    for (const x of p.kpis) if (!seen.has(x.metricKey)) { cur.kpis.push(x); seen.add(x.metricKey); }
    for (const c of p.processCodes) if (!cur.processCodes.includes(c)) cur.processCodes.push(c);
  }
  return [...byKey.values()];
}

export const SEED_PROCESSES: CatalogueProcessDef[] = mergeProcesses([...PRIMARY, ...SEED_PROCESSES_B, ...fromRegistry()]);
