import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ProcessDashboard } from "@/components/process-dashboard/ProcessDashboard";
import { fetchConfigs as fetchProcessDashboardConfigs } from "@/components/process-dashboard/api";
import type { ProcessConfigSummary } from "@/components/process-dashboard/types";
import { Link } from "react-router-dom";
import { AltRxMisPanel } from "@/components/process-performance/AltRxMisPanel";
import { V2DashboardView, DASHBOARDS_BY_COMPANY, COMPANIES, todayStr, firstOfMonthStr, type CompanyKey, type DashboardKind } from "@/components/process-performance/v2Dashboards";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ProjectDetailView } from "@/pages/NativeInboundDashboard";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi, getAuthToken } from "@/lib/hrmsApi";
import { useTpzAccess } from "@/hooks/useTpzAccess";
import { apiUrl } from "@/lib/apiBase";
import { TONE_CLASSES, TONE_GRADIENT_CLASSES, type Tone } from "@/lib/processPerformanceTones";
import { UploaderHub, type UploaderHubItem } from "@/components/process-performance/UploaderHub";
import { UploaderWorkspace } from "@/components/process-performance/UploaderWorkspace";
import {
  Activity, ChevronLeft, ChevronRight, LayoutDashboard, Upload,
  ShoppingBag, MessageSquare, ShoppingCart, Target, Users,
  Receipt, PhoneIncoming, PhoneOutgoing, PhoneCall, ClipboardList,
  Mail, Star, ShieldCheck, Repeat, RotateCcw, TrendingUp,
  Heart, Footprints, HeartPulse, Home, Crown, Shirt, FileText, Tag,
  Building2, Globe, Settings, Zap, CreditCard, LayoutGrid, UploadCloud, Sparkles, Download,
  CalendarClock,
} from "lucide-react";
import { MisEmailScheduleDrawer } from "@/components/process-performance/MisEmailScheduleDrawer";

type SectionKey = "dashboards" | "uploader" | "mis";


/** Icon + color per company, purely a visual grouping aid on the landing
 * grid — has no bearing on which uploaders/dashboards a company has. */
const COMPANY_META: Record<CompanyKey, { icon: React.ComponentType<{ className?: string }>; tone: Tone }> = {
  bellavita: { icon: ShoppingBag, tone: "rose" },
  gnc: { icon: Heart, tone: "emerald" },
  neemans: { icon: Footprints, tone: "violet" },
  appreciate_health: { icon: HeartPulse, tone: "sky" },
  housing_owner: { icon: Home, tone: "orange" },
  housing_premium: { icon: Crown, tone: "amber" },
  clovia: { icon: Shirt, tone: "red" },
  birlanu: { icon: FileText, tone: "indigo" },
  satya_retail: { icon: Tag, tone: "yellow" },
  alt_rx: { icon: Tag, tone: "emerald" },
  lp_feedback: { icon: MessageSquare, tone: "blue" },
  lp_onboarding: { icon: Users, tone: "pink" },
  puresta: { icon: Sparkles, tone: "slate" },
  dalmia: { icon: Building2, tone: "green" },
  dubangladesh: { icon: Globe, tone: "cyan" },
  viega: { icon: Settings, tone: "purple" },
  exicom: { icon: Zap, tone: "fuchsia" },
  sbi_card: { icon: CreditCard, tone: "blue" },
  du_thailand: { icon: PhoneIncoming, tone: "red" },
  du_korea: { icon: PhoneIncoming, tone: "blue" },
};


const SECTIONS: Array<{ key: SectionKey; label: string; description: string }> = [
  { key: "dashboards", label: "Dashboards", description: "Live KPI dashboards, built from uploaded data" },
  { key: "uploader", label: "Uploader", description: "Bulk data uploaders" },
  { key: "mis", label: "MIS", description: "Download a combined MIS report for this process" },
];

/**
 * Bellavita's 4 live uploaders only — the other 3 db_masmis upload types this process
 * already has (Repeat CDR, Repeat Allocation, Shopify Order Export) are deliberately
 * left out here per explicit scope; they remain reachable from the main Bulk Upload
 * Hub's template dropdown.
 */
const BELLAVITA_UPLOADERS = [
  { code: "BB_SALE_MASMIS", label: "Sale Data", description: "Upload Bellavita sale data", icon: ShoppingBag },
  { code: "BB_APR_MASMIS",  label: "APR Data",  description: "Upload Bellavita APR data",  icon: Activity },
  { code: "BB_CHAT_MASMIS", label: "Chat Data", description: "Upload Bellavita chat data", icon: MessageSquare },
  { code: "BB_CART_MASMIS", label: "Cart Data", description: "Upload Bellavita cart data", icon: ShoppingCart },
];

