/** Small shared bits for the Analytics sections. */
import { Suspense, type ReactNode } from "react";
import { Calendar } from "lucide-react";
import { ConsoleCard } from "@/components/wfm/console/ConsoleCard";
import { StatusPill, type PillTone } from "@/components/wfm/console/StatusPill";
import type { Tone } from "./calc";
import type { DrawerTarget } from "./types";

export type OpenDrawer = (t: DrawerTarget) => void;

export const toPill = (t: Tone): PillTone => (t === "neutral" ? "neutral" : t);
export const Pill = ({ tone, children }: { tone: Tone; children: ReactNode }) => <StatusPill tone={toPill(tone)}>{children}</StatusPill>;

export function NeedBranch({ what }: { what: string }) {
  return (
    <ConsoleCard className="py-12 text-center text-slate-600">
      <Calendar className="mx-auto mb-3 h-10 w-10 text-slate-400" aria-hidden />
      <p className="font-medium">Select a branch to view {what}</p>
      <p className="mt-1 text-xs">Use the Branch filter above; this view is computed per branch.</p>
    </ConsoleCard>
  );
}

export function KpiSkeletons({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="status" aria-label="Loading metrics">
      {Array.from({ length: n }, (_, i) => <div key={i} className="h-[104px] animate-pulse rounded-lg bg-slate-100" />)}
    </div>
  );
}

export const ChartFallback = () => <div className="h-full animate-pulse rounded-md bg-slate-100" />;
export const Lazy = ({ children }: { children: ReactNode }) => <Suspense fallback={<ChartFallback />}>{children}</Suspense>;

export function ErrorBox({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return (
    <ConsoleCard className="p-4 text-sm text-slate-700" >
      <p role="alert">Could not load {what}{error instanceof Error ? `: ${error.message}` : ""}.</p>
      <button type="button" onClick={onRetry} className="mt-2 min-h-[44px] cursor-pointer rounded-md border border-border px-3 text-xs font-medium hover:bg-muted sm:min-h-0 sm:py-1">Retry</button>
    </ConsoleCard>
  );
}
