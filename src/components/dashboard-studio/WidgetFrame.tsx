import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Copy, Download, FileSpreadsheet, Loader2, MoreVertical, Pencil, Table2, Trash2, BarChart3, Pin } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { errorText, useWidgetData } from "./api";
import { exportCsv, exportXlsx } from "./export";
import { formatCategory } from "./format";
import { effectiveQuery, queryProblems, type CrossFilter, type RuntimeFilters } from "./model";
import { seriesColors, themePalette } from "./palettes";
import { toTable } from "./shape";
import type { Cell, DashboardSettings, DatasetDef, QueryResult, Theme, Widget } from "./types";
import { vizOf } from "./viz/registry";

const EMPTY: QueryResult = { columns: [], rows: [], truncated: false, range: null, totals: {}, generatedAt: "" };

interface Props {
  widget: Widget; theme: Theme; datasets: DatasetDef[]; settings: DashboardSettings; runtime: RuntimeFilters;
  editing: boolean; selected?: boolean; crossSourceId?: string;
  onSelectWidget?: () => void; onDuplicate?: () => void; onDelete?: () => void;
  onCrossFilter?: (f: CrossFilter) => void;
  /** Lets the dashboard collect results for "export all". */
  onResult?: (id: string, result: QueryResult | null) => void;
}

function Message({ theme, icon, children }: { theme: Theme; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-xs" style={{ color: theme.muted }}>
      {icon}{children}
    </div>
  );
}

