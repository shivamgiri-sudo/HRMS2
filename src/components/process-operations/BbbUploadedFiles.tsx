import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface Batch {
  batchId: string; kind: "received" | "sales"; uploadedAt: string | null; uploadedBy: string | null;
  liveRows: number; trashedRows: number; dateFrom: string | null; dateTo: string | null; trashedAt: string | null; state?: string;
}
interface Listing { received: Batch[]; sales: Batch[] }

const BASE = "/api/bla-bli-blu-dashboard/uploads";
const n = (v: number) => v.toLocaleString("en-IN");
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const btn = "inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Every uploaded BBB file, with a way to remove a wrong one as a whole. Received Data goes to a trash it can be
 * restored from; a sales upload is undone order by order (each order returns to the version it replaced).
 */
export default function BbbUploadedFiles({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [data, setData] = useState<Listing | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"received" | "sales">("received");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ batch: Batch; action: "trash" | "delete" } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try { setData((await hrmsApi.get<{ data: Listing }>(BASE)).data); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not load the uploaded files"); }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);
  // A large file keeps being worked on after the request returns (statuses, dashboard totals). Re-check until done.
  const updating = !!data?.received.some((b) => b.state === "updating");
  useEffect(() => {
    if (!updating) return;
    const t = setInterval(() => { void load(); onChanged(); }, 10_000);
    return () => clearInterval(t);
  }, [updating, load, onChanged]);

  const act = async (batch: Batch, action: "trash" | "restore" | "delete") => {
    setBusy(batch.batchId); setNote(null); setErr(null);
    try {
      if (action === "trash") {
        const r = await hrmsApi.post<{ data: { trashed: number; pending: boolean } }>(`${BASE}/received/${batch.batchId}/trash`, undefined, 60_000);
        setNote(r.data.pending
          ? "This upload is being moved to the trash. It is a large file, so the dashboard totals will catch up in a few minutes."
          : `${n(r.data.trashed)} rows moved to the trash. Fresh / NC was worked out again for the days after.`);
      } else if (action === "restore") {
        const r = await hrmsApi.post<{ data: { restored: number; keptInTrash: number; pending: boolean } }>(`${BASE}/received/${batch.batchId}/restore`, undefined, 60_000);
        setNote(r.data.pending
          ? "This upload is being restored. It is a large file, so the dashboard totals will catch up in a few minutes."
          : `${n(r.data.restored)} rows restored.${r.data.keptInTrash ? ` ${n(r.data.keptInTrash)} stayed in the trash because the same number now exists for that date.` : ""}`);
      } else {
        const r = await hrmsApi.delete<{ data: { reverted: number; removed: number } }>(`${BASE}/sales/${batch.batchId}`);
        setNote(`${n(r.data.removed)} orders removed and ${n(r.data.reverted)} put back to their previous version.`);
      }
      setConfirm(null);
      await load(); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "That did not work. Please try again."); }
    finally { setBusy(null); }
  };

  const rows = data ? data[tab] : [];
  return (
    <section aria-labelledby="bbb-files" className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 id="bbb-files" className="text-sm font-semibold text-slate-700">Uploaded files</h3>
        <div role="tablist" aria-label="Which uploads" className="inline-flex rounded-lg bg-slate-100 p-1">
          {([["received", "Received Data"], ["sales", "Overall Sales"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setConfirm(null); }}
              className={`min-h-[36px] cursor-pointer rounded-md px-3 text-xs font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${tab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{label}</button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        {tab === "received"
          ? "Each number is stored once per date. Uploaded the wrong file? Move it to the trash; you can restore it later."
          : "Each Order ID is stored once and always shows the latest upload. Deleting an upload puts every order back to the version it replaced."}
      </p>

      {note && <p role="status" className="mb-3 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800">{note}</p>}
      {err && <p role="alert" className="mb-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{err}</p>}
      {!data && !err && <div className="flex items-center gap-2 py-4 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>}
      {data && !rows.length && <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">Nothing has been uploaded yet.</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>{["Uploaded", "By", "Dates covered", "Rows", "Status", ""].map((h) => <th key={h} scope="col" className="px-2 py-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const trashed = b.kind === "received" && (!!b.trashedAt || (b.liveRows === 0 && b.trashedRows > 0));
                const working = b.state === "updating";
                const asking = confirm?.batch.batchId === b.batchId;
                return (
                  <tr key={b.batchId} className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-2 py-2 text-slate-800">{when(b.uploadedAt)}</td>
                    <td className="px-2 py-2 text-slate-600">{b.uploadedBy ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-600">{b.dateFrom === b.dateTo ? b.dateFrom ?? "—" : `${b.dateFrom} to ${b.dateTo}`}</td>
                    <td className="px-2 py-2 tabular-nums text-slate-800">{n(b.liveRows)}{b.trashedRows > 0 && <span className="block text-slate-400">{n(b.trashedRows)} in trash</span>}</td>
                    <td className="px-2 py-2">
                      {working ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900"><Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />Updating totals…</span>
                      ) : b.state === "failed" ? (
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-800" title="The rows are stored, but Fresh / NC or the dashboard totals could not be refreshed. Trash and restore the upload to retry.">Totals not refreshed</span>
                      ) : (
                        <span className={`rounded px-1.5 py-0.5 font-semibold ${trashed ? "bg-slate-200 text-slate-700" : "bg-emerald-100 text-emerald-800"}`}>{trashed ? `In trash since ${when(b.trashedAt)}` : "In use"}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {asking ? (
                        <div className="inline-flex max-w-xs flex-col items-end gap-1.5 text-left">
                          <span className="flex items-start gap-1 text-rose-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                            {confirm!.action === "trash" ? `Remove all ${n(b.liveRows)} rows of this upload from the dashboard?` : `Undo this upload for ${n(b.liveRows)} orders? This cannot be restored; re-upload the file if needed.`}
                          </span>
                          <span className="flex gap-1.5">
                            <button type="button" className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`} onClick={() => setConfirm(null)}>Cancel</button>
                            <button type="button" disabled={busy === b.batchId} className={`${btn} border-rose-600 bg-rose-600 text-white hover:bg-rose-700`} onClick={() => void act(b, confirm!.action)}>
                              {busy === b.batchId && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Yes, {confirm!.action === "trash" ? "move to trash" : "delete"}
                            </button>
                          </span>
                        </div>
                      ) : working ? (
                        <span className="text-slate-400">Please wait</span>
                      ) : trashed ? (
                        <button type="button" disabled={busy === b.batchId} className={`${btn} border-slate-300 text-slate-700 hover:bg-slate-50`} onClick={() => void act(b, "restore")}>
                          {busy === b.batchId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden />}Restore
                        </button>
                      ) : (
                        <button type="button" className={`${btn} border-slate-300 text-slate-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700`} onClick={() => setConfirm({ batch: b, action: b.kind === "received" ? "trash" : "delete" })}>
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />{b.kind === "received" ? "Move to trash" : "Delete upload"}
                        </button>
                      )}
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
