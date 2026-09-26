import { useEffect, useMemo, useState } from "react";
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { PhoneIncoming, MessageSquare, ShoppingCart, Crown, ArrowUpRight, Target } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatINR, formatShortDate } from "./DashboardKit";

/**
 * "LOB Overview" strip for the GNC Overall dashboard: one card per line of business (Inbound, Chat,
 * Abandon Cart) with its revenue, target progress, daily revenue sparkline, headline KPIs and top agents.
 *
 * Everything comes from the payload the Overall dashboard already loaded (gnc_sale by campaign, the
 * target blocks from the Targets page), except Chat's ticket KPIs (chats, unique chats, FRT / resolution
 * TAT, CSAT), which are the Chat dashboard's own headline numbers so the two never disagree. Inbound has
 * no call/ticket source in this app, so its card shows sale-side KPIs only -- never a guessed call figure.
 */

type LobKey = "Inbound" | "Chat" | "Abandon Cart";

export interface LobOverviewData {
  from: string; to: string;
  headline: { totalAllocation?: number; sameDayConnectedPct?: number };
  funnel?: Array<{ stage: string; count: number; pctOfBase: number }>;
  campaignRevenue: Array<{
    campaign: string; saleCount: number; codCount: number; paidCount: number; codPct: number; paidPct: number;
    turnover: number; conversionPct: number | null; target?: number | null; achPct?: number | null;
  }>;
  dateWiseBreakdown: Array<{ date: string; byCampaign: Record<string, { totalSaleCount: number; totalAmount: number }> }>;
  agentPerformance: Array<{ empId: string; empName: string; lob: string; saleCount: number; revenue: number }>;
  targets?: { blocks: Array<{ lob: string; configured: boolean; monthlyTarget: number | null; rangeTarget: number | null; agentCount: number | null; revenue: number; achPct: number | null }> };
}

interface ChatHeadline {
  totalChats: number; uniqueChats: number; frtInTatPct: number; resolutionInTatPct: number; conversionPct: number; avgCsat: number; csatResponses: number;
}

const THEME: Record<LobKey, {
  icon: typeof PhoneIncoming; sub: string; header: string; ring: string; stroke: string; fill: string; chip: string; medal: string; btn: string;
}> = {
  Inbound: {
    icon: PhoneIncoming, sub: "Inbound calls · sale side", header: "from-sky-600 via-blue-600 to-indigo-600", ring: "text-sky-500", stroke: "#0284c7", fill: "#38bdf8",
    chip: "bg-sky-50 text-sky-700", medal: "bg-sky-100 text-sky-700", btn: "text-sky-700 hover:bg-sky-50",
  },
  Chat: {
    icon: MessageSquare, sub: "WhatsApp & web chat", header: "from-violet-600 via-purple-600 to-fuchsia-600", ring: "text-violet-500", stroke: "#7c3aed", fill: "#a78bfa",
    chip: "bg-violet-50 text-violet-700", medal: "bg-violet-100 text-violet-700", btn: "text-violet-700 hover:bg-violet-50",
  },
  "Abandon Cart": {
    icon: ShoppingCart, sub: "Cart-recovery calling", header: "from-amber-500 via-orange-500 to-rose-500", ring: "text-amber-500", stroke: "#d97706", fill: "#fbbf24",
    chip: "bg-amber-50 text-amber-700", medal: "bg-amber-100 text-amber-700", btn: "text-amber-700 hover:bg-amber-50",
  },
};
const LOBS: LobKey[] = ["Inbound", "Chat", "Abandon Cart"];
const fmtN = (n: number) => n.toLocaleString("en-IN");
const MEDALS = ["🥇", "🥈", "🥉"];

/** Circular achievement gauge (0-100+, capped visually at 100). */
function AchRing({ pct }: { pct: number | null }) {
  const size = 62, sw = 6, r = (size - sw) / 2, c = 2 * Math.PI * r;
  const v = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} title={pct === null ? "No target configured" : `${pct}% of target`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ffffff" strokeWidth={sw} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none text-white">
        <span className="text-[13px] font-extrabold">{pct === null ? "—" : `${Math.round(pct)}%`}</span>
        <span className="mt-0.5 text-[8px] font-semibold uppercase tracking-wide text-white/80">target</span>
      </span>
    </span>
  );
}

