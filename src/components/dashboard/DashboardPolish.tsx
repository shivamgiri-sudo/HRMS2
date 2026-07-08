import React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ActionStripItem {
  label: string;
  value: number | string | null | undefined;
  detail?: string;
  tone?: "red" | "amber" | "blue" | "green";
  onClick?: () => void;
}

const toneClasses: Record<NonNullable<ActionStripItem["tone"]>, string> = {
  red: "border-red-200 bg-red-50 text-red-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

export function DashboardActionStrip({
  title = "Today's Operations - Immediate Actions",
  items,
}: {
  title?: string;
  items: ActionStripItem[];
}) {
  const visibleItems = items.filter((item) => item.value !== null && item.value !== undefined);
  if (visibleItems.length === 0) return null;

  return (
    <section className="rounded-2xl border border-red-100 bg-red-50/45 p-4 shadow-[0_12px_35px_rgba(239,68,68,0.05)]">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-lg bg-red-100 p-1.5 text-red-600">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-black text-slate-900">{title}</h2>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {visibleItems.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className={cn(
              "min-h-[74px] rounded-xl border bg-white px-4 py-3 text-left transition-all",
              "hover:-translate-y-0.5 hover:shadow-md",
              toneClasses[item.tone ?? "red"],
              !item.onClick && "cursor-default hover:translate-y-0 hover:shadow-none",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-wide">{item.label}</p>
              <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-black shadow-sm">
                {item.value}
              </span>
            </div>
            {item.detail && <p className="mt-2 text-xs font-medium opacity-80">{item.detail}</p>}
          </button>
        ))}
      </div>
    </section>
  );
}

export function DashboardCard({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_35px_rgba(15,23,42,0.04)]", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-black text-slate-900">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
