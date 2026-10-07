/**
 * Plan section of the Drive Command Center: per-day target vs expected, recommended invites per stream with their reasoning (text),
 * what-if sliders (pure recomputation: nothing is saved, nothing is sent), the stream x day calendar, the D-1 checklist with Plan now,
 * and each stream's Extend menu (Task 14). PlanSectionView is presentational (static-markup tested); the default export loads data.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Inbox, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { createRequestSequencer, type RequisitionOption } from "./commandData";
import { dayLabel } from "./driveChartModel";
import { istTodayClient } from "./driveCommandModel";
import type { DriveGroup, DrivePlan, PlanDay, StreamView } from "./driveCommandTypes";
import {
  EMPTY_PLAN_TEXT, PICK_LABEL, QUOTA_MAX, clampQuota, coversDay, clampShowRate, dayRows, hasEdits, planPickList, planState, recomputeDay, sliderValues, streamRows,
  whatIfAnnouncement, type WhatIf,
} from "./planModel";
import { useDrivePlan } from "./useCommandData";
import { streamsOfRequisitionPath } from "./streamActionsModel";
import StreamActions, { BTN, FIELD, LABEL } from "./StreamActions";
import CreateStreamDialog from "./CreateStreamDialog";
import PlanCalendar from "./PlanCalendar";
import D1Checklist from "./D1Checklist";

const PULSE = "animate-pulse rounded-xl border border-slate-200 bg-slate-100 motion-reduce:animate-none dark:border-slate-700 dark:bg-slate-800";
const TH = "px-3 py-2 text-left text-xs font-semibold text-slate-800 dark:text-slate-100";
const TD = "px-3 py-2 text-slate-900 dark:text-slate-100";
const H4 = "text-sm font-bold text-slate-900 dark:text-slate-100";

/** What-if for one day: quota and show-rate per open stream, the recomputed result and a live region. Local state only. */
export function WhatIfPanel({ day }: { day: PlanDay }) {
  const [edits, setEdits] = useState<Record<string, WhatIf>>({});
  useEffect(() => setEdits({}), [day.date]);
  const uid = useId().replaceAll(":", "");
  const r = recomputeDay(day, edits);
  const open = (day.streams ?? []).filter(coversDay);
  const set = (id: string, patch: WhatIf) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const num = (t: string): number => (t.trim() === "" ? Number.NaN : Number(t));
  return (
    <section aria-labelledby={`${uid}-h`} className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`${uid}-h`} className={H4}>What if, for {dayLabel(day.date)}</h4>
        <button type="button" className={BTN} disabled={!hasEdits(edits)} onClick={() => setEdits({})}><RotateCcw className="h-4 w-4" aria-hidden /> Reset</button>
      </div>
      <p className="text-xs text-slate-700 dark:text-slate-200">Try other daily quotas and show rates. Nothing is saved and nothing is sent.</p>
      {open.length === 0 && <p className="text-sm text-slate-700 dark:text-slate-200">No stream is open on this day.</p>}
      {open.map((s) => {
        const v = sliderValues(s, edits[s.streamId]);
        const id = `${uid}-${s.streamId}`;
        return (
          <fieldset key={s.streamId} className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
            <legend className="max-w-full break-words px-1 text-xs font-semibold text-slate-900 dark:text-slate-100">{s.label}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={`${id}-q`} className={LABEL}>Daily quota (people)</label>
                <div className="flex items-center gap-2">
                  <input id={`${id}-q`} type="range" min={0} max={QUOTA_MAX} step={1} value={v.quota} aria-label={`Daily quota for ${s.label}`} aria-valuetext={`${v.quota} people`}
                    className="h-11 min-w-0 flex-1 cursor-pointer accent-blue-700 sm:h-8" onChange={(e) => set(s.streamId, { quota: clampQuota(num(e.target.value)) ?? undefined })} />
                  <input type="number" inputMode="numeric" min={0} max={QUOTA_MAX} step={1} value={v.quota} aria-label={`Daily quota for ${s.label}, exact number`}
                    className={`${FIELD} w-20`} onChange={(e) => set(s.streamId, { quota: clampQuota(num(e.target.value)) ?? undefined })} />
                </div>
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-r`} className={LABEL}>Assumed show rate (%)</label>
                <div className="flex items-center gap-2">
                  <input id={`${id}-r`} type="range" min={0} max={100} step={1} value={v.showRate} aria-label={`Show rate for ${s.label}`} aria-valuetext={`${v.showRate}%`}
                    className="h-11 min-w-0 flex-1 cursor-pointer accent-blue-700 sm:h-8" onChange={(e) => set(s.streamId, { showRate: clampShowRate(num(e.target.value)) ?? undefined })} />
                  <input type="number" inputMode="numeric" min={0} max={100} step={1} value={v.showRate} aria-label={`Show rate for ${s.label}, exact percent`}
                    className={`${FIELD} w-20`} onChange={(e) => set(s.streamId, { showRate: clampShowRate(num(e.target.value)) ?? undefined })} />
                </div>
              </div>
            </div>
          </fieldset>
        );
      })}
      <p role="status" aria-live="polite" className="text-sm font-semibold text-slate-900 dark:text-slate-100">{whatIfAnnouncement(day, r)}</p>
    </section>
  );
}

export interface PlanSectionViewProps {
  requisitionId: string | null;
  groups: DriveGroup[] | null;
  groupsLoading: boolean;
  onPick: (requisitionId: string) => void;
  plan: DrivePlan | null; loading: boolean; error: string | null; onRetry: () => void;
  day: string | null; onDay: (date: string) => void;
  /** Extend menu of a stream (null when the stream is not loaded). */
  streamActions?: (streamId: string) => ReactNode;
  checklist?: ReactNode;
  onCreateStream?: () => void;
}

function PickRequisition({ groups, groupsLoading, onPick }: Pick<PlanSectionViewProps, "groups" | "groupsLoading" | "onPick">) {
  const list = planPickList(groups ?? []);
  if (groupsLoading && list.length === 0) return <div className={PULSE} style={{ height: 72 }} role="status" aria-label="Loading requisitions" />;
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 px-4 text-center dark:border-slate-600" style={{ minHeight: 160 }}>
        <Inbox className="h-6 w-6 text-slate-500 dark:text-slate-400" aria-hidden />
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">No requisition with streams in this window</p>
        <p className="text-xs text-slate-600 dark:text-slate-300">Pick a requisition in the filters above, or widen the date range.</p>
      </div>
    );
  }
  return (
    <div className="max-w-md space-y-1">
      <label htmlFor="plan-pick" className={LABEL}>{PICK_LABEL}</label>
      <select id="plan-pick" className={`${FIELD} cursor-pointer`} value="" onChange={(e) => { if (e.target.value) onPick(e.target.value); }}>
        <option value="">{PICK_LABEL}</option>
        {list.map((o) => <option key={o.requisitionId} value={o.requisitionId}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function PlanSectionView(p: PlanSectionViewProps) {
  const state = planState({ requisitionId: p.requisitionId, plan: p.plan, loading: p.loading, error: p.error });
  const plan = p.plan;
  const days = plan?.days ?? [];
  const current = days.find((d) => d.date === p.day) ?? days.find((d) => d.date === plan?.checklist?.date) ?? days[0] ?? null;
  return (
    <section aria-labelledby="plan-heading" className="space-y-4" aria-busy={p.loading}>
      <h3 id="plan-heading" className="text-base font-bold text-slate-900 dark:text-slate-100">Plan{plan ? `: ${plan.code}` : ""}</h3>
      {state === "pick" && <PickRequisition groups={p.groups} groupsLoading={p.groupsLoading} onPick={p.onPick} />}
      {state === "loading" && (
        <div role="status" aria-label="Loading the plan" className="space-y-3">
          <div className={PULSE} style={{ height: 160 }} />
          <div className={PULSE} style={{ height: 240 }} />
        </div>
      )}
      {state === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Could not load the plan: {p.error}</span>
          <button type="button" onClick={p.onRetry} className={BTN}><RefreshCw className="h-4 w-4" aria-hidden /> Retry</button>
        </div>
      )}
      {plan && p.error && <p role="alert" className="text-xs text-rose-800 dark:text-rose-200">Could not refresh: {p.error}. Showing the last result.</p>}
      {plan?.partial && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 break-words">Partial plan: some parts failed to load ({(plan.failedSections ?? []).join(", ") || "unknown"}). Numbers may be incomplete; show rates may be on the plan default.</span>
          <button type="button" onClick={p.onRetry} className={BTN}><RefreshCw className="h-4 w-4" aria-hidden /> Retry</button>
        </div>
      )}
      {state === "empty" && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center dark:border-slate-600" style={{ minHeight: 160 }}>
          <Inbox className="h-6 w-6 text-slate-500 dark:text-slate-400" aria-hidden />
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{EMPTY_PLAN_TEXT}</p>
          {p.onCreateStream && <button type="button" className={BTN} onClick={p.onCreateStream}><Plus className="h-4 w-4" aria-hidden /> Open a stream</button>}
        </div>
      )}
      {(state === "ready" || state === "empty") && plan && (
        <>
          {state === "ready" && <DaysTable plan={plan} />}
          {state === "ready" && current && (
            <>
              <div className="max-w-xs space-y-1">
                <label htmlFor="plan-day" className={LABEL}>Day for recommendations and what-if</label>
                <select id="plan-day" className={`${FIELD} cursor-pointer`} value={current.date} onChange={(e) => p.onDay(e.target.value)}>
                  {days.map((d) => <option key={d.date} value={d.date}>{dayLabel(d.date)}</option>)}
                </select>
              </div>
              <StreamsTable day={current} streamActions={p.streamActions} />
              <WhatIfPanel day={current} />
              <PlanCalendar plan={plan} />
            </>
          )}
          {p.checklist}
        </>
      )}
    </section>
  );
}

function DaysTable({ plan }: { plan: DrivePlan }) {
  const rows = dayRows(plan);
  return (
    <section aria-labelledby="plan-days-heading" className="space-y-2">
      <h4 id="plan-days-heading" className={H4}>Target vs expected arrivals</h4>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Per day: target arrivals, expected arrivals from the people lined up, the gap and seats used of capacity</caption>
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>{["Day", "Target", "Expected", "Gap", "Seats used / capacity", "Drive"].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.date} className="border-t border-slate-200 dark:border-slate-700">
                <th scope="row" className={`${TH} whitespace-nowrap`}>{r.label}</th>
                <td className={`${TD} tabular-nums`}>{r.target}</td>
                <td className={`${TD} tabular-nums`}>{r.expected}</td>
                <td className={`${TD} tabular-nums`}>{r.gap}</td>
                <td className={`${TD} tabular-nums`}>{r.seats}</td>
                <td className={TD}>{r.drive}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StreamsTable({ day, streamActions }: { day: PlanDay; streamActions?: (streamId: string) => ReactNode }) {
  const rows = streamRows(day);
  return (
    <section aria-labelledby="plan-rec-heading" className="space-y-2">
      <h4 id="plan-rec-heading" className={H4}>Recommended invites for {dayLabel(day.date)}</h4>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Per stream: people lined up, show rate and its basis, expected arrivals, recommended invites and why</caption>
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>{["Stream", "Lined up", "Show rate", "Expected", "Recommended invites", "Why"].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.streamId} className="border-t border-slate-200 align-top dark:border-slate-700">
                <th scope="row" className={`${TH} max-w-xs break-words`}>{r.label}<span className="block font-normal text-slate-700 dark:text-slate-200">{r.typeLabel}{r.open ? "" : ", not open"}</span></th>
                <td className={`${TD} tabular-nums`}>{r.lined}</td>
                <td className={TD}><span className="tabular-nums">{r.rate}</span> <span className="text-xs text-slate-700 dark:text-slate-200">({r.basis})</span></td>
                <td className={`${TD} tabular-nums`}>{r.expected}</td>
                <td className={`${TD} font-semibold tabular-nums`}>{r.recommended}</td>
                <td className={`${TD} min-w-48 break-words text-xs`}>{r.reasoning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Actions sit outside the scrolling table so the Extend menu is never clipped by it (overflow-x:auto also clips vertically). */}
      {streamActions && rows.length > 0 && (
        <ul aria-label="Stream actions" className="space-y-2">
          {rows.map((r) => {
            const node = streamActions(r.streamId);
            return node ? (
              <li key={r.streamId} role="group" aria-label={r.label} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <span className="min-w-0 break-words text-sm font-semibold text-slate-900 dark:text-slate-100">{r.label}</span>
                <span className="ml-auto">{node}</span>
              </li>
            ) : null;
          })}
        </ul>
      )}
    </section>
  );
}

function useRequisitionStreams(requisitionId: string | null) {
  const seq = useRef(createRequestSequencer());
  const [streams, setStreams] = useState<StreamView[]>([]);
  const load = useCallback(async () => {
    if (!requisitionId) { seq.current.cancel(); setStreams([]); return; }
    const ticket = seq.current.begin();
    try {
      const r = await hrmsApi.get<{ data?: unknown }>(streamsOfRequisitionPath(requisitionId), undefined, ticket.signal);
      if (ticket.isCurrent()) setStreams(Array.isArray(r?.data) ? (r.data as StreamView[]).filter((s) => s && typeof s.id === "string") : []);
    } catch {
      if (ticket.isCurrent()) setStreams([]); // the plan still renders; no stream actions are listed
    }
  }, [requisitionId]);
  useEffect(() => { void load(); const s = seq.current; return () => s.cancel(); }, [load]);
  return { streams, reload: () => void load() };
}

export interface PlanSectionProps {
  requisitionId: string | null; groups: DriveGroup[] | null; groupsLoading: boolean; requisitions: RequisitionOption[];
  onPick: (requisitionId: string) => void; onChanged: () => void;
  autoPreview?: { requisitionId: string; date?: string; nonce: number } | null;
}

export default function PlanSection({ requisitionId, groups, groupsLoading, requisitions, onPick, onChanged, autoPreview }: PlanSectionProps) {
  const { data, error, loading, reload } = useDrivePlan(requisitionId);
  const { streams, reload: reloadStreams } = useRequisitionStreams(requisitionId);
  const [day, setDay] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => { setDay(null); setNote(null); }, [requisitionId]);
  const today = istTodayClient();
  const refresh = useCallback(() => { reload(); reloadStreams(); onChanged(); }, [reload, reloadStreams, onChanged]);
  const byId = useMemo(() => new Map(streams.map((s) => [s.id, s])), [streams]);
  const option = requisitions.find((r) => r.id === requisitionId);
  const plan = data && data.requisitionId === requisitionId ? data : null; // never show another requisition's plan while switching
  return (
    <>
      <p role="status" className="text-sm text-emerald-800 empty:hidden dark:text-emerald-200">{note}</p>
      <PlanSectionView
        requisitionId={requisitionId} groups={groups} groupsLoading={groupsLoading} onPick={onPick}
        plan={plan} loading={loading} error={error} onRetry={reload} day={day} onDay={setDay}
        streamActions={(id) => { const s = byId.get(id); return s ? <StreamActions stream={s} today={today} onDone={(_a, text) => { setNote(text); refresh(); }} /> : null; }}
        checklist={plan && requisitionId ? <D1Checklist plan={plan} requisitionId={requisitionId} autoPreview={autoPreview} onPlanned={refresh} /> : null}
        onCreateStream={requisitionId ? () => setCreateOpen(true) : undefined}
      />
      {requisitionId && (
        <CreateStreamDialog open={createOpen} onOpenChange={setCreateOpen} today={today} requisitionId={requisitionId}
          requisitions={option ? [option] : [{ id: requisitionId, label: plan?.code || "This requisition", branch: plan?.branch ?? "", code: plan?.code }]} lockRequisition
          onCreated={(_s, text) => { setCreateOpen(false); setNote(text); refresh(); }} />
      )}
    </>
  );
}
