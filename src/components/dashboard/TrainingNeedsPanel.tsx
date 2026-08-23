/**
 * TrainingNeedsPanel — Compact TNI card for Manager dashboard.
 * Fetches from GET /api/management/tni
 */
import { useQuery } from "@tanstack/react-query";
import { Loader, AlertTriangle, GraduationCap, BookOpen } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface TniRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  skill_gap: string;
  recommended_training: string;
  priority?: "high" | "medium" | "low";
  status?: string;
}

function PriorityDot({ priority }: { priority?: string }) {
  const colors: Record<string, string> = {
    high: "bg-red-500",
    medium: "bg-amber-500",
    low: "bg-slate-400",
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[priority ?? "low"] ?? colors.low}`} />;
}

export function TrainingNeedsPanel() {
  const { data: records, isLoading, error } = useQuery<TniRecord[], Error>({
    queryKey: ["management", "tni"],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: TniRecord[] }>("/api/management/tni");
      return (res as { success: boolean; data: TniRecord[] }).data ?? [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
  });

  const items = records ?? [];

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white shadow-sm overflow-hidden transition-all hover:shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-amber-50/60 to-orange-50/40 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-100 p-2.5">
            <GraduationCap className="h-5 w-5 text-amber-700" />
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-900">Training Needs Identification</h3>
            <p className="text-xs text-slate-500">
              {isLoading ? "Loading..." : `${items.length} gap${items.length !== 1 ? "s" : ""} identified`}
            </p>
          </div>
        </div>
        {items.length > 0 && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
            {items.filter((i) => i.priority === "high").length} High Priority
          </span>
        )}
      </div>

      {/* Content */}
      <div className="px-5 py-4">
        {isLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="font-medium">Failed to load TNI data: {error.message}</span>
          </div>
        )}

        {!isLoading && !error && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <BookOpen className="mb-3 h-10 w-10 opacity-30" />
            <p className="font-semibold text-sm">No training needs identified</p>
            <p className="text-xs mt-1">All team members are meeting skill benchmarks</p>
          </div>
        )}

        {!isLoading && !error && items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Employee</th>
                  <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Skill Gap</th>
                  <th className="pb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Recommended Training</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.slice(0, 10).map((item) => (
                  <tr key={item.id} className="group transition-colors hover:bg-slate-50/80">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <PriorityDot priority={item.priority} />
                        <span className="text-sm font-semibold text-slate-900">{item.employee_name}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {item.skill_gap}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="text-xs font-medium text-slate-600">{item.recommended_training}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length > 10 && (
              <p className="mt-3 text-center text-xs font-semibold text-slate-400">
                + {items.length - 10} more records
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
