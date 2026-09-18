import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ProjectDetailView } from "@/pages/NativeInboundDashboard";
import { BellavitaSaleDashboard } from "@/components/process-performance/BellavitaSaleDashboard";
import { GncSaleDashboard } from "@/components/process-performance/GncSaleDashboard";
import { GncInboundDashboard } from "@/components/process-performance/GncInboundDashboard";
import { NeemansCartDashboard } from "@/components/process-performance/NeemansCartDashboard";
import { NeemansPerformanceDashboard } from "@/components/process-performance/NeemansPerformanceDashboard";
import { NeemansChatDashboard } from "@/components/process-performance/NeemansChatDashboard";
import { BellavitaChatDashboard } from "@/components/process-performance/BellavitaChatDashboard";
import { BellavitaCartDashboard } from "@/components/process-performance/BellavitaCartDashboard";
import { HousingOwnerDashboard } from "@/components/process-performance/HousingOwnerDashboard";
import { HousingPremiumSaleDashboard } from "@/components/process-performance/HousingPremiumSaleDashboard";
import { LpFeedbackDashboard } from "@/components/process-performance/LpFeedbackDashboard";
import { LpOnboardingDashboard } from "@/components/process-performance/LpOnboardingDashboard";
import { SatyaRetailDashboard } from "@/components/process-performance/SatyaRetailDashboard";
import { CloviaDashboard } from "@/components/process-performance/CloviaDashboard";
import { BirlanuDashboard } from "@/components/process-performance/BirlanuDashboard";
import { hrmsApi } from "@/lib/hrmsApi";
import { TONE_CLASSES, TONE_GRADIENT_CLASSES, type Tone } from "@/lib/processPerformanceTones";
import { UploaderHub, type UploaderHubItem } from "@/components/process-performance/UploaderHub";
import { UploaderWorkspace } from "@/components/process-performance/UploaderWorkspace";
import {
  Activity, ChevronLeft, ChevronRight, LayoutDashboard, Upload,
  ShoppingBag, MessageSquare, ShoppingCart, Target, Users,
  Receipt, PhoneIncoming, PhoneOutgoing, PhoneCall, ClipboardList,
  Mail, Star, ShieldCheck, Repeat, RotateCcw, TrendingUp,
  Heart, Footprints, HeartPulse, Home, Crown, Shirt, FileText, Tag,
  Building2, Globe, Settings, Zap, LayoutGrid, UploadCloud,
} from "lucide-react";

/**
 * dalmia/dubangladesh/viega/exicom are spelled exactly as the backend's
 * inbound.service.ts PROJECTS[].key (dubangladesh has no underscore) --
 * company is passed straight through as projectKey with no separate
 * mapping table, same as bellavita/gnc/clovia/neemans already are.
 */
type CompanyKey = "bellavita" | "gnc" | "neemans" | "appreciate_health" | "housing_owner" | "housing_premium" | "clovia" | "birlanu" | "satya_retail" | "lp_feedback" | "lp_onboarding" | "dalmia" | "dubangladesh" | "viega" | "exicom";
type SectionKey = "dashboards" | "uploader";

