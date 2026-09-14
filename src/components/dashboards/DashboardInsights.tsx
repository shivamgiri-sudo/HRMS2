import { useState } from "react";
import { ChevronDown, CheckCircle2, Flag, Circle, Lightbulb } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface InsightBadge {
  type: "highlight" | "lowlight" | "neutral";
  label: string;
}

export interface InsightBlock {
  type: "hl" | "ll" | "gd";
  label: string;
  text: string;
}

export interface InsightRow {
  id: string;
  name: string;
  sub: string;
  badges: InsightBadge[];
  blocks: InsightBlock[];
}

export interface InsightsData {
  callout: string | null;
  rows: InsightRow[];
}

const badgeClass: Record<InsightBadge["type"], string> = {
  highlight: "text-emerald-700 bg-emerald-500/14 dark:text-emerald-400",
  lowlight: "text-rose-700 bg-rose-500/14 dark:text-rose-400",
  neutral: "text-slate-500 bg-slate-500/10 dark:text-slate-400",
};
const blockClass: Record<InsightBlock["type"], string> = {
  hl: "text-emerald-600 dark:text-emerald-400",
  ll: "text-rose-600 dark:text-rose-400",
  gd: "text-primary",
};
function BadgeIcon({ type }: { type: InsightBadge["type"] }) {
  if (type === "highlight") return <CheckCircle2 className="h-3 w-3" aria-hidden />;
  if (type === "lowlight") return <Flag className="h-3 w-3" aria-hidden />;
  return <Circle className="h-1.5 w-1.5 fill-current" aria-hidden />;
}
function BlockIcon({ type }: { type: InsightBlock["type"] }) {
  if (type === "hl") return <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />;
  if (type === "ll") return <Flag className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />;
  return <Circle className="h-1.5 w-1.5 mt-1.5 shrink-0 fill-current" aria-hidden />;
}

/**
 * Peer-comparison insights (highlight / lowlight / guidance) for whatever level is currently
 * displayed. Deliberately level-agnostic: at "process" level a lowlight names the weakest
 * process; drill to "analyst" level within a team and the same component names the analyst
 * needing attention — no separate "top performer" feature required, since the node shape
 * (and this comparison logic) is identical at every level of the same API.
 */
