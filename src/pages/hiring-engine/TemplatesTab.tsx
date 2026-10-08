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
  interface WaPlan { configured: boolean; to: string | null; gaps: number[]; scenarios: Array<{ id: string; label: string; steps: Array<{ key: string; name: string; approved: boolean }> }>; active?: WaJob | null }
  interface WaJob { to: string; gapMin: number; scenario: string; done: boolean; steps: Array<{ key: string; name: string; status: "waiting" | "sent" | "failed"; error?: string }> }
  const [wa, setWa] = useState<WaPlan | null>(null);
  const [waScenario, setWaScenario] = useState("happy");
  const [waGap, setWaGap] = useState(2);
  const [waJob, setWaJob] = useState<WaJob | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [waErr, setWaErr] = useState<string | null>(null);
  const waAsk = async () => {
    setWaBusy(true); setWaErr(null);
    try {
      const r = await hrmsApi.post<WaPlan>("/api/he/templates/whatsapp-sample", { confirm: false });
      if (!r.configured) setWaErr("WhatsApp (Pinbot) is not configured on the server, so nothing can be sent yet.");
      else if (!r.to) setWaErr("There is no mobile number on your employee profile, so a sample cannot be sent to you.");
      else { setWa(r); if (r.active) setWaJob(r.active); }
    } catch (e: unknown) { setWaErr((e as { message?: string })?.message || "Could not check"); }
    finally { setWaBusy(false); }
  };
  const waStart = async () => {
    setWaBusy(true); setWaErr(null);
    try { const r = await hrmsApi.post<{ job: WaJob }>("/api/he/templates/whatsapp-sample", { confirm: true, scenario: waScenario, gapMinutes: waGap }); setWaJob(r.job); }
    catch (e: unknown) { setWaErr((e as { message?: string })?.message || "Could not start the sample"); }
    finally { setWaBusy(false); }
  };
  // While a journey is running, poll its progress so each message shows as it goes out.
  useEffect(() => {
    if (!waJob || waJob.done) return;
    const t = setInterval(() => { void hrmsApi.get<{ job: WaJob | null }>("/api/he/templates/whatsapp-sample/status").then((r) => { if (r.job) setWaJob(r.job); }).catch(() => undefined); }, 5000);
    return () => clearInterval(t);
  }, [waJob]);
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
          <p className="text-xs text-slate-600">Emails you one test message for every stage: the email invite, the WhatsApp invite, the bot call script and each follow-up (WhatsApp and email). Sent only to your own address.</p>
        </div>
        <button type="button" disabled={sampling} onClick={() => void sendSamples()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"><Mail className="h-4 w-4" aria-hidden /> {sampling ? "Sending 17 emails…" : "Email me a sample of every stage"}</button>
        {sampleMsg && <p role={sampleMsg.ok ? "status" : "alert"} className={`basis-full text-sm ${sampleMsg.ok ? "text-emerald-700" : "text-rose-700"}`}>{sampleMsg.text}</p>}
        <div className="basis-full border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-xs text-slate-600">Also WhatsApp yourself a real candidate journey, one message at a time with a gap between them, to the mobile on your own profile. It goes through Pinbot and Meta, so it also shows right away if a template is rejected.</p>
            <button type="button" disabled={waBusy || wa !== null} onClick={() => void waAsk()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-600 px-3.5 py-2 text-sm font-semibold text-emerald-700 transition-colors duration-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"><MessageCircle className="h-4 w-4" aria-hidden /> {waBusy && !wa ? "Checking…" : "WhatsApp me a sample journey"}</button>
          </div>
          {waErr && <p role="alert" className="mt-3 text-sm text-rose-700">{waErr}</p>}
          {wa && !waJob && (
            <div role="group" aria-label="Choose a sample journey" className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <fieldset className="space-y-1.5">
                <legend className="mb-1 font-semibold text-slate-900">Which journey?</legend>
                {wa.scenarios.map((sc) => (
                  <label key={sc.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white">
                    <input type="radio" name="wa-scenario" value={sc.id} checked={waScenario === sc.id} onChange={() => setWaScenario(sc.id)} className="mt-1" />
                    <span className="min-w-0"><span className="block text-slate-900">{sc.label}</span><span className="mt-0.5 flex flex-wrap gap-1">{sc.steps.map((st) => <span key={st.key} className={`rounded-full px-2 py-0.5 text-[11px] ${st.approved ? "bg-white text-slate-600 ring-1 ring-slate-200" : "bg-rose-50 text-rose-700 ring-1 ring-rose-200"}`}>{st.name.replace(/^t(\d+)_he_/, "T$1 ").replace(/_/g, " ")}</span>)}</span></span>
                  </label>
                ))}
              </fieldset>
              <label className="flex flex-wrap items-center gap-2">Gap between messages
                <select value={waGap} onChange={(e) => setWaGap(Number(e.target.value))} className="rounded-lg border border-slate-300 bg-white px-2 py-1">{wa.gaps.map((g) => <option key={g} value={g}>{g} min</option>)}</select>
              </label>
              {(() => { const n = wa.scenarios.find((x) => x.id === waScenario)?.steps.length ?? 0; return <p className="text-slate-700">The first message goes <b>now</b>, then one every <b>{waGap} min</b> ({n} message{n === 1 ? "" : "s"}, about {Math.max(0, (n - 1) * waGap)} min in total) to <b>{wa.to}</b>, the mobile on your profile. Nobody else receives anything.</p>; })()}
              <div className="flex gap-2">
                <button type="button" disabled={waBusy} onClick={() => void waStart()} className="cursor-pointer rounded-md bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">{waBusy ? "Starting…" : "Start the journey"}</button>
                <button type="button" disabled={waBusy} onClick={() => setWa(null)} className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Cancel</button>
              </div>
            </div>
          )}
          {waJob && (
            <div role="status" aria-label="Sample journey progress" className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <p className="font-semibold text-slate-900">{waJob.done ? "Finished" : "Running"}: one message every {waJob.gapMin} min to {waJob.to}</p>
              <ol className="space-y-1">
                {waJob.steps.map((st) => (
                  <li key={st.key} className="flex flex-wrap items-baseline gap-2">
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${st.status === "sent" ? "bg-emerald-100 text-emerald-700" : st.status === "failed" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-500"}`} aria-hidden>{st.status === "sent" ? "✓" : st.status === "failed" ? "!" : "…"}</span>
                    <span className="text-slate-900">{st.name}</span>
                    <span className="text-xs text-slate-500">{st.status === "sent" ? "sent" : st.status === "failed" ? `rejected: ${st.error}` : "waiting"}</span>
                  </li>
                ))}
              </ol>
              {waJob.done && <button type="button" onClick={() => { setWaJob(null); setWa(null); }} className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Done</button>}
            </div>
          )}
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
