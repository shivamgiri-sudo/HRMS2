/**
 * TableStates — wraps a data table with all §8.2 required states in one place.
 *
 * States: loading skeleton | permission-denied | error | empty-filtered |
 *         empty-no-data | children (normal render)
 *
 * Usage:
 *   <TableStates
 *     loading={isLoading}
 *     error={fetchError}
 *     onRetry={refetch}
 *     empty={data.length === 0}
 *     filtersActive={hasActiveFilters}
 *     onClearFilters={clearFilters}
 *     permissionDenied={!canView}
 *     skeletonRows={8}
 *     skeletonCols={5}
 *   >
 *     <MyTable data={data} />
 *   </TableStates>
 */

import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Filter, Lock, RefreshCcw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TableStatesProps {
  children: React.ReactNode;
  loading?: boolean;
  /** Error message or Error object; null/undefined = no error */
  error?: string | Error | null;
  onRetry?: () => void;
  /** True when the table has no rows (after loading completes) */
  empty?: boolean;
  /** True when empty is caused by applied filters (not genuinely no data) */
  filtersActive?: boolean;
  onClearFilters?: () => void;
  /** Hide table and show access-denied state */
  permissionDenied?: boolean;
  /** Number of skeleton rows to show during loading */
  skeletonRows?: number;
  /** Number of skeleton columns to show during loading */
  skeletonCols?: number;
  className?: string;
}

// Skeleton row factory
function TableSkeleton({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div className="space-y-2" aria-label="Loading…" role="status">
      {/* Header row */}
      <div className="flex gap-3 border-b border-[var(--color-border-subtle)] pb-2">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1 rounded" />
        ))}
      </div>
      {/* Data rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 py-1">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton
              key={c}
              className="h-4 flex-1 rounded"
              style={{ opacity: 1 - r * 0.08 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function TableStates({
  children,
  loading = false,
  error,
  onRetry,
  empty = false,
  filtersActive = false,
  onClearFilters,
  permissionDenied = false,
  skeletonRows = 6,
  skeletonCols = 5,
  className,
}: TableStatesProps) {
  if (loading) {
    return (
      <div className={className}>
        <TableSkeleton rows={skeletonRows} cols={skeletonCols} />
      </div>
    );
  }

  if (permissionDenied) {
    return (
      <div className={className}>
        <EmptyState
          icon={<Lock className="h-8 w-8" />}
          title="Access restricted"
          description="You don't have permission to view this data. Contact your administrator to request access."
          variant="default"
        />
      </div>
    );
  }

  if (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return (
      <div
        role="alert"
        className={[
          "rounded-[var(--radius-card)] border border-[#FECACA] bg-[#FEF2F2] px-4 py-10 text-center",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <AlertTriangle className="mx-auto h-8 w-8 text-[#B91C1C]" aria-hidden />
        <h3 className="mt-3 text-base font-semibold text-[var(--text-primary)]">
          Couldn&apos;t load data
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-secondary)]">{msg}</p>
        {onRetry && (
          <Button
            variant="outline"
            className="mt-5 rounded-[var(--radius-input)] bg-[var(--color-surface)]"
            onClick={onRetry}
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        )}
      </div>
    );
  }

  if (empty) {
    if (filtersActive) {
      return (
        <div className={className}>
          <EmptyState
            icon={<Filter className="h-8 w-8" />}
            title="No results match these filters"
            description="Try adjusting or clearing the active filters to see more records."
            action={
              onClearFilters ? (
                <Button variant="outline" size="sm" onClick={onClearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
            variant="default"
          />
        </div>
      );
    }
    return (
      <div className={className}>
        <EmptyState
          title="No records found"
          description="There's nothing here yet. Records will appear once data is added."
          variant="default"
        />
      </div>
    );
  }

  return <>{children}</>;
}
