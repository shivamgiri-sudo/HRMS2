/**
 * META Campaign Automation dashboard.
 *
 * Reads /api/meta/overview, /api/meta/campaigns, /api/meta/campaigns/:id/funnel and /api/meta/leads.
 * Every figure on this page comes from one of those endpoints — there are no client-side estimates
 * and no placeholder numbers, per this codebase's standing rule against mock metrics on a real
 * route.
 *
 * Two presentation decisions worth stating, both following analytics-kit's conventions:
 *
 *   - Percentages always name their denominator. The funnel labels each bar with its share of the
 *     top stage AND its share of the immediately preceding stage, because "40%" is meaningless
 *     without knowing 40% of what.
 *   - A ratio with a zero denominator renders "—", never "0%". Cost-per-qualified on a campaign
 *     with no spend recorded is unknown, not free, and the backend returns null for exactly that
 *     reason.
 *
 * The configuration banner is deliberate rather than defensive noise. This feature depends on four
 * external integrations (Graph API token, webhook signing secret, WhatsApp bridge URL, voice-bot
 * URL) and none is configured on any environment yet. Without the banner an empty dashboard looks
 * like "the campaigns are not performing" instead of "nothing is connected yet".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Eye,
  Filter,
  Footprints,
  Megaphone,
  MousePointerClick,
  RefreshCcw,
  Send,
  ThumbsUp,
  UserCheck,
  UserPlus,
  UserX,
  Wallet,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartCard,
  EmptyState,
  FUNNEL_RAMP,
  ProvenanceBar,
  StatTile,
  inrShort,
  num,
  pct,
  ratio,
} from "@/components/analytics/analytics-kit";

type Overview = {
  campaigns: number;
  activeCampaigns: number;
  impressions: number;
  clicks: number;
  spendInr: number;
  formFills: number;
  qualified: number;
  disqualified: number;
  pending: number;
  candidatesCreated: number;
  walkins: number;
  selected: number;
  onboarded: number;
  costPerQualified: number | null;
  costPerWalkin: number | null;
  costPerOnboarded: number | null;
  metaConfigured: boolean;
};

type Campaign = {
  id: string;
  requisitionId: string;
  requisitionCode: string | null;
  designationName: string | null;
  branchName: string | null;
  processName: string | null;
  demandRaisedDate: string | null;
  trainingStartDate: string | null;
  targetJoiningDate: string | null;
  requestedByName: string | null;
  requestedHeadcount: number | null;
  plannedBatchNo: string | null;
  plannedBatchName: string | null;
  requisitionPriority: string | null;
  campaignName: string;
  campaignStatus: "draft" | "active" | "paused" | "completed" | "archived";
  metaCampaignId: string | null;
  metaFormId: string | null;
  impressions: number;
  reach: number;
  clicks: number;
  leadsCount: number;
  spendInr: number;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
};

type FunnelStage = { key: string; label: string; count: number };

type Funnel = {
  campaignId: string;
  requisitionCode: string | null;
  designationName: string | null;
  campaignName: string;
  stages: FunnelStage[];
  spendInr: number;
  costPerLead: number | null;
  costPerQualified: number | null;
};

type Lead = {
  id: string;
  parsedName: string | null;
  parsedPhone: string | null;
  parsedEmail: string | null;
  parsedAge: number | null;
  parsedLocation: string | null;
  parsedEducation: string | null;
  screeningResult: "pending" | "qualified" | "disqualified";
  disqualificationReason: string | null;
  atsCandidateId: string | null;
  notificationSentAt: string | null;
  notificationChannels: string[];
  voiceCallStatus: string | null;
  createdAt: string;
};

type ConfigStatus = {
  metaApiConfigured: boolean;
  webhookVerifyTokenConfigured: boolean;
  webhookSignatureConfigured: boolean;
  whatsappConfigured: boolean;
  voicebotConfigured: boolean;
};

const STATUS_BADGE: Record<Campaign["campaignStatus"], string> = {
  draft: "bg-slate-100 text-slate-600",
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-700",
  completed: "bg-blue-100 text-blue-700",
  archived: "bg-slate-100 text-slate-400",
};

const SCREENING_BADGE: Record<Lead["screeningResult"], string> = {
  qualified: "bg-emerald-100 text-emerald-700",
  disqualified: "bg-rose-100 text-rose-700",
  pending: "bg-amber-100 text-amber-700",
};

/**
 * "12.3% of clicks", or "no clicks yet" when the denominator is zero.
 *
 * The `pct(ratio(a, b) ?? 0)` shorthand is wrong and this exists to stop it: ratio() deliberately
 * returns null for a zero denominator, and coercing that to 0 renders "0.0% of clicks" on a
 * campaign that has had no clicks at all. That reads as a measured failure rather than as an
 * absence of data — exactly the confusion analytics-kit's ratio() was written to avoid.
 */
