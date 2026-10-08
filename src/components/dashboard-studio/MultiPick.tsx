import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Props {
  label: string; options: Array<{ value: string; label: string }>; selected: string[]; onChange: (next: string[]) => void;
  /** Called as the user types, for server-side option lookups. */
  onSearch?: (q: string) => void; loading?: boolean;
}

/** A searchable multi-select in a popover. Shows "All" when nothing is picked. */
export default function MultiPick({ label, options, selected, onChange, onSearch, loading }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options;
    return list.slice(0, 200);
  }, [options, q]);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const summary = !selected.length ? "All" : selected.length === 1 ? options.find((o) => o.value === selected[0])?.label ?? selected[0] : `${selected.length} selected`;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`${label}: ${summary}`}
          className={`inline-flex h-10 max-w-[15rem] cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${selected.length ? "border-blue-700 bg-blue-50 text-blue-900" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
          <span className="text-xs font-semibold text-slate-500">{label}</span>
          <span className="truncate font-medium">{summary}</span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input autoFocus aria-label={`Search ${label}`} value={q} onChange={(e) => { setQ(e.target.value); onSearch?.(e.target.value); }} placeholder="Search…"
            className="h-9 w-full rounded-md border border-slate-300 pl-8 pr-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600" />
        </div>
        <ul role="listbox" aria-multiselectable className="max-h-64 overflow-auto">
          {loading && <li className="px-2 py-2 text-xs text-slate-500">Loading…</li>}
          {!loading && !shown.length && <li className="px-2 py-2 text-xs text-slate-500">Nothing matches.</li>}
          {shown.map((o) => {
            const on = selected.includes(o.value);
            return (
              <li key={o.value}>
                <button type="button" role="option" aria-selected={on} onClick={() => toggle(o.value)}
                  className="flex min-h-[36px] w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-blue-700 bg-blue-700 text-white" : "border-slate-400"}`}>{on && <Check className="h-3 w-3" />}</span>
                  <span className="truncate">{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {selected.length > 0 && <button type="button" onClick={() => onChange([])} className="mt-2 w-full cursor-pointer rounded-md border border-slate-300 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Clear</button>}
      </PopoverContent>
    </Popover>
  );
}
