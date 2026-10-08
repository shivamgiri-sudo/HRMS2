import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, Check } from "lucide-react";
import { Empty, ErrorBox, FOCUS, Skeleton, btn } from "../ui";
import { ackEvent, alertsKey, fetchEvents, type AlertEvent } from "./api";
import { errMsg, when } from "./alertUi";
import { SeverityBadge } from "./SeverityBadge";

type Filter = "open" | "acknowledged" | "all";
const FILTERS: Array<[Filter, string]> = [["open", "Open"], ["acknowledged", "Acknowledged"], ["all", "All"]];

function EventCard({ e, onAck, busy }: { e: AlertEvent; onAck: () => void; busy: boolean }) {
  const acked = !!e.acknowledgedAt;
  return (
    <li className={`rounded-xl border p-3 ${acked ? "border-slate-200 bg-slate-50" : e.severity === "critical" ? "border-red-300 bg-red-50/50" : "border-amber-300 bg-amber-50/40"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900"><SeverityBadge s={e.severity} />{e.ruleName ?? "Deleted rule"}</p>
          <p className="mt-1 text-sm text-slate-900">{e.message}</p>
          <p className="mt-1 text-xs text-slate-700">Data date {e.dataDate} · fired {when(e.firedAt)} · {e.notified ? "notification sent" : "no notification delivered"}{acked ? ` · acknowledged ${when(e.acknowledgedAt)}` : ""}</p>
          {e.context?.agents && e.context.agents.length > 0 && (
            <details className="mt-2 text-xs text-slate-800"><summary className={`min-h-[32px] cursor-pointer font-semibold ${FOCUS}`}>{e.context.agents.length} agent{e.context.agents.length === 1 ? "" : "s"} flagged</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{e.context.agents.map((a) => <li key={a.agentCode}><b>{a.name ?? a.agentCode}</b> ({a.agentCode}): {a.detail}</li>)}</ul></details>
          )}
        </div>
        {acked ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800"><Check className="h-3.5 w-3.5" aria-hidden="true" />Acknowledged</span>
          : <button type="button" onClick={onAck} disabled={busy} className={btn}><Check className="h-3.5 w-3.5" aria-hidden="true" />Acknowledge<span className="sr-only"> alert {e.ruleName}</span></button>}
      </div>
    </li>
  );
}

export function EventsFeed({ processId }: { processId: string }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("open");
  const q = useQuery({ queryKey: alertsKey(processId, "events", filter), queryFn: () => fetchEvents(processId, filter), refetchInterval: 60_000 });
  const ack = useMutation({ mutationFn: (id: string) => ackEvent(processId, id), onSuccess: () => void qc.invalidateQueries({ queryKey: alertsKey(processId) }) });
  return (
    <section aria-label="Alert events" className="space-y-3">
      <div role="group" aria-label="Filter events" className="flex flex-wrap gap-1">
        {FILTERS.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={`min-h-[36px] cursor-pointer rounded-lg px-3 text-xs font-semibold ${FOCUS} ${filter === k ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-800 hover:bg-slate-200"}`}>
            {l}{k === "open" && q.data ? ` (${q.data.open})` : ""}</button>
        ))}
      </div>
      {ack.isError && <ErrorBox message={errMsg(ack.error, "Could not acknowledge the alert.")} />}
      {q.isLoading ? <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        : q.isError ? <ErrorBox message={errMsg(q.error, "Could not load alerts.")} onRetry={() => void q.refetch()} />
        : q.data && q.data.rows.length === 0 ? <Empty><BellOff className="mx-auto mb-1 h-5 w-5 text-slate-500" aria-hidden="true" />{filter === "open" ? "No open alerts. Everything is within your thresholds." : "Nothing here yet."}</Empty>
        : <ul className="space-y-2">{q.data?.rows.map((e) => <EventCard key={e.id} e={e} busy={ack.isPending && ack.variables === e.id} onAck={() => ack.mutate(e.id)} />)}</ul>}
    </section>
  );
}
