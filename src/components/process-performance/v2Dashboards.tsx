import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { ProcessDashboard } from "@/components/process-dashboard/ProcessDashboard";
import { ProjectDetailView } from "@/pages/NativeInboundDashboard";
import { BellavitaSaleDashboard } from "@/components/process-performance/BellavitaSaleDashboard";
import { GncSaleDashboard } from "@/components/process-performance/GncSaleDashboard";
import { GncChatDashboard } from "@/components/process-performance/GncChatDashboard";
import { GncTargetsDashboard } from "@/components/process-performance/GncTargetsDashboard";
import { ProcessTargetsPage } from "@/components/process-performance/ProcessTargetsPage";
import { GncAbandonCartDashboard } from "@/components/process-performance/GncAbandonCartDashboard";
import { InboundInsightsDashboard, type InboundInsightProject } from "@/components/process-performance/InboundInsightsDashboard";
import { NeemansCartDashboard } from "@/components/process-performance/NeemansCartDashboard";
import { NeemansPerformanceDashboard } from "@/components/process-performance/NeemansPerformanceDashboard";
import { NeemansChatDashboard } from "@/components/process-performance/NeemansChatDashboard";
import { BellavitaChatDashboard } from "@/components/process-performance/BellavitaChatDashboard";
import { BellavitaCartDashboard } from "@/components/process-performance/BellavitaCartDashboard";
import { DalmiaDashboard } from "@/components/process-performance/DalmiaDashboard";
import { SbiCardDashboard } from "@/components/process-performance/SbiCardDashboard";
import { HousingOwnerDashboard } from "@/components/process-performance/HousingOwnerDashboard";
import { HousingPremiumSaleDashboard } from "@/components/process-performance/HousingPremiumSaleDashboard";
import { LpFeedbackDashboard } from "@/components/process-performance/LpFeedbackDashboard";
import { LpOnboardingDashboard } from "@/components/process-performance/LpOnboardingDashboard";
import { SatyaRetailDashboard } from "@/components/process-performance/SatyaRetailDashboard";
import { CloviaDashboard } from "@/components/process-performance/CloviaDashboard";
import { DuDigitalDashboard } from "@/components/process-performance/DuDigitalDashboard";
import { AhmDashboard } from "@/components/process-performance/AhmDashboard";
import { AltRxDashboard } from "@/components/process-performance/AltRxDashboard";
import { BirlanuDashboard } from "@/components/process-performance/BirlanuDashboard";
import { AppreciateWealthDashboard } from "@/components/process-performance/AppreciateWealthDashboard";
import { UploaderHub, type UploaderHubItem } from "@/components/process-performance/UploaderHub";
import { UploaderWorkspace } from "@/components/process-performance/UploaderWorkspace";

/**
 * dalmia/dubangladesh/viega/exicom are spelled exactly as the backend's
 * inbound.service.ts PROJECTS[].key (dubangladesh has no underscore) --
 * company is passed straight through as projectKey with no separate
 * mapping table, same as bellavita/gnc/clovia/neemans already are.
 */
export type CompanyKey = "bellavita" | "gnc" | "neemans" | "appreciate_health" | "housing_owner" | "housing_premium" | "clovia" | "birlanu" | "satya_retail" | "alt_rx" | "lp_feedback" | "lp_onboarding" | "puresta" | "dalmia" | "dubangladesh" | "viega" | "exicom" | "sbi_card" | "du_thailand" | "du_korea" | "ahm";

/**
 * Named dashboard entries per company. "inbound" entries render the exact
 * same live dialer_db view as /call-master/inbound/:projectKey (via the
 * shared ProjectDetailView component) -- projectKey there already uses the
 * same lowercase keys as this page's CompanyKey (bellavita/gnc/clovia/
 * neemans), confirmed against backend/src/modules/call-master/
 * inbound.service.ts, so `company` is passed straight through with no
 * separate mapping. "stub" entries are the pre-existing "nothing built
 * yet" placeholders (Neemans' Sale/Allocation cards) -- unchanged.
 */
