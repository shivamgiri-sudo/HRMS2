import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Insight } from "./useOpsCommand";

const STYLE: Record<Insight["severity"], { icon: typeof Info; ring: string; text: string }> = {
  critical: { icon: AlertOctagon, ring: "border-rose-500/40 bg-rose-500/5", text: "text-rose-600 dark:text-rose-400" },
  warning: { icon: AlertTriangle, ring: "border-amber-500/40 bg-amber-500/5", text: "text-amber-600 dark:text-amber-400" },
  info: { icon: Info, ring: "border-sky-500/30 bg-sky-500/5", text: "text-sky-600 dark:text-sky-400" },
  good: { icon: CheckCircle2, ring: "border-emerald-500/40 bg-emerald-500/5", text: "text-emerald-600 dark:text-emerald-400" },
};

interface Props {
  insights: Insight[] | undefined;
  loading: boolean;
  onOpen: (i: Insight) => void;
}

/** "What should I look at first": rule-based, each line is checkable against a table on the page. */
export function OpsInsights({ insights, loading, onOpen }: Props) {
  return (
    <section aria-label="Insights" className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">What needs attention</h2>
        <p className="text-xs text-muted-foreground">Auto-detected from this scope and period · click to jump to the detail</p>
      </div>
      {loading && !insights ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>
      ) : !insights?.length ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nothing stands out for this selection.</p>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {insights.map((i) => {
            const st = STYLE[i.severity];
            const Icon = st.icon;
            return (
              <li key={i.id}>
                <button type="button" onClick={() => onOpen(i)} disabled={!i.action}
                  className={cn("flex w-full items-start gap-3 rounded-lg border p-3 text-left transition hover:shadow-sm disabled:cursor-default", st.ring)}>
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", st.text)} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{i.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{i.detail}</span>
                  </span>
                  {i.action && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