function Chip({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-xl px-2.5 py-2 ${tone}`}>
      <p className="truncate text-[15px] font-extrabold leading-tight tracking-tight">{value}</p>
      <p className="truncate text-[10px] font-semibold opacity-75">{label}</p>
    </div>
  );
}

export function GncLobOverview({
  data, onOpenLob, onOpenAgent,
}: { data: LobOverviewData; onOpenLob: (lob: string) => void; onOpenAgent: (empId: string) => void }) {
  const [chat, setChat] = useState<ChatHeadline | null>(null);
  const [chatState, setChatState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setChatState("loading");
    hrmsApi.get<{ success: boolean; data: { headline: ChatHeadline } }>(`/api/process-performance/gnc-chat-dashboard?from=${data.from}&to=${data.to}`, 90000)
      .then((r) => { if (!cancelled) { setChat(r.data.headline); setChatState("ok"); } })
      .catch(() => { if (!cancelled) setChatState("error"); });
    return () => { cancelled = true; };
  }, [data.from, data.to]);

  const cards = useMemo(() => LOBS.map((lob) => {
    const row = data.campaignRevenue.find((c) => c.campaign.toLowerCase() === lob.toLowerCase()) ?? null;
    const block = data.targets?.blocks.find((b) => b.lob === lob) ?? null;
    const spark = data.dateWiseBreakdown.map((d) => ({ date: d.date, revenue: d.byCampaign[lob]?.totalAmount ?? 0 }));
    const agents = data.agentPerformance.filter((a) => a.lob.toLowerCase() === lob.toLowerCase()).sort((a, b) => b.revenue - a.revenue);
    const sales = row?.saleCount ?? 0;
    const revenue = row?.turnover ?? 0;
    return { lob, row, block, spark, agents, sales, revenue, aov: sales > 0 ? revenue / sales : 0 };
  }), [data]);
  const totalRevenue = cards.reduce((s, c) => s + c.revenue, 0);

  const chatVal = (f: (h: ChatHeadline) => string) => (chatState === "ok" && chat ? f(chat) : chatState === "loading" ? "…" : "—");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <h3 className="text-sm font-bold text-slate-800">LOB Overview</h3>
          <p className="text-[11px] text-slate-500">Inbound, Chat and Abandon Cart side by side · {formatShortDate(data.from)} – {formatShortDate(data.to)}</p>
        </div>
        <p className="text-[11px] font-medium text-slate-400">Click a card for its full breakdown, or an agent for their date-wise detail</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {cards.map(({ lob, row, block, spark, agents, sales, revenue, aov }) => {
          const th = THEME[lob];
          const Icon = th.icon;
          const share = totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 1000) / 10 : 0;
          const hasTarget = !!block?.configured && block.rangeTarget !== null;
          const ach = hasTarget ? block!.achPct : null;
          const fill = ach === null ? 0 : Math.min(100, ach);
          const chips: Array<[string, string]> = lob === "Chat"
            ? [
                ["Total chats", chatVal((h) => fmtN(h.totalChats))], ["Unique chats", chatVal((h) => fmtN(h.uniqueChats))],
                ["Sale conv. %", chatVal((h) => `${h.conversionPct}%`)], ["FRT in TAT", chatVal((h) => `${h.frtInTatPct}%`)],
                ["Resolution in TAT", chatVal((h) => `${h.resolutionInTatPct}%`)], ["Avg CSAT", chatVal((h) => (h.csatResponses > 0 ? String(h.avgCsat) : "—"))],
              ]
            : lob === "Inbound"
              ? [
                  ["Sale count", fmtN(sales)], ["AOV", formatINR(aov)], ["Prepaid %", row ? `${row.paidPct}%` : "—"],
                  ["COD %", row ? `${row.codPct}%` : "—"], ["Agents sold", fmtN(agents.length)], ["Revenue / agent", agents.length ? formatINR(revenue / agents.length) : "—"],
                ]
              : [
                  ["Allocation", data.headline.totalAllocation != null ? fmtN(data.headline.totalAllocation) : "—"], ["Sale count", fmtN(sales)],
                  ["Conversion %", row?.conversionPct != null ? `${row.conversionPct}%` : "—"], ["AOV", formatINR(aov)],
                  ["Prepaid %", row ? `${row.paidPct}%` : "—"], ["Agents sold", fmtN(agents.length)],
                ];
          const chipTones = ["bg-slate-50 text-slate-700", th.chip, th.chip, "bg-slate-50 text-slate-700", "bg-slate-50 text-slate-700", th.chip];
          return (
            <div key={lob} className="group flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg">
              <button type="button" onClick={() => onOpenLob(lob)} className={`relative w-full bg-gradient-to-br ${th.header} p-4 text-left text-white`} title={`Open ${lob} breakdown`}>
                <div className="pointer-events-none absolute inset-0 opacity-[0.14]" style={{ backgroundImage: "radial-gradient(circle at 12% 18%, white, transparent 42%), radial-gradient(circle at 92% 90%, white, transparent 38%)" }} />
                <div className="relative flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold backdrop-blur-sm"><Icon className="h-3.5 w-3.5" />{lob}</span>
                    <p className="mt-2.5 text-[26px] font-extrabold leading-none tracking-tight">{formatINR(revenue)}</p>
                    <p className="mt-1 text-[11px] font-medium text-white/85">{fmtN(sales)} sales · {share}% of GNC revenue</p>
                    <p className="text-[10px] text-white/65">{th.sub}</p>
                  </div>
                  <AchRing pct={ach} />
                </div>
              </button>

              <div className="flex flex-1 flex-col gap-3 p-4">
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-600"><Target className="h-3 w-3" />{hasTarget ? `Target ${formatINR(block!.rangeTarget as number)}` : "No target set"}</span>
                    <span className={`font-extrabold ${ach === null ? "text-slate-300" : ach >= 100 ? "text-emerald-600" : ach >= 60 ? "text-amber-600" : "text-rose-600"}`}>{ach === null ? "—" : `${ach}%`}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${fill}%`, backgroundColor: th.stroke }} />
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {hasTarget ? `${formatINR(block!.monthlyTarget ?? 0)} / month${block!.agentCount ? ` · ${block!.agentCount} agents` : ""} — edit on the Targets page` : "Add one on the Targets page to see achievement"}
                  </p>
                </div>

                <div className="h-[64px] w-full">
                  {spark.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={spark} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
                        <defs>
                          <linearGradient id={`lobFill-${lob.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={th.fill} stopOpacity={0.55} />
                            <stop offset="100%" stopColor={th.fill} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" hide />
                        <Tooltip
                          contentStyle={{ fontSize: 11, borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff", padding: "4px 8px" }}
                          itemStyle={{ color: "#0f172a", fontWeight: 600 }} labelStyle={{ color: "#334155", fontWeight: 700 }}
                          labelFormatter={(d) => formatShortDate(String(d))} formatter={(v: number) => [formatINR(Number(v)), "Revenue"]}
                        />
                        <Area type="monotone" dataKey="revenue" stroke={th.stroke} strokeWidth={2} fill={`url(#lobFill-${lob.replace(/\s/g, "")})`} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : <p className="flex h-full items-center justify-center text-[11px] text-slate-400">Not enough days for a trend</p>}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {chips.map(([label, value], i) => <Chip key={label} label={label} value={value} tone={chipTones[i]} />)}
                </div>

                <div>
                  <p className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400"><Crown className="h-3 w-3" />Top agents by revenue</p>
                  {agents.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-400">None</p> : (
                    <ul className="space-y-1">
                      {agents.slice(0, 3).map((a, i) => (
                        <li key={a.empId}>
                          <button type="button" onClick={() => onOpenAgent(a.empId)} className="flex w-full items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-slate-100">
                            <span className="w-5 text-center text-sm">{MEDALS[i]}</span>
                            <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{a.empName}</span>
                            <span className="shrink-0 text-[10px] text-slate-400">{a.saleCount} sales</span>
                            <span className="shrink-0 font-bold text-slate-800">{formatINR(a.revenue)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <button type="button" onClick={() => onOpenLob(lob)} className={`mt-auto inline-flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-bold transition-colors ${th.btn}`}>
                  View {lob} details <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {chatState === "error" && <p className="px-1 text-[10px] text-slate-400">Chat ticket KPIs could not be loaded; Chat sale figures above are unaffected.</p>}
    </div>
  );
}
