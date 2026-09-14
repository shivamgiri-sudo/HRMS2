/**
 * TrainingList — List of agents who need training, with skill gaps highlighted.
 */
import { Loader, AlertTriangle, GraduationCap } from "lucide-react";
import { useTrainingNeeds, type TrainingNeed } from "@/hooks/useManagementDashboard";

function PriorityBadge({ priority }: { priority: TrainingNeed["priority"] }) {
  const map: Record<TrainingNeed["priority"], string> = {
    high: "bg-red-100 text-red-800",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${map[priority]}`}>
      {priority}
    </span>
  );
}

function ScoreBar({ current, target }: { current: number; target: number }) {
  const pct = Math.min(100, Math.round((current / Math.max(target, 1)) * 100));
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 text-right text-xs font-semibold text-slate-500">
        {current} / {target}
      </span>
    </div>
  );
}

export function TrainingList() {
  const { data, isLoading, error } = useTrainingNeeds();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        Failed to load training needs: {error.message}
      </div>
    );
  }

  const needs = data ?? [];

  if (needs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <GraduationCap className="mb-3 h-10 w-10 opacity-30" />
        <p className="font-semibold">No training gaps identified.</p>
      </div>
    );
  }

  // Group by priority for display
  const high = needs.filter((n) => n.priority === "high");
  const medium = needs.filter((n) => n.priority === "medium");
  const low = needs.filter((n) => n.priority === "low");

  const groups: { label: string; items: TrainingNeed[] }[] = [
    { label: "High Priority", items: high },
    { label: "Medium Priority", items: medium },
    { label: "Low Priority", items: low },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-amber-50 p-2.5 text-amber-700">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div>
          <p className="font-black text-slate-950">{needs.length} agents need training</p>
          <p className="text-xs text-slate-500">
            {high.length} high · {medium.length} medium · {low.length} low priority
          </p>
        </div>
      </div>

      {groups.map(({ label, items }) => (
        <div key={label}>
          <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">{label}</p>
          <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
            <div className="divide-y">
              {items.map((need) => (
                <div key={`${need.agent_id}-${need.skill_gap}`} className="p-5 transition-colors hover:bg-slate-50/80">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-950">{need.agent_name}</p>
                      <p className="font-mono text-xs text-slate-400">{need.agent_id}</p>
                    </div>
                    <PriorityBadge priority={need.priority} />
                  </div>
                  <div className="mb-2">
                    <p className="mb-1 text-xs font-semibold text-slate-600">
                      Skill gap:{" "}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                        {need.skill_gap}
                      </span>
                    </p>
                  </div>
                  <ScoreBar current={need.current_score} target={need.target_score} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
