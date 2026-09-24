import * as React from "react";
import { cn } from "@/lib/utils";

export interface PanelHeaderProps {
  title: string;
  description?: React.ReactNode;
  icon?: React.ElementType;
  /** Renders a small green "Live" badge next to the title. */
  live?: boolean;
  /** e.g. "Updated 10:42" */
  updatedLabel?: string;
  actions?: React.ReactNode;
  className?: string;
}

/** Compact in-panel section header (no banner, no gradient). */
export function PanelHeader({ title, description, icon: Icon, live, updatedLabel, actions, className }: PanelHeaderProps) {
  return (
    <div className={cn("mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-primary" aria-hidden />}
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {live && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 motion-safe:animate-pulse" aria-hidden />
              Live
            </span>
          )}
          {updatedLabel && <span className="text-xs text-slate-600">{updatedLabel}</span>}
        </div>
        {description && <p className="mt-0.5 text-xs text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export default PanelHeader;
