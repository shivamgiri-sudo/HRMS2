import * as React from "react";
import { cn } from "@/lib/utils";

export type PillTone = "neutral" | "green" | "amber" | "red" | "blue" | "violet";

const TONE: Record<PillTone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  blue: "bg-blue-50 text-blue-800 ring-blue-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
};

/** Dot + label pill. Colour is never the only signal — the label always renders. */
export function StatusPill({ tone = "neutral", children, dot = true, className }: { tone?: PillTone; children: React.ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", TONE[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export default StatusPill;
