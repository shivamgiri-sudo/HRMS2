import { useId, useState, type ReactNode } from "react";
import { DEFAULT_HEIGHT } from "./parts";
import type { TableSpec } from "./scale";

/** A chart reserves at most this much height so a small chart never leaves a large empty block. */
const MAX_RESERVED = 320;

export interface ChartFrameProps {
  title: string;
  subtitle?: string;
  table: TableSpec;
  height?: number;
  actions?: ReactNode;
  /** Start in table view (used by static-markup tests and print views). */
  defaultShowTable?: boolean;
  children: ReactNode;
}

/** Strings render exactly as given (pre-formatted to match chart labels); raw numbers as plain String(n). */
export function cell(v: string | number | null): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  return v;
}

/** The accessible twin of a chart: a real table built from the same TableSpec the chart was given. */
export function DataTable({ table }: { table: TableSpec }) {
  return (
    <div className="bh-table-wrap">
      <table className="bh-table">
        <caption>{table.caption}</caption>
        <thead>
          <tr>{table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.length ? table.rows.map((row, i) => (
            <tr key={i}>{row.map((v, j) => <td key={j}>{cell(v)}</td>)}</tr>
          )) : (
            <tr><td colSpan={Math.max(1, table.columns.length)}>No data</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Shared chart wrapper: title, optional subtitle and actions, a "View as table" toggle (aria-pressed)
 * and a chart body with a capped min-height (not applied to the table view).
 */
export function ChartFrame({ title, subtitle, table, height = DEFAULT_HEIGHT, actions, defaultShowTable = false, children }: ChartFrameProps) {
  const [showTable, setShowTable] = useState(defaultShowTable);
  const titleId = useId();
  const bodyId = useId();
  return (
    <section className="bh-viz bh-frame" aria-labelledby={titleId}>
      <div className="bh-frame-head">
        <div>
          <h3 id={titleId} className="bh-frame-title">{title}</h3>
          {subtitle ? <p className="bh-frame-sub">{subtitle}</p> : null}
        </div>
        <div className="bh-frame-actions">
          {actions}
          <button type="button" className="bh-btn" aria-pressed={showTable} aria-controls={bodyId}
            onClick={() => setShowTable((v) => !v)}>
            View as table
          </button>
        </div>
      </div>
      <div id={bodyId} className="bh-frame-body" style={showTable ? undefined : { minHeight: Math.min(height, MAX_RESERVED) }}>
        {showTable ? <DataTable table={table} /> : children}
      </div>
    </section>
  );
}
