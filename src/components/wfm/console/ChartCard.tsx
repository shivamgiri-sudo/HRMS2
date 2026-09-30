import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConsoleCard } from "./ConsoleCard";

export interface ChartCardProps {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: boolean;
  emptyLabel?: string;
  /** Fixed body height so async content never jumps the layout. */
  height?: number;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** Card wrapper for a chart/table with uniform header + loading/error/empty states. */
export function ChartCard({
  title, subtitle, actions, loading, error, onRetry, empty, emptyLabel = "No data for the selected filters",
  height = 240, footer, className, children,
}: ChartCardProps) {
  let body: React.ReactNode = children;
  if (loading) {
    body = <div className="h-full animate-pulse rounded-md bg-slate-100" role="status" aria-label={`Loading ${title}`} />;
  } else if (error) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-slate-600">
        <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
        <span>Could not load {title.toLowerCase()}</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted">
            <RefreshCw className="h-3 w-3" aria-hidden /> Retry
          </button>
        )}
      </div>
    );
  } else if (empty) {
    body = <div className="flex h-full items-center justify-center text-sm text-slate-500">{emptyLabel}</div>;
  }
  return (
    <ConsoleCard className={cn("p-4", className)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-600">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div style={{ height }}>{body}</div>
      {footer && <div className="mt-3 border-t border-border pt-2 text-xs text-slate-600">{footer}</div>}
    </ConsoleCard>
  );
}

export default ChartCard;
