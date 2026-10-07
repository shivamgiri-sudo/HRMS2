/**
 * Upload the call report downloaded from the Superbot portal (Bulk calls tab). Step 1 reads the file and shows what would happen to each call;
 * step 2 applies it. Each row is found by its HRMS-001 style reference. Uploading the same file twice is safe: calls are deduped on Superbot's call id.
 */
import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";

interface Summary { rows: number; matched: number; unmatched: number; unreadable: number; alreadyLoaded: number; outcomes: Record<string, number>; humanFollowUps: number; problems: Array<{ row: number; reason: string }> }

export default function SuperbotReportUpload() {
  const ref = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<"read" | "apply" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reset = () => { setRows([]); setPreview(null); setFileName(""); if (ref.current) ref.current.value = ""; };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy("read"); setMsg(null); setPreview(null); setFileName(f.name);
    try {
      const XLSX = await import("xlsx");
      const wb = /\.csv$/i.test(f.name) ? XLSX.read(await f.text(), { type: "string", raw: true }) : XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: false });
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false }).filter((r) => Object.values(r).some((v) => String(v).trim() !== ""));
      if (!data.length) { setMsg({ ok: false, text: "The file has no rows." }); return; }
      if (data.length > 5000) { setMsg({ ok: false, text: `The file has ${num(data.length)} rows; upload at most 5,000 at a time.` }); return; }
      setRows(data);
      setPreview((await hrmsApi.post<{ data: Summary }>("/api/he/superbot-report/preview", { rows: data }, 180000)).data);
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not read that file." }); }
    finally { setBusy(null); }
  };
  const apply = async () => {
    setBusy("apply"); setMsg(null);
    try {
      const s = (await hrmsApi.post<{ data: Summary }>("/api/he/superbot-report/import", { rows }, 600000)).data;
      setMsg({ ok: true, text: `Recorded ${num(s.matched - s.alreadyLoaded)} calls${s.alreadyLoaded ? ` (${num(s.alreadyLoaded)} were already loaded)` : ""}. ${num(s.humanFollowUps)} need a person to follow up.` });
      reset();
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not apply the report." }); }
    finally { setBusy(null); }
  };

  const fresh = preview ? preview.matched - preview.alreadyLoaded : 0;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Upload Superbot call report">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900"><FileUp className="h-4 w-4 text-emerald-600" aria-hidden /> Upload the Superbot call report</h2>
      <p className="mt-1 text-xs text-slate-600">Upload the report you downloaded from the Superbot portal (Excel or CSV). Confirmed candidates are marked confirmed and sent their confirmation; those who will not come are handed to a person; calls that ended early are noted and never marked declined.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className={`inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500 ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy === "read" ? "Reading…" : fileName || "Choose report (Excel or CSV)"}
          <input ref={ref} type="file" accept=".csv,.xlsx,.xls" aria-label="Superbot call report" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {preview && <button type="button" onClick={reset} className="cursor-pointer rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Cancel</button>}
      </div>
      {preview && (
        <div className="mt-4 space-y-3 text-sm" aria-label="What the report will do">
          <p className="text-slate-800"><b className="tabular-nums">{num(preview.rows)}</b> rows · <b className="tabular-nums text-emerald-700">{num(fresh)}</b> new calls to record{preview.alreadyLoaded > 0 && <> · {num(preview.alreadyLoaded)} already loaded</>}{preview.unmatched > 0 && <span className="text-amber-700"> · {num(preview.unmatched)} not matched to a candidate</span>}{preview.unreadable > 0 && <span className="text-amber-700"> · {num(preview.unreadable)} unreadable</span>}</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {Object.entries(preview.outcomes).sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k} className="flex justify-between rounded-md bg-slate-50 px-3 py-1.5"><span>{k}</span><b className="tabular-nums">{num(v)}</b></li>)}
          </ul>
          <p className="text-xs text-slate-600">{num(preview.humanFollowUps)} will be flagged for a person to follow up (asked for HR, a callback, or the call ended early).</p>
          {preview.problems.length > 0 && <ul className="max-h-32 overflow-auto rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{preview.problems.map((p, i) => <li key={i}>Row {p.row}: {p.reason}</li>)}</ul>}
          <button type="button" disabled={busy != null || fresh === 0} onClick={() => void apply()} className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            {busy === "apply" ? "Applying…" : fresh === 0 ? "Nothing new to apply" : `Apply ${num(fresh)} calls`}
          </button>
        </div>
      )}
      {msg && <p role="status" className={`mt-2 text-sm ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p>}
    </section>
  );
}
