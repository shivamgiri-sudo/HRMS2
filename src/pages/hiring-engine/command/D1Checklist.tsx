/**
 * D-1 checklist of the Plan section: what tonight's evening pass will do (the API's dry run), what is already planned and what needs
 * attention, plus "Preview Plan now (dry run)" and "Plan now" (POST /api/he/requisitions/:id/plan-now). Plan now asks for confirmation
 * in the repo's AlertDialog, is never optimistic (busy label, the server's answer is shown per stream), and refreshes the plan after.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarCheck, CheckCircle2, Eye, Loader2, MoonStar, PlayCircle, XCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { dayLabel } from "./driveChartModel";
import { isIsoDay } from "./driveCommandModel";
import type { ChecklistItem, DrivePlan, StreamDayPlan } from "./driveCommandTypes";
import { CHECK_WORD, checklistGroups, planNowBody, planNowConfirm, planNowErrorText, planNowLines, planNowPath, planNowSummary } from "./planModel";
import { BTN, PRIMARY } from "./StreamActions";

export const PLAN_PREVIEW_ID = "plan-now-result";

const ICON: Record<ChecklistItem["kind"], typeof MoonStar> = {
  will_plan: MoonStar, already_planned: CalendarCheck, fill_soon: AlertTriangle, stream_ends_tomorrow: AlertTriangle, pool_below_quota: AlertTriangle, readiness: AlertTriangle,
};

export interface PlanRun { dryRun: boolean; result: StreamDayPlan | null; error: string | null }

export interface D1ChecklistViewProps {
  checklist: DrivePlan["checklist"]; date: string; busy: "preview" | "plan" | null; run: PlanRun | null;
  onPreview: () => void; onPlanNow: () => void;
}

/** Presentational (static-markup tested). The result region is always mounted so a new answer is announced and can take focus. */
export function D1ChecklistView({ checklist, date, busy, run, onPreview, onPlanNow }: D1ChecklistViewProps) {
  const groups = checklistGroups(checklist?.items);
  const apiPreview = checklist?.preview ?? null;
  return (
    <section aria-labelledby="plan-d1-heading" className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <h4 id="plan-d1-heading" className="text-sm font-bold text-slate-900 dark:text-slate-100">Checklist for {dayLabel(checklist?.date ?? date)} (the day before)</h4>
      {apiPreview && (
        <p className="text-sm text-slate-800 dark:text-slate-100"><span className="font-semibold">Dry run of tonight&apos;s pass:</span> {planNowSummary(apiPreview)}</p>
      )}
      {groups.map((g) => (
        <div key={g.id} className="space-y-1">
          <h5 className="text-xs font-semibold text-slate-800 dark:text-slate-100">{g.title}</h5>
          {g.items.length === 0 ? <p className="text-xs text-slate-700 dark:text-slate-200">Nothing</p> : (
            <ul className="space-y-1">
              {g.items.map((i, at) => {
                const Icon = ICON[i.kind] ?? AlertTriangle;
                return (
                  <li key={`${i.kind}:${i.streamId ?? ""}:${at}`} className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-100">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words"><span className="font-semibold">{CHECK_WORD[i.kind] ?? "Note"}:</span> {i.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} disabled={busy !== null} onClick={onPreview}>
          {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          {busy === "preview" ? "Previewing…" : "Preview Plan now (dry run)"}
        </button>
        <button type="button" className={PRIMARY} disabled={busy !== null} onClick={onPlanNow}>
          {busy === "plan" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <PlayCircle className="h-4 w-4" aria-hidden />}
          {busy === "plan" ? "Planning…" : "Plan now"}
        </button>
        <span className="text-xs text-slate-700 dark:text-slate-200">for {dayLabel(date)}</span>
      </div>
      <div id={PLAN_PREVIEW_ID} tabIndex={-1} role="status" className="space-y-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        {run && run.error && (
          <p className="flex items-start gap-2 text-sm text-rose-800 dark:text-rose-200"><XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {run.dryRun ? "Preview failed" : "Plan now failed"}: {run.error}</p>
        )}
        {run && !run.error && (
          <>
            <p className="flex items-start gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {run.dryRun ? "Preview (nothing saved)" : "Planned"}: {planNowSummary(run.result)}
            </p>
            <ul className="space-y-0.5 pl-6 text-sm text-slate-800 dark:text-slate-100">
              {planNowLines(run.result).map((l) => (
                <li key={l.streamId} className="break-words">
                  {l.skipped && <AlertTriangle className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden />}
                  <span className="font-semibold">{l.label}:</span> {l.text}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

export interface D1ChecklistProps {
  plan: DrivePlan; requisitionId: string;
  /** Set by an insight's "Preview Plan now": run the dry run once for this nonce and move focus to its result. */
  autoPreview?: { requisitionId: string; date?: string; nonce: number } | null;
  onPlanned: () => void;
}

export default function D1Checklist({ plan, requisitionId, autoPreview, onPlanned }: D1ChecklistProps) {
  const wanted = autoPreview && autoPreview.requisitionId === requisitionId && isIsoDay(autoPreview.date ?? null) ? autoPreview.date as string : null;
  const date = wanted ?? plan.checklist?.date ?? plan.from;
  const [busy, setBusy] = useState<"preview" | "plan" | null>(null);
  const [run, setRun] = useState<PlanRun | null>(null);
  const [confirming, setConfirming] = useState(false);
  const handled = useRef<number | null>(null);

  const call = useCallback(async (dryRun: boolean): Promise<void> => {
    setBusy(dryRun ? "preview" : "plan");
    try {
      const r = await hrmsApi.post<{ data?: StreamDayPlan | null }>(planNowPath(requisitionId), planNowBody(date, dryRun));
      setRun({ dryRun, result: r?.data ?? null, error: null });
      if (!dryRun) onPlanned();
    } catch (e: unknown) {
      setRun({ dryRun, result: null, error: planNowErrorText(e) });
    } finally {
      setBusy(null);
      window.setTimeout(() => document.getElementById(PLAN_PREVIEW_ID)?.focus(), 0);
    }
  }, [requisitionId, date, onPlanned]);

  useEffect(() => {
    if (!autoPreview || autoPreview.requisitionId !== requisitionId || handled.current === autoPreview.nonce) return;
    handled.current = autoPreview.nonce;
    void call(true);
  }, [autoPreview, requisitionId, call]);

  const text = planNowConfirm(date, plan.code || requisitionId);
  return (
    <>
      <D1ChecklistView checklist={plan.checklist} date={date} busy={busy} run={run} onPreview={() => void call(true)} onPlanNow={() => setConfirming(true)} />
      <AlertDialog open={confirming} onOpenChange={(o) => { if (!o && busy !== "plan") setConfirming(false); }}>
        <AlertDialogContent onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}>
          <AlertDialogHeader>
            <AlertDialogTitle>{text.title}</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-700 dark:text-slate-200">{text.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy !== null} className="min-h-11 sm:min-h-9">Cancel</AlertDialogCancel>
            <button type="button" className={PRIMARY} disabled={busy !== null} onClick={() => { setConfirming(false); void call(false); }}>{text.confirm}</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
