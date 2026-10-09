import { useCallback, useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { CreditCard, PhoneCall, PhoneIncoming, Headphones, Handshake, Percent, Gauge, Wallet, Users, Banknote, Layers } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardHero, DateRangeToolbar, KpiCard, SectionCard, Spinner, currentMonthRange } from "./DashboardKit";
import { TOOLTIP_PROPS, fmtShortDay } from "./lpCallShared";
import type { SbiCardData, SbiDailyRow, SbiFunnel } from "./sbiCardTypes";
import { Empty, SortTable, inr, nz, pctTxt, ratio } from "./SbiCardShared";
import { SbiCardCollectionsTab } from "./SbiCardCollectionsTab";
import { SbiCardPayoutTab } from "./SbiCardPayoutTab";
import { SbiCardReadinessTab } from "./SbiCardReadinessTab";
import { SbiCardMovementTab } from "./SbiCardMovementTab";
import { SbiCardAgentsTab } from "./SbiCardAgentsTab";
import { SbiCardAccountsTab, SbiCardCampaignsTab, SbiCardDowntimeTab, SbiCardKpiTab } from "./SbiCardOtherTabs";
import { SbiCardReportsTab } from "./SbiCardReportsTab";

/**
 * SBI Card Collections (process SBI_CARD) dashboard.
 * Backend: GET /api/process-performance/sbi-card-dashboard?from=&to=. Figures come straight from the uploaded
 * Dialer MIS / Agent MIS / Account File / Downtime Tracker; empty sections say so rather than showing zeros.
 */
const API = "/api/process-performance/sbi-card-dashboard";
type TabKey = "overview" | "collections" | "payout" | "files" | "movement" | "campaigns" | "agents" | "accounts" | "downtime" | "kpi" | "reports";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" }, { key: "collections", label: "Collections Ops" }, { key: "campaigns", label: "Campaigns / Buckets" }, { key: "agents", label: "Agents & Teams" },
  { key: "accounts", label: "Accounts" }, { key: "downtime", label: "Downtime" }, { key: "files", label: "Files" }, { key: "movement", label: "Movement" }, { key: "kpi", label: "KPI Metrics" }, { key: "payout", label: "Payout" },
  { key: "reports", label: "Reports" },
];
const C = { dials: "#3b82f6", connects: "#22c55e", ptp: "#f59e0b", rate: "#7c3aed" };

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1";
const reduceMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const sum = (rows: SbiFunnel[], k: keyof SbiFunnel) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);