export function DashboardInsights({ data }: { data: InsightsData }) {
  const [openId, setOpenId] = useState<string | null>(data.rows[0]?.id ?? null);

  if (data.rows.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-[17px] w-[17px] text-amber-600 dark:text-amber-400" aria-hidden />
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">AI Insights</h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">— highlight, lowlight and guidance for each row shown below</span>
      </div>

      {data.callout && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/12 to-transparent p-3.5">
          <Lightbulb className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <p className="text-sm leading-relaxed">
            <b className="text-amber-700 dark:text-amber-400">Floor-wide pattern — </b>
            {data.callout}
          </p>
        </div>
      )}

      <Card className="overflow-hidden rounded-2xl border-slate-200 dark:border-slate-800 p-0">
        {data.rows.map((row, i) => {
          const open = openId === row.id;
          return (
            <div key={row.id} className={cn(i > 0 && "border-t border-slate-200 dark:border-slate-800")}>
              <button
                onClick={() => setOpenId(open ? null : row.id)}
                aria-expanded={open}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/60",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                )}
              >
                <span className="min-w-[170px] shrink-0">
                  <span className="block text-sm font-bold">{row.name}</span>
                  <span className="block font-mono text-[10px] text-slate-500 dark:text-slate-400">{row.sub}</span>
                </span>
                <span className="flex flex-1 flex-wrap gap-1.5">
                  {row.badges.map((b, bi) => (
                    <span key={bi} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", badgeClass[b.type])}>
                      <BadgeIcon type={b.type} />
                      {b.label}
                    </span>
                  ))}
                </span>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} aria-hidden />
              </button>
              {open && (
                <div className="grid gap-2.5 px-4 pb-4">
                  {row.blocks.map((b, bi) => (
                    <div key={bi} className="flex items-start gap-2 text-sm leading-relaxed">
                      <span className={blockClass[b.type]}><BlockIcon type={b.type} /></span>
                      <span>
                        <b className={blockClass[b.type]}>{b.label} — </b>
                        {b.text}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}

interface QualityInsightNode {
  id: string;
  name: string;
  secondaryLabel: string | null;
  agentCount: number;
  callsAudited: number;
  avgQualityPct: number | null;
}

export function computeQualityInsights(nodes: QualityInsightNode[], levelNoun: string): InsightsData {
  if (nodes.length === 0) return { callout: null, rows: [] };
  const scored = nodes.filter((n) => n.avgQualityPct !== null);
  const totalCalls = nodes.reduce((s, n) => s + n.callsAudited, 0);
  const weightedAvg = scored.length
    ? scored.reduce((s, n) => s + (n.avgQualityPct ?? 0) * n.callsAudited, 0) / scored.reduce((s, n) => s + n.callsAudited, 0)
    : null;
  const maxQ = scored.length ? Math.max(...scored.map((n) => n.avgQualityPct as number)) : null;
  const minQ = scored.length ? Math.min(...scored.map((n) => n.avgQualityPct as number)) : null;
  const maxCalls = Math.max(...nodes.map((n) => n.callsAudited));
  const gaps = nodes.filter((n) => n.avgQualityPct === null && n.callsAudited > 0);

  const callout = gaps.length
    ? `${gaps.map((g) => g.name).join(", ")} ${gaps.length === 1 ? "has" : "have"} calls audited this period but not one carries a quality score — that reads as a scoring-pipeline gap, not evidence of good or bad performance. Worth fixing before it's mistaken for either.`
    : null;

  const rows: InsightRow[] = nodes.map((n) => {
    const share = totalCalls ? (n.callsAudited / totalCalls) * 100 : 0;
    const perAgent = n.agentCount ? Math.round(n.callsAudited / n.agentCount) : null;
    const badges: InsightBadge[] = [];
    const blocks: InsightBlock[] = [];

    if (n.avgQualityPct === null) {
      badges.push({ type: "lowlight", label: n.callsAudited > 0 ? "No scores yet" : "No calls yet" });
      if (n.callsAudited > 0) {
        blocks.push({ type: "ll", label: "Lowlight", text: `${n.callsAudited.toLocaleString()} calls audited, none scored — the QA pipeline hasn't completed here this period.` });
        blocks.push({ type: "gd", label: "Guidance", text: `Confirm the audit form and parameter mapping are active for this ${levelNoun}, then clear the backlog before drawing any performance conclusion.` });
      } else {
        blocks.push({ type: "gd", label: "Guidance", text: `No audited calls in the selected range yet.` });
      }
    } else {
      const diff = maxQ !== null && weightedAvg !== null ? n.avgQualityPct - weightedAvg : 0;
      if (n.avgQualityPct === maxQ) badges.push({ type: "highlight", label: `Top ${levelNoun}` });
      else if (diff >= 3) badges.push({ type: "highlight", label: `+${diff.toFixed(1)}pp vs floor` });
      if (n.avgQualityPct === minQ) badges.push({ type: "lowlight", label: "Needs attention" });
      else if (diff <= -3) badges.push({ type: "lowlight", label: `${diff.toFixed(1)}pp vs floor` });
      if (n.avgQualityPct < 50 && n.avgQualityPct !== minQ) badges.push({ type: "lowlight", label: "Below 50% pass bar" });
      if (n.callsAudited === maxCalls) badges.push({ type: "neutral", label: `${share.toFixed(0)}% of audited volume` });
      if (badges.length === 0) badges.push({ type: "neutral", label: "In line with the floor" });

      if (n.avgQualityPct === maxQ) blocks.push({ type: "hl", label: "Highlight", text: `Highest quality score at ${n.avgQualityPct}% — ${diff.toFixed(1)}pp above the ${weightedAvg?.toFixed(1)}% floor average.` });
      else if (diff >= 3) blocks.push({ type: "hl", label: "Highlight", text: `${diff.toFixed(1)} points above the floor average of ${weightedAvg?.toFixed(1)}%.` });

      if (n.avgQualityPct === minQ) blocks.push({ type: "ll", label: "Lowlight", text: `Lowest quality score at ${n.avgQualityPct}% — ${Math.abs(diff).toFixed(1)}pp below the ${weightedAvg?.toFixed(1)}% floor average.` });
      else if (diff <= -3) blocks.push({ type: "ll", label: "Lowlight", text: `${Math.abs(diff).toFixed(1)} points below the floor average.` });
      else if (n.avgQualityPct < 50) blocks.push({ type: "ll", label: "Lowlight", text: `Sits below the 50% pass threshold at ${n.avgQualityPct}%.` });

      if (!blocks.some((b) => b.type === "hl" || b.type === "ll")) blocks.push({ type: "hl", label: "On par", text: `Tracking within 3 points of the floor average${weightedAvg !== null ? ` (${weightedAvg.toFixed(1)}%)` : ""} — no outlier signal either way.` });

      blocks.push({ type: "gd", label: "Call load", text: `${n.callsAudited.toLocaleString()} calls audited across ${n.agentCount} agent${n.agentCount === 1 ? "" : "s"}${perAgent !== null ? ` (~${perAgent}/agent)` : ""} — ${share.toFixed(1)}% of all calls audited in this view.` });

      let guidance: string;
      if (n.avgQualityPct === minQ) guidance = `Prioritise for a calibration session and a fatal-error review of its lowest-scoring calls before the next audit cycle.`;
      else if (diff <= -3) guidance = `Below the floor average — worth a spot check of recent calls to see if this is agent-level or script-level.`;
      else if (n.avgQualityPct === maxQ) guidance = `Document what's being done differently here — a candidate model for coaching the rest of the floor.`;
      else guidance = `Tracking close to the floor average — routine monitoring is enough for now.`;
      blocks.push({ type: "gd", label: "Guidance", text: guidance });
    }

    return { id: n.id, name: n.name, sub: `${n.callsAudited.toLocaleString()} calls · ${n.agentCount} agent${n.agentCount === 1 ? "" : "s"}`, badges, blocks };
  });

  return { callout, rows };
}

interface OpsInsightNode {
  id: string;
  name: string;
  secondaryLabel: string | null;
  headcount: number;
  presentRatePct: number | null;
  absentRatePct: number | null;
  lateRatePct: number | null;
}

export function computeOpsInsights(nodes: OpsInsightNode[], levelNoun: string): InsightsData {
  if (nodes.length === 0) return { callout: null, rows: [] };
  const withRate = nodes.filter((n) => n.presentRatePct !== null);
  const totalHc = nodes.reduce((s, n) => s + n.headcount, 0);
  const wPresent = withRate.length ? withRate.reduce((s, n) => s + (n.presentRatePct ?? 0) * n.headcount, 0) / withRate.reduce((s, n) => s + n.headcount, 0) : null;
  const withAbsent = nodes.filter((n) => n.absentRatePct !== null);
  const wAbsent = withAbsent.length ? withAbsent.reduce((s, n) => s + (n.absentRatePct ?? 0) * n.headcount, 0) / withAbsent.reduce((s, n) => s + n.headcount, 0) : null;
  const withLate = nodes.filter((n) => n.lateRatePct !== null);
  const wLate = withLate.length ? withLate.reduce((s, n) => s + (n.lateRatePct ?? 0) * n.headcount, 0) / withLate.reduce((s, n) => s + n.headcount, 0) : null;
  const maxPresent = withRate.length ? Math.max(...withRate.map((n) => n.presentRatePct as number)) : null;
  const minPresent = withRate.length ? Math.min(...withRate.map((n) => n.presentRatePct as number)) : null;
  const maxHc = Math.max(...nodes.map((n) => n.headcount));
  const highLateCount = nodes.filter((n) => n.lateRatePct !== null && n.lateRatePct >= 60).length;

  const callout = highLateCount >= Math.ceil(nodes.length * 0.5) && nodes.length >= 4
    ? `Late-mark rates are elevated across most of this view — ${highLateCount} of ${nodes.length} sit at 60%+${wLate !== null ? ` (weighted average ${wLate.toFixed(1)}%)` : ""}. Broad enough to be worth checking as a shift-time or roster-configuration question before treating any single one as an agent-behaviour outlier.`
    : null;

  const rows: InsightRow[] = nodes.map((n) => {
    const share = totalHc ? (n.headcount / totalHc) * 100 : 0;
    const badges: InsightBadge[] = [];
    const blocks: InsightBlock[] = [];

    if (n.presentRatePct === null) {
      badges.push({ type: "neutral", label: "No attendance data" });
      blocks.push({ type: "gd", label: "Guidance", text: `No attendance records found for this ${levelNoun} in the selected range.` });
    } else {
      const diffP = wPresent !== null ? n.presentRatePct - wPresent : 0;
      if (n.presentRatePct === maxPresent) badges.push({ type: "highlight", label: "Top present rate" });
      else if (diffP >= 3) badges.push({ type: "highlight", label: `+${diffP.toFixed(1)}pp vs floor` });
      if (n.presentRatePct === minPresent) badges.push({ type: "lowlight", label: "Needs attention" });
      else if (diffP <= -3) badges.push({ type: "lowlight", label: `${diffP.toFixed(1)}pp vs floor` });
      if (wAbsent !== null && n.absentRatePct !== null && n.absentRatePct > wAbsent + 2) badges.push({ type: "lowlight", label: "High absence" });
      if (n.lateRatePct !== null && n.lateRatePct >= 80) badges.push({ type: "lowlight", label: "High late rate" });
      if (n.headcount === maxHc) badges.push({ type: "neutral", label: `${share.toFixed(0)}% of headcount shown` });
      if (badges.length === 0) badges.push({ type: "neutral", label: "In line with the floor" });

      if (n.presentRatePct === maxPresent) blocks.push({ type: "hl", label: "Highlight", text: `Highest present rate at ${n.presentRatePct}%${wPresent !== null ? ` — ${diffP.toFixed(1)}pp above the ${wPresent.toFixed(1)}% floor average` : ""}.` });
      else if (diffP >= 3) blocks.push({ type: "hl", label: "Highlight", text: `${diffP.toFixed(1)} points above the present-rate average.` });

      if (n.presentRatePct === minPresent) blocks.push({ type: "ll", label: "Lowlight", text: `Lowest present rate at ${n.presentRatePct}%${wPresent !== null ? ` — ${Math.abs(diffP).toFixed(1)}pp below the floor average` : ""}.` });
      else if (diffP <= -3) blocks.push({ type: "ll", label: "Lowlight", text: `${Math.abs(diffP).toFixed(1)} points below the present-rate average.` });
      if (wAbsent !== null && n.absentRatePct !== null && n.absentRatePct > wAbsent + 2) blocks.push({ type: "ll", label: "Lowlight", text: `Absence sits at ${n.absentRatePct}%, above the ${wAbsent.toFixed(1)}% floor average${n.headcount >= 30 ? ` — at ${n.headcount} headcount this is one of the largest absolute gaps in this view on a given day` : ""}.` });
      if (n.lateRatePct !== null && n.lateRatePct >= 80) blocks.push({ type: "ll", label: "Lowlight", text: `Late-mark rate of ${n.lateRatePct}% is among the highest here — worth checking shift-start configuration specifically.` });
      if (!blocks.some((b) => b.type === "hl" || b.type === "ll")) blocks.push({ type: "hl", label: "On par", text: `Present, absent and late rates are all within a few points of the floor average — no outlier signal.` });

      blocks.push({ type: "gd", label: "Headcount", text: `${n.headcount} on roster — ${share.toFixed(1)}% of the total headcount shown here.` });

      let guidance: string;
      if (n.presentRatePct === minPresent) guidance = `Lowest present rate in this view — worth a shrinkage review before the next roster cycle.`;
      else if (n.lateRatePct !== null && n.lateRatePct >= 80) guidance = `Check shift-start/roster configuration before treating the late rate as an agent-behaviour issue.`;
      else if (diffP <= -3) guidance = `Below the floor average on presence — flag to the manager for the next 1:1.`;
      else guidance = `Tracking close to the floor average — routine monitoring is enough for now.`;
      blocks.push({ type: "gd", label: "Guidance", text: guidance });
    }

    return { id: n.id, name: n.name, sub: `${n.headcount} headcount`, badges, blocks };
  });

  return { callout, rows };
}
