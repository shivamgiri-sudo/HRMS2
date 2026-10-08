/**
 * One person's timeline of messages, answers, status changes and calls (newest first, by day). TimelineView is presentational;
 * TimelineSection loads it by a response, match or lead id (also used inside Candidate 360); the default export is the side drawer.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Flag, MessageSquareText, PhoneCall, AlertTriangle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BTN } from "../command/charts/ChartFrame";
import { keyOf, timelineDays, timelinePath, type Timeline, type TimelineKey, type TimelineKind } from "./timelineModel";

const ICON: Record<TimelineKind, typeof Flag> = { out: ArrowUpRight, in: ArrowDownLeft, response: MessageSquareText, event: Flag, call: PhoneCall };

export function TimelineView({ data, loading, error, onRetry }: { data: Timeline | null; loading: boolean; error: string | null; onRetry?: () => void }) {
  if (loading && !data) return <div className="h-40 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" role="status" aria-label="Loading the timeline" />;
  if (error && !data) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> <span className="flex-1">Could not load the timeline: {error}</span>
        {onRetry && <button type="button" className={BTN} onClick={onRetry}>Retry</button>}
      </div>
    );
  }
  const days = timelineDays(data);
  if (!days.length) return <p className="text-sm text-slate-700 dark:text-slate-200">Nothing recorded for this person yet.</p>;
  return (
    <div className="space-y-4" data-timeline>
      {data?.truncated && <p className="text-xs text-slate-700 dark:text-slate-200">Showing the latest 300 items.</p>}
      {days.map((d) => (
        <section key={d.day} aria-label={d.dayText}>
          <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">{d.dayText}</h4>
          <ol className="space-y-1.5 border-l border-slate-200 pl-3 dark:border-slate-700">
            {d.items.map((i, n) => {
              const Icon = ICON[i.kind] ?? Flag;
              return (
                <li key={`${i.at}-${n}`} className="text-sm text-slate-800 dark:text-slate-100" data-kind={i.kind}>
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="w-11 shrink-0 tabular-nums text-xs text-slate-600 dark:text-slate-300">{i.time}</span>
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="font-semibold">{i.kindWord}</span>
                    {i.channelWord && <span className="text-xs text-slate-600 dark:text-slate-300">{i.channelWord}</span>}
                    <span className="min-w-0">{i.label}</span>
                  </div>
                  {i.detail && <p className="ml-11 break-words text-xs text-slate-700 dark:text-slate-200">{i.detail}</p>}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function useTimeline(k: TimelineKey | null): { data: Timeline | null; loading: boolean; error: string | null; reload: () => void } {
  const [state, setState] = useState<{ data: Timeline | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null });
  const [tick, setTick] = useState(0);
  const key = keyOf(k);
  useEffect(() => {
    if (!k) return;
    const c = new AbortController();
    setState({ data: null, loading: true, error: null });
    hrmsApi.get<{ data?: Timeline }>(timelinePath(k), undefined, c.signal)
      .then((r) => { if (!c.signal.aborted) setState({ data: r?.data ?? null, loading: false, error: r?.data ? null : "No data" }); })
      .catch((e: unknown) => { if (!c.signal.aborted) setState({ data: null, loading: false, error: (e as { status?: number })?.status === 404 ? "Not found in your branch" : String((e as Error)?.message || "Request failed") }); });
    return () => c.abort();
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: useCallback(() => setTick((n) => n + 1), []) };
}

export function TimelineSection({ k }: { k: TimelineKey | null }) {
  const t = useTimeline(k);
  return <TimelineView data={t.data} loading={t.loading} error={t.error} onRetry={t.reload} />;
}

export default function TimelineDrawer({ k, title, onClose }: { k: TimelineKey | null; title?: string; onClose: () => void }) {
  const t = useTimeline(k);
  return (
    <Sheet open={k != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t.data ? `${t.data.person.name} · ${t.data.person.mobileMasked}` : title ?? "Timeline"}</SheetTitle>
          <SheetDescription className="text-slate-700 dark:text-slate-200">Every message, answer, status change and call, newest first.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 pb-8"><TimelineView data={t.data} loading={t.loading} error={t.error} onRetry={t.reload} /></div>
      </SheetContent>
    </Sheet>
  );
}
