import { useState, useMemo } from "react";

export type SortDirection = "asc" | "desc" | null;

export interface SortConfig<T> {
  key: keyof T | null;
  direction: SortDirection;
}

export interface UseSortingReturn<T> {
  sortedItems: T[];
  sortConfig: SortConfig<T>;
  requestSort: (key: keyof T) => void;
  getSortDirection: (key: keyof T) => SortDirection;
  clearSort: () => void;
}

export function useSorting<T>(
  items: T[],
  initialSortKey?: keyof T,
  initialDirection: SortDirection = "asc"
): UseSortingReturn<T> {
  const [sortConfig, setSortConfig] = useState<SortConfig<T>>({
    key: initialSortKey ?? null,
    direction: initialSortKey ? initialDirection : null,
  });

  const sortedItems = useMemo(() => {
    if (!sortConfig.key || !sortConfig.direction) {
      return items;
    }

    return [...items].sort((a, b) => {
      const aValue = a[sortConfig.key!];
      const bValue = b[sortConfig.key!];

      // Handle null/undefined values
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return sortConfig.direction === "asc" ? 1 : -1;
      if (bValue == null) return sortConfig.direction === "asc" ? -1 : 1;

      // Handle different types
      if (typeof aValue === "string" && typeof bValue === "string") {
        const comparison = aValue.localeCompare(bValue, undefined, { sensitivity: "base" });
        return sortConfig.direction === "asc" ? comparison : -comparison;
      }

      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortConfig.direction === "asc" ? aValue - bValue : bValue - aValue;
      }

      // Handle dates (string format)
      if (typeof aValue === "string" && typeof bValue === "string") {
        const dateA = new Date(aValue).getTime();
        const dateB = new Date(bValue).getTime();
        if (!isNaN(dateA) && !isNaN(dateB)) {
          return sortConfig.direction === "asc" ? dateA - dateB : dateB - dateA;
        }
      }

      // Fallback to string comparison
      const strA = String(aValue);
      const strB = String(bValue);
      const comparison = strA.localeCompare(strB);
      return sortConfig.direction === "asc" ? comparison : -comparison;
    });
  }, [items, sortConfig]);

  const requestSort = (key: keyof T) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        // Cycle through: asc -> desc -> null
        if (prev.direction === "asc") {
          return { key, direction: "desc" };
        } else if (prev.direction === "desc") {
          return { key: null, direction: null };
        }
      }
      return { key, direction: "asc" };
    });
  };

  const getSortDirection = (key: keyof T): SortDirection => {
    if (sortConfig.key === key) {
      return sortConfig.direction;
    }
    return null;
  };

  const clearSort = () => {
    setSortConfig({ key: null, direction: null });
  };

  return {
    sortedItems,
    sortConfig,
    requestSort,
    getSortDirection,
    clearSort,
  };
}
