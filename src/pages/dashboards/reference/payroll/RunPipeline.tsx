import { Link } from "react-router-dom";
import { AlertOctagon, Check, CircleDashed, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Pipeline, StageState } from "./payrollModel";

const LOOK: Record<StageState, { ring: string; chip: string; label: string }> = {
  done: { ring: "ring-emerald-200 bg-emerald-50", chip: "bg-emerald-500 text-white", label: "Done" },
  current: { ring: "ring-amber-300 bg-amber-50", chip: "bg-amber-500 text-white", label: "Waiting here" },
  blocked: { ring: "ring-rose-300 bg-rose-50", chip: "bg-rose-500 text-white", label: "Blocked" },
  pending: { ring: "ring-slate-200 bg-white", chip: "bg-slate-200 text-slate-700", label: "Not started" },
  unknown: { ring: "ring-slate-200 border-dashed bg-white", chip: "bg-slate-100 text-slate-500", label: "No record" },
};

function StageIcon({ state, index }: { state: StageState; index: number }) {
  if (state === "done") return <Check className="h-4 w-4" aria-hidden />;
  if (state === "blocked") return <AlertOctagon className="h-4 w-4" aria-hidden />;
  if (state === "current") return <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />;
  if (state === "unknown") return <CircleDashed className="h-4 w-4" aria-hidden />;
  return <span className="text-[12px] font-bold">{index + 1}</span>;
}

/**
 * The run pipeline: attendance lock -> prep -> validation -> approval -> disbursal -> statutory -> payslips.
 * Each step links to the page where it is worked, and the step the run is stuck at is highlighted.
 */
export function RunPipeline({ pipeline }: { pipeline: Pipeline }) {
  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" aria-label="Payroll run pipeline">
      {pipeline.stages.map((stage, i) => {
        const look = LOOK[stage.state];
        return (
          <li key={stage.key} aria-current={stage.state === "current" || stage.state === "blocked" ? "step" : undefined}>
            <Link
              to={stage.href}
              className={cn("flex h-full flex-col gap-2 rounded-2xl p-3 text-slate-900 ring-1 transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500", look.ring, stage.state === "unknown" && "border border-dashed border-white/30")}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={cn("flex h-7 w-7 items-center justify-center rounded-full", look.chip)}><StageIcon state={stage.state} index={i} /></span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{look.label}</span>
              </span>
              <span className="text-[13px] font-bold leading-tight">{stage.label}</span>
              <span className="text-[11px] leading-snug text-slate-600">{stage.detail}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
