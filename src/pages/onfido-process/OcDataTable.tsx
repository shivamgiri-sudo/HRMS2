import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Search,
} from "lucide-react";
import {
  filterRows,
  nextSort,
  sortRows,
  toCsv,
  type OcCell,
  type OcSortState,
} from "./ocDataTableLogic";

/**
 * The Onfido dashboard's data table: click-to-sort headers, optional search box, CSV
 * export of exactly what is on screen (after search and sort), a sticky header, a loading
 * skeleton and an empty state. It renders the same `oc-table` markup and classes as the
 * hand-rolled tables it replaces, so the existing look and click-through behaviour carry over.
 */
export interface OcColumn<T> {
  key: string;
  header: ReactNode;
  /** Plain-text header used in the CSV; defaults to `key`. */
  headerText?: string;
  align?: "left" | "right";
  /** The value used for sorting, searching and CSV. */
  accessor: (row: T) => OcCell;
  /** What is drawn in the cell; defaults to the accessor's value. */
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  title?: string;
}

export interface OcDataTableProps<T> {
  rows: readonly T[];
  columns: readonly OcColumn<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowTitle?: (row: T) => string | undefined;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Enables the CSV button; the file is named `<csvName>.csv`. */
  csvName?: string;
  loading?: boolean;
  emptyMessage?: string;
  maxHeight?: number | string;
}

const SKELETON_ROWS = 5;

function downloadCsv(name: string, csv: string): void {
  // The BOM makes Excel read the file as UTF-8.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function OcDataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  rowTitle,
  searchable = false,
  searchPlaceholder = "Search…",
  csvName,
  loading = false,
  emptyMessage = "No records",
  maxHeight,
}: OcDataTableProps<T>) {
  const [sort, setSort] = useState<OcSortState>(null);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const filtered = searchable
      ? filterRows(
          rows,
          columns.map((c) => c.accessor),
          query,
        )
      : [...rows];
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    return sort && col ? sortRows(filtered, col.accessor, sort.dir) : filtered;
  }, [rows, columns, query, sort, searchable]);

  const showTools = searchable || Boolean(csvName);

  return (
    <div>
      {showTools && (
        <div className="oc-tools">
          {searchable && (
            <label className="oc-tools-search">
              <Search size={13} aria-hidden="true" />
              <input
                className="oc-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
              />
            </label>
          )}
          <span className="oc-tools-count">
            {visible.length === rows.length
              ? `${rows.length} rows`
              : `${visible.length} of ${rows.length} rows`}
          </span>
          {csvName && (
            <button
              type="button"
              className="oc-btn-ghost"
              disabled={loading || visible.length === 0}
              onClick={() =>
                downloadCsv(
                  csvName,
                  toCsv(
                    columns.map((c) => ({
                      header: c.headerText ?? c.key,
                      accessor: c.accessor,
                    })),
                    visible,
                  ),
                )
              }
            >
              <Download size={13} aria-hidden="true" /> CSV
            </button>
          )}
        </div>
      )}

      <div
        className="oc-table-scroll"
        style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
      >
        <table className="oc-table">
          <thead>
            <tr>
              {columns.map((c) => {
                const sortable = c.sortable !== false;
                const active = sort?.key === c.key ? sort.dir : null;
                return (
                  <th
                    key={c.key}
                    className={c.align === "right" ? "oc-right" : undefined}
                    title={c.title}
                    aria-sort={
                      active === "asc"
                        ? "ascending"
                        : active === "desc"
                          ? "descending"
                          : sortable
                            ? "none"
                            : undefined
                    }
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className="oc-sortbtn"
                        onClick={() => setSort((s) => nextSort(s, c.key))}
                      >
                        {c.header}
                        {active === "asc" ? (
                          <ArrowUp size={11} aria-hidden="true" />
                        ) : active === "desc" ? (
                          <ArrowDown size={11} aria-hidden="true" />
                        ) : (
                          <ArrowUpDown
                            size={11}
                            className="oc-sort-idle"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                  <tr key={`sk-${i}`} aria-hidden="true">
                    {columns.map((c) => (
                      <td key={c.key}>
                        <div
                          className="oc-skeleton"
                          style={{
                            height: 12,
                            width: c.align === "right" ? "60%" : "80%",
                            marginLeft: c.align === "right" ? "auto" : 0,
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              : visible.map((row) => (
                  <tr
                    key={rowKey(row)}
                    className={onRowClick ? "oc-row-click" : undefined}
                    title={rowTitle?.(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={c.align === "right" ? "oc-right" : undefined}
                      >
                        {c.render ? c.render(row) : (c.accessor(row) ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
            {!loading && visible.length === 0 && (
              <tr className="oc-empty-row">
                <td colSpan={columns.length}>
                  {query.trim() ? "No rows match your search" : emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
