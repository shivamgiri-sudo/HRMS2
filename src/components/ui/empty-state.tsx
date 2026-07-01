/**
 * EmptyState — universal zero-data placeholder.
 *
 * Usage:
 *   <EmptyState
 *     icon={<Users className="h-8 w-8" />}
 *     title="No employees found"
 *     description="Try adjusting your search or filters."
 *     action={<Button onClick={onAdd}>Add Employee</Button>}
 *   />
 *
 * Variants:
 *   - "default"  : centered card with icon, title, description, optional action
 *   - "inline"   : compact horizontal strip (use inside table cells / small panels)
 *   - "fullpage" : vertically centered, full available height (use for whole-page empty)
 */

import * as React from "react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  /** Lucide icon element or any ReactNode placed in the icon slot. */
  icon?: React.ReactNode;
  /** Main heading — keep to one short phrase. */
  title: string;
  /** Supporting copy — one sentence, explain what the user can do. */
  description?: string;
  /** Primary CTA button / link placed below description. */
  action?: React.ReactNode;
  /** Secondary CTA (e.g. "Learn more" link). */
  secondaryAction?: React.ReactNode;
  /** Visual weight of the empty state. */
  variant?: "default" | "inline" | "fullpage";
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  variant = "default",
  className,
}: EmptyStateProps) {
  if (variant === "inline") {
    return (
      <div
        role="status"
        aria-label={title}
        className={cn(
          "flex items-center gap-3 rounded-lg border border-dashed bg-muted/30 px-4 py-3 text-sm text-muted-foreground",
          className
        )}
      >
        {icon && (
          <span className="shrink-0 text-muted-foreground/60" aria-hidden>
            {icon}
          </span>
        )}
        <span className="font-medium text-foreground">{title}</span>
        {description && <span className="hidden sm:inline">— {description}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label={title}
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-muted/20 px-6 py-12 text-center",
        variant === "fullpage" && "min-h-[60vh]",
        className
      )}
    >
      {icon && (
        <div
          aria-hidden
          className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground/60"
        >
          {icon}
        </div>
      )}

      <div className="max-w-sm space-y-1.5">
        <p className="text-base font-semibold text-foreground">{title}</p>
        {description && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>

      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