function shareOf(numerator: number | undefined, denominator: number | undefined, unit: string): string {
  const share = ratio(Number(numerator ?? 0), Number(denominator ?? 0));
  return share === null ? `No ${unit} recorded yet` : `${pct(share)} of ${unit}`;
}

function fmtDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default function MetaCampaignDashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [search, setSearch] = useState("");

  // Dimension filters — server-side
  const [branchFilter, setBranchFilter] = useState("");
  const [processFilter, setProcessFilter] = useState("");
  const [requisitionFilter, setRequisitionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterOptions, setFilterOptions] = useState<{
    branches: string[];
    processes: string[];
    requisitions: Array<{ id: string; code: string; designation: string }>;
  }>({ branches: [], processes: [], requisitions: [] });

  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setErrorMsg("");
    try {
      const params = new URLSearchParams();
      if (branchFilter) params.set("branchName", branchFilter);
      if (processFilter) params.set("processName", processFilter);
      if (requisitionFilter) params.set("requisitionId", requisitionFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const [ov, cfg, camps] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: Overview }>("/api/meta/overview"),
        hrmsApi.get<{ success: boolean; data: ConfigStatus }>("/api/meta/config-status"),
        hrmsApi.get<{ success: boolean; data: Campaign[] }>(`/api/meta/campaigns${qs}`),
      ]);
      setOverview(ov.data);
      setConfig(cfg.data);
      setCampaigns(camps.data ?? []);
    } catch (err: unknown) {
      setErrorMsg((err as { message?: string })?.message || "Unable to load META campaign data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [branchFilter, processFilter, requisitionFilter, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    hrmsApi
      .get<{ success: boolean; data: typeof filterOptions }>("/api/meta/filter-options")
      .then((res) => setFilterOptions(res.data ?? { branches: [], processes: [], requisitions: [] }))
      .catch(() => {});
  }, []);

  const openCampaign = async (campaign: Campaign) => {
    setSelected(campaign);
    setSheetOpen(true);
    setDrawerLoading(true);
    setFunnel(null);
    setLeads([]);
    setActiveStage(null);
    try {
      const [f, l] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: Funnel }>(`/api/meta/campaigns/${campaign.id}/funnel`),
        hrmsApi.get<{ success: boolean; data: Lead[] }>(`/api/meta/leads?campaignId=${campaign.id}`),
      ]);
      setFunnel(f.data);
      setLeads(l.data ?? []);
    } catch (err: unknown) {
      setErrorMsg((err as { message?: string })?.message || "Unable to load campaign detail");
    } finally {
      setDrawerLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (statusFilter !== "All" && c.campaignStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        c.campaignName.toLowerCase().includes(q) ||
        (c.requisitionCode ?? "").toLowerCase().includes(q) ||
        (c.designationName ?? "").toLowerCase().includes(q)
      );
    });
  }, [campaigns, statusFilter, search]);

  const missingConfig = useMemo(() => {
    if (!config) return [];
    const gaps: string[] = [];
    if (!config.metaApiConfigured) gaps.push("META Graph API token (META_MARKETING_ACCESS_TOKEN) — no lead detail or metrics can be fetched");
    if (!config.webhookVerifyTokenConfigured) gaps.push("Webhook verify token (META_LEAD_VERIFY_TOKEN) — the webhook cannot be subscribed");
    if (!config.webhookSignatureConfigured) gaps.push("Webhook signing secret (META_APP_SECRET) — incoming webhooks are refused unverified");
    if (!config.whatsappConfigured) gaps.push("WhatsApp bridge URL (LOCAL_WHATSAPP_API_URL) — WhatsApp outreach is skipped");
    if (!config.voicebotConfigured) gaps.push("Voice bot URL (VOICEBOT_TRIGGER_URL) — voice calls are skipped");
    return gaps;
  }, [config]);

  const [activeStage, setActiveStage] = useState<string | null>(null);

  const funnelBars = useMemo(() => {
    if (!funnel?.stages?.length) return [];
    // Use the maximum count across ALL stages as the width reference, not just stage[0].
    // When stage[0] is Impressions=0 (no META spend yet), using it as denominator makes
    // every subsequent bar ratio=null → all bars collapse to the 7% minimum (a dot).
    // The max-count approach keeps bars proportional no matter which stage is tallest.
    const maxCount = Math.max(...funnel.stages.map((s) => s.count), 1);
    // "First non-zero" stage — used for ofPrev chain and drop calculation anchor
    return funnel.stages.map((stage, i) => {
      const prev = i === 0 ? stage.count : funnel.stages[i - 1]!.count;
      return {
        ...stage,
        ofMax: ratio(stage.count, maxCount),          // drives bar width
        ofPrev: i === 0 ? null : ratio(stage.count, prev),
        dropped: i === 0 ? 0 : Math.max(0, prev - stage.count),
      };
    });
  }, [funnel]);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Megaphone className="h-5 w-5 text-blue-600" /> META Campaign Automation
            </h1>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Lead Gen ad performance, automated screening outcomes and the impressions-to-onboarded funnel per requisition.
            </p>
          </div>
          <button
            onClick={() => void load(true)}
            disabled={refreshing}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-slate-700 disabled:opacity-60"
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Loading…" : "Refresh"}
          </button>
        </header>

        {errorMsg && (
          <div role="alert" className="rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {errorMsg}
          </div>
        )}

        {missingConfig.length > 0 && (
          <div className="rounded-xl border-2 border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-amber-900">
                  {missingConfig.length} integration{missingConfig.length === 1 ? "" : "s"} not yet configured
                </p>
                <p className="mt-0.5 text-[12px] text-amber-800">
                  Zeroes below reflect missing configuration, not campaign performance.
                </p>
                <ul className="mt-2 space-y-1">
                  {missingConfig.map((gap) => (
                    <li key={gap} className="flex items-start gap-1.5 text-[12px] text-amber-900">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                      <span>{gap}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Dimension filter bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <Select
            value={branchFilter}
            onValueChange={(v) => setBranchFilter(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder="Branch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Branches</SelectItem>
              {filterOptions.branches.map((b) => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={processFilter}
            onValueChange={(v) => setProcessFilter(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue placeholder="Process" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Processes</SelectItem>
              {filterOptions.processes.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={requisitionFilter}
            onValueChange={(v) => setRequisitionFilter(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="Requisition" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Requisitions</SelectItem>
              {filterOptions.requisitions.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.code}{r.designation ? ` — ${r.designation}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            type="date"
            aria-label="Date from"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <input
            type="date"
            aria-label="Date to"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {(branchFilter || processFilter || requisitionFilter || dateFrom || dateTo) && (
            <button
              onClick={() => {
                setBranchFilter("");
                setProcessFilter("");
                setRequisitionFilter("");
                setDateFrom("");
                setDateTo("");
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <X className="h-4 w-4" /> Clear
            </button>
          )}
        </div>

        <ProvenanceBar
          items={[
            { label: "Campaigns", value: `${num(overview?.campaigns ?? 0)} (${num(overview?.activeCampaigns ?? 0)} active)` },
            { label: "Ad metrics", value: overview?.metaConfigured ? "Synced from META Marketing API" : "Not synced — no API token", warn: !overview?.metaConfigured },
            { label: "Leads", value: `${num(overview?.formFills ?? 0)} form fills` },
            { label: "Screening", value: "Age / education / experience vs requisition" },
            { label: "Excludes", value: "leads from unlinked forms" },
          ]}
        />

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : (
          <>
            {/* META Funnel: Impressions → Clicks → Form Fills → Qualified/Disqualified */}
            <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-700">
                <Megaphone className="h-4 w-4" /> META Ad Funnel
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                <StatTile
                  label="Impressions"
                  value={num(overview?.impressions ?? 0)}
                  denominator="Across all campaigns"
                  icon={<Eye className="h-4 w-4" />}
                />
                <StatTile
                  label="Clicks"
                  value={num(overview?.clicks ?? 0)}
                  denominator={shareOf(overview?.clicks, overview?.impressions, "impressions")}
                  icon={<MousePointerClick className="h-4 w-4" />}
                />
                <StatTile
                  label="Form Fills"
                  value={num(overview?.formFills ?? 0)}
                  denominator={shareOf(overview?.formFills, overview?.clicks, "clicks")}
                  icon={<Send className="h-4 w-4" />}
                />
                <StatTile
                  label="Qualified"
                  value={num(overview?.qualified ?? 0)}
                  denominator={`${shareOf(overview?.qualified, overview?.formFills, "form fills")} · ${num(overview?.pending ?? 0)} pending`}
                  intent="good"
                  icon={<UserCheck className="h-4 w-4" />}
                />
                <StatTile
                  label="Disqualified"
                  value={num(overview?.disqualified ?? 0)}
                  denominator={shareOf(overview?.disqualified, overview?.formFills, "form fills")}
                  intent="critical"
                  icon={<UserX className="h-4 w-4" />}
                />
                <StatTile
                  label="Ad Spend"
                  value={inrShort(overview?.spendInr ?? 0)}
                  denominator={
                    overview?.costPerQualified != null
                      ? `${inrShort(overview.costPerQualified)} per qualified`
                      : "Cost per qualified — not measurable"
                  }
                  icon={<Wallet className="h-4 w-4" />}
                />
              </div>
            </div>

            {/* ATS Funnel: Walk-ins → Selections → Onboardings */}
            <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-700">
                <Footprints className="h-4 w-4" /> Recruitment Funnel (from Campaign Leads)
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatTile
                  label="ATS Candidates"
                  value={num(overview?.candidatesCreated ?? 0)}
                  denominator={shareOf(overview?.candidatesCreated, overview?.qualified, "qualified leads")}
                  icon={<UserPlus className="h-4 w-4" />}
                />
                <StatTile
                  label="Walk-ins"
                  value={num(overview?.walkins ?? 0)}
                  denominator={
                    overview?.costPerWalkin != null
                      ? `${inrShort(overview.costPerWalkin)} per walk-in`
                      : shareOf(overview?.walkins, overview?.candidatesCreated, "ATS candidates")
                  }
                  intent="good"
                  icon={<Footprints className="h-4 w-4" />}
                />
                <StatTile
                  label="Selected"
                  value={num(overview?.selected ?? 0)}
                  denominator={shareOf(overview?.selected, overview?.walkins, "walk-ins")}
                  intent="good"
                  icon={<ThumbsUp className="h-4 w-4" />}
                />
                <StatTile
                  label="Onboarded"
                  value={num(overview?.onboarded ?? 0)}
                  denominator={
                    overview?.costPerOnboarded != null
                      ? `${inrShort(overview.costPerOnboarded)} per onboarding`
                      : shareOf(overview?.onboarded, overview?.selected, "selected")
                  }
                  intent="good"
                  icon={<BadgeCheck className="h-4 w-4" />}
                />
              </div>
            </div>
          </>
        )}

        <ChartCard
          title="Campaigns"
          subtitle="One row per Lead Gen campaign linked to a requisition. Click a row to see its full funnel and every lead it produced."
          action={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Filter className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <select
                  aria-label="Filter by campaign status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-8 rounded-lg border border-slate-200 pl-7 pr-2 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500"
                >
                  {["All", "draft", "active", "paused", "completed", "archived"].map((s) => (
                    <option key={s} value={s}>
                      {s === "All" ? "All statuses" : s}
                    </option>
                  ))}
                </select>
              </div>
              <input
                aria-label="Search campaigns"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search campaign / requisition"
                className="h-8 w-52 rounded-lg border border-slate-200 px-2.5 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          }
        >
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              label={campaigns.length === 0 ? "No META campaigns linked yet" : "No campaigns match these filters"}
              hint={
                campaigns.length === 0
                  ? "A campaign appears here once marketing links a META Campaign ID and Lead Gen Form ID to an approved requisition."
                  : "Clear the status filter or search box."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-left">
                  <tr className="border-b border-slate-200">
                    <th className="sr-only">Campaign details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((c) => {
                    const isActive = selected?.id === c.id && sheetOpen;
                    const PRIORITY_BADGE: Record<string, string> = {
                      urgent: "bg-red-100 text-red-700",
                      high: "bg-amber-100 text-amber-700",
                      normal: "bg-slate-100 text-slate-600",
                      low: "bg-slate-50 text-slate-400",
                    };
                    return (
                      <tr
                        key={c.id}
                        onClick={() => void openCampaign(c)}
                        className={`cursor-pointer transition-colors ${isActive ? "bg-blue-50/60" : "hover:bg-slate-50/70"}`}
                      >
                        <td className="px-4 py-3">
                          {/* ── Row: two-column grid — left=context, right=metrics ── */}
                          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:gap-6">

                            {/* LEFT — Campaign + Requisition context */}
                            <div className="min-w-0 flex-1 space-y-1.5">
                              {/* Row 1: campaign name + status + priority */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-bold text-slate-900 leading-tight">{c.campaignName}</span>
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[c.campaignStatus]}`}>
                                  {c.campaignStatus}
                                </span>
                                {c.requisitionPriority && c.requisitionPriority !== "normal" && (
                                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${PRIORITY_BADGE[c.requisitionPriority] ?? "bg-slate-100 text-slate-600"}`}>
                                    {c.requisitionPriority}
                                  </span>
                                )}
                                <span className="font-mono text-[10px] text-slate-400">
                                  {c.metaFormId ? `form ${c.metaFormId}` : "no form ID"}
                                </span>
                              </div>

                              {/* Row 2: Designation · Branch · Process */}
                              <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                                {c.designationName && <span className="font-semibold">{c.designationName}</span>}
                                {c.branchName && <><span className="text-slate-300">·</span><span>{c.branchName}</span></>}
                                {c.processName && <><span className="text-slate-300">·</span><span className="text-blue-600 font-medium">{c.processName}</span></>}
                                {c.requisitionCode && <><span className="text-slate-300">·</span><span className="font-mono text-slate-500">{c.requisitionCode}</span></>}
                              </div>

                              {/* Row 3: Batch no + name */}
                              {(c.plannedBatchNo || c.plannedBatchName) && (
                                <div className="flex items-center gap-1.5 text-[11px]">
                                  <span className="text-slate-400 uppercase tracking-wide font-bold text-[9px]">Batch</span>
                                  <span className="font-semibold text-indigo-700">{[c.plannedBatchNo, c.plannedBatchName].filter(Boolean).join(" — ")}</span>
                                </div>
                              )}

                              {/* Row 4: Key dates + who raised */}
                              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                                {c.demandRaisedDate && (
                                  <span>
                                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Raised </span>
                                    {fmtDate(c.demandRaisedDate)}
                                  </span>
                                )}
                                {c.trainingStartDate && (
                                  <span>
                                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Training </span>
                                    <span className="font-semibold text-emerald-700">{fmtDate(c.trainingStartDate)}</span>
                                  </span>
                                )}
                                {c.targetJoiningDate && (
                                  <span>
                                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Target join </span>
                                    {fmtDate(c.targetJoiningDate)}
                                  </span>
                                )}
                                {c.requestedByName && (
                                  <span>
                                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">By </span>
                                    {c.requestedByName}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* RIGHT — Metrics */}
                            <div className="flex flex-shrink-0 flex-wrap items-center gap-3 lg:justify-end">
                              {c.requestedHeadcount && (
                                <div className="text-center">
                                  <div className="text-sm font-bold text-slate-900">{c.requestedHeadcount}</div>
                                  <div className="text-[9px] uppercase tracking-wide text-slate-400">HC</div>
                                </div>
                              )}
                              <div className="text-center">
                                <div className="text-sm font-bold text-emerald-700">{num(c.leadsCount)}</div>
                                <div className="text-[9px] uppercase tracking-wide text-slate-400">Leads</div>
                              </div>
                              {c.impressions > 0 && (
                                <div className="text-center">
                                  <div className="text-sm font-bold text-slate-700">{num(c.impressions)}</div>
                                  <div className="text-[9px] uppercase tracking-wide text-slate-400">Impressions</div>
                                </div>
                              )}
                              {c.clicks > 0 && (
                                <div className="text-center">
                                  <div className="text-sm font-bold text-slate-700">{num(c.clicks)}</div>
                                  <div className="text-[9px] uppercase tracking-wide text-slate-400">Clicks</div>
                                </div>
                              )}
                              {c.spendInr > 0 && (
                                <div className="text-center">
                                  <div className="text-sm font-bold text-slate-700">{inrShort(c.spendInr)}</div>
                                  <div className="text-[9px] uppercase tracking-wide text-slate-400">Spend</div>
                                </div>
                              )}
                              <div className="text-center">
                                {c.lastSyncError ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600">
                                    <AlertTriangle className="h-3 w-3" /> sync failed
                                  </span>
                                ) : c.lastSyncedAt ? (
                                  <div>
                                    <div className="text-[10px] text-slate-400">{fmtDate(c.lastSyncedAt)}</div>
                                    <div className="text-[9px] uppercase tracking-wide text-slate-400">Last sync</div>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-slate-300">no sync</span>
                                )}
                              </div>
                              <span className={`inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold ${isActive ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-700"}`}>
                                {isActive ? "Open" : "View"}
                              </span>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Right-side campaign detail drawer */}
      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) {
            setSelected(null);
            setFunnel(null);
            setLeads([]);
            setActiveStage(null);
          }
        }}
      >
        <SheetContent side="right" className="flex w-full flex-col overflow-hidden p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-slate-100 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="text-base font-bold text-slate-900 leading-snug">
                  {selected?.campaignName ?? "Campaign"}
                </SheetTitle>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-600">
                  {selected?.designationName && <span className="font-semibold">{selected.designationName}</span>}
                  {selected?.branchName && <><span className="text-slate-300">·</span><span>{selected.branchName}</span></>}
                  {selected?.processName && <><span className="text-slate-300">·</span><span className="text-blue-600 font-medium">{selected.processName}</span></>}
                  {selected?.requisitionCode && <><span className="text-slate-300">·</span><span className="font-mono text-slate-500">{selected.requisitionCode}</span></>}
                </div>
                {(selected?.plannedBatchNo || selected?.plannedBatchName) && (
                  <div className="mt-1 text-[11px] font-semibold text-indigo-700">
                    Batch: {[selected.plannedBatchNo, selected.plannedBatchName].filter(Boolean).join(" — ")}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                  {selected?.requestedHeadcount && <span><span className="font-bold text-slate-700">{selected.requestedHeadcount}</span> HC required</span>}
                  {selected?.demandRaisedDate && <span>Raised: <span className="font-medium">{fmtDate(selected.demandRaisedDate)}</span></span>}
                  {selected?.trainingStartDate && <span>Training: <span className="font-semibold text-emerald-700">{fmtDate(selected.trainingStartDate)}</span></span>}
                  {selected?.targetJoiningDate && <span>Target join: <span className="font-medium">{fmtDate(selected.targetJoiningDate)}</span></span>}
                  {selected?.requestedByName && <span>By: <span className="font-medium">{selected.requestedByName}</span></span>}
                </div>
              </div>
              {selected && (
                <span className={`mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[selected.campaignStatus]}`}>
                  {selected.campaignStatus}
                </span>
              )}
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {drawerLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : (
              <>
                {selected?.lastSyncError && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                    <span className="font-bold">Last metrics sync failed: </span>
                    {selected.lastSyncError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <StatTile
                    label="Spend"
                    value={inrShort(funnel?.spendInr ?? 0)}
                    denominator={
                      funnel?.costPerLead != null ? `${inrShort(funnel.costPerLead)} per form fill` : "Cost per fill — not measurable"
                    }
                  />
                  <StatTile
                    label="Cost / Qualified"
                    value={funnel?.costPerQualified != null ? inrShort(funnel.costPerQualified) : "—"}
                    denominator={funnel?.costPerQualified != null ? "Spend ÷ qualified leads" : "Needs spend and ≥1 qualified lead"}
                    intent={funnel?.costPerQualified != null ? "good" : "neutral"}
                  />
                </div>

                <section>
                  <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Campaign Funnel</h3>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Bar width is each stage's share of the first stage. Both denominators are labelled, so no percentage is
                    ambiguous. ATS stages appear only once a candidate has reached them.
                  </p>
                  {activeStage && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[11px] text-slate-600">Showing: <strong>{funnelBars.find(s => s.key === activeStage)?.label}</strong></span>
                      <button type="button" onClick={() => setActiveStage(null)} className="text-[10px] text-blue-600 hover:underline">Show all</button>
                    </div>
                  )}
                  {funnelBars.length === 0 ? (
                    <div className="mt-3">
                      <EmptyState label="No funnel data yet" hint="The funnel populates as leads arrive." />
                    </div>
                  ) : (
                    <div className="mt-3 space-y-1">
                      {funnelBars.map((stage, i) => {
                        const isActive = activeStage === stage.key;
                        return (
                        <div key={stage.key}>
                          {i > 0 && stage.dropped > 0 && (
                            <div className="flex items-center gap-2 py-0.5 pl-[124px]">
                              <span className="h-px w-5 bg-rose-200" />
                              <span className="text-[10px] font-semibold text-rose-500">−{num(stage.dropped)} dropped</span>
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => setActiveStage(isActive ? null : stage.key)}
                            className={`group flex w-full items-center gap-3 rounded-lg px-1 py-0.5 text-left transition-colors ${isActive ? "bg-blue-50 ring-1 ring-blue-200" : "hover:bg-slate-50"}`}
                            title={`Click to filter leads to ${stage.label} stage`}
                          >
                            <span className={`w-[112px] shrink-0 text-right text-[11px] font-semibold transition-colors ${isActive ? "text-blue-700" : "text-slate-700 group-hover:text-blue-600"}`}>
                              {stage.label}
                            </span>
                            <div className="relative h-9 flex-1 overflow-hidden rounded-lg bg-slate-100">
                              <div
                                className="flex h-full items-center rounded-lg px-3 transition-[width] duration-700"
                                style={{
                                  width: `${Math.max(stage.ofMax ?? 0, stage.count > 0 ? 8 : 4)}%`,
                                  backgroundColor: isActive ? "#2563eb" : FUNNEL_RAMP[i % FUNNEL_RAMP.length],
                                }}
                              >
                                <span className="text-[12px] font-bold tabular-nums text-white drop-shadow-sm">
                                  {num(stage.count)}
                                </span>
                              </div>
                              <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1.5">
                                {stage.ofPrev !== null && stage.ofPrev !== undefined && (
                                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${isActive ? "bg-blue-100 text-blue-700" : "bg-slate-200/80 text-slate-700"}`}>
                                    {pct(stage.ofPrev)} of prev
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section>
                  {/* Stage-filtered leads list */}
                  {(() => {
                    const stageFiltered = activeStage
                      ? leads.filter((l) => {
                          switch (activeStage) {
                            case "form_fills":     return true;
                            case "qualified":      return l.screeningResult === "qualified";
                            case "disqualified":   return l.screeningResult === "disqualified";
                            case "pending":        return l.screeningResult === "pending";
                            case "notified":       return Boolean(l.notificationSentAt);
                            case "applied":
                            case "hr_screening":
                            case "assessment":
                            case "operations":
                            case "client_round":
                            case "selection":
                            case "selected":
                            case "offered":
                            case "arrived":
                            case "joined":         return Boolean(l.atsCandidateId);
                            default:               return true;
                          }
                        })
                      : leads;
                    const stageLabel = activeStage ? funnelBars.find(s => s.key === activeStage)?.label : null;
                    return (
                      <>
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                            {stageLabel ? `${stageLabel} Leads` : "All Leads"} ({num(stageFiltered.length)})
                          </h3>
                          <a
                            href={`/ats/meta-leads`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-blue-600 hover:underline"
                          >
                            Open in Leads page ↗
                          </a>
                        </div>
                        {stageFiltered.length === 0 ? (
                          <div className="mt-3">
                            <EmptyState
                              label={activeStage ? `No leads at ${stageLabel} stage` : "No leads received"}
                              hint={activeStage ? "Try a different funnel stage above." : "Leads arrive via the META webhook once the Lead Gen form is linked."}
                            />
                          </div>
                        ) : (
                          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full min-w-[520px] border-collapse text-sm">
                              <thead className="bg-slate-50 text-left">
                                <tr className="border-b border-slate-200">
                                  {["Name / Phone", "Age", "Screening", "Notified", "Received"].map((h) => (
                                    <th key={h} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {stageFiltered.map((l) => (
                                  <tr
                                    key={l.id}
                                    onClick={() => window.open(`/ats/meta-leads`, "_blank")}
                                    className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-blue-50/50 transition-colors"
                                    title="Click to view full lead details"
                                  >
                                    <td className="px-3 py-2">
                                      <div className="text-xs font-semibold text-blue-700 hover:underline">{l.parsedName ?? "—"}</div>
                                      <div className="text-[10px] text-slate-400">{l.parsedPhone ?? "no phone"}</div>
                                    </td>
                                    <td className="px-3 py-2 text-[11px] text-slate-600">
                                      {l.parsedAge != null ? `${l.parsedAge} yrs` : "—"}
                                      {l.parsedLocation && <div className="text-[10px] text-slate-400">{l.parsedLocation}</div>}
                                    </td>
                                    <td className="px-3 py-2">
                                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${SCREENING_BADGE[l.screeningResult]}`}>
                                        {l.screeningResult}
                                      </span>
                                      {l.disqualificationReason && (
                                        <div className="mt-0.5 max-w-[160px] text-[9px] leading-snug text-slate-400">{l.disqualificationReason}</div>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-[11px]">
                                      {l.notificationSentAt ? (
                                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                                          <BadgeCheck className="h-3 w-3" />
                                          {l.notificationChannels.length ? l.notificationChannels.join(", ") : "sent"}
                                        </span>
                                      ) : (
                                        <span className="text-slate-400 text-[10px]">not sent</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-[10px] text-slate-400">{fmtDateTime(l.createdAt)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </section>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