/** GNC's 3 live db_masmis uploaders (gnc_sale, gnc_apr, gnc_allocation). */
const GNC_UPLOADERS = [
  { code: "GNC_SALE_MASMIS",       label: "Sale Data",       description: "Upload GNC sale data",       icon: ShoppingBag },
  { code: "GNC_APR",               label: "APR Data",        description: "Upload GNC APR data",        icon: Activity },
  { code: "GNC_ALLOCATION_MASMIS", label: "Allocation Data", description: "Upload GNC allocation data", icon: ShoppingCart },
  { code: "GNC_CHAT_MASMIS",       label: "Chat Data",       description: "Upload GNC chat/CS ticket data", icon: MessageSquare },
];

/** Neemans' 5 live db_masmis uploaders. Cart (neemans_cart, 0 rows, never
 * used) is deliberately left out here per explicit scope, same as
 * Bellavita's own left-out extras above; still reachable from the main
 * Bulk Upload Hub. */
const NEEMANS_UPLOADERS = [
  { code: "NEEMANS_SALE_RAW_MASMIS",       label: "Sale Raw",       description: "Upload Neemans sale raw data",     icon: ShoppingBag },
  { code: "NEEMANS_ALLOCATION_MASMIS",     label: "Allocation",     description: "Upload Neemans allocation data",   icon: ShoppingCart },
  { code: "NEEMANS_APR_MASMIS",            label: "APR",            description: "Upload Neemans APR data",          icon: Activity },
  { code: "NEEMANS_MONTH_TARGET_MASMIS",   label: "Target",         description: "Upload Neemans monthly target",    icon: Target },
  { code: "NEEMANS_AGENT_DETAILS_MASMIS",  label: "Agent Details",  description: "Upload Neemans agent roster",      icon: Users },
  { code: "NEEMANS_CHAT_MASMIS",           label: "Chat Data",      description: "Upload Neemans chat/DM ticket data", icon: MessageSquare },
];

/** Appreciate Wealth's 5 live db_masmis uploaders (internal key/table names stay
 * "appreciate_health"/"aw_*" -- only the user-facing label changed). No real Excel export has
 * been seen for any of them yet (unlike GNC/Neemans, no sample file or
 * screenshot) -- header matching is normalized on both this component's own
 * pre-check and each aw-*-bulk.service.ts backend importer, so real-world
 * spelling/case/spacing differences shouldn't block an upload the way they
 * did for GNC/Neemans before those were fixed. See aw-mandate-bulk.service.ts. */
const APPRECIATE_HEALTH_UPLOADERS = [
  { code: "AW_BILLING_MASMIS", label: "Billing",  description: "Upload Appreciate Wealth billing data",  icon: Receipt },
  { code: "AW_INBOUND_MASMIS", label: "Inbound",   description: "Upload Appreciate Wealth inbound CDR",   icon: PhoneIncoming },
  { code: "AW_MANDATE_MASMIS", label: "Mandate",   description: "Upload Appreciate Wealth billing mandate", icon: ClipboardList },
  { code: "AW_NEW_CDR_MASMIS", label: "New CDR",   description: "Upload Appreciate Wealth new CDR data",   icon: Activity },
  { code: "AW_OUT_MASMIS",     label: "Outbound",  description: "Upload Appreciate Wealth outbound data",  icon: PhoneOutgoing },
  { code: "AW_CHAT_MASMIS",    label: "Chat",      description: "Upload Appreciate Wealth chat data",      icon: MessageSquare },
];

/** Housing Owner's 3 uploaders, writing into brand-new db_masmis tables
 * (owner_sale/Owner_cdr/owner_agent_details, sql/1766) -- deliberately
 * separate from the existing, more sophisticated Housing Dashboards
 * feature and existing CR_housing_owner CDR table, per explicit user
 * confirmation. NOTE: the target tables could not be created by this app's
 * DB user (no CREATE privilege on db_masmis) -- uploads will fail until
 * someone with sufficient privilege runs sql/1766. */
const HOUSING_OWNER_UPLOADERS = [
  { code: "OWNER_SALE_MASMIS",          label: "Owner Sale",          description: "Upload Housing Owner sale data",   icon: ShoppingBag },
  { code: "OWNER_CDR_MASMIS",           label: "Owner CDR",           description: "Upload Housing Owner CDR data",     icon: PhoneIncoming },
  { code: "OWNER_AGENT_DETAILS_MASMIS", label: "Owner Agent Details", description: "Upload Housing Owner agent roster", icon: Users },
];

