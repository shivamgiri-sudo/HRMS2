import { useMemo } from "react";
import { PhoneCall, PhoneOff, ShoppingCart, Users, Store, Repeat, Clock3, TrendingUp, ListTree, Hash } from "lucide-react";
import { KpiCard, SectionCard } from "./DashboardKit";
import { ComboTrend, Donut, RankBars, fmtPct } from "./NeemansCharts";
import { BarCell, DataTable, type Col } from "./SatyaUi";
import { fmtInt, fmtRatio, ratio, type SatyaCallsData, type SatyaReportData } from "./satyaReportModel";
import type { SatyaDetailTarget } from "./SatyaDetailDrawer";

/**
 * Dial attempts from the call log (satya_cdr): volume and connect rate by
 * day, by attempt number (how many tries a shop takes) and by hour of day,
 * plus outcomes and an agent table. Complements the allocation-based tabs,
 * which count shops; this counts every dial.
 */
export function SatyaCallsTab({ data, onOpen }: { data: SatyaReportData; onOpen: (t: SatyaDetailTarget) => void }) {
  const calls = data.calls;
  const h = calls.headline;

  const byAttempt = useMemo(
    () => calls.byAttempt.map((r) => ({ ...r, connectRate: ratio(r.connected, r.attempts) ?? 0 })),
    [calls.byAttempt],
  );
  const hourly = useMemo(
    () => calls.hourly.map((r) => ({ ...r, hourKey: String(r.hour), connectRate: ratio(r.connected, r.attempts) ?? 0 })),
    [calls.hourly],
  );
  const maxAttempts = Math.max(0, ...calls.agents.map((a) => a.attempts));

  const agentCols: Array<Col<SatyaCallsData["agents"][number]>> = [
    { key: "agent", label: "Agent", sort: (r) => r.agentId, total: "Total", render: (r) => <span className="font-medium text-slate-700">{r.agentId}</span> },
    { key: "att", label: "Dial attempts", align: "right", sort: (r) => r.attempts, total: fmtInt(h.attempts), render: (r) => <BarCell value={r.attempts} max={maxAttempts} color="#f59e0b">{fmtInt(r.attempts)}</BarCell> },
    { key: "conn", label: "Connected", align: "right", sort: (r) => r.connected, total: fmtInt(h.connected), render: (r) => <span className="text-emerald-700">{fmtInt(r.connected)}</span> },
    { key: "cpct", label: "Connect %", align: "right", sort: (r) => ratio(r.connected, r.attempts) ?? -1, total: fmtRatio(ratio(h.connected, h.attempts)), render: (r) => fmtRatio(ratio(r.connected, r.attempts)) },
    { key: "ord", label: "Order-placing calls", align: "right", sort: (r) => r.orderCalls, total: fmtInt(h.orderCalls), render: (r) => <span className="font-semibold text-slate-800">{fmtInt(r.orderCalls)}</span> },
    { key: "avg", label: "Avg attempt no.", align: "right", sort: (r) => r.avgAttempt, total: String(h.avgAttempt), render: (r) => r.avgAttempt },
  ];

  return (
    <div className="space-y-5">
      <p className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-xs text-sky-800">
        Dial attempts come from the call log exactly as uploaded. The Roster filter doesn't apply here (about half the call-log rows carry no roster); Date and Warehouse do.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <KpiCard icon={PhoneCall} label="Dial attempts" value={fmtInt(h.attempts)} tone="amber" />
        <KpiCard icon={PhoneCall} label="Connected" value={fmtInt(h.connected)} sub={`${h.connectedPct}% of attempts`} tone="emerald" />
        <KpiCard icon={PhoneOff} label="Call dropped" value={fmtInt(h.dropped)} tone="rose" />
        <KpiCard icon={ShoppingCart} label="Order-placing calls" value={fmtInt(h.orderCalls)} sub="a shop can take several" tone="violet" />
        <KpiCard icon={Store} label="Shops dialled" value={fmtInt(h.shops)} tone="teal" />
        <KpiCard icon={Repeat} label="Avg attempt no." value={String(h.avgAttempt)} sub="how deep into retries" tone="indigo" />
        <KpiCard icon={Users} label="Agents dialling" value={String(h.agents)} tone="sky" />
      </div>

      <SectionCard icon={TrendingUp} title="Dial attempts & connects by day" tone="amber">
        <ComboTrend
          data={calls.daily}
          series={[
            { key: "attempts", name: "Attempts", kind: "bar", color: "#f59e0b" },
            { key: "connected", name: "Connected", kind: "line", color: "#10b981" },
            { key: "orderCalls", name: "Order-placing calls", kind: "line", color: "#7c3aed", axis: "right" },
          ]}
        />
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard icon={Hash} title="Attempts by attempt number" tone="indigo" footnote="How many tries the dial log shows per shop, and how the connect rate changes with each retry.">
          <ComboTrend
            height={230} xKey="bucket" xFormat={(v) => `#${v}`}
            data={byAttempt}
            series={[
              { key: "attempts", name: "Attempts", kind: "bar", color: "#6366f1" },
              { key: "connectRate", name: "Connect %", kind: "line", color: "#10b981", axis: "right", format: fmtPct },
            ]}
          />
        </SectionCard>
        <SectionCard icon={Clock3} title="Attempts by hour of day" tone="sky" footnote="Hour the call was placed (24h).">
          <ComboTrend
            height={230} xKey="hourKey" xFormat={(v) => `${v}:00`}
            data={hourly}
            series={[
              { key: "attempts", name: "Attempts", kind: "bar", color: "#0ea5e9" },
              { key: "connectRate", name: "Connect %", kind: "line", color: "#f59e0b", axis: "right", format: fmtPct },
            ]}
          />
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard icon={PhoneCall} title="Call result" tone="emerald">
          <Donut data={calls.byScenario.map((s) => ({ name: s.scenario, value: s.count }))} centerValue={fmtInt(h.attempts)} centerLabel="Attempts" colors={["#f43f5e", "#10b981", "#f59e0b", "#94a3b8"]} />
        </SectionCard>
        <div className="lg:col-span-2">
          <SectionCard icon={ListTree} title="Top outcomes (sub-scenario)" tone="violet" footnote="'Not tagged' = the call log has no sub-scenario for the row.">
            <RankBars maxRows={10} data={calls.bySubScenario.map((s) => ({ name: s.subScenario, value: s.count }))} />
          </SectionCard>
        </div>
      </div>

      <SectionCard icon={Users} title="Agent-wise dial attempts" tone="amber" footnote="Click an agent for the full drill-down.">
        <DataTable columns={agentCols} rows={calls.agents} rowKey={(r) => r.agentId} onRowClick={(r) => onOpen({ type: "agent", key: r.agentId })} defaultSort={{ key: "att", dir: "desc" }} empty="No dial attempts in this range." />
      </SectionCard>
    </div>
  );
}
