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

export default function MetaCampaignDashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [search, setSearch] = useState("");

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
      const [ov, cfg, camps] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: Overview }>("/api/meta/overview"),
        hrmsApi.get<{ success: boolean; data: ConfigStatus }>("/api/meta/config-status"),
        hrmsApi.get<{ success: boolean; data: Campaign[] }>("/api/meta/campaigns"),
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCampaign = async (campaign: Campaign) => {
    setSelected(campaign);
    setSheetOpen(true);
    setDrawerLoading(true);
    setFunnel(null);
    setLeads([]);
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

  const funnelBars = useMemo(() => {
    if (!funnel?.stages?.length) return [];
    const top = funnel.stages[0]?.count ?? 0;
    return funnel.stages.map((stage, i) => {
      const prev = i === 0 ? stage.count : funnel.stages[i - 1]!.count;
      return {
        ...stage,
        ofTop: ratio(stage.count, top),
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
                    {["Campaign", "Requisition", "Status", "Impressions", "Clicks", "Leads", "Spend", "Last Sync", ""].map((h) => (
                      <th
                        key={h}
                        className={`px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 ${
                          ["Impressions", "Clicks", "Leads", "Spend"].includes(h) ? "text-right" : ""
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const isActive = selected?.id === c.id && sheetOpen;
                    return (
                      <tr
                        key={c.id}
                        onClick={() => void openCampaign(c)}
                        className={`cursor-pointer border-b border-slate-100 transition-colors ${
                          isActive ? "bg-blue-50/60" : "hover:bg-slate-50/70"
                        }`}
                      >
                        <td className="px-3 py-2">
                          <div className="text-xs font-semibold text-slate-900">{c.campaignName}</div>
                          <div className="font-mono text-[10px] text-slate-400">
                            {c.metaFormId ? `form ${c.metaFormId}` : "no form ID linked"}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-mono text-[11px] text-slate-700">{c.requisitionCode ?? "—"}</div>
                          <div className="text-[10px] text-slate-400">
                            {c.designationName ?? "—"}
                            {c.branchName ? ` · ${c.branchName}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[c.campaignStatus]}`}>
                            {c.campaignStatus}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-700">{num(c.impressions)}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-700">{num(c.clicks)}</td>
                        <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-slate-900">{num(c.leadsCount)}</td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-700">{inrShort(c.spendInr)}</td>
                        <td className="px-3 py-2 text-[10px] text-slate-400">
                          {c.lastSyncError ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
                              <AlertTriangle className="h-3 w-3" /> sync failed
                            </span>
                          ) : (
                            fmtDateTime(c.lastSyncedAt)
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span
                            className={`inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                              isActive ? "bg-blue-600 text-white" : "border border-slate-200 text-slate-700"
                            }`}
                          >
                            {isActive ? "Open" : "View"}
                          </span>
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
          }
        }}
      >
        <SheetContent side="right" className="flex w-full flex-col overflow-hidden p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-slate-100 px-5 py-4">
            <SheetTitle className="text-base font-bold text-slate-900">
              {selected?.campaignName ?? "Campaign"}
            </SheetTitle>
            <p className="text-[11px] text-slate-500">
              {selected?.requisitionCode ?? "—"}
              {selected?.designationName ? ` · ${selected.designationName}` : ""}
              {selected?.branchName ? ` · ${selected.branchName}` : ""}
            </p>
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
                  {funnelBars.length === 0 ? (
                    <div className="mt-3">
                      <EmptyState label="No funnel data yet" hint="The funnel populates as leads arrive." />
                    </div>
                  ) : (
                    <div className="mt-3 space-y-1">
                      {funnelBars.map((stage, i) => (
                        <div key={stage.key}>
                          {i > 0 && stage.dropped > 0 && (
                            <div className="flex items-center gap-2 py-1 pl-[124px]">
                              <span className="h-px w-5 bg-rose-200" />
                              <span className="text-[10px] font-semibold text-rose-600">−{num(stage.dropped)} dropped</span>
                            </div>
                          )}
                          <div className="flex items-center gap-3">
                            <span className="w-[112px] shrink-0 text-right text-[11px] font-semibold text-slate-700">
                              {stage.label}
                            </span>
                            <div className="relative h-8 flex-1 overflow-hidden rounded-md bg-slate-50">
                              <div
                                className="flex h-full items-center rounded-md px-2.5 transition-[width] duration-500"
                                style={{
                                  width: `${Math.max(stage.ofTop ?? 0, 7)}%`,
                                  backgroundColor: FUNNEL_RAMP[i % FUNNEL_RAMP.length],
                                }}
                              >
                                <span className="text-[11px] font-bold tabular-nums text-white drop-shadow-sm">
                                  {num(stage.count)}
                                </span>
                              </div>
                              {/* Percentages are omitted entirely rather than shown as 0.0% when
                                  the denominator is zero — the bar's own count is still visible,
                                  so nothing is lost by not inventing a share. */}
                              <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1.5">
                                {stage.ofTop !== null && (
                                  <span className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">
                                    {pct(stage.ofTop)} of {funnelBars[0]!.label.toLowerCase()}
                                  </span>
                                )}
                                {stage.ofPrev !== null && (
                                  <span className="rounded bg-slate-200/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700">
                                    {pct(stage.ofPrev)} of prev
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                    Leads ({num(leads.length)})
                  </h3>
                  {leads.length === 0 ? (
                    <div className="mt-3">
                      <EmptyState
                        label="No leads received"
                        hint="Leads arrive via the META webhook once the Lead Gen form is linked and the ad is live."
                      />
                    </div>
                  ) : (
                    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full min-w-[560px] border-collapse text-sm">
                        <thead className="bg-slate-50 text-left">
                          <tr className="border-b border-slate-200">
                            {["Lead", "Age / Location", "Screening", "Notified", "Received"].map((h) => (
                              <th key={h} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {leads.map((l) => (
                            <tr key={l.id} className="border-b border-slate-100 last:border-0">
                              <td className="px-3 py-2">
                                <div className="text-xs font-semibold text-slate-900">{l.parsedName ?? "—"}</div>
                                <div className="text-[10px] text-slate-400">{l.parsedPhone ?? "no phone"}</div>
                              </td>
                              <td className="px-3 py-2 text-[11px] text-slate-600">
                                <div>{l.parsedAge != null ? `${l.parsedAge} yrs` : "—"}</div>
                                <div className="text-[10px] text-slate-400">{l.parsedLocation ?? "—"}</div>
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${SCREENING_BADGE[l.screeningResult]}`}>
                                  {l.screeningResult}
                                </span>
                                {l.disqualificationReason && (
                                  <div className="mt-1 max-w-[190px] text-[10px] leading-snug text-slate-500">
                                    {l.disqualificationReason}
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-[11px] text-slate-600">
                                {l.notificationSentAt ? (
                                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                                    <BadgeCheck className="h-3 w-3" />
                                    {l.notificationChannels.length ? l.notificationChannels.join(", ") : "sent"}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-slate-400">
                                    <X className="h-3 w-3" /> not sent
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-[10px] text-slate-400">{fmtDateTime(l.createdAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
