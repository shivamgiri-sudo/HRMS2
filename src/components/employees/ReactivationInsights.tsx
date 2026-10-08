import { useMemo } from "react";
import { Area, AreaChart, Bar, BarChart, Cell, CartesianGrid, Pie, PieChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export type InsightRequest = {
  status: string;
  created_at: string;
  gap_days: number;
  hr_final_actioned_at?: string;
  branch_head_actioned_at?: string;
};

const DAY_MS = 86_400_000;
const SLA_DAYS = 3;

const STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  branch_head_approved: "#1B6AB5",
  approved: "#3BAD49",
  rejected: "#ef4444",
  cancelled: "#94a3b8",
};
const STATUS_LABELS: Record<string, string> = {
  pending: "Branch Head",
  branch_head_approved: "Final decision (old process)",
  approved: "Reactivated",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function waitingDays(r: InsightRequest): number {
  const from = r.status === "branch_head_approved" ? r.branch_head_actioned_at ?? r.created_at : r.created_at;
  const t = new Date(from).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold tracking-tight text-slate-950">{title}</h3>
      <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-[200px] items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-400">
      {text}
    </div>
  );
}

/**
 * Charts for the reactivation page. `history` is the recent request history (HR / payroll head
 * only); `queue` is the currently open queue, which every approver can see.
 */
export function ReactivationInsights({ history, queue }: { history: InsightRequest[]; queue: InsightRequest[] }) {
  const trend = useMemo(() => {
    const months: { key: string; label: string; raised: number; reactivated: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: monthKey(d), label: d.toLocaleDateString("en-IN", { month: "short" }), raised: 0, reactivated: 0 });
    }
    const byKey = new Map(months.map(m => [m.key, m]));
    for (const r of history) {
      const raised = byKey.get(monthKey(new Date(r.created_at)));
      if (raised) raised.raised += 1;
      if (r.status === "approved") {
        // The branch head's approval is final now; old two-step rows were finalised by HR.
        const done = byKey.get(monthKey(new Date(r.hr_final_actioned_at ?? r.branch_head_actioned_at ?? r.created_at)));
        if (done) done.reactivated += 1;
      }
    }
    return months;
  }, [history]);

  const statusMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of history) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return [...counts.entries()].map(([status, value]) => ({
      status,
      name: STATUS_LABELS[status] ?? status,
      value,
      fill: STATUS_COLORS[status] ?? "#94a3b8",
    }));
  }, [history]);

  const aging = useMemo(() => {
    const buckets = [
      { range: "0-1d", count: 0, over: false },
      { range: "2d", count: 0, over: false },
      { range: `${SLA_DAYS}-4d`, count: 0, over: true },
      { range: "5d+", count: 0, over: true },
    ];
    for (const r of queue) {
      const d = waitingDays(r);
      buckets[d <= 1 ? 0 : d === 2 ? 1 : d <= 4 ? 2 : 3].count += 1;
    }
    return buckets;
  }, [queue]);

  const gaps = useMemo(() => {
    const buckets = [
      { range: "<30d", count: 0 },
      { range: "30-90d", count: 0 },
      { range: "90-180d", count: 0 },
      { range: "180d+", count: 0 },
    ];
    for (const r of history) {
      const g = r.gap_days ?? 0;
      buckets[g < 30 ? 0 : g < 90 ? 1 : g < 180 ? 2 : 3].count += 1;
    }
    return buckets;
  }, [history]);

  const trendConfig = {
    raised: { label: "Raised", color: "#1B6AB5" },
    reactivated: { label: "Reactivated", color: "#3BAD49" },
  } satisfies ChartConfig;
  const agingConfig = { count: { label: "Open requests", color: "#1B6AB5" } } satisfies ChartConfig;
  const gapConfig = { count: { label: "Requests", color: "#8b5cf6" } } satisfies ChartConfig;
  const mixConfig = Object.fromEntries(
    statusMix.map(s => [s.status, { label: s.name, color: s.fill }]),
  ) satisfies ChartConfig;

  const hasHistory = history.length > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <ChartCard title="Requests vs reactivations" subtitle="Last 6 months, from the latest 100 requests">
          {hasHistory ? (
            <ChartContainer config={trendConfig} className="h-[220px] w-full">
              <AreaChart data={trend} accessibilityLayer margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="reactRaised" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1B6AB5" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#1B6AB5" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="reactDone" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3BAD49" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#3BAD49" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Area type="monotone" dataKey="raised" stroke="#1B6AB5" strokeWidth={2} fill="url(#reactRaised)" />
                <Area type="monotone" dataKey="reactivated" stroke="#3BAD49" strokeWidth={2} fill="url(#reactDone)" />
              </AreaChart>
            </ChartContainer>
          ) : (
            <Empty text="No request history yet" />
          )}
        </ChartCard>
      </div>

      <ChartCard title="Status mix" subtitle="All recent requests">
        {hasHistory ? (
          <ChartContainer config={mixConfig} className="mx-auto h-[220px] w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="status" />} />
              <Pie data={statusMix} dataKey="value" nameKey="status" innerRadius={50} outerRadius={80} paddingAngle={3} strokeWidth={0}>
                {statusMix.map(s => (
                  <Cell key={s.status} fill={s.fill} />
                ))}
              </Pie>
              <ChartLegend content={<ChartLegendContent nameKey="status" />} />
            </PieChart>
          </ChartContainer>
        ) : (
          <Empty text="No request history yet" />
        )}
      </ChartCard>

      <div className={hasHistory ? "" : "lg:col-span-3"}>
        <ChartCard title="Open queue aging" subtitle={`Days with current approver · red = past ${SLA_DAYS}-day SLA`}>
          {queue.length > 0 ? (
            <ChartContainer config={agingConfig} className="h-[200px] w-full">
              <BarChart data={aging} accessibilityLayer margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="range" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                  {aging.map(b => (
                    <Cell key={b.range} fill={b.over ? "#ef4444" : "#1B6AB5"} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          ) : (
            <Empty text="Nothing waiting. Queue is clear" />
          )}
        </ChartCard>
      </div>

      {hasHistory && (
        <div className="lg:col-span-2">
          <ChartCard title="Time away before rejoining" subtitle="Days between exit and the proposed rejoin date">
            <ChartContainer config={gapConfig} className="h-[200px] w-full">
              <BarChart data={gaps} accessibilityLayer margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="range" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Bar dataKey="count" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </ChartCard>
        </div>
      )}
    </div>
  );
}
