/**
 * Held offers inside the Follow-up panel: people with several open requisitions who are offered one at a time. Read-only (no buttons).
 * The list sits in a native <details> (collapsed by default); server text is rendered as React text after the model's scrubbing.
 */
import { Info, PauseCircle, AlertTriangle } from "lucide-react";
import { HELD_OFF_SENTENCE, HELD_PARTIAL_SENTENCE, heldState, heldTitle, type HeldOffers as HeldData } from "./heldOffersModel";

export default function HeldOffers({ held, now }: { held: HeldData | null | undefined; now?: number }) {
  const s = heldState(held, now);
  if (!s) return null;
  if (s.kind === "off") {
    return <p className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><Info className="h-4 w-4 shrink-0" aria-hidden /> {HELD_OFF_SENTENCE}.</p>;
  }
  if (s.kind === "partial") {
    return <p role="alert" className="flex items-center gap-2 text-sm text-amber-900 dark:text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {HELD_PARTIAL_SENTENCE}.</p>;
  }
  if (s.kind === "empty") {
    return <p className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><PauseCircle className="h-4 w-4 shrink-0" aria-hidden /> Held: no one is waiting for another offer.</p>;
  }
  return (
    <details className="rounded-lg border border-slate-200 dark:border-slate-700">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-100">
        <PauseCircle className="h-4 w-4 shrink-0" aria-hidden />{heldTitle(s.total)}
      </summary>
      {s.truncated && <p className="px-2 text-xs text-slate-700 dark:text-slate-200">Showing the first {s.total}; more are held.</p>}
      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {s.rows.map((r) => (
          <li key={r.id} className="space-y-0.5 px-2 py-2">
            <p className="text-sm text-slate-900 dark:text-slate-100"><span className="font-semibold">{r.name}</span> <span>{r.mobile}</span> <span className="text-slate-700 dark:text-slate-200">({r.code})</span></p>
            <p className="text-xs text-slate-800 dark:text-slate-100">{r.line}. Qualified {r.age}.</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