/** Housing Premium's 3 uploaders, writing into db_masmis.pre_sale/Pre_cdr/
 * pre_agent_details. These tables exist and hold real data (confirmed live
 * 2026-09-20: pre_sale 1,072 rows, pre_agent_details 40 rows, Pre_cdr 4 rows
 * -- the full CDR file has not been uploaded yet) -- the "not yet created"
 * caveat that used to apply here no longer does. */
const HOUSING_PREMIUM_UPLOADERS = [
  { code: "PRE_SALE_MASMIS",          label: "Premium Sale",          description: "Upload Housing Premium sale data",   icon: ShoppingBag },
  { code: "PRE_CDR_MASMIS",           label: "Premium CDR",           description: "Upload Housing Premium CDR data",     icon: PhoneIncoming },
  { code: "PRE_AGENT_DETAILS_MASMIS", label: "Premium Agent Details", description: "Upload Housing Premium agent roster", icon: Users },
];

/** Clovia's 9 uploaders, writing into brand-new db_masmis tables (sql/1768).
 * 6 of these 9 (Chat/Disposition/Email Raw/Feedback/Quality/Rechurn Call)
 * already have a different, working Clovia upload feature in this codebase
 * (mas_hrms-backed) -- kept deliberately separate per explicit user
 * confirmation, same as Housing Owner/Premium. APR/Inbound CDR/Outbound
 * have no existing Clovia equivalent. Tables not yet created (user is
 * running sql/1768 themselves) -- same status as Housing Owner/Premium
 * before their tables existed. */
const CLOVIA_UPLOADERS = [
  { code: "CL_APR_MASMIS",           label: "APR",           description: "Upload Clovia APR data",             icon: Activity },
  { code: "CL_CHAT_MASMIS",          label: "Chat",          description: "Upload Clovia chat data",            icon: MessageSquare },
  { code: "CL_DISPO_MASMIS",         label: "Disposition",   description: "Upload Clovia CRM disposition data", icon: ClipboardList },
  { code: "CL_EMAIL_RAW_MASMIS",     label: "Email Raw",     description: "Upload Clovia email raw data",       icon: Mail },
  { code: "CL_FEEDBACK_MASMIS",      label: "Feedback",      description: "Upload Clovia feedback data",        icon: Star },
  { code: "CL_IB_CDR_MASMIS",        label: "Inbound CDR",   description: "Upload Clovia inbound CDR data",     icon: PhoneIncoming },
  { code: "CL_OUTBOUND_MASMIS",      label: "Outbound",      description: "Upload Clovia outbound call data",   icon: PhoneOutgoing },
  { code: "CL_QUALITY_MASMIS",       label: "Quality",       description: "Upload Clovia quality audit data",   icon: ShieldCheck },
  { code: "CL_RECHURN_CALL_MASMIS",  label: "Rechurn Call",  description: "Upload Clovia rechurn call data",    icon: Repeat },
];

/** Birlanu's 2 uploaders, writing into brand-new db_masmis tables
 * (birlanu_sale/birlanu_apr, sql/1770). Same status as Clovia before its
 * tables existed -- CREATE TABLE SQL is ready, user runs it themselves. */
const BIRLANU_UPLOADERS = [
  { code: "BIRLANU_SALE_MASMIS", label: "Sale",  description: "Upload Birlanu sale/lead data", icon: ShoppingCart },
  { code: "BIRLANU_APR_MASMIS",  label: "APR",   description: "Upload Birlanu agent APR data", icon: Activity },
];

/** Satya Retail's 2 uploaders, writing into brand-new db_masmis tables
 * (satya_allocation/satya_cdr, sql/1770). Same status as above. */
const ALT_RX_UPLOADERS = [
  { code: "ALT_RX_DUMP_MASMIS", label: "Dump", description: "Upload the ALT RX ticket Dump. Each upload replaces the previous Dump.", icon: Upload },
];

const SATYA_RETAIL_UPLOADERS = [
  { code: "SATYA_ALLOCATION_MASMIS", label: "Allocation", description: "Upload Satya Retail beat/shop allocation data", icon: Target },
  { code: "SATYA_CDR_MASMIS",        label: "CDR",         description: "Upload Satya Retail call detail records",      icon: PhoneOutgoing },
];

/** LP Feedback's 2 uploaders, writing into brand-new db_masmis tables
 * (lp_feedback_apr/lp_feedback_cdr, sql/1772). Same status as Clovia
 * before its tables existed -- CREATE TABLE SQL is ready, user runs it
 * themselves. */
const LP_FEEDBACK_UPLOADERS = [
  { code: "LP_FEEDBACK_APR_MASMIS", label: "APR", description: "Upload LP Feedback agent APR data",       icon: Activity },
  { code: "LP_FEEDBACK_CDR_MASMIS", label: "CDR", description: "Upload LP Feedback call detail records",  icon: PhoneOutgoing },
];

