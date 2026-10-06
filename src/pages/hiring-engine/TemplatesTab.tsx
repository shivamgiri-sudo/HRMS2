/**
 * Template registry. Nothing is sent from a template until its row is Approved here. Admins record Meta's decision
 * (and, if Pinbot approved a different name, the name to send). Reads/writes /api/he/templates.
 */
import { useCallback, useEffect, useState } from "react";
import { Mail, MessageCircle, ShieldAlert } from "lucide-react";
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

  const [sampling, setSampling] = useState(false);
  const [sampleMsg, setSampleMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sendSamples = async () => {
    setSampling(true); setSampleMsg(null);
    try {
      const r = await hrmsApi.post<{ to: string; sent: number; failed: number }>("/api/he/templates/send-samples", {}, 180000);
      setSampleMsg({ ok: r.failed === 0, text: `${r.sent} sample emails sent to ${r.to}${r.failed ? `, ${r.failed} failed` : ""}. Each one is stamped TEST and nothing was sent to a candidate.` });
    } catch (e: unknown) { setSampleMsg({ ok: false, text: (e as { message?: string })?.message || "Could not send the samples" }); }
    finally { setSampling(false); }
  };
  const [wa, setWa] = useState<{ configured: boolean; to: string | null; templates: number } | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [waMsg, setWaMsg] = useState<{ ok: boolean; text: string; fails: string[] } | null>(null);
  const waAsk = async () => {
    setWaBusy(true); setWaMsg(null);
    try {
      const r = await hrmsApi.post<{ configured: boolean; to: string | null; templates: number }>("/api/he/templates/whatsapp-sample", { confirm: false });
      if (!r.configured) setWaMsg({ ok: false, text: "WhatsApp (Pinbot) is not configured on the server, so nothing can be sent yet.", fails: [] });
      else if (!r.to) setWaMsg({ ok: false, text: "There is no mobile number on your employee profile, so a sample cannot be sent to you.", fails: [] });
      else setWa(r);
    } catch (e: unknown) { setWaMsg({ ok: false, text: (e as { message?: string })?.message || "Could not check", fails: [] }); }
    finally { setWaBusy(false); }
  };
  const waSend = async () => {
    setWaBusy(true); setWaMsg(null);
    try {
      const r = await hrmsApi.post<{ to: string; sent: number; failed: number; results: Array<{ name: string; ok: boolean; error?: string }> }>("/api/he/templates/whatsapp-sample", { confirm: true }, 240000);
      setWaMsg({ ok: r.failed === 0, text: `${r.sent} of ${r.sent + r.failed} WhatsApp messages accepted for ${r.to}. They arrive in order within a minute.`, fails: r.results.filter((x) => !x.ok).map((x) => `${x.name}: ${x.error}`) });
    } catch (e: unknown) { setWaMsg({ ok: false, text: (e as { message?: string })?.message || "Could not send the WhatsApp samples", fails: [] }); }
    finally { setWaBusy(false); setWa(null); }
  };
  const update = async (key: string, body: { approvalState?: string; pinbotName?: string; language?: string }) => {
    try { await hrmsApi.patch(`/api/he/templates/${encodeURIComponent(key)}`, body); await load(); }
    catch (e: unknown) { setErr((e as { message?: string })?.message || "Only an admin can change this"); }
  };

  return (
    <div className="space-y-4">
      {paused && <div role="alert" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><ShieldAlert className="h-4 w-4" aria-hidden /> Sending is paused by the HE_SENDS_PAUSED switch. Nothing is delivered until it is cleared.</div>}
      {err && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div>}
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Sample emails">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">See exactly what candidates receive</p>
          <p className="text-xs text-slate-600">Emails you one test message for every stage: the email invite, the WhatsApp invite, the bot call script and each follow-up. Sent only to your own address.</p>
        </div>
        <button type="button" disabled={sampling} onClick={() => void sendSamples()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"><Mail className="h-4 w-4" aria-hidden /> {sampling ? "Sending 13 emails…" : "Email me a sample of every stage"}</button>
        {sampleMsg && <p role={sampleMsg.ok ? "status" : "alert"} className={`basis-full text-sm ${sampleMsg.ok ? "text-emerald-700" : "text-rose-700"}`}>{sampleMsg.text}</p>}
        <div className="basis-full border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-xs text-slate-600">Also WhatsApp you each approved template with sample values, to the mobile on your own profile. This is the real route through Pinbot and Meta, so it shows right away if a template or language code is rejected.</p>
            <button type="button" disabled={waBusy || wa !== null} onClick={() => void waAsk()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-600 px-3.5 py-2 text-sm font-semibold text-emerald-700 transition-colors duration-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"><MessageCircle className="h-4 w-4" aria-hidden /> {waBusy ? "Working…" : "WhatsApp me a sample of every template"}</button>
          </div>
          {wa && (
            <div role="alertdialog" aria-label="Confirm WhatsApp samples" className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <span className="min-w-0 flex-1">This sends <b>{wa.templates} WhatsApp messages</b> to <b>{wa.to}</b>, the mobile on your profile. Nobody else receives anything.</span>
              <button type="button" disabled={waBusy} onClick={() => void waSend()} className="cursor-pointer rounded-md bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">Yes, send them</button>
              <button type="button" disabled={waBusy} onClick={() => setWa(null)} className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Cancel</button>
            </div>
          )}
          {waMsg && <div role={waMsg.ok ? "status" : "alert"} className={`mt-3 text-sm ${waMsg.ok ? "text-emerald-700" : "text-rose-700"}`}><p>{waMsg.text}</p>{waMsg.fails.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{waMsg.fails.map((f) => <li key={f}>{f}</li>)}</ul>}</div>}
        </div>
      </section>
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