export const COMPANIES: Array<{ key: CompanyKey; label: string }> = [
  { key: "bellavita", label: "Bellavita" },
  { key: "gnc", label: "GNC" },
  { key: "neemans", label: "Neemans" },
  { key: "appreciate_health", label: "Appreciate Wealth" },
  { key: "housing_owner", label: "Housing Owner" },
  { key: "housing_premium", label: "Housing Premium" },
  { key: "clovia", label: "Clovia" },
  { key: "birlanu", label: "Birlanu" },
  { key: "satya_retail", label: "Satya Retail" },
  { key: "alt_rx", label: "ALT RX" },
  { key: "lp_feedback", label: "LP Feedback" },
  { key: "lp_onboarding", label: "LP Onboarding" },
  { key: "puresta", label: "Puresta" },
  { key: "dalmia", label: "Dalmia" },
  { key: "dubangladesh", label: "DU Bangladesh" },
  { key: "viega", label: "Viega" },
  { key: "exicom", label: "Exicom" },
  { key: "sbi_card", label: "SBI Card Collections" },
  { key: "du_thailand", label: "DU Digital Thailand" },
  { key: "du_korea", label: "DU Digital Korea" },
  { key: "ahm", label: "AHM" },
];

export const DASHBOARDS_BY_COMPANY: Partial<Record<CompanyKey, V2Dashboard[]>> = {
  bellavita: [
    { key: "sale_performance", label: "Overall Dashboard", description: "Turn over, RTO%, prepaid%, top performers — live from uploaded sale data", kind: "bellavita_sale" },
    { key: "chat_performance", label: "Chat Sale Performance", description: "Tickets, resolved%, repeat%, TL & agent-wise — live from uploaded chat data", kind: "bellavita_chat" },
    { key: "cart_performance", label: "Abandon Cart", description: "Cart value, connect%, discount codes, agent-wise + Repeat Allocation — live from uploaded cart data", kind: "bellavita_cart" },
    { key: "inbound", label: "Inbound", description: "Live call performance — AL%, SL%, ACHT, Repeat%", kind: "inbound" },
  ],
  housing_owner: [
    { key: "sale_performance", label: "Sale Performance", description: "Revenue vs target, AM/TL/agent-wise, call connect% — live from uploaded owner sale/CDR/roster data", kind: "housing_owner_sale" },
    { key: "process_details", label: "Process Details", description: "Change the monthly target agent-wise, TL-wise and AM-wise — every Housing Owner dashboard uses it", kind: "housing_owner_targets" },
  ],
  housing_premium: [
    { key: "sale_performance", label: "Sale Performance", description: "Revenue vs target, TL/agent-wise, call connect% — live from uploaded Premium sale/CDR/roster data", kind: "housing_premium_sale" },
    { key: "process_details", label: "Process Details", description: "Change the monthly target agent-wise, TL-wise and Center-wise — every Housing Premium dashboard uses it", kind: "housing_premium_targets" },
  ],
  lp_feedback: [
    { key: "call_performance", label: "Feedback Call Performance", description: "Login/calls/connectivity, lead-source, week-wise & agent-wise — live from uploaded APR/CDR data", kind: "lp_feedback" },
  ],
  lp_onboarding: [
    { key: "call_performance", label: "Onboarding Call Performance", description: "Login/calls/connectivity, lead-source, week-wise & agent-wise — live from uploaded APR/CDR data", kind: "lp_onboarding" },
  ],
  alt_rx: [
    { key: "alt_rx_dashboard", label: "ALT RX Dashboard", description: "Upload the ticket Dump to see Inflow, Closure, TAT and FRT by agent, comment type and brand, by day, week and MTD", kind: "alt_rx" },
  ],
  satya_retail: [
    { key: "satya_dashboard", label: "Satya Retail Dashboard", description: "Morning/Absentee allocation, calls, connect, orders & conversion, outcomes, agent-wise and daily tracker — live from uploaded allocation/CDR data", kind: "satya_retail_dashboard" },
  ],
  gnc: [
    { key: "sale_performance", label: "Overall Dashboard", description: "Gross revenue, prepaid%, allocation, top performers — live from uploaded sale data", kind: "gnc_sale" },
    { key: "abandon_cart", label: "Abandon Cart Dashboard", description: "Cart-recovery funnel, conversion, weekly comparison & top products — live from uploaded allocation/sale data", kind: "gnc_abandon_cart" },
    { key: "targets", label: "Targets", description: "Monthly revenue target per LOB (Inbound, Chat, Abandon Cart) — editable, and used by every GNC dashboard incl. agent-wise", kind: "gnc_targets" },
    { key: "chat_performance", label: "Chat Performance", description: "Tickets, unique/repeat, FRT/resolution TAT, QRC & agent-wise, with Sale (Chat) linkage — live from uploaded chat data", kind: "gnc_chat" },
    { key: "inbound", label: "Inbound", description: "Live call performance — Overview, agent-wise & date-wise breakdowns", kind: "inbound" },
  ],
  clovia: [
    { key: "dashboard", label: "Dashboard", description: "Inbound (live calls), Email/Chat/Feedback/Quality/Headcount and slot-wise/hourly views — beautiful multi-slide dashboard", kind: "clovia_dashboard" },
  ],
  appreciate_health: [
    { key: "dashboard", label: "Dashboard", description: "Overview, date-wise, billing & mandate, inbound, outbound dialer & sales, agent-wise and data health — live from the uploaded AW Billing / Inbound / Mandate / New CDR / Outbound files", kind: "appreciate_wealth" },
  ],
  birlanu: [
    { key: "dashboard", label: "Dashboard", description: "Lead-to-sale funnel, conversion%, business/brand/zone/agent-wise, TAT compliance — live from uploaded Sale/APR data", kind: "birlanu_dashboard" },
  ],
  neemans: [
    { key: "performance", label: "Sale, Allocation & Productivity", description: "Combined dashboard over Sale/Allocation/Productivity uploads — TL, agent-wise & date-wise, live", kind: "neemans_performance" },
    { key: "chat", label: "Chat Performance", description: "Tickets, resolved%, LOB-wise & agent-wise, FRT/resolution/CSAT — live from uploaded chat data", kind: "neemans_chat" },
    { key: "cart", label: "Abandoned Cart Dashboard", description: "Cart count, value, disposition & agent-wise breakdown — live from uploaded cart data", kind: "neemans_cart" },
    { key: "inbound", label: "Inbound", description: "Live call performance — AL%, SL%, ACHT, Repeat%, FCR%", kind: "inbound" },
  ],
  dalmia: [
    { key: "performance", label: "Inbound & Outbound Performance", description: "Calls, AL/SL, language-wise, outbound, QRC and leads — inbound live from the dialer, DD/Outbound/APR from the uploaders", kind: "dalmia_dashboard" },
    { key: "inbound", label: "Inbound", description: "Live call performance — AL%, SL%, ACHT, Repeat%", kind: "inbound" },
  ],
  sbi_card: [
    { key: "performance", label: "Collections Performance", description: "Dials, connects, PTP, campaigns/buckets, agents & teams, accounts, downtime and KPI metrics", kind: "sbi_card_dashboard" },
  ],
  dubangladesh: [
    { key: "inbound", label: "Inbound", description: "Live call performance — AL%, SL%, ACHT, Repeat%", kind: "inbound" },
  ],
  viega: [
    { key: "inbound", label: "Inbound", description: "Live call performance — AL%, SL%, ACHT, Repeat%", kind: "inbound" },
  ],
  exicom: [
    { key: "inbound", label: "Inbound", description: "Live call performance — AL%, SL%, ACHT, Repeat%", kind: "inbound" },
  ],
  du_thailand: [
    { key: "dashboard", label: "Dashboard", description: "Offered/Answered/SL/AL/Abandon%, AHT, Intraday Call Flow, Language/Queue view, Today/WTD/MTD snapshot — live from uploaded CDR/APR data", kind: "du_digital_thailand" },
  ],
  du_korea: [
    { key: "dashboard", label: "Dashboard", description: "Offered/Answered/SL/AL/Abandon%, AHT, Intraday Call Flow, Language/Queue view, Today/WTD/MTD snapshot — live from uploaded CDR/APR data", kind: "du_digital_korea" },
  ],
  ahm: [
    { key: "dashboard", label: "Dashboard", description: "Order vs Delivery, Disposition, Hourly order-taking, Product Mix, Telesales and Delivery Partner performance — live from the uploaded Dump data", kind: "ahm_dashboard" },
  ],
};