/** LP Onboarding's 2 uploaders, writing into brand-new db_masmis tables
 * (lp_onboarding_apr/lp_onboarding_cdr, sql/1772). Same status as above. */
const LP_ONBOARDING_UPLOADERS = [
  { code: "LP_ONBOARDING_APR_MASMIS", label: "APR", description: "Upload LP Onboarding agent APR data",      icon: Activity },
  { code: "LP_ONBOARDING_CDR_MASMIS", label: "CDR", description: "Upload LP Onboarding call detail records", icon: PhoneOutgoing },
];

/** DU Digital's 2 uploaders per country (CDR/APR), writing into mas_hrms
 * tables du_cdr_daily_actual (sql/1966) and du_apr_daily_actual (sql/1710).
 * Auto-downloaded daily by uploader/du_digital (Task Scheduler), but
 * also manually uploadable here like every other company's uploaders --
 * the same DU_CDR_/DU_APR_ upload_type_codes either path writes through. */
const DU_THAILAND_UPLOADERS = [
  { code: "DU_CDR_THAILAND", label: "CDR", description: "Upload DU Digital Thailand call detail records", icon: PhoneOutgoing },
  { code: "DU_APR_THAILAND", label: "APR", description: "Upload DU Digital Thailand agent APR data",      icon: Activity },
];
const DU_KOREA_UPLOADERS = [
  { code: "DU_CDR_KOREA", label: "CDR", description: "Upload DU Digital Korea call detail records", icon: PhoneOutgoing },
  { code: "DU_APR_KOREA", label: "APR", description: "Upload DU Digital Korea agent APR data",      icon: Activity },
];

/** Every company that has a real uploader array, keyed for UploaderHub/
 * UploaderWorkspace — Dalmia/DU Bangladesh/Viega/Exicom are deliberately
 * absent (Inbound-dashboard-only so far) and fall through to the stub. */
/** Dalmia Cement's 4 uploaders. Labels are the names the business asked for; the codes are the existing/new
 * upload_template_master rows (DALMIA_DD_RAW = the dial-desk "DD Raw" sheet, sql/1731; DALMIA_OUTBOUND_RAW, sql/1732;
 * DALMIA_AFTER_HOUR, sql/1734; DALMIA_APR, sql/1894 -- that migration must be applied before the APR tab can import). */
const DALMIA_UPLOADERS = [
  { code: "DALMIA_DD_RAW",       label: "dalmia_daildesk", description: "Upload Dalmia dial-desk call log (DD Raw)",   icon: ClipboardList },
  { code: "DALMIA_OUTBOUND_RAW", label: "Outbound",        description: "Upload Dalmia outbound enquiry follow-up",    icon: PhoneOutgoing },
  { code: "DALMIA_APR",          label: "dalmia_apr",      description: "Upload Dalmia agent productivity (APR)",      icon: Activity },
  { code: "DALMIA_AFTER_HOUR",   label: "after_hour",      description: "Upload Dalmia after-hour call log",           icon: PhoneIncoming },
];

/** SBI Card Collections' 8 uploaders (upload_template_master codes; RPCs import_sbi_card_*_batch). */
const SBI_CARD_UPLOADERS = [
  { code: "SBI_CARD_DIALER_MIS",     label: "Dialer MIS",       description: "Upload SBI Card dialer MIS (one campaign sheet per upload)", icon: PhoneOutgoing },
  { code: "SBI_CARD_AGENT_MIS",      label: "Agent MIS",        description: "Upload SBI Card agent MIS",                                  icon: Users },
  { code: "SBI_CARD_ACCOUNT_FILE",   label: "Account File",     description: "Upload SBI Card account allocation file",                    icon: ClipboardList },
  { code: "SBI_CARD_DOWNTIME",       label: "Downtime Tracker", description: "Upload SBI Card dialer downtime tracker",                    icon: Activity },
  { code: "SBI_CARD_APR",            label: "Agent Time (APR)", description: "Upload the dialer Agent Time Detail export (AGENT_TIME*.csv)", icon: Users },
  { code: "SBI_CARD_ROSTER",         label: "Agent roster", description: "Upload the TEAM_LIST: dialer id, team (HIGHBAL / LOWBAL) and team leader", icon: Users },
  { code: "SBI_CARD_OUTCOME",        label: "Outcome (Res / NM / RB)", description: "Upload cycle-to-date Resolution, Normalisation and Rollback for the payout", icon: Target },
  { code: "SBI_CARD_PEN_ESTIMATION", label: "Pen Estimation",   description: "Upload SBI Card penetration estimation",                     icon: Target },
];