/** One widget on the canvas: card, title, menu, and the loading / not-ready / empty / error / table states around the chart. */
export default function WidgetFrame({ widget, theme, datasets, settings, runtime, editing, selected, crossSourceId, onSelectWidget, onDuplicate, onDelete, onCrossFilter, onResult }: Props) {
  const def = vizOf(widget.widgetType);
  const [asTable, setAsTable] = useState(false);
  const style = useMemo(() => ({ ...(def?.defaults ?? {}), ...widget.viz }), [def, widget.viz]);
  const problems = def && !def.noQuery ? queryProblems(def.needs, widget.query, def.label) : [];
  const spec = useMemo(
    () => (def && !def.noQuery && !problems.length ? effectiveQuery(widget, settings, runtime, datasets, crossSourceId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [widget.query, widget.viz.pinDate, settings, runtime, datasets, crossSourceId, def, problems.length],
  );
  const needsCompare = def?.type === "kpi" && spec && !spec.compare && spec.dateRange && spec.dateRange.preset !== "all";
  const finalSpec = useMemo(() => (spec && needsCompare ? { ...spec, compare: "previous_period" as const } : spec), [spec, needsCompare]);
  const { data, isFetching, isError, error } = useWidgetData(finalSpec, !!finalSpec, settings.autoRefreshSec ?? 0);

  const result = data ?? null;
  useMemo(() => { onResult?.(widget.id, result); }, [widget.id, result]); // eslint-disable-line react-hooks/exhaustive-deps

  const seriesCount = result ? Math.max(result.columns.filter((c) => c.kind === "measure").length, result.rows.length, 8) : 8;
  const colors = useMemo(() => seriesColors(style, Math.min(seriesCount, 24), themePalette(theme)), [style, seriesCount, theme]);
  const title = widget.title ?? def?.label ?? "Widget";

  const select = (columnKey: string, value: Cell) => {
    if (!onCrossFilter || !result || !widget.query) return;
    const col = result.columns.find((c) => c.key === columnKey); const i = Number(columnKey.slice(1));
    const dim = widget.query.dimensions[i];
    if (!col || col.kind !== "dimension" || !dim || dim.grain) return; // grouped time buckets are not a field value
    onCrossFilter({ field: dim.field, value, label: `${col.label}: ${formatCategory(value, col)}` });
  };

  let body: ReactNode;
  if (!def) body = <Message theme={theme} icon={<AlertTriangle className="h-4 w-4" />}>This chart type ({widget.widgetType}) is not available.</Message>;
  else if (def.noQuery) body = <def.Component result={EMPTY} style={style} theme={theme} colors={colors} />;
  else if (problems.length) body = <Message theme={theme} icon={<BarChart3 className="h-5 w-5" />}>{problems.map((p) => <p key={p}>{p}</p>)}{editing && <p>Open the Data tab to fix this.</p>}</Message>;
  else if (isError) body = <Message theme={theme} icon={<AlertTriangle className="h-4 w-4 text-rose-500" />}>{errorText(error)}</Message>;
  else if (!result) body = <div className="h-full w-full animate-pulse rounded-lg motion-reduce:animate-none" style={{ background: theme.grid, opacity: 0.5 }} aria-label="Loading" />;
  else if (!result.rows.length) body = <Message theme={theme}>No data for these filters and dates.</Message>;
  else if (asTable) {
    const t = toTable(result);
    body = (
      <div className="h-full w-full overflow-auto">
        <table className="min-w-full text-xs" style={{ color: theme.text }}>
          <thead><tr>{t.header.map((h) => <th key={h} className="sticky top-0 px-2 py-1.5 text-left font-semibold" style={{ background: theme.card, borderBottom: `1px solid ${theme.border}` }}>{h}</th>)}</tr></thead>
          <tbody>{t.rows.map((r, i) => <tr key={i} style={{ borderBottom: `1px solid ${theme.grid}` }}>{r.map((c, j) => <td key={j} className="px-2 py-1 tabular-nums">{c === null ? "—" : typeof c === "number" ? c.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  } else body = <def.Component result={result} style={style} theme={theme} colors={colors} onSelect={settings.crossFilter === false ? undefined : select} />;

  const card = style.card ?? "bordered";
  const isHeader = def?.type === "header";
  return (
    <section
      aria-label={title}
      onClick={editing ? (e) => { e.stopPropagation(); onSelectWidget?.(); } : undefined}
      className={`group flex h-full w-full flex-col overflow-hidden rounded-xl transition-shadow duration-200 ${editing ? "cursor-pointer" : ""} ${card === "shadow" ? "shadow-md" : ""}`}
      style={{
        background: isHeader || card === "plain" ? "transparent" : card === "tinted" ? `${theme.accent}12` : theme.card,
        border: isHeader || card === "plain" ? "1px solid transparent" : `1px solid ${theme.border}`,
        outline: selected ? `2px solid ${theme.accent}` : undefined, outlineOffset: 1, color: theme.text,
      }}
    >
      {!isHeader && (
        <header className={`flex items-start gap-2 px-3 pt-2.5 ${editing ? "studio-drag-handle cursor-move" : ""}`}>
          <div className={`min-w-0 flex-1 ${style.align === "center" ? "text-center" : ""}`}>
            <h3 className="truncate text-[13px] font-semibold leading-tight" style={{ color: theme.text }}>{title}</h3>
            {widget.subtitle && <p className="truncate text-[11px]" style={{ color: theme.muted }}>{widget.subtitle}</p>}
          </div>
          {widget.viz.pinDate && <Pin className="mt-0.5 h-3 w-3 shrink-0" style={{ color: theme.muted }} aria-label="Uses its own date range" />}
          {isFetching && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" style={{ color: theme.muted }} aria-label="Refreshing" />}
          {result?.truncated && <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#FEF3C7", color: "#92400E" }} title="More rows exist than this dataset returns in one query. Add a filter or a coarser grouping.">Partial</span>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`Options for ${title}`} onClick={(e) => e.stopPropagation()}
                className="-mr-1 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2" style={{ color: theme.muted }}>
                <MoreVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {!def?.noQuery && <DropdownMenuItem onClick={() => setAsTable((v) => !v)}>{asTable ? <BarChart3 className="mr-2 h-4 w-4" /> : <Table2 className="mr-2 h-4 w-4" />}{asTable ? "Show chart" : "View as table"}</DropdownMenuItem>}
              {result && result.rows.length > 0 && <>
                <DropdownMenuItem onClick={() => exportCsv(title, result)}><Download className="mr-2 h-4 w-4" />Download CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void exportXlsx(title, [{ title, result }])}><FileSpreadsheet className="mr-2 h-4 w-4" />Download Excel</DropdownMenuItem>
              </>}
              {editing && <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSelectWidget}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                <DropdownMenuItem onClick={onDuplicate}><Copy className="mr-2 h-4 w-4" />Duplicate</DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} className="text-rose-600 focus:text-rose-600"><Trash2 className="mr-2 h-4 w-4" />Remove</DropdownMenuItem>
              </>}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
      )}
      <div className={`min-h-0 flex-1 ${isHeader ? "" : "p-2.5 pt-1.5"} ${editing && isHeader ? "studio-drag-handle cursor-move" : ""}`}>{body}</div>
    </section>
  );
}
