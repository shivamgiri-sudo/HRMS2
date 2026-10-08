/** Result line of Notify All: sent / skipped / failed as icon + word, with the most common skip reasons. */
import { CheckCircle2, CircleSlash, XCircle } from "lucide-react";
import type { BulkTotals } from "./metaNotifyAll";

export function BulkNotifyResult({ r }: { r: BulkTotals }) {
  const top = Object.entries(r.reasons).sort((a, b) => b[1] - a[1]).slice(0, 2);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium text-slate-700 dark:text-slate-200" role="status">
      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" aria-hidden />{r.sent} sent</span>
      {r.skipped > 0 && <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300"><CircleSlash className="h-4 w-4" aria-hidden />{r.skipped} skipped</span>}
      {r.failed > 0 && <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400"><XCircle className="h-4 w-4" aria-hidden />{r.failed} failed</span>}
      {top.length > 0 && <span className="text-xs text-slate-500 dark:text-slate-400">{top.map(([k, n]) => `${k} (${n})`).join("; ")}</span>}
    </span>
  );
}
