import { useState, type ReactNode } from "react";
import type { TableSpec } from "../viz";
import "./look.css";

export interface NavyColumn<R> {
  key: string;
  label: string;
  /** Numbers right-aligned with tabular figures. */
  num?: boolean;
  /** Let this column wrap (chips with long text) instead of the default single line. */
  wrap?: boolean;
  render: (row: R, i: number) => ReactNode;
}

export interface NavyTableProps<R> {
  caption: string;
  columns: Array<NavyColumn<R>>;
  rows: R[];
  /** Rows shown before "Show all"; 0 shows every row. */
  limit?: number;
  /** Max body height before the table scrolls inside its own box (sticky header). */
  maxHeight?: number;
  onRowClick?: (row: R, i: number) => void;
  /** Label of the row for the click (screen readers). */
  rowLabel?: (row: R) => string;
  empty?: string;
}

/** Navy header, zebra rows, right-aligned numbers, sticky header when tall, top-N with "Show all". */
export function NavyTable<R>({ caption, columns, rows, limit = 10, maxHeight = 460, onRowClick, rowLabel, empty = "No rows" }: NavyTableProps<R>) {
  const [all, setAll] = useState(false);
  const cut = limit > 0 && !all && rows.length > limit;
  const shown = cut ? rows.slice(0, limit) : rows;
  return (
    <div>
      <div className="bhl-tw" style={{ maxHeight }}>
        <table className="bhl-t">
          <caption>{caption}</caption>
          <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.num ? "bhl-r" : undefined}>{c.label}</th>)}</tr></thead>
          <tbody>
            {shown.length === 0 ? <tr><td colSpan={columns.length}>{empty}</td></tr> : shown.map((r, i) => (
              <tr key={i} className={onRowClick ? "bhl-click" : undefined} tabIndex={onRowClick ? 0 : undefined}
                aria-label={onRowClick && rowLabel ? `Open ${rowLabel(r)}` : undefined}
                onClick={onRowClick ? () => onRowClick(r, i) : undefined}
                onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(r, i); } } : undefined}>
                {columns.map((c) => <td key={c.key} className={[c.num ? "bhl-r" : "", c.wrap ? "bhl-wrap" : ""].join(" ").trim() || undefined}>{c.render(r, i)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limit > 0 && rows.length > limit ? (
        <button type="button" className="bhl-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? `Show top ${limit}` : `Show all ${rows.length}`}
        </button>
      ) : null}
    </div>
  );
}

const isDigit = (ch: string | undefined) => ch != null && ch >= "0" && ch <= "9";
/** A cell reads as a number when it is one, or its text starts with a digit, rupee sign or minus + digit. */
export function looksNumeric(v: string | number | null): boolean {
  if (typeof v === "number") return true;
  if (v == null) return false;
  const s = String(v).trim();
  const i = s[0] === "-" || s[0] === "+" ? 1 : 0;
  return isDigit(s[i]) || (s[i] === "₹" && (isDigit(s[i + 1]) || s[i + 1] === "-"));
}

const cellText = (v: string | number | null) => (v == null ? "—" : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "—") : v);

/** A chart's TableSpec twin in the navy table look; a column is right-aligned when most of its cells are numbers. */
export function SpecTable({ table, limit = 0, maxHeight }: { table: TableSpec; limit?: number; maxHeight?: number }) {
  const numCol = table.columns.map((_, j) => j > 0 && table.rows.length > 0 && table.rows.filter((r) => looksNumeric(r[j] ?? null)).length * 2 >= table.rows.length);
  return (
    <NavyTable caption={table.caption} rows={table.rows} limit={limit} maxHeight={maxHeight} empty="No data"
      columns={table.columns.map((c, j) => ({ key: `${j}-${c}`, label: c, num: numCol[j], render: (r: Array<string | number | null>) => cellText(r[j] ?? null) }))} />
  );
}

/** Inline percentage bar for a table cell: value text plus a filled track (colour = series, not status). */
export function BarCell({ pct, text, color = "#2a78d6" }: { pct: number | null; text: string; color?: string }) {
  const w = pct == null || !Number.isFinite(pct) ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <span className="bhl-bar">
      <span aria-hidden="true"><i style={{ width: `${w}%`, background: color }} /></span>
      <span className="tabular-nums">{text}</span>
    </span>
  );
}

export type ChipTone = "crit" | "warn" | "ok" | "info" | "mute";
export const Chip = ({ tone = "mute", children }: { tone?: ChipTone; children: ReactNode }) => <span className={`bhl-chip bhl-chip-${tone}`}>{children}</span>;
