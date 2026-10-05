/**
 * Brings the third-party tool's call results back into the HRMS: confirmed / rescheduled / declined / no answer / wrong
 * person / failed. Each applied row updates the candidate's status, the call log and (for Meta leads) the walk-in
 * confirmation, exactly like a call placed by the HRMS. Unrecognised results are shown, never guessed.
 */
import { useRef, useState } from "react";
import { Inbox } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { StatTile, num } from "@/components/analytics/analytics-kit";

interface Row { rowNo: number; ok: boolean; errors: string[]; warnings: string[]; display: { phone: string; result: string }; outcome?: string; newInterviewAt?: string; knownLead: boolean; mobile10?: string }
interface Preview { missingColumns: string[]; tooMany: boolean; rows: Row[]; summary: { total: number; valid: number; rejected: number; confirmed: number; rescheduled: number; declined: number; noAnswer: number; wrongPerson: number; failed: number; newLeads: number } }

const LABEL: Record<string, string> = { WALKIN_CONFIRMED_YES: "Confirmed", WALKIN_RESCHEDULED: "Rescheduled", WALKIN_DECLINED_NEEDS_FOLLOWUP: "Declined", NO_ANSWER: "No answer", WRONG_PERSON_REACHED: "Wrong person", CALL_FAILED: "Call failed" };
const TONE: Record<string, string> = { WALKIN_CONFIRMED_YES: "text-emerald-700", WALKIN_RESCHEDULED: "text-blue-700", WALKIN_DECLINED_NEEDS_FOLLOWUP: "text-rose-700", NO_ANSWER: "text-slate-600", WRONG_PERSON_REACHED: "text-amber-700", CALL_FAILED: "text-slate-500" };

export default function CallResultsImport() {
  const ref = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onFile = async (f: File | undefined) => {
    setMsg(null); setPreview(null); setRows([]);
    if (!f) return;
    setName(f.name); setBusy("read");
    try {
      const XLSX = await import("xlsx");
      const wb = /\.csv$/i.test(f.name) ? XLSX.read(await f.text(), { type: "string", raw: true }) : XLSX.read(await f.arrayBuffer(), { type: "array" });
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: true }).filter((r) => Object.values(r).some((v) => String(v).trim() !== ""));
      if (!data.length) { setMsg({ ok: false, text: "The file has no data rows." }); return; }
      setRows(data);
      const p = await hrmsApi.post<{ data: Preview }>("/api/he/call-results/preview", { rows: data });
      setPreview(p.data);
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not read that file." }); }
    finally { setBusy(null); }
  };

  const apply = async () => {
    setBusy("apply"); setMsg(null);
    try {
      const r = await hrmsApi.post<{ data: { applied: number; duplicates: number; rejected: number; newLeads: number; failedRows: number[] } }>("/api/he/call-results", { rows });
      const d = r.data;
      setMsg({ ok: d.failedRows.length === 0, text: `${d.applied} results saved${d.duplicates ? ` · ${d.duplicates} already imported earlier` : ""}${d.rejected ? ` · ${d.rejected} rows skipped` : ""}${d.newLeads ? ` · ${d.newLeads} new candidates added to the lead pool` : ""}${d.failedRows.length ? ` · rows ${d.failedRows.join(", ")} could not be saved` : ""}.` });
      setPreview(null); setRows([]); setName(""); if (ref.current) ref.current.value = "";
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not save the results" }); }
    finally { setBusy(null); }
  };

  const s = preview?.summary;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Import call results">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Inbox className="h-4 w-4 text-blue-600" aria-hidden /> Import results from the calling tool</h2>
      <p className="mt-1 text-sm text-slate-600">Upload the tool&apos;s result report. Candidate status, the call log and the walk-in confirmation are updated from it.</p>
      <p className="mt-1 text-xs text-slate-500">Needs a phone column and a result column (confirmed, rescheduled, declined, no answer, wrong number…). Optional: call_id, call_time, duration, remarks, new_date, new_time. Include call_id or call_time so repeat calls to one person are all kept.</p>
      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500">
        {busy === "read" ? "Reading…" : name || "Choose the result file (CSV or Excel)"}
        <input ref={ref} type="file" accept=".csv,.xlsx,.xls" aria-label="Call results file" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {msg && <div role={msg.ok ? "status" : "alert"} className={`mt-3 rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{msg.text}</div>}
      {preview?.missingColumns.length ? <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">The file needs these columns: <b>{preview.missingColumns.join(", ")}</b>.</div> : null}
      {preview?.tooMany && <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Too many rows. Import at most 2,000 at a time.</div>}
      {s && !preview?.missingColumns.length && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <StatTile label="Rows" value={num(s.total)} />
            <StatTile label="Confirmed" value={num(s.confirmed)} intent="good" />
            <StatTile label="Rescheduled" value={num(s.rescheduled)} />
            <StatTile label="Declined" value={num(s.declined)} intent={s.declined ? "warning" : "neutral"} />
            <StatTile label="No answer / failed" value={num(s.noAnswer + s.failed)} />
            <StatTile label="Not understood" value={num(s.rejected)} intent={s.rejected ? "critical" : "neutral"} denominator="skipped" />
          </div>
          <div className="max-h-96 overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-2.5">Row</th><th className="px-4 py-2.5">Phone</th><th className="px-4 py-2.5">Tool said</th><th className="px-4 py-2.5">HRMS will record</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {preview!.rows.map((r) => (
                  <tr key={r.rowNo} className={r.ok ? "" : "bg-rose-50/40"}>
                    <td className="px-4 py-2 tabular-nums text-slate-500">{r.rowNo}</td>
                    <td className="px-4 py-2">{r.display.phone}{r.ok && !r.knownLead ? <span className="ml-2 text-xs text-amber-700">new candidate</span> : null}</td>
                    <td className="px-4 py-2 text-slate-700">{r.display.result || "—"}</td>
                    <td className="px-4 py-2">{r.ok && r.outcome ? <span className={`font-medium ${TONE[r.outcome] ?? ""}`}>{LABEL[r.outcome] ?? r.outcome}{r.newInterviewAt ? ` → ${r.newInterviewAt.slice(0, 16)}` : ""}</span> : <span className="text-rose-700">{r.errors.join("; ")}</span>}{r.warnings.map((w, i) => <div key={i} className="text-xs text-amber-700">{w}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end"><button type="button" disabled={s.valid === 0 || busy !== null} onClick={() => void apply()} className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">{busy === "apply" ? "Saving…" : `Save ${s.valid} result${s.valid === 1 ? "" : "s"}`}</button></div>
        </div>
      )}
    </section>
  );
}
