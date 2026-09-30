import { useId, type ReactNode } from "react";

/** Small, consistent form controls for the dense config panel. Every input is tied to a visible label. */
const base = "h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:bg-slate-100 disabled:text-slate-500";

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-700">{label}</label>
      {children(id)}
      {hint && <p className="text-[11px] leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}

export function SelectInput({ id, value, onChange, options, disabled, ariaLabel }: {
  id?: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string; disabled?: boolean }>; disabled?: boolean; ariaLabel?: string;
}) {
  return (
    <select id={id} aria-label={ariaLabel} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`${base} cursor-pointer`}>
      {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
  );
}

export function TextInput({ id, value, onChange, placeholder, type = "text", ariaLabel, list }: {
  id?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; ariaLabel?: string; list?: string;
}) {
  return <input id={id} aria-label={ariaLabel} list={list} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={base} />;
}

export function NumberInput({ id, value, onChange, placeholder, min, max, step, ariaLabel }: {
  id?: string; value: number | undefined; onChange: (v: number | undefined) => void; placeholder?: string; min?: number; max?: number; step?: number; ariaLabel?: string;
}) {
  return (
    <input id={id} aria-label={ariaLabel} type="number" inputMode="decimal" min={min} max={max} step={step} placeholder={placeholder}
      value={value ?? ""} onChange={(e) => onChange(e.target.value === "" || Number.isNaN(Number(e.target.value)) ? undefined : Number(e.target.value))} className={base} />
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-400 accent-blue-700" />
      <label htmlFor={id} className="cursor-pointer text-sm text-slate-800">{label}{hint && <span className="block text-[11px] text-slate-500">{hint}</span>}</label>
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-2 border-b border-slate-200 px-3 py-3 last:border-b-0">
      <div className="flex items-center justify-between"><h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</h4>{action}</div>
      {children}
    </section>
  );
}

export const smallBtn = "inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 transition-colors duration-150 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50";
export const iconBtn = "inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600";
