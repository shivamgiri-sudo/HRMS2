import { Lock, Unlock, ChevronDown, ChevronUp } from "lucide-react";
import type { KeyboardEvent } from "react";

interface SessionContextPanelProps {
  process_name: string;
  hiring_source: string;
  position_name: string;
  wp_group: string;
  locked: boolean;
  processOptions: string[];
  sourceOptions: string[];
  positionOptions: string[];
  wpGroupOptions: string[];
  onUpdate: (field: string, value: string) => void;
  onToggleLock: () => void;
  onKeyAdvance?: (field: string) => (e: KeyboardEvent<HTMLElement>) => void;
}

export function SessionContextPanel({
  process_name,
  hiring_source,
  position_name,
  wp_group,
  locked,
  processOptions,
  sourceOptions,
  positionOptions,
  wpGroupOptions,
  onUpdate,
  onToggleLock,
  onKeyAdvance,
}: SessionContextPanelProps) {
  // Compact badge text for locked state
  const badgeText = locked
    ? [process_name || "Process", hiring_source || "Source", position_name || "Position", wp_group || "WP Group"]
        .join(" • ")
    : "";

  // Check if all required fields are filled
  const canLock = Boolean(process_name && hiring_source && position_name && wp_group);

  if (locked) {
    return (
      <section className="rounded-3xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-sky-50 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
              <Lock className="h-5 w-5 text-emerald-700" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
                Session Context Locked
              </div>
              <div className="mt-1 text-sm font-bold text-slate-800">{badgeText}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleLock}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <Unlock className="h-4 w-4" />
            Change Context
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-slate-950">
            <ChevronDown className="h-4 w-4 text-amber-600" />
            Session Context (set once per batch)
          </div>
          <div className="mt-1 text-sm text-slate-600">
            Fill these four fields and lock to reuse for all candidates in this calling session.
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleLock}
          disabled={!canLock}
          className={`inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-bold ${
            canLock
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "cursor-not-allowed bg-slate-200 text-slate-500"
          }`}
          title={canLock ? "Lock context and start rapid entry" : "Fill all four fields first"}
        >
          <Lock className="h-4 w-4" />
          Lock Context
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            <span>Process Name</span>
            <span className="text-rose-500">*</span>
          </div>
          <select
            value={process_name}
            onChange={(e) => onUpdate("process_name", e.target.value)}
            onKeyDown={onKeyAdvance?.("process_name")}
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
          >
            <option value="">Select process</option>
            {processOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            <span>Hiring Source</span>
            <span className="text-rose-500">*</span>
          </div>
          <select
            value={hiring_source}
            onChange={(e) => onUpdate("hiring_source", e.target.value)}
            onKeyDown={onKeyAdvance?.("hiring_source")}
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
          >
            <option value="">Walk-in, portal, reference...</option>
            {sourceOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            <span>Position</span>
            <span className="text-rose-500">*</span>
          </div>
          <select
            value={position_name}
            onChange={(e) => onUpdate("position_name", e.target.value)}
            onKeyDown={onKeyAdvance?.("position_name")}
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
          >
            <option value="">Select position</option>
            {positionOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
            <span>WP Group</span>
            <span className="text-rose-500">*</span>
          </div>
          <select
            value={wp_group}
            onChange={(e) => onUpdate("wp_group", e.target.value)}
            onKeyDown={onKeyAdvance?.("wp_group")}
            className="h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
          >
            <option value="">Select WP group</option>
            {wpGroupOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!canLock && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800">
          <ChevronUp className="h-3 w-3" />
          Fill all four fields above to enable context locking
        </div>
      )}
    </section>
  );
}
