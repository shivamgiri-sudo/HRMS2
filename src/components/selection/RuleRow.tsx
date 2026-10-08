/** One rule in the editor (S16): plain label, MUST / PREFER / No requirement (radio group, arrow keys), weight, unknown policy, value. */
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Lock, Minus, Plus } from "lucide-react";
import type { RowMode, RowState } from "./criteriaEditorModel";
import type { MissingPolicy } from "./selectionTypes";

export const FIELD = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 sm:min-h-9";
export const SMALL_BTN = "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-100 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 sm:min-h-8 sm:min-w-8";
const MODES: ReadonlyArray<{ id: Exclude<RowMode, "undecided">; label: string }> = [{ id: "must", label: "MUST" }, { id: "prefer", label: "PREFER" }, { id: "off", label: "No requirement" }];
const POLICIES: ReadonlyArray<{ id: MissingPolicy; label: string }> = [{ id: "review", label: "Ask HR (review)" }, { id: "fail", label: "Treat as not meeting it" }, { id: "pass", label: "Treat as meeting it" }];
export const PER_SOURCE: ReadonlyArray<{ id: string; label: string }> = [
  { id: "meta_live", label: "Live Meta" }, { id: "meta_old", label: "Old Meta data" }, { id: "he", label: "Hiring Engine pool" }, { id: "naukri_import", label: "Naukri upload" }, { id: "workindia_import", label: "WorkIndia upload" },
];

export function ModeGroup({ label, value, disabled, onChange }: { label: string; value: RowMode; disabled: boolean; onChange: (m: RowMode) => void }) {
  const at = MODES.findIndex((m) => m.id === value);
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || disabled) return;
    e.preventDefault();
    onChange(MODES[((at < 0 ? 0 : at) + step + MODES.length) % MODES.length].id);
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKey} className="inline-flex flex-wrap gap-1">
      {MODES.map((m, i) => {
        const on = m.id === value;
        return (
          <button key={m.id} type="button" role="radio" aria-checked={on} disabled={disabled} tabIndex={on || (at < 0 && i === 0) ? 0 : -1} onClick={() => onChange(m.id)}
            className={`${SMALL_BTN} ${on ? "border-blue-700 bg-blue-700 text-white hover:bg-blue-700 dark:border-blue-400 dark:bg-blue-400 dark:text-slate-950" : ""}`}>{m.label}</button>
        );
      })}
    </div>
  );
}

export interface RuleRowProps {
  ruleKey: string; label: string; row: RowState; readOnly: boolean; lock: string | null; coverage?: string | null; children?: ReactNode;
  onMode: (m: RowMode) => void; onWeight: (w: number) => void; onMissing: (m: MissingPolicy, bySource: Record<string, MissingPolicy>) => void;
}

export default function RuleRow({ ruleKey, label, row, readOnly, lock, coverage, children, onMode, onWeight, onMissing }: RuleRowProps) {
  const id = useId().replaceAll(":", "");
  const [perSource, setPerSource] = useState(Object.keys(row.missingBySource).length > 0);
  const disabled = readOnly || !!lock;
  return (
    <li id={`rule-${ruleKey}`} className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700" aria-labelledby={`${id}-label`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`${id}-label`} className="min-w-0 break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</span>
        {row.mode === "undecided"
          ? <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">{row.defaulted ? "Not decided: acts as MUST now" : row.today ? `Not decided: today's screening treats it as ${row.today}` : "Not decided"}</span>
          : null}
        {lock && <span className="inline-flex items-center gap-1 text-xs text-slate-700 dark:text-slate-200"><Lock className="h-3.5 w-3.5" aria-hidden="true" />{lock}</span>}
      </div>
      {!readOnly && <ModeGroup label={`${label}: how it counts`} value={row.mode} disabled={disabled} onChange={onMode} />}
      {readOnly && <p className="text-xs text-slate-700 dark:text-slate-200">{row.mode === "undecided" ? "Not decided" : MODES.find((m) => m.id === row.mode)?.label}</p>}
      {row.mode === "prefer" && !readOnly && (
        <div className="flex items-center gap-2" role="group" aria-label={`${label}: weight`}>
          <button type="button" aria-label={`Lower the weight of ${label}`} disabled={disabled || row.weight <= 0} onClick={() => onWeight(row.weight - 5)} className={SMALL_BTN}><Minus className="h-4 w-4" aria-hidden="true" /></button>
          <span className="min-w-[4rem] text-center text-sm tabular-nums" aria-live="polite">Weight {row.weight}</span>
          <button type="button" aria-label={`Raise the weight of ${label}`} disabled={disabled || row.weight >= 50} onClick={() => onWeight(row.weight + 5)} className={SMALL_BTN}><Plus className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      )}
      {row.mode === "must" && !readOnly && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200" htmlFor={`${id}-missing`}>If we don't know</label>
          <select id={`${id}-missing`} value={row.missing} disabled={disabled} onChange={(e) => onMissing(e.target.value as MissingPolicy, row.missingBySource)} className={FIELD}>
            {POLICIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button type="button" aria-expanded={perSource} aria-controls={`${id}-per-source`} onClick={() => setPerSource((v) => !v)} className={SMALL_BTN}>
            {perSource ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />} Per source
          </button>
          <div id={`${id}-per-source`} hidden={!perSource} className="grid gap-2 sm:grid-cols-2">
            {PER_SOURCE.map((s) => (
              <label key={s.id} className="block text-xs text-slate-700 dark:text-slate-200">{s.label}
                <select value={row.missingBySource[s.id] ?? ""} disabled={disabled} className={FIELD}
                  onChange={(e) => { const next = { ...row.missingBySource }; if (e.target.value) next[s.id] = e.target.value as MissingPolicy; else delete next[s.id]; onMissing(row.missing, next); }}>
                  <option value="">Same as above</option>
                  {POLICIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
      {children}
      {coverage && <p className="text-xs text-slate-600 dark:text-slate-300">{coverage}</p>}
    </li>
  );
}
