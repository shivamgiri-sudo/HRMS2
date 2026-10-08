/**
 * "Confirmed to attend" for one drive, which is also the arrival checklist: slot, name, masked mobile, how and when they confirmed, other
 * channels they also said yes on, a flag when a later answer went against the confirm, and arrival. Print opens a plain checklist page.
 * ConfirmedView is presentational; the default export loads GET /api/he/drives/:id/confirmed. Mark confirmed (write roles only) opens the
 * manual dialog for a row.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Printer, UserCheck, XCircle, History } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { BTN } from "../command/charts/ChartFrame";
import { checklistHtml, confirmedHeading, confirmedPath, confirmedRows, confirmedSummary, type ArrivalState, type ConfirmedRowView, type DriveConfirmed } from "./confirmedModel";
import ManualConfirmDialog from "./ManualConfirmDialog";
import type { ManualTarget } from "./manualConfirmModel";
import TimelineDrawer from "./TimelineDrawer";
import type { TimelineKey } from "./timelineModel";

const ARRIVAL_ICON: Record<ArrivalState, typeof Clock> = { arrived: CheckCircle2, expected: Clock, no_show: XCircle, changed: AlertTriangle };
const ARRIVAL_CLASS: Record<ArrivalState, string> = {
  arrived: "text-emerald-800 dark:text-emerald-200", expected: "text-slate-800 dark:text-slate-100", no_show: "text-rose-800 dark:text-rose-200", changed: "text-amber-900 dark:text-amber-200",
};

export interface ConfirmedViewProps {
  data: DriveConfirmed | null; loading: boolean; error: string | null; canWrite: boolean;
  onRetry: () => void; onPrint: () => void; onMark: (r: ConfirmedRowView) => void; onOpen: (r: ConfirmedRowView) => void; headingLevel?: "h3" | "h4";
}

export function ConfirmedView({ data, loading, error, canWrite, onRetry, onPrint, onMark, onOpen, headingLevel = "h3" }: ConfirmedViewProps) {
  const H = headingLevel;
  if (loading && !data) return <div className="h-32 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" role="status" aria-label="Loading the confirmed list" />;
  if (error && !data) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> <span className="flex-1">Could not load the confirmed list: {error}</span>
        <button type="button" className={BTN} onClick={onRetry}>Retry</button>
      </div>
    );
  }
  if (!data) return null;
  const rows = confirmedRows(data);
  return (
    <section className="space-y-2" aria-label={confirmedHeading(data)} data-confirmed-list>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <H className="text-sm font-bold text-slate-900 dark:text-slate-100">{confirmedHeading(data)}</H>
          <p className="text-xs text-slate-700 dark:text-slate-200">{data.drive.requisitionCode} {data.drive.role} · {data.drive.branch} · {data.drive.date} · {confirmedSummary(data)}</p>
        </div>
        <button type="button" className={BTN} onClick={onPrint} disabled={!rows.length} aria-label="Print the arrival checklist"><Printer className="h-3.5 w-3.5" aria-hidden /> Print checklist</button>
      </div>
      {!rows.length ? <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-200">No one has confirmed for this drive yet.</p> : (
        <div className="relative overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[720px] text-left text-sm text-slate-800 dark:text-slate-100">
            <caption className="sr-only">People confirmed to attend, by slot, with how they confirmed and whether they arrived</caption>
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr><th scope="col" className="px-3 py-2">Slot</th><th scope="col" className="px-3 py-2">Name</th><th scope="col" className="px-3 py-2">Confirmed via</th><th scope="col" className="px-3 py-2">At</th>
                <th scope="col" className="px-3 py-2">Also said yes on</th><th scope="col" className="px-3 py-2">Arrival</th><th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => {
                const Icon = ARRIVAL_ICON[r.arrival];
                return (
                  <tr key={r.matchId} data-match={r.matchId}>
                    <td className="px-3 py-2 tabular-nums">{r.slot}</td>
                    <td className="px-3 py-2"><div className="font-medium">{r.name}</div><div className="text-xs text-slate-600 dark:text-slate-300">{r.mobile}</div></td>
                    <td className="px-3 py-2"><span className="inline-flex items-center gap-1"><UserCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />{r.via}</span></td>
                    <td className="px-3 py-2 text-xs">{r.at}</td>
                    <td className="px-3 py-2 text-xs">{r.also || "–"}</td>
                    <td className={`px-3 py-2 ${ARRIVAL_CLASS[r.arrival]}`}>
                      <span className="inline-flex items-center gap-1"><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />{r.arrivalText}</span>
                      {r.conflict && <span className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-amber-900 dark:text-amber-200"><AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />Conflict: answered differently later</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button type="button" className={BTN} onClick={() => onOpen(r)} aria-label={`Timeline of ${r.name}`}><History className="h-3.5 w-3.5" aria-hidden /> Timeline</button>
                        {canWrite && r.arrival !== "arrived" && <button type="button" className={BTN} onClick={() => onMark(r)} aria-label={`Record an answer for ${r.name}`}>Record answer</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Prints the checklist (escaped, masked mobiles only) from a hidden frame, so no pop-up is needed and the page itself is not printed. */
