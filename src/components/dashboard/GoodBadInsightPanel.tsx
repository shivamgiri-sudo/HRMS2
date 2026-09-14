import React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, CheckCircle2, AlertCircle } from "lucide-react";

export interface InsightItem {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "flat";
  unit?: string;
}

export interface GoodBadInsightPanelProps {
  good: {
    count: number;
    items: InsightItem[];
  };
  bad: {
    count: number;
    items: InsightItem[];
  };
  loading?: boolean;
}

function TrendIcon({ trend }: { trend?: "up" | "down" | "flat" }) {
  if (trend === "up") return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />;
  if (trend === "down") return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
  return <Minus className="h-3.5 w-3.5 text-slate-400" />;
}

function InsightList({
  items,
  emptyMessage,
}: {
  items: InsightItem[];
  emptyMessage: string;
}) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-slate-400 py-2">{emptyMessage}</p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex items-center justify-between text-sm py-1 border-b border-slate-100 last:border-0"
        >
          <span className="text-slate-700 truncate mr-2">{item.label}</span>
          <span className="flex items-center gap-1 shrink-0 text-slate-900 font-medium">
            <TrendIcon trend={item.trend} />
            {item.value}
            {item.unit && (
              <span className="text-slate-400 font-normal text-xs">{item.unit}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function GoodBadInsightPanel({
  good,
  bad,
  loading = false,
}: GoodBadInsightPanelProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border p-4 space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {/* On Track Panel */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <span className="font-semibold text-emerald-800">On Track</span>
          <span className="ml-auto rounded-full bg-emerald-200 text-emerald-800 text-xs font-bold px-2 py-0.5">
            {good.count}
          </span>
        </div>
        <InsightList
          items={good.items}
          emptyMessage="No items on track."
        />
      </div>

      {/* Needs Attention Panel */}
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
          <span className="font-semibold text-red-800">Needs Attention</span>
          <span className="ml-auto rounded-full bg-red-200 text-red-800 text-xs font-bold px-2 py-0.5">
            {bad.count}
          </span>
        </div>
        <InsightList
          items={bad.items}
          emptyMessage="No items need attention."
        />
      </div>
    </div>
  );
}
