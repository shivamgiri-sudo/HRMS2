// What HR / payroll can do about the attendance-mismatch items of one branch, shown at the top of the drawer:
// a plain-language breakdown by cause, then two guarded actions.
//   - Close old items as reviewed (HR, admin, payroll head): for items older than the 7-day automatic window,
//     e.g. months that payroll has already closed. A reason is mandatory and is recorded.
//   - Back-fill missing records (admin, payroll head only): creates the attendance records the nightly job
//     missed, for a past date range. Preview first; anything older than 7 days also needs the word BACKFILL.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, ListChecks } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { AUTO_HEAL_DAYS, countClosable, guideFor, suggestBackfillRange, summariseTypes } from "./attendanceGuide";

const BASE = "/api/ops-control-tower";

interface MismatchRow { issueDate?: string; issueType?: string; daysOpen?: number }
interface BackfillPreview {
  found: number; truncated: boolean; processed: number; failed: number; dryRun: boolean; needsConfirmation: boolean;
  byDate: Record<string, number>; payrollRunsInRange: Array<{ month: string; status: string }>; errors: string[];
}

const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export function OpsAttendanceActions({ branchId, branchName, rows, canClose, canBackfill, onChanged }: {
  branchId: string; branchName: string; rows: MismatchRow[]; canClose: boolean; canBackfill: boolean; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const types = useMemo(() => summariseTypes(rows), [rows]);
  const closable = useMemo(() => countClosable(rows), [rows]);
  const range = useMemo(() => suggestBackfillRange(rows, todayIst()), [rows]);
  const [panel, setPanel] = useState<null | "close" | "backfill">(null);

  // close form
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  // backfill form
  const [from, setFrom] = useState(range?.from ?? "");
  const [to, setTo] = useState(range?.to ?? "");
  const [preview, setPreview] = useState<BackfillPreview | null>(null);
  const [phrase, setPhrase] = useState("");

  const chosenTypes = types.filter((t) => picked[t.type] !== false).map((t) => t.type);
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ["ops-control-tower"] });
    void qc.invalidateQueries({ queryKey: ["ops-control-tower-detail"] });
    void qc.invalidateQueries({ queryKey: ["ops-sync-health"] });
    onChanged();
  };

  const close = async () => {
    setBusy(true);
    try {
      const out = await hrmsApi.post<{ closed: number; leftOpen: number; closableMonths: string[] }>(`${BASE}/attendance/close`, { branchId, reason: reason.trim(), issueTypes: chosenTypes });
      toast.success(`${out.closed} old item${out.closed === 1 ? "" : "s"} closed as reviewed${out.leftOpen > 0 ? ` · ${out.leftOpen} older item${out.leftOpen === 1 ? "" : "s"} left open because payroll for their month is not closed yet` : ""}`);
      setPanel(null); setReason(""); setConfirmClose(false);
      refreshAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not close the items");
    } finally { setBusy(false); }
  };

  const runBackfill = async (mode: "preview" | "commit") => {
    setBusy(true);
    try {
      const out = await hrmsApi.post<BackfillPreview>(`${BASE}/attendance/backfill`, { branchId, from, to, mode, confirm: phrase || undefined });
      if (mode === "preview") setPreview(out);
      else {
        toast.success(`${out.processed} attendance record${out.processed === 1 ? "" : "s"} created${out.failed ? `, ${out.failed} failed` : ""}`);
        setPanel(null); setPreview(null); setPhrase("");
        refreshAll();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The back-fill did not run");
    } finally { setBusy(false); }
  };

  return (
    <section aria-label="What is wrong and what to do" className="mt-3 space-y-2 rounded-lg border bg-slate-50 p-3 text-xs">
      <p className="text-sm font-semibold text-slate-900">What these items are</p>
      <ul className="space-y-1.5">
        {types.map((t) => (
          <li key={t.type}>
            <span className="font-semibold text-slate-800">{t.label}</span> <span className="font-mono text-slate-500">× {t.count}</span>
            <div className="text-slate-600">{guideFor(t.type).plain}</div>
            <div className="text-slate-500">What to do: {guideFor(t.type).action}</div>
          </li>
        ))}
        {types.length === 0 && <li className="text-slate-400">Nothing open here.</li>}
      </ul>
      <p className="text-slate-500">
        Items from the last {AUTO_HEAL_DAYS} days are repaired automatically every night. The oldest 200 are listed below; the actions apply to the whole branch.
      </p>

      {(canClose || canBackfill) && types.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {canClose && closable > 0 && (
            <Button size="sm" variant="outline" className="h-8" onClick={() => setPanel(panel === "close" ? null : "close")} aria-expanded={panel === "close"}>
              <ListChecks className="mr-1 h-3.5 w-3.5" aria-hidden /> Close old items as reviewed
            </Button>
          )}
          {canBackfill && range && (
            <Button size="sm" variant="outline" className="h-8" onClick={() => setPanel(panel === "backfill" ? null : "backfill")} aria-expanded={panel === "backfill"}>
              <History className="mr-1 h-3.5 w-3.5" aria-hidden /> Back-fill missing records
            </Button>
          )}
        </div>
      )}

      {panel === "close" && (
        <div className="space-y-2 rounded-md border bg-white p-3">
          <p className="font-semibold text-slate-800">Close old items in {branchName}</p>
          <p className="text-slate-600">
            For items older than {AUTO_HEAL_DAYS} days in a month whose payroll is already closed (locked or finalized). Items in a month that payroll is still working on are always left open.
            This closes <strong>every</strong> such open item of the kinds ticked below in this branch, not only the ones listed. Your name and reason are recorded.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {types.map((t) => (
              <label key={t.type} className="flex items-center gap-1.5">
                <input type="checkbox" checked={picked[t.type] !== false} onChange={(e) => { setPicked((p) => ({ ...p, [t.type]: e.target.checked })); setConfirmClose(false); }} />
                {t.label}
              </label>
            ))}
          </div>
          <label className="block">
            <span className="font-medium text-slate-700">Reason (required)</span>
            <textarea className="mt-1 w-full rounded-md border p-2" rows={2} maxLength={500} value={reason}
              onChange={(e) => { setReason(e.target.value); setConfirmClose(false); }} placeholder="e.g. July payroll is closed; no action possible" />
          </label>
          {!confirmClose ? (
            <Button size="sm" className="h-8" disabled={reason.trim().length < 5 || chosenTypes.length === 0} onClick={() => setConfirmClose(true)}>Close items…</Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-red-700">Close all old {chosenTypes.length === types.length ? "" : "selected "}items in {branchName}?</span>
              <Button size="sm" className="h-8" disabled={busy} onClick={() => void close()}>{busy ? "Closing…" : "Yes, close them"}</Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setConfirmClose(false)}>Cancel</Button>
            </div>
          )}
        </div>
      )}

      {panel === "backfill" && (
        <div className="space-y-2 rounded-md border bg-white p-3">
          <p className="font-semibold text-slate-800">Back-fill missing attendance records in {branchName}</p>
          <p className="text-slate-600">
            Creates the records the nightly job missed, using the normal attendance rules (roster, leave, holiday, biometric). It never changes an
            existing or payroll-locked record. Preview first: nothing is written until you confirm.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label>From <input type="date" className="ml-1 rounded border px-2 py-1" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPreview(null); }} /></label>
            <label>To <input type="date" className="ml-1 rounded border px-2 py-1" value={to} min={from || undefined} max={todayIst()} onChange={(e) => { setTo(e.target.value); setPreview(null); }} /></label>
            <Button size="sm" className="h-8" disabled={busy || !from || !to} onClick={() => void runBackfill("preview")}>{busy && !preview ? "Checking…" : "Preview"}</Button>
          </div>
          {preview && (
            <div className="space-y-1.5 rounded border bg-slate-50 p-2">
              <p className="font-semibold text-slate-800">
                {preview.found === 0 ? "No missing records in this range." : `${preview.found} missing record${preview.found === 1 ? "" : "s"} would be created${preview.truncated ? " (more exist; run again after this)" : ""}.`}
              </p>
              {preview.found > 0 && (
                <p className="text-slate-600">
                  Heaviest days: {Object.entries(preview.byDate).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d, n]) => `${d.slice(8, 10)}/${d.slice(5, 7)} (${n})`).join(", ")}
                </p>
              )}
              {preview.payrollRunsInRange.length > 0 && (
                <p role="note" className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
                  Payroll runs already exist for these months ({preview.payrollRunsInRange.map((r) => `${r.month}: ${r.status}`).join(", ")}). New records can make attendance differ from what was paid. Only continue if payroll agrees.
                </p>
              )}
              {preview.found > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {preview.needsConfirmation && (
                    <label>Type <span className="font-mono font-semibold">BACKFILL</span> to confirm <input className="ml-1 w-28 rounded border px-2 py-1 font-mono" value={phrase} onChange={(e) => setPhrase(e.target.value)} /></label>
                  )}
                  <Button size="sm" className="h-8" disabled={busy || (preview.needsConfirmation && phrase !== "BACKFILL")} onClick={() => void runBackfill("commit")}>
                    {busy ? "Creating…" : `Create ${preview.found} record${preview.found === 1 ? "" : "s"}`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