function printChecklist(d: DriveConfirmed): void {
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  f.onload = () => { f.contentWindow?.focus(); f.contentWindow?.print(); window.setTimeout(() => f.remove(), 60_000); };
  f.srcdoc = checklistHtml(d);
  document.body.appendChild(f);
}

export function useDriveConfirmed(driveId: string | null): { data: DriveConfirmed | null; loading: boolean; error: string | null; reload: () => void } {
  const [s, setS] = useState<{ data: DriveConfirmed | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!driveId) { setS({ data: null, loading: false, error: null }); return; }
    const c = new AbortController();
    setS((x) => ({ data: x.data?.drive.id === driveId ? x.data : null, loading: true, error: null }));
    hrmsApi.get<{ data?: DriveConfirmed }>(confirmedPath(driveId), undefined, c.signal)
      .then((r) => { if (!c.signal.aborted) setS({ data: r?.data ?? null, loading: false, error: r?.data ? null : "No data" }); })
      .catch((e: unknown) => { if (!c.signal.aborted) setS((x) => ({ data: x.data, loading: false, error: String((e as Error)?.message || "Request failed") })); });
    return () => c.abort();
  }, [driveId, tick]);
  return { ...s, reload: useCallback(() => setTick((n) => n + 1), []) };
}

export default function ConfirmedList({ driveId, canWrite, headingLevel }: { driveId: string | null; canWrite: boolean; headingLevel?: "h3" | "h4" }) {
  const c = useDriveConfirmed(driveId);
  const [mark, setMark] = useState<ManualTarget | null>(null);
  const [open, setOpen] = useState<TimelineKey | null>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <p role="status" className="text-sm text-emerald-800 empty:hidden dark:text-emerald-200">{note}</p>
      <ConfirmedView data={c.data} loading={c.loading} error={c.error} canWrite={canWrite} onRetry={c.reload} headingLevel={headingLevel}
        onPrint={() => { if (c.data) printChecklist(c.data); }} onOpen={(r) => setOpen({ matchId: r.matchId })}
        onMark={(r) => setMark({ leadId: r.leadId, name: r.name, requisitionId: c.data?.drive.requisitionId ?? null, slotAt: r.slotAt })} />
      {canWrite && <ManualConfirmDialog target={mark} choices={c.data ? [{ id: c.data.drive.requisitionId, label: `${c.data.drive.requisitionCode} ${c.data.drive.role}` }] : []}
        onClose={() => setMark(null)} onDone={(t) => { setNote(t); c.reload(); }} />}
      <TimelineDrawer k={open} onClose={() => setOpen(null)} />
    </div>
  );
}
