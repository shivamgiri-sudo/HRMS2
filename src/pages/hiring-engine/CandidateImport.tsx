/**
 * Add candidates from any pool (job website export, portal download, vendor list, walk-in sheet, referrals) into the
 * one master. The number is the person: existing people are enriched, never duplicated; a shared email is flagged.
 */
import { useRef, useState } from "react";
import { UserPlus } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

const SOURCES = [["website", "Job website"], ["portal", "Job portal (Naukri, WorkIndia, Apna)"], ["walkin", "Walk-in sheet"], ["calling", "Calling sheet"], ["referral", "Referral"], ["vendor", "Vendor"], ["other", "Other"]] as const;
interface Result { received: number; created: number; updated: number; rejected: Array<{ rowNo: number; reason: string }>; consentRecorded: number }

export default function CandidateImport({ onDone }: { onDone?: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<string>("portal");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true); setMsg(null);
    try {
      const XLSX = await import("xlsx");
      const wb = /\.csv$/i.test(f.name) ? XLSX.read(await f.text(), { type: "string", raw: true }) : XLSX.read(await f.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false }).filter((r) => Object.values(r).some((v) => String(v).trim() !== ""));
      if (!rows.length) { setMsg({ ok: false, text: "The file has no data rows." }); return; }
      const r = await hrmsApi.post<{ data: Result }>("/api/he/candidates/import", { rows, source }, 120000);
      const d = r.data;
      const bad = d.rejected.length ? ` · ${d.rejected.length} skipped (${[...new Set(d.rejected.map((x) => x.reason.replace(/_/g, " ")))].join(", ")})` : "";
      setMsg({ ok: true, text: `${d.created} new · ${d.updated} already known and enriched${d.consentRecorded ? ` · ${d.consentRecorded} with WhatsApp consent` : ""}${bad}.` });
      onDone?.();
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not import that file." }); }
    finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Add candidates">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><UserPlus className="h-4 w-4 text-blue-600" aria-hidden /> Add candidates from any source</h2>
      <p className="mt-1 text-xs text-slate-600">Needs a mobile column. Optional: name, email, age, education, experience, city, pincode, gender, process, consent (yes/no). Same number = same person; nothing is duplicated.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="ci-source">Source</label>
        <select id="ci-source" value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className={`inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500 ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy ? "Importing…" : "Choose file (CSV or Excel)"}
          <input ref={ref} type="file" accept=".csv,.xlsx,.xls" aria-label="Candidate file" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      </div>
      {msg && <p role="status" className={`mt-2 text-sm ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p>}
    </section>
  );
}
