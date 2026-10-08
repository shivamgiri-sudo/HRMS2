import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Table as TableIcon, Table2 } from "lucide-react";
import { formatCategory, formatValue } from "../format";
import { thresholdColor } from "../palettes";
import { dims, measures, toMatrix } from "../shape";
import type { Cell, Theme, VizProps, VizStyle } from "../types";
import type { VizDef } from "./def";

const FOCUS = "cursor-pointer rounded focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1";
const toNum = (v: Cell | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

function Message({ theme, text = "No data" }: { theme: Theme; text?: string }) {
  return <div className="flex h-full w-full items-center justify-center p-3 text-center text-sm" style={{ color: theme.muted }}>{text}</div>;
}
/** Threshold tint for a measure cell: a soft background in the threshold colour plus a solid edge, text stays readable. */
function tint(style: VizStyle, v: number | null): React.CSSProperties {
  const c = thresholdColor(style, v);
  if (!c) return {};
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  const bg = m ? `rgba(${parseInt(m[1].slice(0, 2), 16)}, ${parseInt(m[1].slice(2, 4), 16)}, ${parseInt(m[1].slice(4, 6), 16)}, 0.18)` : c;
  return { background: bg, boxShadow: `inset 3px 0 0 ${c}`, fontWeight: 600 };
}

function DataTable({ result, style, theme, onSelect }: VizProps) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);
  const cols = result.columns;
  if (!cols.length) return <Message theme={theme} />;
  const sortCol = sort ? cols.find((c) => c.key === sort.key) : undefined;
  const rows = [...result.rows];
  if (sort && sortCol) {
    const sign = sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      const xn = x === null || x === undefined || x === "", yn = y === null || y === undefined || y === "";
      if (xn || yn) return xn === yn ? 0 : xn ? 1 : -1; // blanks always last
      if (sortCol.kind === "measure" || (typeof x === "number" && typeof y === "number")) return ((toNum(x) ?? 0) - (toNum(y) ?? 0)) * sign;
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * sign;
    });
  }
  const size = Math.max(1, Math.floor(style.pageSize ?? 25));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * size, at * size + size);
  const toggle = (key: string) => { setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" })); setPage(0); };
  const cellBorder = { borderBottom: `1px solid ${theme.border}` };
  const hasDim = cols[0].kind === "dimension";
  return (
    <div className="flex h-full w-full flex-col text-sm">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {cols.map((c) => {
                const dir = sort?.key === c.key ? sort.dir : null;
                const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ChevronsUpDown;
                return (
                  <th key={c.key} scope="col" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"} className={`sticky top-0 z-10 whitespace-nowrap px-2 py-1.5 font-semibold ${c.kind === "measure" ? "text-right" : "text-left"}`} style={{ background: theme.card, color: theme.muted, borderBottom: `1px solid ${theme.border}` }}>
                    <button type="button" className={`${FOCUS} inline-flex items-center gap-1`} style={{ color: theme.muted, outlineColor: theme.accent }} onClick={() => toggle(c.key)} title={`Sort by ${c.label}`}>
                      <span>{c.label}</span>
                      <Icon className="h-3.5 w-3.5" style={{ opacity: dir ? 1 : 0.5 }} aria-hidden="true" />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={at * size + i}>
                {cols.map((c) => {
                  if (c.kind === "measure") {
                    return <td key={c.key} className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums" style={{ color: theme.text, ...cellBorder, ...tint(style, toNum(row[c.key])) }}>{formatValue(row[c.key], c.format, style)}</td>;
                  }
                  const label = formatCategory(row[c.key], c);
                  return (
                    <td key={c.key} className="px-2 py-1.5" style={{ color: theme.text, ...cellBorder }}>
                      {onSelect ? (
                        <button type="button" className={`${FOCUS} text-left hover:underline`} style={{ color: theme.text, outlineColor: theme.accent }} onClick={() => onSelect(c.key, row[c.key])} title={`Filter by ${label}`}>{label}</button>
                      ) : label}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={cols.length} className="px-2 py-6 text-center" style={{ color: theme.muted }}>No data</td></tr>
            )}
          </tbody>
          {style.showTotals && (
            <tfoot>
              <tr>
                {cols.map((c, i) => (
                  c.kind === "measure"
                    ? <td key={c.key} className="sticky bottom-0 whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums" style={{ background: theme.card, color: theme.text, borderTop: `2px solid ${theme.border}` }}>{formatValue(result.totals?.[c.key] ?? null, c.format, style)}</td>
                    : <th key={c.key} scope={i === 0 ? "row" : undefined} className="sticky bottom-0 px-2 py-1.5 text-left font-semibold" style={{ background: theme.card, color: theme.text, borderTop: `2px solid ${theme.border}` }}>{i === 0 && hasDim ? "Total" : ""}</th>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.length > size && (
        <div className="flex shrink-0 items-center justify-end gap-2 px-2 py-1 text-xs" style={{ color: theme.muted, borderTop: `1px solid ${theme.border}` }}>
          <span className="tabular-nums">{at * size + 1}–{Math.min(rows.length, (at + 1) * size)} of {rows.length}</span>
          <button type="button" className={`${FOCUS} p-1 disabled:cursor-not-allowed disabled:opacity-40`} style={{ color: theme.text, outlineColor: theme.accent }} onClick={() => setPage(Math.max(0, at - 1))} disabled={at === 0} aria-label="Previous page"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" className={`${FOCUS} p-1 disabled:cursor-not-allowed disabled:opacity-40`} style={{ color: theme.text, outlineColor: theme.accent }} onClick={() => setPage(Math.min(pages - 1, at + 1))} disabled={at >= pages - 1} aria-label="Next page"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      )}
    </div>
  );
}

function Pivot({ result, style, theme }: VizProps) {
  const ds = dims(result), m = measures(result)[0];
  const mx = toMatrix(result);
  if (!m || !mx.rows.length) return <Message theme={theme} />;
  const totals = style.showTotals !== false;
  const sum = (xs: Array<number | null>): number | null => (xs.some((x) => x !== null) ? xs.reduce<number>((a, x) => a + (x ?? 0), 0) : null);
  const rowTotals = mx.cells.map(sum);
  const colTotals = mx.cols.map((_, ci) => sum(mx.cells.map((r) => r[ci])));
  const head = { background: theme.card, color: theme.muted, borderBottom: `1px solid ${theme.border}` };
  const foot = { background: theme.card, color: theme.text, borderTop: `2px solid ${theme.border}` };
  const line = { borderBottom: `1px solid ${theme.border}` };
  return (
    <div className="h-full w-full overflow-auto text-sm">
      <table className="w-full border-collapse" aria-label={`${m.label} by ${ds[0]?.label ?? "row"} and ${ds[1]?.label ?? "column"}`}>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 top-0 z-20 whitespace-nowrap px-2 py-1.5 text-left font-semibold" style={head}>{ds[0]?.label ?? ""}</th>
            {mx.cols.map((c) => <th key={c} scope="col" className="sticky top-0 z-10 whitespace-nowrap px-2 py-1.5 text-right font-semibold" style={head}>{c}</th>)}
            {totals && <th scope="col" className="sticky top-0 z-10 whitespace-nowrap px-2 py-1.5 text-right font-semibold" style={{ ...head, color: theme.text }}>Total</th>}
          </tr>
        </thead>
        <tbody>
          {mx.rows.map((r, ri) => (
            <tr key={r}>
              <th scope="row" className="sticky left-0 z-10 whitespace-nowrap px-2 py-1.5 text-left font-medium" style={{ background: theme.card, color: theme.text, ...line }}>{r}</th>
              {mx.cols.map((c, ci) => (
                <td key={c} className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums" style={{ color: theme.text, ...line, ...tint(style, mx.cells[ri][ci]) }}>{formatValue(mx.cells[ri][ci], m.format, style)}</td>
              ))}
              {totals && <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: theme.text, ...line }}>{formatValue(rowTotals[ri], m.format, style)}</td>}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr>
              <th scope="row" className="sticky bottom-0 left-0 z-20 px-2 py-1.5 text-left font-semibold" style={foot}>Total</th>
              {colTotals.map((v, ci) => <td key={mx.cols[ci]} className="sticky bottom-0 whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums" style={foot}>{formatValue(v, m.format, style)}</td>)}
              <td className="sticky bottom-0 whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums" style={foot}>{formatValue(sum(rowTotals), m.format, style)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export const TABLE_VIZ: VizDef[] = [
  {
    type: "table", label: "Table", category: "Tables", icon: TableIcon, description: "Use when people need to read, sort and page through the exact values.",
    needs: { dims: [0, 4], measures: [1, 8] }, defaultSize: { w: 6, h: 8 }, defaults: { pageSize: 25 },
    styleOptions: ["numberFormat", "thresholds", "pageSize", "showTotals"], Component: DataTable,
  },
  {
    type: "pivot", label: "Pivot table", category: "Tables", icon: Table2, description: "Use to cross-tabulate one measure by two dimensions, with row and column totals.",
    needs: { dims: [2, 2], measures: [1, 1] }, defaultSize: { w: 8, h: 8 }, defaults: { showTotals: true },
    styleOptions: ["numberFormat", "thresholds", "showTotals"], Component: Pivot,
  },
];