/** Local YYYY-MM-DD, deliberately NOT via toISOString(): that converts
 * through UTC and rolls the date back a day for a viewer ahead of UTC
 * (e.g. IST, UTC+5:30) -- same fix already applied throughout the other
 * Process Performance V2 dashboards. */
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const firstOfMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

/**
 * Date-range wrapper around NativeInboundDashboard's ProjectDetailView —
 * that component takes from/to as props rather than owning its own range,
 * so this tab supplies the default and controls its own date pickers,
 * reusing the live summary/trend/hourly view as-is. Defaults to the current
 * month (1st .. today), never a rolling window, so every Inbound dashboard
 * opens on "this month" consistently.
 */
function InboundDashboardTab({ projectKey }: { projectKey: string }) {
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm"
        />
        <span className="text-sm text-slate-400">—</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm"
        />
        <button
          type="button"
          onClick={() => { setFrom(firstOfMonthStr()); setTo(todayStr()); }}
          className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200"
        >
          <RotateCcw className="h-3.5 w-3.5" /> This Month
        </button>
      </div>
      <ProjectDetailView projectKey={projectKey} from={from} to={to} />
    </div>
  );
}

export type V2Dashboard = { key: string; label: string; description: string; kind: "inbound" | "stub" | "bellavita_sale" | "gnc_sale" | "gnc_chat" | "gnc_abandon_cart" | "gnc_targets" | "housing_owner_targets" | "housing_premium_targets" | "neemans_cart" | "neemans_chat" | "housing_owner_sale" | "housing_premium_sale" | "lp_feedback" | "lp_onboarding" | "satya_retail_dashboard" | "alt_rx" | "satya_retail_report" | "clovia_dashboard" | "birlanu_dashboard" | "neemans_performance" | "bellavita_chat" | "bellavita_cart" | "appreciate_wealth" | "dalmia_dashboard" | "sbi_card_dashboard" | "du_digital_thailand" | "du_digital_korea" | "ahm_dashboard" | "category_template" };
export type DashboardKind = V2Dashboard["kind"];

