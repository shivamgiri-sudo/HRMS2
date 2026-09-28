import type { ComponentType } from "react";
import {
  IndianRupee, ShoppingBag, TrendingUp, ClipboardList, PhoneCall, Gauge, Clock3, Users, MessageSquare, Trophy,
  ShieldCheck, LogIn, Coffee, PhoneIncoming, PhoneMissed, ShoppingCart, Layers, UserCog, Activity, HeartPulse,
  Target, ListTree, Headset,
} from "lucide-react";
import { KpiCard, SectionCard, formatINR } from "./DashboardKit";
import { ComboTrend, Donut, RankBars, RingGauge, fmtNum, fmtPct } from "./NeemansCharts";
import type { NeemansDashboardData } from "./neemansPerformanceTypes";

export type OverviewTarget = "sale" | "allocation" | "chat" | "productivity";

const fmtHm = (sec: number) => `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
const fmtMs = (sec: number) => `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;

function SourceBand({
  icon: Icon, title, subtitle, gradient, onOpen,
}: {
  icon: ComponentType<{ className?: string }>; title: string; subtitle: string; gradient: string; onOpen?: () => void;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-r ${gradient} px-4 py-3 text-white shadow-sm`}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-bold leading-tight">{title}</p>
          <p className="text-[11px] text-white/80">{subtitle}</p>
        </div>
      </div>
      {onOpen && (
        <button type="button" onClick={onOpen} className="rounded-lg bg-white/15 px-3 py-1.5 text-[11px] font-semibold transition-colors hover:bg-white/25">
          Open details →
        </button>
      )}
    </div>
  );
}

/** Ring value, or null (an empty "—" ring) when the source has no volume in
 * range -- a 0% ring would read as "everything failed" rather than "no data". */
const ringValue = (hasVolume: boolean, value: number): number | null => (hasVolume ? value : null);

/**
 * Neemans Overview -- every source in one scroll: Sale, Allocation, Chat, APR
 * (productivity), Inbound and Abandoned Cart, each with its KPIs plus the
 * charts that source's own tab/dashboard leads with. All numbers come from
 * the same response the per-source tabs use, for the same date range.
 */
export function NeemansOverviewTab({
  data, onOpenTab,
}: { data: NeemansDashboardData; onOpenTab: (tab: OverviewTarget) => void }) {
  const { sale, allocation, chat, productivity, cart, inbound } = data;

  /** Orders placed / total numbers allocated -- matches the reference management
   * workbook's "Conversion %" (Neeman's Billing Sep 26.xlsb, sheet "Dashboard": Total
   * Orders / Workable Data). Computed here rather than read off the API response
   * because both inputs are already in `data`; the backend also now exposes the same
   * figure as `overview.conversionPct` for any non-UI consumer of this endpoint. */
  const conversionPct = allocation.headline.totalAllocation > 0
    ? Math.round((sale.headline.saleCount / allocation.headline.totalAllocation) * 10000) / 100
    : 0;

  return (
    <div className="space-y-8">
      <SectionCard icon={HeartPulse} title="Process health at a glance" tone="violet" footnote="Each ring is one source's headline rate for the selected range; an empty ring means that source has no data in range.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <RingGauge label="Allocation connected" value={ringValue(allocation.headline.totalAllocation > 0, allocation.headline.connectedPct)} color="#10b981" />
          <RingGauge label="Chat resolved" value={ringValue(chat.headline.totalTickets > 0, chat.headline.resolvedPct)} color="#6366f1" />
          <RingGauge label="Chat FRT in TAT" value={ringValue(chat.headline.totalTickets > 0, chat.headline.frtTatCompliancePct)} color="#0ea5e9" />
          <RingGauge label="Agent occupancy" value={ringValue(productivity.headline.totalCalls > 0, productivity.headline.avgOccupancyPct)} color="#f59e0b" />
          <RingGauge label="Inbound service level" value={inbound ? ringValue(inbound.headline.answered > 0, inbound.headline.slPct) : null} color="#8b5cf6" />
          <RingGauge label="Sale prepaid" value={ringValue(sale.headline.saleCount > 0, sale.headline.prepaidPct)} color="#14b8a6" />
        </div>
      </SectionCard>

      {/* ── Sale ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SourceBand
          icon={ShoppingBag} title="Sale" gradient="from-emerald-600 to-teal-600"
          subtitle={`${sale.headline.saleCount.toLocaleString("en-IN")} orders · ${formatINR(sale.headline.revenue)} revenue`}
          onOpen={() => onOpenTab("sale")}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard icon={IndianRupee} label="Revenue" value={formatINR(sale.headline.revenue)} tone="emerald" />
          <KpiCard icon={ShoppingBag} label="Orders" value={sale.headline.saleCount.toLocaleString("en-IN")} tone="sky" />
          <KpiCard icon={TrendingUp} label="AOV" value={formatINR(sale.headline.aov)} tone="violet" />
          <KpiCard icon={IndianRupee} label="Prepaid %" value={`${sale.headline.prepaidPct}%`} tone="teal" />
          <KpiCard icon={IndianRupee} label="COD %" value={`${sale.headline.codPct}%`} tone="amber" />
          <KpiCard icon={PhoneMissed} label="RTO %" value={`${sale.headline.rtoPct}%`} tone="rose" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SectionCard icon={TrendingUp} title="Revenue, orders & RTO by day" tone="emerald">
              <ComboTrend
                data={sale.dateWiseTrend}
                series={[
                  { key: "revenue", name: "Revenue", kind: "area", color: "#10b981", axis: "right", format: formatINR },
                  { key: "saleCount", name: "Orders", kind: "bar", color: "#0ea5e9" },
                  { key: "rtoCount", name: "RTO", kind: "line", color: "#f43f5e" },
                ]}
              />
            </SectionCard>
          </div>
          <SectionCard icon={Layers} title="Payment mix (revenue)" tone="teal">
            <Donut
              data={sale.paymentBreakdown.map((p) => ({ name: p.paymentStatus, value: p.revenue }))}
              valueFormat={formatINR} centerValue={formatINR(sale.headline.revenue)} centerLabel="Revenue"
            />
          </SectionCard>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard icon={Users} title="Top team leaders by revenue" tone="violet">
            <RankBars data={sale.byTl.map((t) => ({ name: t.tlName, value: t.revenue }))} valueFormat={formatINR} />
          </SectionCard>
          <SectionCard icon={Trophy} title="Top agents by revenue" tone="amber">
            <RankBars data={sale.agents.map((a) => ({ name: a.name, value: a.revenue }))} valueFormat={formatINR} colors={["#f59e0b", "#f97316", "#ec4899", "#8b5cf6", "#0ea5e9", "#10b981", "#14b8a6", "#6366f1"]} />
          </SectionCard>
        </div>
      </section>

      {/* ── Allocation ───────────────────────────────────────── */}
      <section className="space-y-3">
        <SourceBand
          icon={ClipboardList} title="Allocation" gradient="from-violet-600 to-purple-600"
          subtitle={`${allocation.headline.totalAllocation.toLocaleString("en-IN")} allocated · ${allocation.headline.connectedPct}% connected`}
          onOpen={() => onOpenTab("allocation")}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <KpiCard icon={ClipboardList} label="Total allocation" value={allocation.headline.totalAllocation.toLocaleString("en-IN")} tone="violet" />
          <KpiCard icon={PhoneCall} label="Connected" value={allocation.headline.connected.toLocaleString("en-IN")} tone="emerald" />
          <KpiCard icon={Gauge} label="Connected %" value={`${allocation.headline.connectedPct}%`} tone="teal" />
          <KpiCard icon={PhoneMissed} label="Not connected" value={allocation.headline.notConnected.toLocaleString("en-IN")} tone="rose" />
          <KpiCard icon={Clock3} label="Pending" value={allocation.headline.pending.toLocaleString("en-IN")} tone="amber" />
          <KpiCard icon={Users} label="Unique phones" value={allocation.headline.uniquePhones.toLocaleString("en-IN")} tone="sky" />
          <KpiCard icon={Target} label="Conversion %" value={`${conversionPct}%`} tone="indigo" sub="orders / allocation" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SectionCard icon={TrendingUp} title="Allocation & connected % by day" tone="violet">
              <ComboTrend
                data={allocation.dateWiseTrend}
                series={[
                  { key: "allocationCount", name: "Allocation", kind: "bar", color: "#7c3aed" },
                  { key: "connectedPct", name: "Connected %", kind: "line", color: "#10b981", axis: "right", format: fmtPct },
                ]}
              />
            </SectionCard>
          </div>
          <SectionCard icon={PhoneCall} title="Calling status" tone="teal">
            <Donut
              data={allocation.statusBreakdown.map((s) => ({ name: s.status, value: s.count }))}
              centerValue={allocation.headline.totalAllocation.toLocaleString("en-IN")} centerLabel="Allocated"
              colors={["#10b981", "#f43f5e", "#f59e0b", "#0ea5e9", "#7c3aed", "#64748b"]}
            />
          </SectionCard>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard icon={ListTree} title="Top call outcomes (sub-scenario)" tone="rose">
            <RankBars data={allocation.subScenarioBreakdown.map((s) => ({ name: s.subScenario, value: s.count }))} colors={["#f43f5e", "#f97316", "#f59e0b", "#84cc16", "#10b981", "#14b8a6", "#0ea5e9", "#6366f1"]} />
          </SectionCard>
          <SectionCard icon={Layers} title="Allocation source (Shopify vs GOKWICK)" tone="indigo">
            <Donut data={allocation.typeBreakdown.map((t) => ({ name: t.type, value: t.count }))} colors={["#7c3aed", "#0ea5e9", "#f59e0b"]} />
          </SectionCard>
        </div>
      </section>

      {/* ── Chat ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SourceBand
          icon={MessageSquare} title="Chat" gradient="from-indigo-600 to-blue-600"
          subtitle={`${chat.headline.totalTickets.toLocaleString("en-IN")} tickets · ${chat.headline.resolvedPct}% resolved`}
          onOpen={() => onOpenTab("chat")}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <KpiCard icon={MessageSquare} label="Tickets" value={chat.headline.totalTickets.toLocaleString("en-IN")} tone="indigo" />
          <KpiCard icon={Gauge} label="Resolved %" value={`${chat.headline.resolvedPct}%`} tone="emerald" />
          <KpiCard icon={Clock3} label="Avg FRT" value={`${chat.headline.avgFrtHrs}m`} tone="sky" />
          <KpiCard icon={Clock3} label="Avg resolution" value={`${chat.headline.avgResolutionHrs}m`} tone="violet" />
          <KpiCard icon={Trophy} label="Avg CSAT" value={chat.headline.avgCsat ? String(chat.headline.avgCsat) : "—"} tone="amber" />
          <KpiCard icon={ShieldCheck} label="FRT TAT" value={`${chat.headline.frtTatCompliancePct}%`} tone="teal" />
          <KpiCard icon={ShieldCheck} label="Resolution TAT" value={`${chat.headline.resolutionTatCompliancePct}%`} tone="cyan" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SectionCard icon={TrendingUp} title="Tickets & resolved % by day" tone="indigo">
              <ComboTrend
                data={chat.dateWiseTrend}
                series={[
                  { key: "tickets", name: "Tickets", kind: "bar", color: "#6366f1" },
                  { key: "resolvedPct", name: "Resolved %", kind: "line", color: "#10b981", axis: "right", format: fmtPct },
                ]}
              />
            </SectionCard>
          </div>
          <SectionCard icon={ListTree} title="Ticket status" tone="rose">
            <Donut
              data={chat.statusBreakdown.map((s) => ({ name: s.status, value: s.count }))}
              centerValue={chat.headline.totalTickets.toLocaleString("en-IN")} centerLabel="Tickets"
              colors={["#10b981", "#f59e0b", "#6366f1", "#f43f5e", "#0ea5e9"]}
            />
          </SectionCard>
        </div>
      </section>

      {/* ── APR / Productivity ───────────────────────────────── */}
      <section className="space-y-3">
        <SourceBand
          icon={Activity} title="APR · Agent productivity" gradient="from-amber-500 to-orange-600"
          subtitle={`${productivity.headline.totalCalls.toLocaleString("en-IN")} calls · ${productivity.headline.avgOccupancyPct}% occupancy`}
          onOpen={() => onOpenTab("productivity")}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard icon={PhoneCall} label="Total calls" value={productivity.headline.totalCalls.toLocaleString("en-IN")} tone="sky" />
          <KpiCard icon={Users} label="Active agents" value={String(productivity.headline.activeAgents)} tone="indigo" />
          <KpiCard icon={Gauge} label="Avg occupancy" value={`${productivity.headline.avgOccupancyPct}%`} tone="violet" />
          <KpiCard icon={Clock3} label="Attendance days" value={String(productivity.headline.attendanceDays)} tone="emerald" />
          <KpiCard icon={LogIn} label="Avg net login" value={fmtHm(productivity.headline.avgNetLoginSec)} tone="teal" sub="per agent-day" />
          <KpiCard icon={Coffee} label="Avg total break" value={fmtHm(productivity.headline.avgTotalBreakSec)} tone="amber" sub="per agent-day" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SectionCard icon={TrendingUp} title="Calls, occupancy & agents logged in by day" tone="amber">
              <ComboTrend
                data={productivity.dateWiseTrend}
                series={[
                  { key: "calls", name: "Calls", kind: "bar", color: "#0ea5e9" },
                  { key: "loginAgents", name: "Agents logged in", kind: "line", color: "#6366f1" },
                  { key: "avgOccupancyPct", name: "Occupancy %", kind: "line", color: "#f59e0b", axis: "right", format: fmtPct },
                ]}
              />
            </SectionCard>
          </div>
          <SectionCard icon={Trophy} title="Top agents by calls" tone="sky">
            <RankBars data={productivity.agents.map((a) => ({ name: a.name, value: a.calls }))} colors={["#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#14b8a6", "#f97316"]} />
          </SectionCard>
        </div>
      </section>

      {/* ── Inbound ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <SourceBand
          icon={PhoneIncoming} title="Inbound" gradient="from-sky-600 to-cyan-600"
          subtitle={inbound ? `${inbound.headline.offered.toLocaleString("en-IN")} calls offered · ${inbound.headline.slPct}% service level` : "Live dialer data"}
        />
        {!inbound ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center text-xs text-slate-500">
            {data.inboundError ?? "Inbound data is unavailable."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <KpiCard icon={PhoneIncoming} label="Offered" value={inbound.headline.offered.toLocaleString("en-IN")} tone="sky" />
              <KpiCard icon={Headset} label="Answered" value={inbound.headline.answered.toLocaleString("en-IN")} tone="emerald" />
              <KpiCard icon={PhoneMissed} label="Abandoned" value={inbound.headline.abandoned.toLocaleString("en-IN")} tone="rose" />
              <KpiCard icon={Gauge} label="Answer %" value={`${inbound.headline.answerPct}%`} tone="teal" />
              <KpiCard icon={Target} label="Service level %" value={`${inbound.headline.slPct}%`} tone="violet" />
              <KpiCard icon={Clock3} label="AHT" value={fmtMs(inbound.headline.ahtSec)} tone="amber" />
              <KpiCard icon={ShieldCheck} label="FCR %" value={inbound.headline.fcrPct === null ? "—" : `${inbound.headline.fcrPct}%`} tone="indigo" />
              <KpiCard icon={Users} label="Agents logged in" value={String(inbound.headline.loginCount)} tone="cyan" />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <SectionCard icon={TrendingUp} title="Calls offered vs answered, with service level" tone="sky">
                  <ComboTrend
                    data={inbound.dateWiseTrend}
                    series={[
                      { key: "offered", name: "Offered", kind: "area", color: "#0ea5e9" },
                      { key: "answered", name: "Answered", kind: "area", color: "#10b981" },
                      { key: "slPct", name: "Service level %", kind: "line", color: "#8b5cf6", axis: "right", format: fmtPct },
                    ]}
                  />
                </SectionCard>
              </div>
              <SectionCard icon={PhoneCall} title="Answered vs abandoned" tone="emerald">
                <Donut
                  data={[
                    { name: "Answered", value: inbound.headline.answered },
                    { name: "Abandoned", value: inbound.headline.abandoned },
                  ]}
                  colors={["#10b981", "#f43f5e"]}
                  centerValue={`${inbound.headline.answerPct}%`} centerLabel="Answered"
                />
              </SectionCard>
            </div>
          </>
        )}
      </section>

      {/* ── Abandoned cart ───────────────────────────────────── */}
      <section className="space-y-3">
        <SourceBand
          icon={ShoppingCart} title="Abandoned cart" gradient="from-fuchsia-600 to-pink-600"
          subtitle={`${cart.headline.totalCarts.toLocaleString("en-IN")} carts · ${formatINR(cart.headline.totalCartValue)} cart value`}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard icon={ShoppingCart} label="Abandoned carts" value={cart.headline.totalCarts.toLocaleString("en-IN")} tone="violet" />
          <KpiCard icon={IndianRupee} label="Total cart value" value={formatINR(cart.headline.totalCartValue)} tone="emerald" />
          <KpiCard icon={TrendingUp} label="Avg cart value" value={formatINR(cart.headline.avgCartValue)} tone="sky" />
          <KpiCard icon={Users} label="Unique customers" value={cart.headline.uniqueCustomers.toLocaleString("en-IN")} tone="amber" />
          <KpiCard icon={UserCog} label="Active agents" value={String(cart.headline.activeAgents)} tone="indigo" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SectionCard icon={TrendingUp} title="Carts & cart value by day" tone="rose">
              <ComboTrend
                data={cart.dateWiseTrend}
                series={[
                  { key: "cartCount", name: "Carts", kind: "bar", color: "#c026d3" },
                  { key: "cartValue", name: "Cart value", kind: "line", color: "#10b981", axis: "right", format: formatINR },
                ]}
              />
            </SectionCard>
          </div>
          <SectionCard icon={Layers} title="Cart dispositions" tone="violet">
            <Donut
              data={cart.dispositionBreakdown.map((d) => ({ name: d.disposition, value: d.count }))}
              centerValue={cart.headline.totalCarts.toLocaleString("en-IN")} centerLabel="Carts"
              valueFormat={fmtNum}
            />
          </SectionCard>
        </div>
      </section>
    </div>
  );
}
