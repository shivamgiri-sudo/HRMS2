import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown, Filter } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import type { SortDir } from "./useSortableRows";

/**
 * Excel-style column filters for a Process Performance V2 table -- pairs with useSortableRows /
 * SortTh (click a header to sort) and adds the per-column "pick which values to show" dropdown
 * Excel gives a filtered range. Filters across columns combine with AND; within one column a row
 * passes when its value is one of the ticked values.
 */

export interface FilterColumn<T> {
  key: string;
  /** The value shown in this column, as text -- also what the filter list offers. */
  get: (row: T) => string | number | null | undefined;
}

const asText = (v: string | number | null | undefined): string => (v === null || v === undefined || v === "" ? "(Blank)" : String(v));

export function useColumnFilters<T>(rows: T[], columns: Array<FilterColumn<T>>) {
  /** column key -> the values that are ticked (a missing key means "no filter on this column"). */
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});

  const getters = useMemo(() => new Map(columns.map((c) => [c.key, c.get])), [columns]);

  const filtered = useMemo(() => {
    const active = Object.entries(selected);
    if (active.length === 0) return rows;
    return rows.filter((row) => active.every(([key, set]) => {
      const get = getters.get(key);
      return get ? set.has(asText(get(row))) : true;
    }));
  }, [rows, selected, getters]);

  /** Distinct values for a column, from the rows the OTHER columns' filters leave -- like Excel,
   * so the list only offers values that can still appear. */
  function optionsFor(key: string): string[] {
    const get = getters.get(key);
    if (!get) return [];
    const others = Object.entries(selected).filter(([k]) => k !== key);
    const pool = others.length === 0 ? rows : rows.filter((row) => others.every(([k, set]) => {
      const g = getters.get(k);
      return g ? set.has(asText(g(row))) : true;
    }));
    const seen = new Set<string>();
    for (const row of pool) seen.add(asText(get(row)));
    return [...seen].sort((a, b) => {
      const an = Number(a.replace(/[^0-9.-]/g, "")), bn = Number(b.replace(/[^0-9.-]/g, ""));
      return Number.isFinite(an) && Number.isFinite(bn) && a !== "(Blank)" && b !== "(Blank)" ? an - bn : a.localeCompare(b);
    });
  }

  function setColumn(key: string, values: Set<string> | null) {
    setSelected((cur) => {
      const next = { ...cur };
      if (values === null) delete next[key]; else next[key] = values;
      return next;
    });
  }

  return {
    filtered, selected, optionsFor, setColumn,
    activeCount: Object.keys(selected).length,
    clearAll: () => setSelected({}),
  };
}

export type ColumnFilters = ReturnType<typeof useColumnFilters>;

/** A `<th>` that sorts on a label click and opens an Excel-style value filter from its funnel icon. */
export function FilterSortTh({
  label, columnKey, sortKey, sortDir, onSort, filters, className, sticky,
}: {
  label: React.ReactNode; columnKey: string;
  sortKey: string | null; sortDir: SortDir; onSort: (key: string) => void;
  filters: ColumnFilters; className?: string; sticky?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const sorted = sortKey === columnKey;
  const active = filters.selected[columnKey] !== undefined;

  const options = open ? filters.optionsFor(columnKey) : [];
  const shown = options.filter((o) => o.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 400);
  const ticked = filters.selected[columnKey];
  const isOn = (v: string) => (ticked ? ticked.has(v) : true);
  const allShownOn = shown.length > 0 && shown.every(isOn);

  function toggle(v: string) {
    const base = ticked ? new Set(ticked) : new Set(options);
    if (base.has(v)) base.delete(v); else base.add(v);
    filters.setColumn(columnKey, base.size === options.length ? null : base);
  }
  function toggleAllShown() {
    const base = ticked ? new Set(ticked) : new Set(options);
    if (allShownOn) shown.forEach((v) => base.delete(v)); else shown.forEach((v) => base.add(v));
    filters.setColumn(columnKey, base.size === options.length ? null : base);
  }

  return (
    <th
      aria-sort={sorted ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className={`select-none whitespace-nowrap ${sticky ? "sticky left-0 z-10 " : ""}${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-1">
        <button type="button" onClick={() => onSort(columnKey)} className="inline-flex items-center gap-1 uppercase" title="Click to sort">
          {label}
          {sorted ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
        </button>
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
          <PopoverTrigger asChild>
            <button
              type="button" aria-label={`Filter ${typeof label === "string" ? label : columnKey}`} title="Filter"
              className={`rounded p-0.5 transition-colors ${active ? "bg-rose-100 text-rose-700" : "text-slate-400 hover:bg-slate-200 hover:text-slate-600"}`}
            >
              <Filter className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2 text-left normal-case tracking-normal">
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" autoFocus
              className="mb-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-rose-400 focus:outline-none"
            />
            <label className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-1 pb-1.5 text-xs font-semibold text-slate-700">
              <input type="checkbox" checked={allShownOn} onChange={toggleAllShown} className="h-3.5 w-3.5 accent-rose-600" />
              (Select All{search.trim() ? " search results" : ""})
            </label>
            <div className="max-h-56 space-y-0.5 overflow-y-auto py-1">
              {shown.map((v) => (
                <label key={v} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs font-normal text-slate-700 hover:bg-slate-50">
                  <input type="checkbox" checked={isOn(v)} onChange={() => toggle(v)} className="h-3.5 w-3.5 accent-rose-600" />
                  <span className="truncate">{v}</span>
                </label>
              ))}
              {shown.length === 0 && <p className="px-1 py-2 text-xs text-slate-400">No matching values.</p>}
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-1.5">
              <button type="button" onClick={() => filters.setColumn(columnKey, null)} disabled={!active} className="text-[11px] font-semibold text-rose-600 disabled:text-slate-300">Clear filter</button>
              <button type="button" onClick={() => setOpen(false)} className="text-[11px] font-semibold text-slate-600">Done</button>
            </div>
          </PopoverContent>
        </Popover>
      </span>
    </th>
  );
}