export function SbiCardDashboard() {
  const [{ from, to }, setRange] = useState(currentMonthRange);
  const [tab, setTab] = useState<TabKey>("overview");
  const [campaign, setCampaign] = useState("");
  const [data, setData] = useState<SbiCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: SbiCardData }>(`${API}?from=${from}&to=${to}`);
      setData(res.data);
    } catch (e) {
      setData(null); setError(e instanceof Error ? e.message : "Failed to load SBI Card dashboard.");
    } finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  const daily: SbiDailyRow[] = useMemo(() => (data?.daily ?? []).filter((r) => !campaign || r.campaign === campaign), [data, campaign]);
  const trend = useMemo(() => {
    const m = new Map<string, { date: string; accounts: number; dials: number; answers: number; connects: number; ptp: number; contacts: number }>();
    for (const r of daily) {
      const t = m.get(r.date) ?? { date: r.date, accounts: 0, dials: 0, answers: 0, connects: 0, ptp: 0, contacts: 0 };
      t.accounts += r.accounts; t.dials += r.dials; t.answers += r.answers; t.connects += r.connects; t.ptp += r.ptp; t.contacts += r.contacts ?? 0;
      m.set(r.date, t);
    }
    return [...m.values()].sort((a, b) => a.date.localeCompare(b.date)).map((t) => ({
      ...t, contactRate: ratio(t.contacts, t.accounts), ptpRate: ratio(t.ptp, t.contacts),
    }));
  }, [daily]);

  // Unfiltered: use the server summary. Filtered by campaign: re-sum the daily rows (agents/amount are not campaign-scoped).
  const kpis = useMemo(() => {
    if (!data) return null;
    const s = data.summary;
    if (!campaign) return { ...s, scoped: false };
    const contacts = daily.reduce((n, r) => n + (r.contacts ?? 0), 0);
    const dials = sum(daily, "dials"), connects = sum(daily, "connects"), answers = sum(daily, "answers"), ptp = sum(daily, "ptp");
    return { ...s, dials, answers, connects, ptp, pad: sum(daily, "pad"), otp: sum(daily, "otp"), accounts: sum(daily, "accounts"),
      contactRatePct: ratio(contacts, sum(daily, "accounts")), connectRatePct: ratio(connects, dials), ptpRatePct: ratio(ptp, contacts), scoped: true };
  }, [data, daily, campaign]);

  const hasData = !!data && (data.daily.length > 0 || data.byCampaign.length > 0 || data.agents.length > 0 || data.agentTime.agents.length > 0 || data.summary.dials > 0);

  return (
    <div className="space-y-4">
      <DashboardHero icon={CreditCard} eyebrow="Process Performance" title="SBI Card Collections" tabs={TABS} activeTab={tab} onTabChange={(k) => setTab(k as TabKey)}
        gradient="from-sky-700 via-blue-700 to-indigo-800" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {(tab === "overview" && data && data.campaigns.length > 0) ? (
          <label className="flex items-center gap-2 text-xs text-slate-600">Campaign
            <select value={campaign} onChange={(e) => setCampaign(e.target.value)} className={`cursor-pointer rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs ${FOCUS}`}>
              <option value="">All campaigns</option>
              {data.campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        ) : <span />}
        <DateRangeToolbar from={from} to={to} onFrom={(v) => setRange({ from: v, to })} onTo={(v) => setRange({ from, to: v })}
          onReset={() => setRange(currentMonthRange())} />
      </div>

      {tab === "reports" ? <SbiCardReportsTab /> : tab === "kpi" ? <SbiCardKpiTab from={from} to={to} /> : tab === "payout" ? <SbiCardPayoutTab from={from} to={to} /> : tab === "files" ? <SbiCardReadinessTab from={from} to={to} /> : tab === "movement" ? <SbiCardMovementTab from={from} to={to} /> : loading ? <Spinner tone="blue" /> : error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error} <button type="button" onClick={() => void load()} className={`ml-2 cursor-pointer rounded font-semibold underline ${FOCUS}`}>Retry</button>
        </div>
      ) : !data || !kpis ? <Empty>No data.</Empty> : (
        <>
          {tab === "overview" && (!hasData ? <Empty>No SBI Card data for {from} to {to}. Upload the Dialer MIS, Agent MIS or Account File from Process Performance → SBI Card → Uploaders, or the Bulk Upload Hub.</Empty> : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                <KpiCard icon={Layers} tone="sky" label="Accounts" value={nz(kpis.accounts)} />
                <KpiCard icon={PhoneCall} tone="blue" label="Dials" value={nz(kpis.dials)} />
                <KpiCard icon={PhoneIncoming} tone="cyan" label="Answers" value={nz(kpis.answers)} />
                <KpiCard icon={Headphones} tone="emerald" label="Connects" value={nz(kpis.connects)} />
                <KpiCard icon={Handshake} tone="amber" label="PTP" value={nz(kpis.ptp)} sub={`PAD ${nz(kpis.pad)} · OTP ${nz(kpis.otp)}`} />
                <KpiCard icon={Percent} tone="violet" label="Contact rate" value={pctTxt(kpis.contactRatePct)} sub="contacts / accounts called" />
                <KpiCard icon={Percent} tone="indigo" label="Connect rate" value={pctTxt(kpis.connectRatePct)} />
                <KpiCard icon={Percent} tone="teal" label="PTP rate" value={pctTxt(kpis.ptpRatePct)} />
                <KpiCard icon={Gauge} tone={data.summary.penetrationTarget !== null && data.summary.penetration < data.summary.penetrationTarget ? "rose" : "emerald"} label="Penetration"
                  value={data.summary.scheduled > 0 ? data.summary.penetration.toFixed(2) : "—"} sub={data.summary.penetrationTarget !== null ? `dials per account · target ${data.summary.penetrationTarget}` : "dials per scheduled account"} />
                <KpiCard icon={Percent} tone="cyan" label="Completion" value={data.summary.scheduled > 0 ? pctTxt(data.summary.completionPct) : "—"} sub="called / scheduled" />
                <KpiCard icon={Banknote} tone="rose" label="Amount collected" value={inr(data.summary.amountCollected)} sub={kpis.scoped ? "all campaigns" : undefined} />
                <KpiCard icon={Users} tone="sky" label="Agents active" value={nz(data.summary.agentsActive)} sub={kpis.scoped ? "all campaigns" : undefined} />
              </div>
              <SectionCard icon={Wallet} title={`Daily trend${campaign ? ` — ${campaign}` : ""}`} tone="blue">
                {trend.length === 0 ? <Empty>No daily rows.</Empty> : (
                  <>
                  <div role="img" aria-label="Daily dials, connects and PTP bars with contact rate and PTP rate lines" className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" tickFormatter={fmtShortDay} tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="n" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="p" orientation="right" unit="%" tick={{ fontSize: 11 }} />
                        <Tooltip {...TOOLTIP_PROPS} labelFormatter={(d) => fmtShortDay(String(d))}
                          formatter={(v, n) => (typeof v === "number" ? (String(n).includes("rate") ? `${v.toFixed(1)}%` : v.toLocaleString("en-IN")) : "—")} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar yAxisId="n" dataKey="dials" name="Dials" isAnimationActive={!reduceMotion} fill={C.dials} radius={[3, 3, 0, 0]} />
                        <Bar yAxisId="n" dataKey="connects" name="Connects" isAnimationActive={!reduceMotion} fill={C.connects} radius={[3, 3, 0, 0]} />
                        <Bar yAxisId="n" dataKey="ptp" name="PTP" isAnimationActive={!reduceMotion} fill={C.ptp} radius={[3, 3, 0, 0]} />
                        <Line yAxisId="p" type="monotone" dataKey="contactRate" name="Contact rate" isAnimationActive={!reduceMotion} stroke={C.rate} strokeWidth={2} dot={false} connectNulls />
                        <Line yAxisId="p" type="monotone" dataKey="ptpRate" name="PTP rate" isAnimationActive={!reduceMotion} stroke="#ef4444" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <details className="mt-3 text-xs text-slate-700">
                    <summary className={`cursor-pointer rounded font-semibold ${FOCUS}`}>View as table</summary>
                    <div className="mt-2">
                      <SortTable rows={trend} caption="Daily dials, connects, PTP and rates" rowKey={(r) => r.date}
                        cols={[
                          { key: "date", label: "Date", align: "left", value: (r) => r.date },
                          { key: "dials", label: "Dials", value: (r) => r.dials },
                          { key: "connects", label: "Connects", value: (r) => r.connects },
                          { key: "ptp", label: "PTP", value: (r) => r.ptp },
                          { key: "cr", label: "Contact rate", value: (r) => r.contactRate, render: (r) => pctTxt(r.contactRate) },
                          { key: "pr", label: "PTP rate", value: (r) => r.ptpRate, render: (r) => pctTxt(r.ptpRate) },
                        ]} />
                    </div>
                  </details>
                  </>
                )}
              </SectionCard>
            </div>
          ))}
          {tab === "collections" && <SbiCardCollectionsTab ops={data.collections} time={data.agentTime} capacity={data.capacity} team={data.team} range={{ from, to }} />}
          {tab === "campaigns" && <SbiCardCampaignsTab rows={data.byCampaign} />}
          {tab === "agents" && <SbiCardAgentsTab agents={data.agents} teams={data.teams} time={data.agentTime} />}
          {tab === "accounts" && <SbiCardAccountsTab accounts={data.accounts} />}
          {tab === "downtime" && <SbiCardDowntimeTab rows={data.downtime} />}
        </>
      )}
    </div>
  );
}

export default SbiCardDashboard;
