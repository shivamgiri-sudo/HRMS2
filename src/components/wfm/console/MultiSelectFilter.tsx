import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiOption { value: string; label: string }

interface Props {
  id: string;
  /** Text when nothing is ticked, e.g. "All branches". */
  allLabel: string;
  options: MultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  className?: string;
  disabled?: boolean;
  /** Plural noun for the summary ("3 branches"). */
  noun?: string;
}

/**
 * Checkbox dropdown for the Roster Command Center filter bar. An empty selection means ALL (the trigger says so),
 * never "nothing". Options that are no longer offered are not silently kept: callers prune `selected`.
 */
export function MultiSelectFilter({ id, allLabel, options, selected, onChange, className, disabled, noun = "selected" }: Props) {
  const [q, setQ] = useState("");
  const labelOf = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options]);
  const chosen = selected.filter((v) => labelOf.has(v));
  const summary = chosen.length === 0 ? allLabel : chosen.length === 1 ? String(labelOf.get(chosen[0])) : `${chosen.length} ${noun}`;
  const shown = q.trim() ? options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : options;
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <Popover onOpenChange={(o) => !o && setQ("")}>
      <PopoverTrigger asChild>
        <button
          type="button" id={id} disabled={disabled}
          aria-haspopup="listbox"
          className={cn("flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input px-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
        >
          <span className={cn("truncate", chosen.length === 0 && "text-slate-600")}>{summary}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[max(var(--radix-popover-trigger-width),16rem)] p-0">
        {options.length > 7 && (
          <div className="border-b border-border p-2">
            <input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search options"
              className="h-8 w-full rounded border border-input bg-white px-2 text-sm text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}
        <div className="flex items-center justify-between border-b border-border px-2 py-1 text-xs">
          <button type="button" className="cursor-pointer font-medium text-primary hover:underline" onClick={() => onChange(options.map((o) => o.value))}>Select all</button>
          <button type="button" className="cursor-pointer font-medium text-slate-700 hover:underline" onClick={() => onChange([])}>Clear (all)</button>
        </div>
        <ul role="listbox" aria-multiselectable="true" className="max-h-64 overflow-auto py-1">
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-slate-600">No matches</li>}
          {shown.map((o) => {
            const on = selected.includes(o.value);
            return (
              <li key={o.value} role="option" aria-selected={on}>
                <button type="button" onClick={() => toggle(o.value)} className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-900 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border", on ? "border-primary bg-primary text-primary-foreground" : "border-slate-400 bg-white")}>
                    {on && <Check className="h-3 w-3" aria-hidden />}
                  </span>
                  <span className="truncate">{o.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
