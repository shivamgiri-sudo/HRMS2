/**
 * HR review queue: free-text replies the system could not read with certainty, oldest first, each with the suggested class and how sure
 * it is. One click applies a class (Will come / Cannot come / Another time go through the same booking path as a tap; Question records
 * it only) or ignores the reply. The row leaves the list at once and comes back if the save fails (409: someone else handled it).
 * Nothing is applied automatically. Buttons only for write roles. QueueView is presentational.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, History, Inbox, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { BTN } from "../command/charts/ChartFrame";
import { AnswerBadge, ChannelBadge } from "./ResponseBadges";
import { QUEUE_ACTIONS, QUEUE_PATH, actionError, ageText, confidenceText, confirmPrompt, queueBuckets, withoutRow, type QueueAction, type ResponseQueueData, type ResponseRow } from "./responsesModel";

export interface QueueViewProps {
  data: ResponseQueueData | null; loading: boolean; error: string | null; canWrite: boolean; busyId: number | null; message: string | null; nowMs?: number;
  onAction: (row: ResponseRow, a: QueueAction) => void; onOpen: (row: ResponseRow) => void; onRetry: () => void;
}

export function QueueView({ data, loading, error, canWrite, busyId, message, nowMs, onAction, onOpen, onRetry }: QueueViewProps) {
  const total = data?.counts.total ?? 0;
  return (
    <section aria-labelledby="queue-heading" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-queue>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="queue-heading" className="text-sm font-bold text-slate-900 dark:text-slate-100">Replies waiting for HR ({total})</h3>
        {data && total > 0 && <p className="text-xs text-slate-700 dark:text-slate-200">{queueBuckets(data.counts).filter((b) => b.n > 0).map((b) => `${b.n} ${b.label}`).join(" · ")}</p>}
      </div>
      <p className="text-xs text-slate-700 dark:text-slate-200">Replies in free text are never applied automatically. Pick what the candidate meant; a booking changes only when you pick Will come, Cannot come or Another time.</p>
      <p role="status" className="text-sm text-slate-800 empty:hidden dark:text-slate-100">{message}</p>
      {loading && !data && <div className="h-24 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" role="status" aria-label="Loading the queue" />}
      {error && !data && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-rose-800 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> <span className="flex-1">Could not load the queue: {error}</span>
          <button type="button" className={BTN} onClick={onRetry}>Retry</button>
        </div>
      )}
      {data && data.rows.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><Inbox className="h-4 w-4 shrink-0" aria-hidden /> No reply is waiting. Clear replies are applied as they come in.</p>
      )}
      {data && data.rows.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.rows.map((r) => (
            <li key={r.id} className="space-y-1.5 py-2" data-response={r.id}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{r.person.name}</span>
                <span className="text-xs text-slate-600 dark:text-slate-300">{r.person.mobileMasked}</span>
                <ChannelBadge channel={r.channel} />
                <span className="text-xs text-slate-700 dark:text-slate-200">{ageText(r.occurredAt, nowMs)} ago{r.requisitionCode ? ` · ${r.requisitionCode}` : ""}</span>
                {r.suggested && <span className="inline-flex items-center gap-1 text-xs text-slate-700 dark:text-slate-200"><AnswerBadge answer={r.suggested} prefix="Looks like" />{confidenceText(r.confidence)}</span>}
              </div>
              <p className="break-words rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-900 dark:bg-slate-800 dark:text-slate-100">{r.textPreview || "(no text)"}</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={BTN} onClick={() => onOpen(r)} aria-label={`Timeline of ${r.person.name}`}><History className="h-3.5 w-3.5" aria-hidden /> Timeline</button>
                {canWrite && QUEUE_ACTIONS.map((a) => (
                  <button key={a.label} type="button" className={BTN} disabled={busyId != null} onClick={() => onAction(r, a)} aria-label={`${a.label}: ${r.person.name}`}>
                    {busyId === r.id && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />}{a.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function useResponseQueue(): { data: ResponseQueueData | null; setData: (f: (d: ResponseQueueData | null) => ResponseQueueData | null) => void; loading: boolean; error: string | null; reload: () => void } {
  const [data, setDataState] = useState<ResponseQueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const reload = useCallback(() => {
    setLoading(true);
    hrmsApi.get<{ data?: ResponseQueueData }>(QUEUE_PATH)
      .then((r) => { if (alive.current) { setDataState(r?.data ?? null); setError(null); } })
      .catch((e: unknown) => { if (alive.current) setError(String((e as Error)?.message || "Request failed")); })
      .finally(() => { if (alive.current) setLoading(false); });
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { data, setData: setDataState, loading, error, reload };
}

export default function ResponseQueue({ canWrite, onOpen, onChanged, refreshSignal = 0 }: { canWrite: boolean; onOpen: (row: ResponseRow) => void; onChanged?: () => void; refreshSignal?: number }) {
  const q = useResponseQueue();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (refreshSignal) q.reload(); }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (row: ResponseRow, a: QueueAction) => {
    const ask = confirmPrompt(row, a);
    if (ask && !window.confirm(ask)) return;
    const cut = withoutRow(q.data?.rows ?? [], row.id);
    q.setData((d) => (d ? { ...d, rows: cut.rows, counts: { ...d.counts, total: Math.max(0, d.counts.total - 1) } } : d));
    setBusyId(row.id); setMessage(null);
    try {
      if ("ignore" in a) await hrmsApi.post(`/api/he/responses/${row.id}/ignore`, { reason: "Ignored by HR from the review queue" });
      else await hrmsApi.post(`/api/he/responses/${row.id}/classify`, { answer: a.answer, apply: a.apply });
      setMessage(`Saved: ${row.person.name}, ${a.label}.`);
      onChanged?.();
    } catch (e: unknown) {
      q.setData((d) => (d ? { ...d, rows: cut.restore(d.rows), counts: { ...d.counts, total: d.counts.total + 1 } } : d));
      setMessage(actionError(e));
      if ((e as { status?: number })?.status === 409) q.reload();
    } finally { setBusyId(null); }
  };
  return <QueueView data={q.data} loading={q.loading} error={q.error} canWrite={canWrite} busyId={busyId} message={message} onAction={(r, a) => void act(r, a)} onOpen={onOpen} onRetry={q.reload} />;
}
