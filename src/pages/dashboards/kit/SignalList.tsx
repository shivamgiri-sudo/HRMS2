import { Link } from "react-router-dom";
import { CheckCircle2, Eye, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InsightSignal } from "../../../../backend/src/modules/dashboards/role-insights/types";
import { Panel } from "./Panel";

const KIND = {
  good: { icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-700", head: "Going well" },
  bad: { icon: TriangleAlert, cls: "bg-rose-50 text-rose-700", head: "Needs attention" },
  watch: { icon: Eye, cls: "bg-amber-50 text-amber-700", head: "Watch" },
} as const;

/** Auto-computed good / bad / watch signals, each linking to the page that explains it. */
export function SignalList({ signals, title = "Insights", loading }: { signals: InsightSignal[] | undefined; title?: string; loading?: boolean }) {
  const order = ["bad", "watch", "good"] as const;
  const list = [...(signals ?? [])].sort((a, b) => order.indexOf(a.tone) - order.indexOf(b.tone));
  return (
    <Panel title={title} subtitle={loading ? "Analysing…" : `${list.filter((s) => s.tone === "bad").length} need attention · ${list.filter((s) => s.tone === "good").length} going well`} bodyClassName="p-0">
      {!list.length ? <p className="p-4 text-[12px] text-slate-400">{loading ? "Analysing…" : "No signals for this scope yet."}</p> : (
        <ul className="divide-y divide-slate-100">
          {list.map((s, i) => {
            const k = KIND[s.tone];
            const Icon = k.icon;
            const row = (
              <div className="flex items-start gap-3 px-4 py-3">
                <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", k.cls)}><Icon className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold text-slate-800">{s.title}</p><p className="mt-0.5 text-[12px] leading-4 text-slate-500">{s.detail}</p></div>
                {s.value !== undefined && s.value !== null ? <span className="kit-num shrink-0 text-[14px] font-extrabold text-slate-900">{s.value}</span> : null}
              </div>
            );
            return <li key={`${s.title}-${i}`}>{s.href ? <Link to={s.href} className="block transition hover:bg-slate-50">{row}</Link> : row}</li>;
          })}
        </ul>
      )}
    </Panel>
  );
}
