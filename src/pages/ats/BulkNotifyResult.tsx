/** Result line of Notify All: sent / skipped / failed as icon + word, the most common skip reasons, and every failed lead with its reason. */
import { AlertTriangle, CheckCircle2, CircleSlash, XCircle } from "lucide-react";
import type { BulkTotals } from "./metaNotifyAll";

export function BulkNotifyResult({ r, names }: { r: BulkTotals; names?: Record<string, string> }) {
  if (r.unavailable) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-amber-900 dark:text-amber-200" role="status">
        <AlertTriangle className="h-4 w-4" aria-hidden />Notify All is not available on this server yet. Nothing was sent; use Notify on each lead.
      </span>
    );
  }
  const top = Object.entries(r.reasons).sort((a, b) => b[1] - a[1]).slice(0, 2);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-slate-700 dark:text-slate-200" role="status">
      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" aria-hidden />{r.sent} sent</span>
      {r.skipped > 0 && <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300"><CircleSlash className="h-4 w-4" aria-hidden />{r.skipped} skipped</span>}
      {r.failed > 0 && <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400"><XCircle className="h-4 w-4" aria-hidden />{r.failed} failed</span>}
      {top.length > 0 && <span className="text-xs text-slate-500 dark:text-slate-400">{top.map(([k, n]) => `${k} (${n})`).join("; ")}</span>}
      {r.failures.length > 0 && (
        <details className="w-full text-xs font-normal">
          <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Show the {r.failures.length} failed lead{r.failures.length === 1 ? "" : "s"}</summary>
          <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-slate-700 dark:text-slate-200">
            {r.failures.map((f) => <li key={f.leadId}>{names?.[f.leadId] ?? f.leadId}: {f.reason}</li>)}
          </ul>
        </details>
      )}
    </span>
  );
}
