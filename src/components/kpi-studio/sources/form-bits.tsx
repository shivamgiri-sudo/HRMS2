import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";

/** Shared by every select on the Data Sources screen so focus and sizing stay identical. */
export const selectClass =
  "w-full cursor-pointer rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1";

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1";

/** A label tied to its input by id, with an optional "what this means" line underneath. */
export function Field({
  id,
  label,
  hint,
  children,
  className = "",
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-[11px] leading-snug text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Problems that stop a save, shown next to the Save button. Renders nothing when there are none. */
export function Problems({ items }: { items: readonly string[] }) {
  if (!items.length) return null;
  return (
    <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-1.5">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