/**
 * The one place that knows how to draw a Process Performance V2 dashboard. ProcessPerformanceV2Page and the
 * Process Operations page both render through this, so a dashboard added or changed here shows up in both.
 */
export function V2DashboardView({ company, dashboard, onOpenDashboard }: {
  company: string;
  dashboard: { key: string; kind: DashboardKind };
  onOpenDashboard?: (dashboardKey: string) => void;
}) {
  return (
    <>
      {dashboard.kind === "inbound" ? (
              // Dialer-backed inbound processes share one full dashboard (overview / hour / date /
              // agent / LOB / wait & abandon / callers, with call-level drill-down). GNC's earlier
              // GncInboundDashboard component stays on disk but is no longer routed. Clovia still
              // uses the original shared InboundDashboardTab.
              (["dubangladesh", "exicom", "viega", "dalmia", "neemans", "gnc", "bellavita"] as string[]).includes(company)
                ? <InboundInsightsDashboard projectKey={company as InboundInsightProject} />
                : <InboundDashboardTab projectKey={company} />
            ) : dashboard.kind === "bellavita_sale" ? (
              <BellavitaSaleDashboard
                onOpenDashboard={(key) => { if (DASHBOARDS_BY_COMPANY.bellavita?.some((d) => d.key === key)) onOpenDashboard?.(key); }}
              />
            ) : dashboard.kind === "gnc_sale" ? (
              <GncSaleDashboard />
            ) : dashboard.kind === "housing_owner_targets" ? (
              <ProcessTargetsPage api="/api/process-performance/housing-owner-targets" topLevel="am" topLabel="AM" title="Housing Owner — Process Details (Targets)" pageCode="PP_HOUSING_OWNER_PROCESS_DETAILS" />
            ) : dashboard.kind === "housing_premium_targets" ? (
              <ProcessTargetsPage api="/api/process-performance/housing-premium-targets" topLevel="center" topLabel="Center" title="Housing Premium — Process Details (Targets)" pageCode="PP_HOUSING_PREMIUM_PROCESS_DETAILS" />
            ) : dashboard.kind === "gnc_targets" ? (
              <GncTargetsDashboard />
            ) : dashboard.kind === "gnc_abandon_cart" ? (
              <GncAbandonCartDashboard />
            ) : dashboard.kind === "gnc_chat" ? (
              <GncChatDashboard />
            ) : dashboard.kind === "neemans_cart" ? (
              <NeemansCartDashboard />
            ) : dashboard.kind === "neemans_performance" ? (
              <NeemansPerformanceDashboard />
            ) : dashboard.kind === "neemans_chat" ? (
              <NeemansChatDashboard />
            ) : dashboard.kind === "bellavita_chat" ? (
              <BellavitaChatDashboard />
            ) : dashboard.kind === "dalmia_dashboard" ? (
              <DalmiaDashboard />
            ) : dashboard.kind === "sbi_card_dashboard" ? (
              <SbiCardDashboard />
            ) : dashboard.kind === "category_template" ? (
              <ProcessDashboard key={dashboard.key} processId={dashboard.key} embedded />
            ) : dashboard.kind === "bellavita_cart" ? (
              <BellavitaCartDashboard />
            ) : dashboard.kind === "housing_owner_sale" ? (
              <HousingOwnerDashboard />
            ) : dashboard.kind === "housing_premium_sale" ? (
              <HousingPremiumSaleDashboard />
            ) : dashboard.kind === "lp_feedback" ? (
              <LpFeedbackDashboard />
            ) : dashboard.kind === "lp_onboarding" ? (
              <LpOnboardingDashboard />
            ) : dashboard.kind === "alt_rx" ? (
              <AltRxDashboard />
            ) : dashboard.kind === "satya_retail_dashboard" ? (
              <SatyaRetailDashboard />
            ) : dashboard.kind === "clovia_dashboard" ? (
              <CloviaDashboard />
            ) : dashboard.kind === "appreciate_wealth" ? (
              <AppreciateWealthDashboard />
            ) : dashboard.kind === "birlanu_dashboard" ? (
              <BirlanuDashboard />
            ) : dashboard.kind === "du_digital_thailand" ? (
              <DuDigitalDashboard country="THAILAND" />
            ) : dashboard.kind === "du_digital_korea" ? (
              <DuDigitalDashboard country="KOREA" />
            ) : dashboard.kind === "ahm_dashboard" ? (
              <AhmDashboard />
            ) : (
              <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-16 text-sm text-slate-400">
                Nothing here yet
              </div>
            )}
    </>
  );
}

