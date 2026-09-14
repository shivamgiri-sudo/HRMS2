/**
 * FilterBar — applied-filter chip strip per MAS Design Guidelines §7.4.
 *
 * Shows active filters as removable chips with a result count and "Clear all".
 * Use inside list/table pages above the data grid.
 *
 * Usage:
 *   const [filters, setFilters] = useState<FilterChip[]>([
 *     { key: "status", label: "Status", value: "Active" },
 *     { key: "branch", label: "Branch", value: "Hyderabad" },
 *   ]);
 *
 *   <FilterBar
 *     filters={filters}
 *     resultCount={142}
 *     onRemove={(key) => setFilters(f => f.filter(x => x.key !== key))}
 *     onClearAll={() => setFilters([])}
 *   />
 */

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FilterChip {
  /** Unique key matching the filter field name. */
  key: string;
  /** Human-readable label for the filter dimension (e.g. "Status"). */
  label: string;
  /** The currently applied value (e.g. "Active"). */
  value: string;
}

export interface FilterBarProps {
  filters: FilterChip[];
  /** Total matching records after applying these filters. */
  resultCount?: number;
  onRemove: (key: string) => void;
  onClearAll?: () => void;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FilterBar({
  filters,
  resultCount,
  onRemove,
  onClearAll,
  className,
}: FilterBarProps) {
  if (filters.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-subtle)] px-3 py-2 text-sm",
        className
      )}
      role="status"
      aria-live="polite"
      aria-label="Active filters"
    >
      {/* Chips */}
      {filters.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]"
        >
          <span className="text-[var(--color-text-muted)]">{chip.label}:</span>
          <span>{chip.value}</span>
          <button
            type="button"
            aria-label={`Remove ${chip.label} filter`}
            onClick={() => onRemove(chip.key)}
            className="ml-0.5 rounded-full p-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)]"
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}

      {/* Result count */}
      {resultCount !== undefined && (
        <span className="text-xs text-[var(--color-text-muted)]">
          {resultCount.toLocaleString("en-IN")} result{resultCount !== 1 ? "s" : ""}
        </span>
      )}

      {/* Clear all */}
      {onClearAll && filters.length > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-auto text-xs font-medium text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] rounded"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
