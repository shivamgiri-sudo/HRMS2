import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { StatusPill, type PillTone } from "@/components/wfm/console/StatusPill";
import { shrinkTone, fmtPct } from "./trendsCalc";

export const chartColor = (n: number) => `hsl(var(--chart-${n}))`;
export const TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" } as const;
export const TIP = { fontSize: 12, borderRadius: 6, border: "1px solid hsl(var(--border))", background: "hsl(var(--popover))", color: "hsl(var(--popover-foreground))" } as const;

const PILL: Record<string, PillTone> = { green: "green", amber: "amber", red: "red", neutral: "neutral" };

/** Percentage with a status pill; the label is always the number so colour is never the only signal. */
export function ShrinkPill({ pct }: { pct: number | null | undefined }) {
  return <StatusPill tone={PILL[shrinkTone(pct)]}>{fmtPct(pct)}</StatusPill>;
}

/** Skeleton / error / data switch for drawer bodies. */
export function QueryBody<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading details">
        {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-md bg-slate-100 motion-reduce:animate-none" />)}
      </div>
    );
  }
  if (query.error || !query.data) {
    const msg = query.error instanceof Error ? query.error.message : "Unknown error";
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">Could not load details</p>
          <p className="text-xs">{msg}</p>
          <button type="button" onClick={() => void query.refetch()} className="mt-2 min-h-[32px] cursor-pointer rounded-md border border-amber-300 px-2 text-xs font-medium hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Retry</button>
        </div>
      </div>
    );
  }
  return <>{children(query.data)}</>;
}

export function NoneNote({ children = "None" }: { children?: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}

/** Truncation / scope caveat under a table. */
export function Caveat({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-xs text-slate-600">{children}</p>;
}