/** Process Operations process_master.process_code -> the V2 company keys whose dashboards belong to it. */
const V2_COMPANIES_BY_PROCESS_CODE: Record<string, CompanyKey[]> = {
  BELLA_VITA: ["bellavita"],
  NEEMANS: ["neemans"],
  GNC: ["gnc"],
  APPRICIATE_WEALTH: ["appreciate_health"],
  CLOVIA: ["clovia"],
  DALMIA_CEMENT: ["dalmia"],
  DU_DIGITAL: ["du_thailand", "du_korea"],
  AHM: ["ahm"],
  SBI_CARD: ["sbi_card"],
  ERESOLUTION: ["lp_feedback", "lp_onboarding"],
  HOUSING_OWNER: ["housing_owner"],
  HOUSING_PREMIUM: ["housing_premium"],
  HOUSING_COM: ["housing_owner", "housing_premium"],
  SATYA_RETAIL: ["satya_retail"],
  ALT_RX: ["alt_rx"],
  BIRLANU: ["birlanu"],
  VIEGA: ["viega"],
  EXICOM: ["exicom"],
  DU_BANGLADESH: ["dubangladesh"],
  PURESTA: ["puresta"],
};

const normKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

/** V2 dashboards for a Process Operations process: by process code, else by an exact name match on the V2 company key/label. */
export function v2DashboardsForProcess(
  processCode: string,
  processName: string,
  companyLabels: Record<string, string>,
): Array<{ company: CompanyKey; companyLabel: string; dashboard: V2Dashboard }> {
  let keys = V2_COMPANIES_BY_PROCESS_CODE[processCode?.toUpperCase()];
  if (!keys) {
    const n = normKey(processName ?? "");
    const hit = (Object.keys(companyLabels) as CompanyKey[]).filter((k) => n && (normKey(k) === n || normKey(companyLabels[k]) === n));
    keys = hit.length ? hit : undefined;
  }
  if (!keys) return [];
  return keys.flatMap((company) =>
    (DASHBOARDS_BY_COMPANY[company] ?? [])
      .filter((d) => d.kind !== "stub")
      .map((dashboard) => ({ company, companyLabel: companyLabels[company] ?? company, dashboard })),
  );
}

export const V2_COMPANY_LABELS: Record<string, string> = Object.fromEntries(COMPANIES.map((c) => [c.key, c.label]));
