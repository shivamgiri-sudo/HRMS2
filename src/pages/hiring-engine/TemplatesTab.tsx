/**
 * Template registry. Nothing is sent from a template until its row is Approved here. Admins record Meta's decision
 * (and, if Pinbot approved a different name, the name to send). Reads/writes /api/he/templates.
 */
import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface Row { template_key: string; pinbot_name: string | null; language: string; approval_state: string }
const STATES = ["draft", "submitted", "approved", "rejected"];
const TONE: Record<string, string> = { approved: "bg-emerald-50 text-emerald-700 ring-emerald-200", rejected: "bg-rose-50 text-rose-700 ring-rose-200", submitted: "bg-blue-50 text-blue-700 ring-blue-200", draft: "bg-slate-50 text-slate-600 ring-slate-200" };

export default function TemplatesTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [paused, setPaused] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await hrmsApi.get<{ data: Row[]; sendsPaused: boolean }>("/api/he/templates"); setRows(r.data ?? []); setPaused(Boolean(r.sendsPaused)); setErr(null); }
    catch (e: unknown) { setErr((e as { message?: string })?.message || "Unable to load templates"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const update = async (key: string, body: { approvalState?: string; pinbotName?: string; language?: string }) => {
    try { await hrmsApi.patch(`/api/he/templates/${encodeURIComponent(key)}`, body); await load(); }
    catch (e: unknown) { setErr((e as { message?: string })?.message || "Only an admin can change this"); }
  };

  return (
    <div className="space-y-4">
      {paused && <div role="alert" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><ShieldAlert className="h-4 w-4" aria-hidden /> Sending is paused by the HE_SENDS_PAUSED switch. Nothing is delivered until it is cleared.</div>}
      {err && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div>}
      <p className="text-sm text-slate-600">Submit each template to Meta/Pinbot, then record the decision here. Only <b>approved</b> templates can be sent.</p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Template</th><th className="px-4 py-3">Name sent to Pinbot</th><th className="px-4 py-3">Language</th><th className="px-4 py-3">Approval</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.template_key}>
                <td className="px-4 py-2.5 font-medium text-slate-900">{r.template_key}</td>
                <td className="px-4 py-2.5"><input defaultValue={r.pinbot_name ?? ""} aria-label={`Pinbot name for ${r.template_key}`} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.pinbot_name) void update(r.template_key, { pinbotName: v }); }} className="w-full max-w-xs rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" /></td>
                <td className="px-4 py-2.5 text-slate-600"><span className="mr-2">{r.template_key.endsWith(":hi") ? "Hinglish" : "English"}</span><input defaultValue={r.language} aria-label={`Meta language code for ${r.template_key}`} title="Language code exactly as approved at Meta (en, en_US, hi)" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.language) void update(r.template_key, { language: v }); }} className="w-20 rounded-lg border border-slate-200 px-2 py-1 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" /></td>
                <td className="px-4 py-2.5">
                  <select value={r.approval_state} onChange={(e) => void update(r.template_key, { approvalState: e.target.value })} aria-label={`Approval state for ${r.template_key}`} className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${TONE[r.approval_state] ?? TONE.draft}`}>
                    {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