const COMPANIES: Array<{ key: CompanyKey; label: string }> = [
  { key: "bellavita", label: "Bellavita" },
  { key: "gnc", label: "GNC" },
  { key: "neemans", label: "Neemans" },
  { key: "appreciate_health", label: "Appreciate Wealth" },
  { key: "housing_owner", label: "Housing Owner" },
  { key: "housing_premium", label: "Housing Premium" },
  { key: "clovia", label: "Clovia" },
  { key: "birlanu", label: "Birlanu" },
  { key: "satya_retail", label: "Satya Retail" },
  { key: "lp_feedback", label: "LP Feedback" },
  { key: "lp_onboarding", label: "LP Onboarding" },
  { key: "dalmia", label: "Dalmia" },
  { key: "dubangladesh", label: "DU Bangladesh" },
  { key: "viega", label: "Viega" },
  { key: "exicom", label: "Exicom" },
];

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
  lp_feedback: { icon: MessageSquare, tone: "blue" },
  lp_onboarding: { icon: Users, tone: "pink" },
  dalmia: { icon: Building2, tone: "green" },
  dubangladesh: { icon: Globe, tone: "cyan" },
  viega: { icon: Settings, tone: "purple" },
  exicom: { icon: Zap, tone: "fuchsia" },
};

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
const DASHBOARDS_BY_COMPANY: Partial<Record<CompanyKey, Array<{ key: string; label: string; description: string; kind: "inbound" | "stub" | "bellavita_sale" | "gnc_sale" | "neemans_cart" | "neemans_chat" | "housing_owner_sale" | "housing_premium_sale" | "lp_feedback" | "lp_onboarding" | "satya_retail_dashboard" | "clovia_dashboard" | "birlanu_dashboard" | "neemans_performance" | "bellavita_chat" | "bellavita_cart" }>>> = {
  bellavita: [
    { key: "sale_performance", label: "Sale Performance", description: "Turn over, RTO%, prepaid%, top performers — live from uploaded sale data", kind: "bellavita_sale" },
    { key: "chat_performance", label: "Chat Performance", description: "Tickets, resolved%, repeat%, TL & agent-wise — live from uploaded chat data", kind: "bellavita_chat" },
    { key: "cart_performance", label: "Abandon Cart", description: "Cart value, connect%, discount codes, agent-wise + Repeat Allocation — live from uploaded cart data", kind: "bellavita_cart" },
    { key: "inbound", label: "Inbound", description: "Live call performance — AL%, SL%, ACHT, Repeat%", kind: "inbound" },
  ],
  housing_owner: [
    { key: "sale_performance", label: "Sale Performance", description: "Revenue vs target, AM/TL/agent-wise, call connect% — live from uploaded owner sale/CDR/roster data", kind: "housing_owner_sale" },
  ],
  housing_premium: [
    { key: "sale_performance", label: "Sale Performance", description: "Revenue vs target, TL/agent-wise, call connect% — live from uploaded Premium sale/CDR/roster data", kind: "housing_premium_sale" },
  ],
  lp_feedback: [
    { key: "call_performance", label: "Feedback Call Performance", description: "Login/calls/connectivity, lead-source, week-wise & agent-wise — live from uploaded APR/CDR data", kind: "lp_feedback" },
  ],
  lp_onboarding: [
    { key: "call_performance", label: "Onboarding Call Performance", description: "Login/calls/connectivity, lead-source, week-wise & agent-wise — live from uploaded APR/CDR data", kind: "lp_onboarding" },
  ],
  satya_retail: [
    { key: "beat_performance", label: "Beat & Call Performance", description: "Allocation/connect%, warehouse-wise & agent-wise — live from uploaded allocation/CDR data", kind: "satya_retail_dashboard" },
  ],
  gnc: [
    { key: "sale_performance", label: "Sale Performance", description: "Turn over, prepaid%, allocation, top performers — live from uploaded sale data", kind: "gnc_sale" },
    { key: "inbound", label: "Inbound", description: "Live call performance — Overview, agent-wise & date-wise breakdowns", kind: "inbound" },
  ],
  clovia: [
    { key: "dashboard", label: "Dashboard", description: "Inbound (live calls), Email/Chat/Feedback/Quality/Headcount and slot-wise/hourly views — beautiful multi-slide dashboard", kind: "clovia_dashboard" },
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
    { key: "inbound", label: "Inbound", description: "Live call performance — AL%, SL%, ACHT, Repeat%", kind: "inbound" },
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
};

const SECTIONS: Array<{ key: SectionKey; label: string; description: string }> = [
  { key: "dashboards", label: "Dashboards", description: "Live KPI dashboards, built from uploaded data" },
  { key: "uploader", label: "Uploader", description: "Bulk data uploaders" },
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

/** Housing Premium's 3 uploaders, writing into brand-new db_masmis tables
 * (pre_sale/Pre_cdr/pre_agent_details, sql/1766) -- same caveat as Housing
 * Owner above: tables not yet created, blocked on DB CREATE privilege. */
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

/** Every company that has a real uploader array, keyed for UploaderHub/
 * UploaderWorkspace — Dalmia/DU Bangladesh/Viega/Exicom are deliberately
 * absent (Inbound-dashboard-only so far) and fall through to the stub. */
const UPLOADERS_BY_COMPANY: Partial<Record<CompanyKey, UploaderHubItem[]>> = {
  bellavita: BELLAVITA_UPLOADERS,
  gnc: GNC_UPLOADERS,
  neemans: NEEMANS_UPLOADERS,
  appreciate_health: APPRECIATE_HEALTH_UPLOADERS,
  housing_owner: HOUSING_OWNER_UPLOADERS,
  housing_premium: HOUSING_PREMIUM_UPLOADERS,
  clovia: CLOVIA_UPLOADERS,
  birlanu: BIRLANU_UPLOADERS,
  satya_retail: SATYA_RETAIL_UPLOADERS,
  lp_feedback: LP_FEEDBACK_UPLOADERS,
  lp_onboarding: LP_ONBOARDING_UPLOADERS,
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

const todayStr = () => new Date().toISOString().slice(0, 10);
const sevenDaysAgoStr = () => {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
};

/**
 * Date-range wrapper around NativeInboundDashboard's ProjectDetailView —
 * that component takes from/to as props rather than owning its own range,
 * so this tab supplies the same default (last 7 days) and controls its
 * own date pickers, reusing the live summary/trend/hourly view as-is.
 */
function InboundDashboardTab({ projectKey }: { projectKey: string }) {
  const [from, setFrom] = useState(sevenDaysAgoStr());
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
          onClick={() => { setFrom(sevenDaysAgoStr()); setTo(todayStr()); }}
          className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>
      <ProjectDetailView projectKey={projectKey} from={from} to={to} />
    </div>
  );
}

export default function ProcessPerformanceV2Page() {
  const [company, setCompany] = useState<CompanyKey | null>(null);
  const [section, setSection] = useState<SectionKey | null>(null);
  const [selectedUploader, setSelectedUploader] = useState<{ code: string; label: string } | null>(null);
  const [selectedDashboard, setSelectedDashboard] = useState<{ key: string; label: string; kind: "inbound" | "stub" | "bellavita_sale" | "gnc_sale" | "neemans_cart" | "neemans_chat" | "housing_owner_sale" | "housing_premium_sale" | "lp_feedback" | "lp_onboarding" | "satya_retail_dashboard" | "clovia_dashboard" | "birlanu_dashboard" | "neemans_performance" | "bellavita_chat" | "bellavita_cart" } | null>(null);
  const [stats, setStats] = useState({ totalFilesUploaded: 0, activeUsers: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    hrmsApi
      .get<{ success: boolean; data: { totalFilesUploaded: number; activeUsers: number } }>(
        "/api/bulk-upload/process-performance-v2-stats",
      )
      .then((res) => { if (!cancelled) setStats(res.data); })
      .catch(() => { /* leave zeros — the stat cards show 0 rather than block the page */ })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const companyLabel = COMPANIES.find((c) => c.key === company)?.label ?? "";
  const sectionLabel = SECTIONS.find((s) => s.key === section)?.label ?? "";

  const reset = () => { setCompany(null); setSection(null); setSelectedUploader(null); setSelectedDashboard(null); };
  const backToCompany = () => { setSection(null); setSelectedUploader(null); setSelectedDashboard(null); };
  const backToUploaderGrid = () => setSelectedUploader(null);
  const backToDashboardGrid = () => setSelectedDashboard(null);

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-4">
        {company && (
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Activity className="h-4.5 w-4.5" />
            </span>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Process Performance V2</h1>
              <p className="text-xs text-slate-500">
                {section ? `${companyLabel} / ${sectionLabel}` : companyLabel}
              </p>
            </div>
          </div>
        )}

        {/* Level 1: company picker */}
        {!company && (
          <div className="space-y-6">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-50 via-violet-50 to-fuchsia-50 p-6 sm:p-8">
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-500">Welcome</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">Process Performance V2</h1>
              <p className="mt-1 max-w-xl text-sm text-slate-600">
                Select a process to manage data, upload files and view performance dashboards.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard icon={LayoutGrid} label="Total Processes" value={COMPANIES.length} tone="emerald" />
              <StatCard icon={UploadCloud} label="Total Files Uploaded" value={stats.totalFilesUploaded} tone="indigo" loading={statsLoading} />
              <StatCard icon={Users} label="Active Users" value={stats.activeUsers} tone="fuchsia" loading={statsLoading} />
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">All Processes</h2>
                <Link to="/bulk-upload" className="text-xs font-semibold text-indigo-600 hover:underline">
                  View All
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {COMPANIES.map((c) => {
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
              </div>
            </div>
          </div>
        )}

        {/* Level 2: section picker (Dashboards / Uploader) */}
        {company && !section && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel]} onBack={reset} />
            <BoxGrid>
              {SECTIONS.map((s) => (
                <Box
                  key={s.key}
                  icon={s.key === "dashboards" ? LayoutDashboard : Upload}
                  label={s.label}
                  description={s.description}
                  tone={s.key === "dashboards" ? "indigo" : "emerald"}
                  onClick={() => setSection(s.key)}
                />
              ))}
            </BoxGrid>
          </div>
        )}

        {/* Level 3: Dashboards — blank for now (single stub for every company without named sub-dashboards) */}
        {company === "appreciate_health" && section === "dashboards" && (
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
              {DASHBOARDS_BY_COMPANY[company]!.map((d) => (
                <Box
                  key={d.key}
                  icon={d.kind === "inbound" ? PhoneIncoming : d.kind === "bellavita_sale" || d.kind === "gnc_sale" || d.kind === "housing_owner_sale" || d.kind === "housing_premium_sale" || d.kind === "neemans_performance" ? TrendingUp : d.kind === "neemans_cart" || d.kind === "bellavita_cart" ? ShoppingCart : d.kind === "clovia_dashboard" ? LayoutGrid : d.kind === "lp_feedback" || d.kind === "lp_onboarding" || d.kind === "satya_retail_dashboard" ? PhoneCall : d.kind === "bellavita_chat" || d.kind === "neemans_chat" ? MessageSquare : LayoutDashboard}
                  label={d.label}
                  description={d.description}
                  tone={company ? COMPANY_META[company].tone : "slate"}
                  onClick={() => setSelectedDashboard({ key: d.key, label: d.label, kind: d.kind })}
                />
              ))}
            </BoxGrid>
          </div>
        )}

        {company && DASHBOARDS_BY_COMPANY[company] && section === "dashboards" && selectedDashboard && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Dashboards", selectedDashboard.label]} onBack={backToDashboardGrid} />
            {selectedDashboard.kind === "inbound" ? (
              // GNC's Inbound gets its own beautified Overview/Agent-wise/Date-wise
              // dashboard (GncInboundDashboard) per explicit user request -- every
              // other "inbound" company keeps the original shared InboundDashboardTab/
              // ProjectDetailView untouched.
              company === "gnc" ? <GncInboundDashboard /> : <InboundDashboardTab projectKey={company} />
            ) : selectedDashboard.kind === "bellavita_sale" ? (
              <BellavitaSaleDashboard />
            ) : selectedDashboard.kind === "gnc_sale" ? (
              <GncSaleDashboard />
            ) : selectedDashboard.kind === "neemans_cart" ? (
              <NeemansCartDashboard />
            ) : selectedDashboard.kind === "neemans_performance" ? (
              <NeemansPerformanceDashboard />
            ) : selectedDashboard.kind === "neemans_chat" ? (
              <NeemansChatDashboard />
            ) : selectedDashboard.kind === "bellavita_chat" ? (
              <BellavitaChatDashboard />
            ) : selectedDashboard.kind === "bellavita_cart" ? (
              <BellavitaCartDashboard />
            ) : selectedDashboard.kind === "housing_owner_sale" ? (
              <HousingOwnerDashboard />
            ) : selectedDashboard.kind === "housing_premium_sale" ? (
              <HousingPremiumSaleDashboard />
            ) : selectedDashboard.kind === "lp_feedback" ? (
              <LpFeedbackDashboard />
            ) : selectedDashboard.kind === "lp_onboarding" ? (
              <LpOnboardingDashboard />
            ) : selectedDashboard.kind === "satya_retail_dashboard" ? (
              <SatyaRetailDashboard />
            ) : selectedDashboard.kind === "clovia_dashboard" ? (
              <CloviaDashboard />
            ) : selectedDashboard.kind === "birlanu_dashboard" ? (
              <BirlanuDashboard />
            ) : (
              <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-16 text-sm text-slate-400">
                Nothing here yet
              </div>
            )}
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
            (no uploader requested) — stub, same "nothing here yet" state the
            Dashboards section uses elsewhere, so Uploader is never a dead end. */}
        {(company === "dalmia" || company === "dubangladesh" || company === "viega" || company === "exicom") && section === "uploader" && (
          <div className="space-y-4">
            <Breadcrumb parts={[companyLabel, "Data Uploader"]} onBack={backToCompany} />
            <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white p-16 text-sm text-slate-400">
              Nothing here yet
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