const UPLOADERS_BY_COMPANY: Partial<Record<CompanyKey, UploaderHubItem[]>> = {
  bellavita: BELLAVITA_UPLOADERS,
  gnc: GNC_UPLOADERS,
  neemans: NEEMANS_UPLOADERS,
  appreciate_health: APPRECIATE_HEALTH_UPLOADERS,
  housing_owner: HOUSING_OWNER_UPLOADERS,
  housing_premium: HOUSING_PREMIUM_UPLOADERS,
  clovia: CLOVIA_UPLOADERS,
  dalmia: DALMIA_UPLOADERS,
  sbi_card: SBI_CARD_UPLOADERS,
  birlanu: BIRLANU_UPLOADERS,
  satya_retail: SATYA_RETAIL_UPLOADERS,
  alt_rx: ALT_RX_UPLOADERS,
  lp_feedback: LP_FEEDBACK_UPLOADERS,
  lp_onboarding: LP_ONBOARDING_UPLOADERS,
  du_thailand: DU_THAILAND_UPLOADERS,
  du_korea: DU_KOREA_UPLOADERS,
};

function BoxGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function Box({
  icon: Icon, label, description, onClick, tone = "slate",
}: { icon: React.ComponentType<{ className?: string }>; label: string; description: string; onClick: () => void; tone?: Tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex items-center justify-between overflow-hidden rounded-2xl border border-slate-100 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-transparent hover:shadow-lg`}
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${TONE_GRADIENT_CLASSES[tone]} opacity-0 transition-opacity duration-200 group-hover:opacity-60`} />
      <div className="relative z-10 flex items-center gap-3.5">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-sm transition-transform duration-200 group-hover:scale-105 ${TONE_CLASSES[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <div className="text-sm font-bold text-slate-900">{label}</div>
          <div className="text-xs text-slate-500">{description}</div>
        </div>
      </div>
      <ChevronRight className="relative z-10 h-4 w-4 shrink-0 text-slate-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-slate-500" />
    </button>
  );
}

function StatCard({
  icon: Icon, label, value, tone, loading,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; tone: Tone; loading?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${TONE_CLASSES[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-lg font-bold text-slate-900">{loading ? "—" : value.toLocaleString()}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </div>
  );
}

function Breadcrumb({ parts, onBack }: { parts: string[]; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
      <button type="button" onClick={onBack} className="flex items-center gap-1 hover:text-slate-900">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span>{parts.join(" / ")}</span>
    </div>
  );
}

/**
 * "MIS" tab — one combined, client-ready Excel per process: every dashboard
 * that company has (Sale/Chat/Cart/Inbound/...), each as its own styled
 * summary sheet plus its full raw data, built server-side by
 * GET /api/process-performance/mis/:company/excel (mis-export.routes.ts ->
 * mis-export.service.ts, which reuses each dashboard's own already-verified
 * service function and the same styled-sheet writer the single-dashboard
 * "Export" button uses). No chart/number is computed here -- this is a
 * download trigger over data every dashboard in this app already shows.
 */
function MisPanel({ companyKey, companyLabel }: { companyKey: CompanyKey; companyLabel: string }) {
  const [from, setFrom] = useState(firstOfMonthStr());
  const [to, setTo] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const download = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const url = `${apiUrl(`/api/process-performance/mis/${companyKey}/excel`)}?from=${from}&to=${to}&label=${encodeURIComponent(companyLabel)}`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${getAuthToken()}` } });
      if (!response.ok) {
        let message = `MIS export failed (${response.status}).`;
        try {
          const body = await response.json();
          if (body?.error || body?.message) message = String(body.error ?? body.message);
        } catch { /* body was not JSON */ }
        throw new Error(message);
      }
      const failed = Number(response.headers.get("X-Export-Failed-Sheets") ?? 0);
      const truncated = Number(response.headers.get("X-Export-Truncated-Sheets") ?? 0);
      const skippedSections = Number(response.headers.get("X-Export-Skipped-Sections") ?? 0);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${companyKey}_MIS_${to}.xlsx`;
      link.click();
      URL.revokeObjectURL(blobUrl);
      if (failed > 0 || truncated > 0 || skippedSections > 0) {
        setNotice(
          `Downloaded. ${skippedSections > 0 ? `${skippedSections} section(s) could not be built and were left out. ` : ""}` +
          `${failed > 0 ? `${failed} raw-data sheet(s) could not be included. ` : ""}` +
          `${truncated > 0 ? `${truncated} raw-data sheet(s) were cut short. ` : ""}` +
          `See "Sections Not Included" / "Raw Data Notes" in the file for details.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "MIS export failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <FileText className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-bold text-slate-900">MIS Report — {companyLabel}</div>
            <p className="mt-0.5 text-xs text-slate-500">
              One Excel workbook with every {companyLabel} dashboard's KPIs and charts as styled summary
              sheets, followed by the full raw data behind each — ready to send to the client.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm"
          />
          <span className="text-sm text-slate-400">—</span>
          <input
            type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm"
          />
          <button
            type="button"
            onClick={() => { setFrom(firstOfMonthStr()); setTo(todayStr()); }}
            className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200"
          >
            <RotateCcw className="h-3.5 w-3.5" /> This Month
          </button>
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 shadow-sm hover:bg-amber-50"
          >
            <CalendarClock className="h-3.5 w-3.5" /> Schedule email
          </button>
          <button
            type="button"
            onClick={() => void download()}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-wait disabled:opacity-70"
          >
            <Download className="h-3.5 w-3.5" /> {busy ? "Preparing MIS…" : "Download MIS Report"}
          </button>
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-4 py-1.5 text-sm font-semibold text-amber-700 shadow-sm hover:bg-amber-50"
          >
            <CalendarClock className="h-3.5 w-3.5" /> Schedule email…
          </button>
        </div>

        {error && <div className="mt-3 rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
        {notice && <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">{notice}</div>}
      </div>
      {/* Emails this same MIS workbook on a schedule (mis-schedule.service.ts, key "mis:<company>"). */}
      <MisEmailScheduleDrawer
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        dashboardKey={`mis:${companyKey}`}
        reportTitle={companyLabel}
      />
    </div>
  );
}

export default function ProcessPerformanceV2Page() {
  // Deep link from the KPI Live Performance page: /performance/process-performance-v2?company=<key>
  const [company, setCompany] = useState<CompanyKey | null>(() => {
    const k = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("company");
    return COMPANIES.some((c) => c.key === k) ? (k as CompanyKey) : null;
  });
  const [section, setSection] = useState<SectionKey | null>(null);
  // Config-driven processes (admin-registered APR table + mapping): no per-client code, one generic "category_template" dashboard.
  const [pdCompany, setPdCompany] = useState<ProcessConfigSummary | null>(null);
  const { data: pdConfigs } = useQuery({ queryKey: ["process-dashboard", "configs"], queryFn: fetchProcessDashboardConfigs, staleTime: 60_000, retry: false });
  const [selectedUploader, setSelectedUploader] = useState<{ code: string; label: string } | null>(null);
  const [selectedDashboard, setSelectedDashboard] = useState<{ key: string; label: string; kind: DashboardKind } | null>(null);
  const [stats, setStats] = useState({ totalFilesUploaded: 0, activeUsers: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  // Admin-assigned access (Settings -> TPZ Access). A role-based user who has not been narrowed sees the page exactly as before;
  // anyone else -- a granted user, or a role-based user an admin restricted -- sees only their processes and sections.
  const { data: tpz } = useTpzAccess();
  const limited = tpz !== undefined && !tpz.roleBased;
  const grantFor = (key: CompanyKey) => tpz?.companies.find((c) => c.key === key);
  const visibleCompanies = limited ? COMPANIES.filter((c) => grantFor(c.key)) : COMPANIES;
  const sectionAllowed = (key: CompanyKey, sec: SectionKey): boolean => {
    if (!limited) return true;
    const g = grantFor(key);
    return sec === "dashboards" ? Boolean(g?.dashboards) : sec === "uploader" ? Boolean(g?.upload) : Boolean(g?.mis);
  };
  const showUploadStats = !limited || Boolean(tpz?.companies.some((c) => c.upload));

  useEffect(() => {
    if (limited && !showUploadStats) { setStatsLoading(false); return; }
    let cancelled = false;
    hrmsApi
      .get<{ success: boolean; data: { totalFilesUploaded: number; activeUsers: number } }>(
        "/api/bulk-upload/process-performance-v2-stats",
      )
      .then((res) => { if (!cancelled) setStats(res.data); })
      .catch(() => { /* leave zeros — the stat cards show 0 rather than block the page */ })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, [limited, showUploadStats]);

  const companyLabel = COMPANIES.find((c) => c.key === company)?.label ?? "";
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hardCoded = new Set(COMPANIES.flatMap((c) => [norm(c.key), norm(c.label)]));
  const pdProcesses = (pdConfigs ?? []).filter((c) => c.enabled && c.configured && !hardCoded.has(norm(c.processName)) && !hardCoded.has(norm(c.label)) && !hardCoded.has(norm(c.processCode)));
  const openPd = (c: ProcessConfigSummary) => { setPdCompany(c); setSection("dashboards"); setSelectedDashboard({ key: c.processId, label: c.label || c.processName, kind: "category_template" }); };
  // Companies with exactly one dashboard tile (Housing Owner, Housing Premium, Clovia, ...)
  // skip the pointless one-tile grid: "Dashboards" opens the dashboard directly.
  // Process Details (targets / add agent) is by explicit per-user grant only (page codes below, assigned in Access Control); everyone else
  // does not see the card. The API enforces the same grant.
  const workforce = useWorkforceAccess();
  const PROCESS_DETAILS_CODE: Record<string, string> = { housing_owner_targets: "PP_HOUSING_OWNER_PROCESS_DETAILS", housing_premium_targets: "PP_HOUSING_PREMIUM_PROCESS_DETAILS" };
  const dashboardAllowed = (kind: string): boolean => { const code = PROCESS_DETAILS_CODE[kind]; return !code || (workforce.isResolved && workforce.canViewPage(code)); };
  const dashboardsForCompany = company ? DASHBOARDS_BY_COMPANY[company]?.filter((d) => dashboardAllowed(d.kind)) : undefined;
  const singleDashboard = dashboardsForCompany && dashboardsForCompany.length === 1 ? dashboardsForCompany[0] : null;

  const reset = () => { setPdCompany(null); setCompany(null); setSection(null); setSelectedUploader(null); setSelectedDashboard(null); };
  const backToCompany = () => { setSection(null); setSelectedUploader(null); setSelectedDashboard(null); };
  const backToUploaderGrid = () => setSelectedUploader(null);
  const backToDashboardGrid = () => (singleDashboard ? backToCompany() : setSelectedDashboard(null));

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-4">
        {/* Level 1: company picker */}
        {!company && !pdCompany && (
          <div className="space-y-6">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-50 via-violet-50 to-fuchsia-50 p-6 sm:p-8">
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-500">Welcome</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">TPZ Process</h1>
              <p className="mt-1 max-w-xl text-sm text-slate-600">
                Select a process to manage data, upload files and view performance dashboards.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard icon={LayoutGrid} label={limited ? "Your Processes" : "Total Processes"} value={visibleCompanies.length + (limited ? 0 : pdProcesses.length)} tone="emerald" />
              {showUploadStats && <StatCard icon={UploadCloud} label="Total Files Uploaded" value={stats.totalFilesUploaded} tone="indigo" loading={statsLoading} />}
              {showUploadStats && <StatCard icon={Users} label="Active Users" value={stats.activeUsers} tone="fuchsia" loading={statsLoading} />}
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">All Processes</h2>
                {!limited && (
                  <Link to="/bulk-upload" className="text-xs font-semibold text-indigo-600 hover:underline">
                    View All
                  </Link>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {visibleCompanies.length === 0 && (
                  <p className="col-span-full rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
                    No processes are assigned to you yet.
                  </p>
                )}
                {visibleCompanies.map((c) => {
                  const meta = COMPANY_META[c.key];
                  return (
                    <Box
                      key={c.key}
                      icon={meta.icon}
                      tone={meta.tone}
                      label={c.label}
                      description="Open process"
                      onClick={() => setCompany(c.key)}
                    />
                  );
                })}
                {!limited && pdProcesses.map((c) => (
                  <Box key={c.processId} icon={LayoutDashboard} tone="indigo" label={c.label || c.processName} description={`Auto dashboard · ${c.category.replace("_", " ")}`} onClick={() => openPd(c)} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Level 2: section picker (Dashboards / Uploader) */}
        {company && !section && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel]} onBack={reset} />
            <BoxGrid>
              {SECTIONS.filter((s) => sectionAllowed(company, s.key)).map((s) => (
                <Box
                  key={s.key}
                  icon={s.key === "dashboards" ? LayoutDashboard : s.key === "uploader" ? Upload : FileText}
                  label={s.label}
                  description={s.description}
                  tone={s.key === "dashboards" ? "indigo" : s.key === "uploader" ? "emerald" : "amber"}
                  onClick={() => {
                    setSection(s.key);
                    if (s.key === "dashboards" && singleDashboard) {
                      setSelectedDashboard({ key: singleDashboard.key, label: singleDashboard.label, kind: singleDashboard.kind });
                    }
                  }}
                />
              ))}
            </BoxGrid>
          </div>
        )}

        {/* Level 3: Dashboards — blank for now (single stub for every company without named sub-dashboards) */}
        {company === "puresta" && section === "dashboards" && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Dashboards"]} onBack={backToCompany} />
            <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-16 text-sm text-slate-400">
              Nothing here yet
            </div>
          </div>
        )}

        {/* Level 3: Dashboards — companies with named dashboard cards (Bellavita/GNC/
            Clovia/Neemans' Inbound, plus Neemans' pre-existing Sale/Allocation stubs) */}
        {company && DASHBOARDS_BY_COMPANY[company] && section === "dashboards" && !selectedDashboard && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Dashboards"]} onBack={backToCompany} />
            <BoxGrid>
              {(dashboardsForCompany ?? []).map((d) => (
                <Box
                  key={d.key}
                  icon={d.kind === "inbound" ? PhoneIncoming : d.kind === "bellavita_sale" || d.kind === "gnc_sale" || d.kind === "housing_owner_sale" || d.kind === "housing_premium_sale" || d.kind === "neemans_performance" ? TrendingUp : d.kind === "neemans_cart" || d.kind === "bellavita_cart" ? ShoppingCart : d.kind === "clovia_dashboard" ? LayoutGrid : d.kind === "lp_feedback" || d.kind === "lp_onboarding" || d.kind === "satya_retail_dashboard" || d.kind === "satya_retail_report" ? PhoneCall : d.kind === "bellavita_chat" || d.kind === "neemans_chat" || d.kind === "gnc_chat" ? MessageSquare : LayoutDashboard}
                  label={d.label}
                  description={d.description}
                  tone={company ? COMPANY_META[company].tone : "slate"}
                  onClick={() => setSelectedDashboard({ key: d.key, label: d.label, kind: d.kind })}
                />
              ))}
            </BoxGrid>
          </div>
        )}

        {((company && DASHBOARDS_BY_COMPANY[company]) || pdCompany) && section === "dashboards" && selectedDashboard && (
          <div className="space-y-4">
            <Breadcrumb parts={pdCompany ? [pdCompany.label || pdCompany.processName, "Dashboard"] : [companyLabel, "Dashboards", selectedDashboard.label]} onBack={pdCompany ? reset : backToDashboardGrid} />
            <V2DashboardView company={company ?? ""} dashboard={selectedDashboard} onOpenDashboard={(key) => { const t = company ? DASHBOARDS_BY_COMPANY[company]?.find((d) => d.key === key) : undefined; if (t) setSelectedDashboard({ key: t.key, label: t.label, kind: t.kind }); }} />
          </div>
        )}

        {/* Level 3: Uploader — pick a data type, then upload right here */}
        {/* Level 3: Uploader hub + workspace — every company with a real uploader
            array (all except Dalmia/DU Bangladesh/Viega/Exicom, Inbound-only so
            far) shares this one design instead of a duplicated block each. */}

        {company && UPLOADERS_BY_COMPANY[company] && section === "uploader" && !selectedUploader && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Data Uploader"]} onBack={backToCompany} />
            <UploaderHub
              companyLabel={companyLabel}
              companyIcon={COMPANY_META[company].icon}
              tone={COMPANY_META[company].tone}
              uploaders={UPLOADERS_BY_COMPANY[company]!}
              typeCodes={UPLOADERS_BY_COMPANY[company]!.map((u) => u.code)}
              onSelect={(item) => setSelectedUploader(item)}
            />
          </div>
        )}

        {company && UPLOADERS_BY_COMPANY[company] && section === "uploader" && selectedUploader && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Data Uploader", selectedUploader.label]} onBack={backToUploaderGrid} />
            <UploaderWorkspace
              companyLabel={companyLabel}
              uploaders={UPLOADERS_BY_COMPANY[company]!}
              initialCode={selectedUploader.code}
              tone={COMPANY_META[company].tone}
            />
          </div>
        )}

        {/* Dalmia/DU Bangladesh/Viega/Exicom only have an Inbound dashboard so far
            (no uploader requested), and Puresta was added as a placeholder with
            both tabs deliberately blank — stub, same "nothing here yet" state the
            Dashboards section uses elsewhere, so Uploader is never a dead end. */}
        {(company === "dubangladesh" || company === "viega" || company === "exicom" || company === "puresta") && section === "uploader" && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Data Uploader"]} onBack={backToCompany} />
            <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-16 text-sm text-slate-400">
              Nothing here yet
            </div>
          </div>
        )}

        {/* Level 3: MIS — every company (the "puresta" placeholder has no
            dashboards to bundle, so the server 404s with a plain message
            the panel shows inline rather than a dead grid here). */}
        {company === "alt_rx" && section === "mis" && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "MIS"]} onBack={backToCompany} />
            <AltRxMisPanel />
          </div>
        )}

        {company && company !== "alt_rx" && section === "mis" && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "MIS"]} onBack={backToCompany} />
            <MisPanel companyKey={company} companyLabel={companyLabel} />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
