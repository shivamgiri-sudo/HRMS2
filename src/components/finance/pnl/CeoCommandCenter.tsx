import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BpoPnlSummary } from "@/hooks/useBpoProcessPnl";
import { PnlDataQualityPanel } from "./PnlDataQualityPanel";
import { CeoProcessScorecard } from "./CeoProcessScorecard";

function compact(value: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

function pct(value: number | null | undefined) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

// ── Zone 1: Six hero KPI tiles ───────────────────────────────────────────────

type HeroTile = {
  label: string;
  value: string;
  tone: "good" | "warning" | "danger" | "neutral";
  sub?: string;
};

function HeroKpiCard({ label, value, tone, sub }: HeroTile) {
  const bg =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "warning"
      ? "border-amber-200 bg-amber-50"
      : tone === "danger"
      ? "border-rose-200 bg-rose-50"
      : "border-slate-200 bg-white";
  const valColor =
    tone === "good"
      ? "text-emerald-800"
      : tone === "warning"
      ? "text-amber-800"
      : tone === "danger"
      ? "text-rose-800"
      : "text-slate-900";
  return (
    <div className={`rounded-2xl border px-4 py-3 ${bg}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60 whitespace-nowrap">{label}</p>
      <p className={`text-2xl font-black tracking-tight mt-1 ${valColor}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function HeroPulse({ kpis }: { kpis: BpoPnlSummary["kpis"] }) {
  const budgetPct =
    kpis.approvedBudget > 0 ? (kpis.consumedBudget / kpis.approvedBudget) * 100 : 0;

  const tiles: HeroTile[] = [
    {
      label: "Recognized Revenue",
      value: compact(kpis.recognizedRevenue),
      tone: "good",
      sub: `Gross potential: ${compact(kpis.grossPotentialRevenue)}`,
    },
    {
      label: "EBITDA",
      value: compact(kpis.ebitda),
      tone: kpis.ebitda >= 0 ? "good" : "danger",
    },
    {
      label: "EBITDA Margin",
      value: pct(kpis.ebitdaMarginPct),
      tone:
        (kpis.ebitdaMarginPct ?? 0) >= 15
          ? "good"
          : (kpis.ebitdaMarginPct ?? 0) >= 0
          ? "warning"
          : "danger",
    },
    {
      label: "PAT",
      value: compact(kpis.pat),
      tone: kpis.pat >= 0 ? "good" : "danger",
      sub: `PBT: ${compact(kpis.pbt)}`,
    },
    {
      label: "Budget Consumed",
      value: pct(budgetPct),
      tone: budgetPct > 95 ? "danger" : budgetPct > 80 ? "warning" : "good",
      sub: `${compact(kpis.consumedBudget)} of ${compact(kpis.approvedBudget)}`,
    },
    {
      label: "Loss-Making Processes",
      value: String(kpis.lossMakingProcesses),
      tone: kpis.lossMakingProcesses > 0 ? "danger" : "good",
      sub: `${kpis.configuredProcesses} of ${kpis.totalProcesses} configured`,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      {tiles.map((t) => (
        <HeroKpiCard key={t.label} {...t} />
      ))}
    </div>
  );
}

// ── Zone 2: Revenue mix panel ────────────────────────────────────────────────

function RevenueMixPanel({
  kpis,
  revenueMix,
}: {
  kpis: BpoPnlSummary["kpis"];
  revenueMix: BpoPnlSummary["revenueMix"];
}) {
  const scale = kpis.grossPotentialRevenue || 1;

  function Bar({
    value,
    color,
    height = "h-2",
  }: {
    value: number;
    color: string;
    height?: string;
  }) {
    const w = Math.max((Math.abs(value) / scale) * 100, value !== 0 ? 1 : 0);
    return (
      <div className={`${height} rounded-full bg-slate-100 overflow-hidden flex-1`}>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(w, 100)}%` }} />
      </div>
    );
  }

  function Row({
    label,
    value,
    color,
    negative = false,
    bold = false,
  }: {
    label: string;
    value: number;
    color: string;
    negative?: boolean;
    bold?: boolean;
  }) {
    return (
      <div className={`flex items-center gap-2 ${bold ? "pt-1" : ""}`}>
        <span className={`w-36 shrink-0 text-[11px] ${bold ? "font-semibold text-slate-900" : "text-slate-500"} whitespace-nowrap`}>
          {negative && value !== 0 && <span className="text-rose-400 mr-0.5">−</span>}
          {label}
        </span>
        <Bar value={value} color={color} height={bold ? "h-4" : "h-2"} />
        <span className={`w-20 shrink-0 text-right text-[11px] ${bold ? "font-bold text-slate-900" : "text-slate-600"}`}>
          {compact(value)}
        </span>
      </div>
    );
  }

  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-950">Revenue structure</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <Row label="Gross potential" value={kpis.grossPotentialRevenue} color="bg-slate-300" />
        <Row label="Base earned" value={revenueMix.baseRevenue} color="bg-emerald-500" />
        <Row label="Min commitment top-up" value={revenueMix.minimumCommitment} color="bg-teal-500" />
        <Row label="Incentives & rewards" value={revenueMix.incentivesAndRewards} color="bg-emerald-400" />
        <Row label="Training & other" value={revenueMix.trainingAndOtherRevenue} color="bg-sky-500" />
        <hr className="border-slate-100" />
        <Row label="Penalties / SLA" value={revenueMix.penaltiesAndSla} color="bg-rose-500" negative />
        <Row label="Credit notes" value={revenueMix.creditNotesAndOtherDeductions} color="bg-rose-400" negative />
        <hr className="border-slate-200" />
        <Row label="Recognized revenue" value={kpis.recognizedRevenue} color="bg-emerald-600" bold />
      </CardContent>
    </Card>
  );
}

// ── Zone 2: Cost mix panel ───────────────────────────────────────────────────

function CostMixPanel({
  kpis,
  costMix,
}: {
  kpis: BpoPnlSummary["kpis"];
  costMix: BpoPnlSummary["costMix"];
}) {
  const revenue = kpis.recognizedRevenue || 1;
  const totalCost = Object.values(costMix).reduce((s, v) => s + (v ?? 0), 0);
  const scale = Math.max(totalCost, revenue);

  const items: { label: string; value: number; dot: string }[] = [
    { label: "Agent salary", value: costMix.agentSalary, dot: "bg-slate-700" },
    { label: "DSC — people", value: costMix.dscPeople, dot: "bg-sky-600" },
    { label: "DSC — non-people", value: costMix.dscNonPeople, dot: "bg-sky-400" },
    { label: "BMC — people", value: costMix.bmcPeople, dot: "bg-amber-600" },
    { label: "BMC — non-people", value: costMix.bmcNonPeople, dot: "bg-amber-400" },
    { label: "Depreciation", value: costMix.depreciation, dot: "bg-violet-500" },
    { label: "Amortization", value: costMix.amortization, dot: "bg-violet-400" },
    { label: "Finance cost", value: costMix.financeCost, dot: "bg-rose-500" },
    { label: "Tax", value: costMix.tax, dot: "bg-rose-400" },
  ];

  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-950">Cost structure</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {items.map(({ label, value, dot }) => {
          const barW = scale > 0 ? Math.max((value / scale) * 100, value > 0 ? 1 : 0) : 0;
          const revPct = revenue > 0 ? (value / revenue) * 100 : 0;
          return (
            <div key={label} className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
              <span className="w-36 shrink-0 text-[11px] text-slate-600 whitespace-nowrap">{label}</span>
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${dot}`} style={{ width: `${Math.min(barW, 100)}%` }} />
              </div>
              <span className="w-12 shrink-0 text-right text-[10px] text-slate-400">{revPct.toFixed(1)}%</span>
              <span className="w-20 shrink-0 text-right text-[11px] text-slate-700">{compact(value)}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Zone 3: Portfolio health panel ───────────────────────────────────────────

function PortfolioHealthPanel({ summary }: { summary: BpoPnlSummary }) {
  const { rows, kpis } = summary;
  const profitable = rows.filter((r) => r.processStatus === "profitable");
  const atRisk = rows.filter((r) => r.processStatus === "at-risk");
  const lossMaking = rows.filter((r) => r.processStatus === "loss-making");

  function groupRevenue(group: typeof rows) {
    return group.reduce((s, r) => s + (r.recognizedRevenue ?? 0), 0);
  }
  function groupAvgEbitda(group: typeof rows) {
    if (!group.length) return null;
    const avg = group.reduce((s, r) => s + (r.ebitdaMarginPct ?? 0), 0) / group.length;
    return avg;
  }

  const totalRevenue = groupRevenue(rows) || 1;
  const profitableRev = groupRevenue(profitable);
  const atRiskRev = groupRevenue(atRisk);
  const lossMakingRev = groupRevenue(lossMaking);

  const statusGroups = [
    {
      label: "Profitable",
      count: profitable.length,
      revenue: profitableRev,
      avgEbitda: groupAvgEbitda(profitable),
      pill: "bg-emerald-100 text-emerald-700",
      barColor: "bg-emerald-500",
      barW: (profitableRev / totalRevenue) * 100,
    },
    {
      label: "At risk",
      count: atRisk.length,
      revenue: atRiskRev,
      avgEbitda: groupAvgEbitda(atRisk),
      pill: "bg-amber-100 text-amber-800",
      barColor: "bg-amber-500",
      barW: (atRiskRev / totalRevenue) * 100,
    },
    {
      label: "Loss-making",
      count: lossMaking.length,
      revenue: lossMakingRev,
      avgEbitda: groupAvgEbitda(lossMaking),
      pill: "bg-rose-100 text-rose-700",
      barColor: "bg-rose-500",
      barW: (lossMakingRev / totalRevenue) * 100,
    },
  ];

  return (
    <Card className="rounded-3xl border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-950">Portfolio health</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {statusGroups.map((g) => (
            <div key={g.label} className={`rounded-2xl border px-3 py-2.5 ${g.pill.replace("text-", "border-").replace("100", "200").split(" ")[0]} bg-white`}>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${g.pill} mb-2`}>
                {g.label}
              </span>
              <div className="text-3xl font-black text-slate-900">{g.count}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{compact(g.revenue)}</div>
              {g.avgEbitda != null && (
                <div className={`text-[10px] mt-0.5 font-semibold ${g.avgEbitda >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  Avg EBITDA {pct(g.avgEbitda)}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Stacked revenue bar */}
        <div>
          <div className="flex h-3 rounded-full overflow-hidden">
            {statusGroups.map((g) => (
              <div
                key={g.label}
                className={g.barColor}
                style={{ width: `${g.barW}%` }}
                title={`${g.label}: ${compact(g.revenue)}`}
              />
            ))}
          </div>
          <div className="flex mt-1.5 gap-4">
            {statusGroups.map((g) => (
              <div key={g.label} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${g.barColor}`} />
                <span className="text-[10px] text-slate-500">{g.label} · {compact(g.revenue)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Workforce mini-stats */}
        <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100 text-center">
          <div>
            <div className="text-lg font-black text-slate-900">{kpis.activeHeadcount}</div>
            <div className="text-[10px] text-slate-400">Active HC</div>
          </div>
          <div>
            <div className="text-lg font-black text-slate-900">{kpis.agentHeadcount}</div>
            <div className="text-[10px] text-slate-400">Agent HC</div>
          </div>
          <div>
            <div className="text-lg font-black text-slate-900">
              {kpis.configuredProcesses}
              <span className="text-sm font-normal text-slate-400">/{kpis.totalProcesses}</span>
            </div>
            <div className="text-[10px] text-slate-400">Configured</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export function CeoCommandCenter({
  summary,
  period,
  onViewAllProcesses,
}: {
  summary: BpoPnlSummary;
  period: string;
  onViewAllProcesses: () => void;
}) {
  return (
    <div className="space-y-4 pb-6">
      {/* Zone 1 — Hero Pulse */}
      <HeroPulse kpis={summary.kpis} />

      {/* Zone 2 — Revenue & Cost structure */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <RevenueMixPanel kpis={summary.kpis} revenueMix={summary.revenueMix} />
        <CostMixPanel kpis={summary.kpis} costMix={summary.costMix} />
      </div>

      {/* Zone 3 — Portfolio health + Alerts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <PortfolioHealthPanel summary={summary} />
        </div>
        <div>
          <PnlDataQualityPanel alerts={summary.alerts.slice(0, 4)} />
        </div>
      </div>

      {/* Zone 4 — Process scorecard */}
      <CeoProcessScorecard rows={summary.rows} period={period} onViewAll={onViewAllProcesses} />
    </div>
  );
}
