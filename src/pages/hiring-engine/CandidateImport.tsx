/**
 * Add candidates from any pool (WorkIndia, Naukri, Apna, Indeed, job website export, vendor list, walk-in sheet...).
 * Step 1: choose the file -> the system recognises each column (from the header, a remembered layout, or the values).
 * Step 2: HR checks / corrects the mapping in place, sees how many rows are new vs already known, and imports.
 * The confirmed mapping is remembered for that header layout, so the next export from the same portal maps itself.
 * The number is the person: existing people are enriched, never duplicated; a shared email/Aadhaar is flagged.
 */
import { useMemo, useRef, useState } from "react";
import { CheckCircle2, UserPlus, Wand2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";

const SOURCES = [["workindia", "WorkIndia"], ["naukri", "Naukri"], ["apna", "Apna"], ["indeed", "Indeed"], ["shine", "Shine"], ["foundit", "foundit"], ["linkedin", "LinkedIn"],
  ["website", "Job website"], ["portal", "Other job portal"], ["walkin", "Walk-in sheet"], ["calling", "Calling sheet"], ["referral", "Referral"], ["vendor", "Vendor"], ["other", "Other"]] as const;

interface Guess { header: string; field: string | null; confidence: number; reason: string }
interface Preview {
  signature: string; savedMapping: boolean; headers: string[]; guesses: Guess[]; mapping: Record<string, string>;
  fields: Array<{ field: string; label: string }>;
  summary: { rows: number; valid: number; rejected: number; rejectedBy: Record<string, number>; alreadyKnown: number; newPeople: number };
  blocked?: Record<string, number>;
  missingMobile: boolean;
}
interface Result { received: number; created: number; updated: number; rejected: Array<{ rowNo: number; reason: string }>; consentRecorded: number; mappingSaved: boolean; batchId?: string | null; blocked?: Record<string, number> }

export default function CandidateImport({ onDone }: { onDone?: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string>("workindia");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [colField, setColField] = useState<Record<string, string>>({}); // header -> field ("" = ignore)
  const [label, setLabel] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState<"read" | "import" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reset = () => { setLabel(""); setAttested(false); setRows([]); setPreview(null); setColField({}); setFileName(""); if (ref.current) ref.current.value = ""; };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy("read"); setMsg(null); setPreview(null); setFileName(f.name);
    try {
      const XLSX = await import("xlsx");
      const wb = /\.csv$/i.test(f.name) ? XLSX.read(await f.text(), { type: "string", raw: true }) : XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: false });
      // Some portal exports put a title row above the headers: use the first row that has 2+ non-empty cells as the header.
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
      const headerIdx = Math.max(0, grid.findIndex((r) => (r as unknown[]).filter((c) => String(c).trim() !== "").length >= 2));
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false, range: headerIdx })
        .filter((r) => Object.values(r).some((v) => String(v).trim() !== ""));
      if (!data.length) { setMsg({ ok: false, text: "The file has no data rows." }); return; }
      if (data.length > 5000) { setMsg({ ok: false, text: `The file has ${num(data.length)} rows; upload at most 5,000 at a time.` }); return; }
      setRows(data);
      const p = await hrmsApi.post<{ data: Preview }>("/api/he/candidates/preview", { rows: data }, 120000);
      setPreview(p.data);
      setColField(Object.fromEntries(p.data.guesses.map((g) => [g.header, g.field ?? ""])));
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not read that file." }); }
    finally { setBusy(null); }
  };

  const mapping = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [h, f] of Object.entries(colField)) if (f && !m[f]) m[f] = h;
    return m;
  }, [colField]);
  const dupFields = useMemo(() => {
    const seen = new Map<string, number>();
    for (const f of Object.values(colField)) if (f) seen.set(f, (seen.get(f) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([f]) => f));
  }, [colField]);
  const sampleOf = (h: string) => rows.slice(0, 3).map((r) => String(r[h] ?? "")).filter(Boolean).join(" · ").slice(0, 60);

  const doImport = async () => {
    if (!mapping.mobile) { setMsg({ ok: false, text: "Pick which column holds the mobile number." }); return; }
    setBusy("import"); setMsg(null);
    try {
      const r = await hrmsApi.post<{ data: Result }>("/api/he/candidates/import", { rows, source, mapping, saveMapping: true, label: label.trim() || undefined, fileName: fileName || undefined, consentAttested: attested }, 300000);
      const d = r.data;
      const bad = d.rejected.length ? ` · ${num(d.rejected.length)} skipped (${[...new Set(d.rejected.map((x) => x.reason.replace(/_/g, " ")))].join(", ")})` : "";
      setMsg({ ok: true, text: `${num(d.created)} new candidates · ${num(d.updated)} already known and enriched${d.consentRecorded ? ` · ${num(d.consentRecorded)} with WhatsApp consent` : ""}${bad}.${d.blocked && Object.keys(d.blocked).length ? ` The engine will never contact: ${Object.entries(d.blocked).map(([k, v]) => `${num(v)} ${k.replace(/_/g, " ")}`).join(", ")}.` : ""} Saved as an upload batch: launch it from "Launch a campaign" below.${d.mappingSaved ? " This column layout is remembered for next time." : ""}` });
      reset(); onDone?.();
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not import that file." }); }
    finally { setBusy(null); }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Add candidates">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><UserPlus className="h-4 w-4 text-blue-600" aria-hidden /> Add candidates from any portal or sheet</h2>
      <p className="mt-1 text-xs text-slate-600">Upload the export as it comes from WorkIndia, Naukri, Apna, Indeed or any sheet. Columns are recognised automatically; check them below before importing. Same number = same person, nothing is duplicated.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="ci-source">Source</label>
        <select id="ci-source" value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className={`inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500 ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy === "read" ? "Reading…" : fileName || "Choose file (CSV or Excel)"}
          <input ref={ref} type="file" accept=".csv,.xlsx,.xls" aria-label="Candidate file" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {preview && <button type="button" onClick={reset} className="cursor-pointer rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Cancel</button>}
      </div>

      {preview && (
        <div className="mt-4 space-y-3" aria-label="Column mapping">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5 text-slate-700">{preview.savedMapping ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> Known layout: mapping remembered from an earlier upload</> : <><Wand2 className="h-4 w-4 text-blue-600" aria-hidden /> New layout: columns recognised automatically</>}</span>
            <span><b className="tabular-nums">{num(preview.summary.valid)}</b> valid of {num(preview.summary.rows)}</span>
            <span><b className="tabular-nums text-emerald-700">{num(preview.summary.newPeople)}</b> new</span>
            <span><b className="tabular-nums">{num(preview.summary.alreadyKnown)}</b> already in the pool (will be enriched)</span>
            {preview.summary.rejected > 0 && <span className="text-amber-700">{num(preview.summary.rejected)} skipped ({Object.entries(preview.summary.rejectedBy).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ")})</span>}
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2">Column in the file</th><th className="px-3 py-2">Example values</th><th className="px-3 py-2">Use as</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {preview.guesses.map((g) => {
                  const f = colField[g.header] ?? "";
                  return (
                    <tr key={g.header} className={f ? "" : "text-slate-400"}>
                      <td className="px-3 py-1.5 font-medium">{g.header}</td>
                      <td className="max-w-[260px] truncate px-3 py-1.5 text-xs" title={sampleOf(g.header)}>{sampleOf(g.header) || "—"}</td>
                      <td className="px-3 py-1.5">
                        <label className="sr-only" htmlFor={`map-${g.header}`}>Use column {g.header} as</label>
                        <select id={`map-${g.header}`} value={f} onChange={(e) => setColField((m) => ({ ...m, [g.header]: e.target.value }))}
                          className={`w-48 rounded-md border px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${dupFields.has(f) ? "border-rose-400 bg-rose-50" : f ? "border-emerald-300 bg-emerald-50/50 text-slate-900" : "border-slate-200 bg-white"}`}>
                          <option value="">Ignore this column</option>
                          {preview.fields.map((x) => <option key={x.field} value={x.field}>{x.label}</option>)}
                        </select>
                        {f && g.field === f && g.confidence < 100 && <span className="ml-2 text-[11px] text-slate-400">{g.reason}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.blocked && Object.keys(preview.blocked).length > 0 && <p className="text-xs text-amber-700">The engine will never contact: {Object.entries(preview.blocked).map(([k, v]) => `${num(v)} ${k.replace(/_/g, " ")}`).join(", ")}.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-600">Name this upload (shown in launches)
              <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={160} placeholder={`${fileName || "Upload"}`} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5" />
              <span>I confirm these people agreed to be contacted on WhatsApp (recorded as consent for this batch). Anyone who opted out is never re-enabled.</span>
            </label>
          </div>
          {dupFields.size > 0 && <p className="text-xs text-rose-700">Two columns are set to the same field; only the first is used.</p>}
          <button type="button" disabled={busy != null || !mapping.mobile} onClick={() => void doImport()} className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            {busy === "import" ? "Importing…" : mapping.mobile ? `Import ${num(preview.summary.valid)} candidates` : "Pick the mobile column first"}
          </button>
        </div>
      )}
      {msg && <p role="status" className={`mt-2 text-sm ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p>}
    </section>
  );
}
