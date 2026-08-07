import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

/**
 * A checkbox dropdown for the P&L filters.
 *
 * WHY NOT A PLAIN <select multiple>
 * ---------------------------------
 * The question these filters answer is comparative — "Noida and Noida-2 against Ahmedabad", "these
 * four processes only" — and a single-value select forces it to be asked one branch at a time,
 * which is four page loads and no comparison at the end. A native multiple select can express it
 * but needs ctrl-click to do so, silently replaces the whole selection on a plain click, and shows
 * no summary of what is selected once it closes.
 *
 * So: checkboxes, a summary line that names the selection while it fits, and a search box because
 * the cost-centre list runs to hundreds of codes.
 *
 * An empty selection means ALL, not NONE. That is the distinction the label carries — "All
 * branches" rather than a blank control — because a filter that silently means "nothing" produces
 * an empty page that looks broken.
 */

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterMultiSelectProps {
  label: string;
  /** Shown when nothing is ticked, e.g. "All branches". */
  allLabel: string;
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /** Offer the search box above this many options. */
  searchAfter?: number;
  disabled?: boolean;
}

export function FilterMultiSelect({
  label, allLabel, options, selected, onChange, searchAfter = 8, disabled = false,
}: FilterMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Close on an outside click or Escape. Without this the panel stays open behind the next one the
  // user opens, and two open panels overlap into something unreadable.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /* A selection that survives an option disappearing is a filter nobody can clear: the id stays in
   * the query string, the page stays narrowed, and no ticked box explains why. Options change with
   * the period, so anything no longer offered is dropped. */
  const known = useMemo(() => new Set(options.map((o) => o.value)), [options]);
  useEffect(() => {
    if (options.length === 0) return;
    const live = selected.filter((value) => known.has(value));
    if (live.length !== selected.length) onChange(live);
  }, [known, options.length, onChange, selected]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, query]);

  const selectedLabels = options.filter((o) => selected.includes(o.value)).map((o) => o.label);
  const summary =
    selectedLabels.length === 0 ? allLabel
      : selectedLabels.length <= 2 ? selectedLabels.join(", ")
      : `${selectedLabels.length} selected`;

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div className="flex min-w-[172px] flex-col gap-1" ref={containerRef}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <div className="relative">
        <button
          type="button"
          id={id}
          disabled={disabled || options.length === 0}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800"
        >
          <span className={`truncate ${selectedLabels.length ? "" : "text-slate-500"}`}>{summary}</span>
          <span className="flex shrink-0 items-center gap-1">
            {selectedLabels.length > 0 && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`Clear ${label} filter`}
                onClick={(e) => { e.stopPropagation(); onChange([]); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onChange([]); } }}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700"
              >
                <X className="h-3 w-3" />
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </span>
        </button>

        {open && (
          <div
            role="listbox"
            aria-multiselectable="true"
            aria-labelledby={id}
            className="absolute z-30 mt-1 max-h-72 w-[max(100%,240px)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
          >
            {options.length > searchAfter && (
              <div className="border-b border-slate-100 p-2 dark:border-slate-800">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${label.toLowerCase()}...`}
                  className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[12.5px] outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            )}
            <div className="flex items-center justify-between border-b border-slate-100 px-2.5 py-1.5 text-[11.5px] dark:border-slate-800">
              <span className="text-slate-500">
                {selectedLabels.length === 0 ? allLabel : `${selectedLabels.length} of ${options.length}`}
              </span>
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={selectedLabels.length === 0}
                className="font-medium text-teal-700 disabled:text-slate-300 dark:text-teal-400 dark:disabled:text-slate-600"
              >
                Clear
              </button>
            </div>
            <ul className="max-h-52 overflow-y-auto py-1">
              {visible.length === 0 && (
                <li className="px-2.5 py-2 text-[12.5px] text-slate-500">No match</li>
              )}
              {visible.map((option) => {
                const isOn = selected.includes(option.value);
                return (
                  <li key={option.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isOn}
                      onClick={() => toggle(option.value)}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
                          isOn
                            ? "border-teal-700 bg-teal-700 text-white"
                            : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"
                        }`}
                      >
                        {isOn && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
                      </span>
                      <span className="truncate">{option.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
