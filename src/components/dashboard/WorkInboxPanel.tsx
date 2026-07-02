import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, AlertCircle, ChevronRight, Clock } from "lucide-react";
import { Link } from "react-router-dom";

export interface WorkInboxItem {
  id: string | number;
  title: string;
  module_code: string;
  priority?: "high" | "medium" | "low";
  due_date?: string;
  description?: string;
}

export interface WorkInboxPanelProps {
  maxItems?: number;
}

const MODULE_COLORS: Record<string, string> = {
  ats: "bg-blue-100 text-blue-700 border-blue-200",
  payroll: "bg-violet-100 text-violet-700 border-violet-200",
  leave: "bg-amber-100 text-amber-700 border-amber-200",
  attendance: "bg-cyan-100 text-cyan-700 border-cyan-200",
  employees: "bg-emerald-100 text-emerald-700 border-emerald-200",
  wfm: "bg-indigo-100 text-indigo-700 border-indigo-200",
  exit: "bg-red-100 text-red-700 border-red-200",
  kpi: "bg-orange-100 text-orange-700 border-orange-200",
  lms: "bg-teal-100 text-teal-700 border-teal-200",
  assets: "bg-pink-100 text-pink-700 border-pink-200",
};

function moduleColor(code: string): string {
  return MODULE_COLORS[code?.toLowerCase()] ?? "bg-slate-100 text-slate-600 border-slate-200";
}

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  high: { label: "High", className: "bg-red-100 text-red-700 border-red-200" },
  medium: { label: "Medium", className: "bg-amber-100 text-amber-700 border-amber-200" },
  low: { label: "Low", className: "bg-slate-100 text-slate-500 border-slate-200" },
};

function isOverdue(dueDateStr?: string): boolean {
  if (!dueDateStr) return false;
  return new Date(dueDateStr) < new Date();
}

function formatDueDate(dueDateStr?: string): string {
  if (!dueDateStr) return "";
  const d = new Date(dueDateStr);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WorkInboxPanel({ maxItems = 5 }: WorkInboxPanelProps) {
  const [items, setItems] = useState<WorkInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<string | number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch("/api/work-inbox/my")
      .then((res) => {
        if (!res.ok) throw new Error(`Error ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          const list: WorkInboxItem[] = Array.isArray(json)
            ? json
            : json.items ?? json.data ?? [];
          setItems(list);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Failed to load work inbox.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleComplete(id: string | number) {
    setCompletedIds((prev) => new Set([...prev, id]));
  }

  const visibleItems = items
    .filter((item) => !completedIds.has(item.id))
    .slice(0, maxItems);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="font-semibold text-slate-800 text-sm">Work Inbox</h3>
        {!loading && !error && items.length > 0 && (
          <span className="text-xs text-slate-400">{items.length - completedIds.size} pending</span>
        )}
      </div>

      {loading && (
        <div className="p-4 space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && visibleItems.length === 0 && (
        <div className="py-10 flex flex-col items-center gap-2 text-slate-400">
          <Check className="h-6 w-6 text-emerald-400" />
          <span className="text-sm">Your inbox is clear.</span>
        </div>
      )}

      {!loading && !error && visibleItems.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {visibleItems.map((item) => {
            const overdue = isOverdue(item.due_date);
            const priority = item.priority
              ? PRIORITY_CONFIG[item.priority]
              : null;

            return (
              <li key={item.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
                        moduleColor(item.module_code)
                      )}
                    >
                      {item.module_code}
                    </span>
                    {priority && (
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-semibold",
                          priority.className
                        )}
                      >
                        {priority.label}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-800 font-medium truncate">{item.title}</p>
                  {item.due_date && (
                    <p
                      className={cn(
                        "text-xs mt-0.5 flex items-center gap-1",
                        overdue ? "text-red-600 font-medium" : "text-slate-400"
                      )}
                    >
                      <Clock className="h-3 w-3" />
                      {overdue ? "Overdue · " : "Due · "}
                      {formatDueDate(item.due_date)}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleComplete(item.id)}
                  className="shrink-0 mt-1 h-7 w-7 rounded-full border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 flex items-center justify-center transition-colors"
                  title="Mark complete"
                >
                  <Check className="h-3.5 w-3.5 text-slate-400 hover:text-emerald-600" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!loading && !error && (
        <div className="px-4 py-2 border-t border-slate-100">
          <Link
            to="/work-inbox"
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            View All
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
