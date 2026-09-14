/**
 * Skeleton variants for the HRMS design system.
 *
 * Built on the base Skeleton primitive. Each variant matches the shape of its
 * real counterpart so the visual jump on load is minimal.
 *
 * Available exports:
 *   SkeletonCard        — matches StatsCard
 *   SkeletonTableRows   — matches any Table (configurable rows/cols)
 *   SkeletonListItem    — single row (avatar + two lines of text)
 *   SkeletonList        — N stacked SkeletonListItems
 *   SkeletonForm        — stacked label+input pairs
 *   SkeletonPageHeader  — PageHeader placeholder
 */

import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ─── SkeletonCard (matches StatsCard) ─────────────────────────────────────────

export interface SkeletonCardProps {
  className?: string;
}

export function SkeletonCard({ className }: SkeletonCardProps) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading card"
      className={cn(
        "rounded-xl border bg-card p-6 shadow-sm",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2.5 w-full">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3.5 w-32" />
        </div>
        <Skeleton className="h-12 w-12 rounded-xl shrink-0" />
      </div>
    </div>
  );
}

// ─── SkeletonTableRows ────────────────────────────────────────────────────────

export interface SkeletonTableRowsProps {
  /** Number of skeleton rows to render. */
  rows?: number;
  /** Number of columns per row. */
  cols?: number;
  /** Show a checkbox column on the left (matches bulk-select tables). */
  showCheckbox?: boolean;
  /** Show an actions column on the right. */
  showActions?: boolean;
  className?: string;
}

export function SkeletonTableRows({
  rows = 5,
  cols = 5,
  showCheckbox = false,
  showActions = false,
  className,
}: SkeletonTableRowsProps) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <tr
          key={rowIdx}
          aria-busy="true"
          aria-label="Loading row"
          className={cn("border-b border-border", className)}
        >
          {showCheckbox && (
            <td className="px-4 py-3">
              <Skeleton className="h-4 w-4 rounded" />
            </td>
          )}

          {/* First col: avatar + name (matches EmployeeTable pattern) */}
          <td className="px-4 py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          </td>

          {Array.from({ length: cols - 1 }).map((_, colIdx) => (
            <td key={colIdx} className="px-4 py-3">
              <Skeleton
                className={cn(
                  "h-3.5",
                  colIdx % 3 === 0 ? "w-20" : colIdx % 3 === 1 ? "w-28" : "w-16"
                )}
              />
            </td>
          ))}

          {showActions && (
            <td className="px-4 py-3">
              <Skeleton className="h-8 w-8 rounded-md ml-auto" />
            </td>
          )}
        </tr>
      ))}
    </>
  );
}

// ─── SkeletonListItem ─────────────────────────────────────────────────────────

export interface SkeletonListItemProps {
  /** Show an avatar circle on the left. */
  showAvatar?: boolean;
  /** Show a badge/pill on the right. */
  showBadge?: boolean;
  className?: string;
}

export function SkeletonListItem({
  showAvatar = true,
  showBadge = false,
  className,
}: SkeletonListItemProps) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading item"
      className={cn("flex items-center gap-3 py-3", className)}
    >
      {showAvatar && <Skeleton className="h-9 w-9 rounded-full shrink-0" />}
      <div className="flex-1 space-y-1.5 min-w-0">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="h-3 w-24" />
      </div>
      {showBadge && <Skeleton className="h-5 w-16 rounded-full shrink-0" />}
    </div>
  );
}

// ─── SkeletonList ─────────────────────────────────────────────────────────────

export interface SkeletonListProps extends SkeletonListItemProps {
  count?: number;
  divided?: boolean;
}

export function SkeletonList({
  count = 5,
  divided = true,
  showAvatar = true,
  showBadge = false,
}: SkeletonListProps) {
  return (
    <div aria-busy="true" aria-label="Loading list">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonListItem
          key={i}
          showAvatar={showAvatar}
          showBadge={showBadge}
          className={cn(divided && i < count - 1 && "border-b border-border")}
        />
      ))}
    </div>
  );
}

// ─── SkeletonForm ─────────────────────────────────────────────────────────────

export interface SkeletonFormProps {
  /** Number of label+input rows. */
  fields?: number;
  /** Show a two-button footer (Cancel + Save). */
  showFooter?: boolean;
  className?: string;
}

export function SkeletonForm({ fields = 4, showFooter = true, className }: SkeletonFormProps) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading form"
      className={cn("space-y-5", className)}
    >
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      ))}
      {showFooter && (
        <div className="flex justify-end gap-2 pt-2">
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      )}
    </div>
  );
}

// ─── SkeletonPageHeader ───────────────────────────────────────────────────────

export function SkeletonPageHeader({ className }: { className?: string }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading page header"
      className={cn("space-y-3", className)}
    >
      <Skeleton className="h-3 w-48" />
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
    </div>
  );
}
