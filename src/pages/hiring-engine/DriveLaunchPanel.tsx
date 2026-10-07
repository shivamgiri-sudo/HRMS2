/**
 * Drive launch panel (opens from a drive row in the Drives tab): what is ready, who would get what, and the buttons to
 * start. Step 1 is the EMAIL invite, which needs neither a WhatsApp template nor WhatsApp opt-in, so outreach can start
 * today. WhatsApp follows one hour later once its template is approved; the call follows one hour after that (or two
 * hours after the email when WhatsApp could not go out). Nothing is sent from Preview.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Mail, MessageCircle, PhoneCall, Send, XCircle, Eye, RefreshCcw } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { num } from "@/components/analytics/analytics-kit";
import DriveShortlist from "./DriveShortlist";

interface Check { key: string; ok: boolean; label: string; detail: string; blocks: string | null }
interface Readiness {
  drive: { id: string; status: string; autoSend: boolean; date: string; targetShows: number; requisition: string; role: string };
  checks: Check[];
  pool: { suggested: number; suggestedWithEmail: number; suggestedWithConsent: number; invited: number; confirmed: number; arrived: number };
  sent: Record<string, number>;
  canSendEmailNow: boolean;
  gapMinutes: number;
  requirements: { jd: Jd | null; rules: Rules | null };
}
interface Rules { minEducationRank: number | null; minExperienceYears: number | null; ageMin: number | null; ageMax: number | null; gender: string | null; nightShift: boolean | null; certifications: string[] | null; languages: string[] | null; salaryMax: number | null; mandatorySkills: string[]; preferredSkills: string[]; locationTokens: string[]; branchName: string; processName: string | null }
interface Jd { source: "uploaded" | "requisition"; sourceName: string | null; parsed: { title: string | null; minExperience: number | null; salaryMonthly: number | null; mandatorySkills: string[]; preferredSkills: string[]; location: string | null } }
const EDU: Record<number, string> = { 1: "below 10th", 2: "10th pass", 3: "12th pass", 4: "diploma", 5: "graduate", 6: "post-graduate" };
interface Planned { matchId: string; name: string | null; mobile: string; channel: "email" | "whatsapp" | null; reason: string }
interface Launch { sent: number; failed: number; dryRun: number; blocked: Record<string, number>; planned: Planned[]; considered: number }
interface Cnt { sent: number; failed: number; dryRun: number; blocked: Record<string, number> }

const BATCHES = [25, 50, 100, 200];
const reqIdOf = (r: Readiness) => (r as unknown as { drive: { requisitionId?: string } }).drive.requisitionId ?? "";

export default function DriveLaunchPanel({ driveId, onClose, onChanged }: { driveId: string | null; onClose: () => void; onChanged: () => void }) {
  const [r, setR] = useState<Readiness | null>(null);
  const [plan, setPlan] = useState<Launch | null>(null);
  const [limit, setLimit] = useState(50);
  const [engine, setEngine] = useState<{ engineAuto: boolean; engineMode: "off" | "dry" | "live"; engineLastTick: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [view, setView] = useState<"outreach" | "shortlist">("outreach");

  const load = useCallback(async () => {
    if (!driveId) return;
    try { const x = await hrmsApi.get<{ data: Readiness }>(`/api/he/drives/${driveId}/readiness`); setR(x.data); }
    catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not load the drive" }); }
  }, [driveId]);
  useEffect(() => { setR(null); setPlan(null); setMsg(null); setConfirm(false); setView("outreach"); void load(); }, [load]);

  const preview = async () => {
    setBusy("preview"); setMsg(null); setConfirm(false);
    try { const x = await hrmsApi.post<{ data: Launch }>(`/api/he/drives/${driveId}/launch`, { dryRun: true, limit }); setPlan(x.data); }
    catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Preview failed" }); }
    finally { setBusy(null); }
  };
  const send = async () => {
    setBusy("send"); setMsg(null); setConfirm(false);
    try {
      const x = await hrmsApi.post<{ data: Launch }>(`/api/he/drives/${driveId}/launch`, { dryRun: false, limit }, 300000);
      const d = x.data;
      const blocked = Object.entries(d.blocked).map(([k, v]) => `${v} ${k}`).join(", ");
      setMsg({ ok: d.failed === 0, text: `${num(d.sent)} invites sent${d.failed ? ` · ${num(d.failed)} failed` : ""}${blocked ? ` · not sent: ${blocked}` : ""}.` });
      setPlan(null); await load(); onChanged();
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Sending failed" }); }
    finally { setBusy(null); }
  };
  const followUps = async () => {
    setBusy("follow"); setMsg(null);
    try {
      const x = await hrmsApi.post<{ data: { whatsapp: Cnt; reminders: Cnt; calls: Cnt; recovery?: Cnt; replacement?: Cnt; noShows?: number; otherRoles?: { offered?: number } | null; alerts?: { alerted?: number } } }>("/api/he/engine/follow-ups", { dryRun: false }, 300000);
      const f = x.data; const why = (c: Cnt) => Object.entries(c.blocked).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(", ");
      const more = [f.noShows ? `${f.noShows} marked no-show (${f.recovery?.sent ?? 0} follow-up messages)` : "", f.replacement?.sent ? `${f.replacement.sent} new-slot offers` : "", f.otherRoles?.offered ? `${f.otherRoles.offered} other-role offers` : "", f.alerts?.alerted ? `${f.alerts.alerted} branch HR alerts` : ""].filter(Boolean).join(" · ");
      setMsg({ ok: true, text: `Follow-ups: ${f.whatsapp.sent} WhatsApp${why(f.whatsapp) ? ` (waiting: ${why(f.whatsapp)})` : ""} · ${f.calls.sent} calls${why(f.calls) ? ` (waiting: ${why(f.calls)})` : ""} · ${f.reminders.sent} reminders${more ? ` · ${more}` : ""}.` });
      await load();
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Follow-ups failed" }); }
    finally { setBusy(null); }
  };

  const willEmail = plan?.planned.filter((p) => p.channel === "email").length ?? 0;
  const willWa = plan?.planned.filter((p) => p.channel === "whatsapp").length ?? 0;
  const uploadJd = async (f: File | undefined) => {
    if (!f || !r) return;
    setBusy("jd"); setMsg(null);
    try {
      const buf = new Uint8Array(await f.arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      await hrmsApi.post(`/api/he/requisitions/${reqIdOf(r)}/jd`, { fileName: f.name, base64: btoa(bin) }, 60000);
      setMsg({ ok: true, text: `JD "${f.name}" read. Click Find leads on the drive to re-shortlist against it.` }); await load();
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not read that JD" }); }
    finally { setBusy(null); }
  };
  const loadEngine = useCallback(async () => {
    try { const p = await hrmsApi.get<{ engineAuto: boolean; engineMode: "off" | "dry" | "live"; engineLastTick: string | null }>("/api/he/policy"); setEngine({ engineAuto: p.engineAuto, engineMode: p.engineMode, engineLastTick: p.engineLastTick }); } catch { /* the section still works manually */ }
  }, []);
  useEffect(() => { if (driveId) void loadEngine(); }, [driveId, loadEngine]);
  const toggleAuto = async () => {
    setBusy("auto"); setMsg(null);
    try {
      const turnOn = engine?.engineMode !== "live";
      const p = await hrmsApi.put<{ engineAuto: boolean; engineMode: "off" | "dry" | "live"; engineLastTick: string | null }>("/api/he/policy", { engineAuto: turnOn });
      setEngine({ engineAuto: p.engineAuto, engineMode: p.engineMode, engineLastTick: p.engineLastTick });
      setMsg({ ok: true, text: turnOn ? "Automatic follow-ups are ON. The engine runs every 5 minutes and follows the plan above." : p.engineMode === "live" ? "The screen switch is off, but the server is configured to run follow-ups automatically." : "Automatic follow-ups are OFF. Use 'Run follow-ups now' to run them by hand." });
      await load();
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Only an admin can switch this" }); }
    finally { setBusy(null); }
  };
  const followNeeded = r?.checks.find((c) => c.key === "engine")?.ok === false;

  return (
    <Sheet open={driveId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className={`w-full overflow-y-auto ${view === "shortlist" ? "sm:max-w-6xl" : "sm:max-w-2xl"}`}>
        <SheetHeader><SheetTitle>{r ? `Start outreach · ${r.drive.role} · ${r.drive.date}` : "Start outreach"}</SheetTitle></SheetHeader>
        <div role="tablist" aria-label="Panel sections" className="mt-2 flex gap-1 border-b border-slate-200">
          {([["outreach", "Outreach"], ["shortlist", "Shortlist & status"]] as const).map(([k, l]) => (
            <button key={k} role="tab" type="button" aria-selected={view === k} onClick={() => setView(k)} className={`-mb-px cursor-pointer border-b-2 px-3 py-2 text-sm font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${view === k ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{l}</button>
          ))}
        </div>
        {view === "shortlist" && driveId ? <div className="pt-3 pb-8"><DriveShortlist driveId={driveId} /></div> : !r ? <div className="mt-6 h-40 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" aria-hidden /> : (
          <div className="space-y-5 pb-8">
            <ol className="mt-3 grid grid-cols-3 gap-2 text-center text-xs" aria-label="Outreach order">
              <li className="rounded-lg border border-blue-200 bg-blue-50 p-2"><Mail className="mx-auto h-4 w-4 text-blue-600" aria-hidden /><div className="mt-1 font-semibold text-slate-900">1. Email</div><div className="text-slate-500">now</div></li>
              <li className="rounded-lg border border-emerald-200 bg-emerald-50 p-2"><MessageCircle className="mx-auto h-4 w-4 text-emerald-600" aria-hidden /><div className="mt-1 font-semibold text-slate-900">2. WhatsApp</div><div className="text-slate-500">+{r.gapMinutes} min</div></li>
              <li className="rounded-lg border border-violet-200 bg-violet-50 p-2"><PhoneCall className="mx-auto h-4 w-4 text-violet-600" aria-hidden /><div className="mt-1 font-semibold text-slate-900">3. Bot call</div><div className="text-slate-500">+{r.gapMinutes} min</div></li>
            </ol>

            {r.requirements?.rules && (() => {
              const ru = r.requirements.rules!; const jd = r.requirements.jd;
              const items: Array<[string, string | null]> = [
                ["Location", ru.locationTokens.length ? `${ru.branchName} area (${ru.locationTokens.slice(0, 4).join(", ")})` : null],
                ["Qualification", ru.minEducationRank ? `${EDU[ru.minEducationRank] ?? ru.minEducationRank} or higher` : null],
                ["Experience", ru.minExperienceYears ? `${ru.minExperienceYears}+ years` : null],
                ["Age", ru.ageMin || ru.ageMax ? `${ru.ageMin ?? "-"} to ${ru.ageMax ?? "-"}` : null],
                ["Gender", ru.gender], ["Certification", ru.certifications?.length ? ru.certifications.join(", ") + " (must hold)" : null],
                ["Languages", ru.languages?.length ? ru.languages.join(", ") : null], ["Night shift", ru.nightShift ? "required" : null],
                ["Salary", ru.salaryMax ? `up to Rs ${ru.salaryMax.toLocaleString("en-IN")}/month` : null],
                ["Mandatory skills", ru.mandatorySkills.length ? ru.mandatorySkills.join(", ") : null], ["Preferred skills", ru.preferredSkills.length ? ru.preferredSkills.join(", ") : null],
              ];
              return (
                <section aria-label="Requirements" className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Who gets shortlisted (from the JD)</h3>
                    <label className={`inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-blue-500 ${busy ? "pointer-events-none opacity-60" : ""}`}>
                      {busy === "jd" ? "Reading JD…" : jd?.source === "uploaded" ? `JD: ${jd.sourceName ?? "uploaded"} · replace` : "Upload JD (.docx / .pdf)"}
                      <input type="file" accept=".docx,.pdf,.txt" aria-label="JD document" className="sr-only" onChange={(e) => void uploadJd(e.target.files?.[0])} />
                    </label>
                  </div>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                    {items.filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-32 shrink-0 text-slate-500">{k}</dt><dd className="text-slate-800">{v}</dd></div>)}
                  </dl>
                  <p className="mt-2 text-[11px] text-slate-500">Hard rules must be confirmed on the candidate's record. When a candidate's skills are on record, at least one mandatory skill must match, and a stated salary more than 25% above the JD is left out. {jd?.source === "uploaded" ? "" : "No JD document uploaded yet: the requisition's own text is used."}</p>
                </section>
              );
            })()}

            <section aria-label="Readiness">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Ready to send?</h3>
              <ul className="space-y-1.5">
                {r.checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-2 text-sm">
                    {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="ready" /> : <XCircle className={`mt-0.5 h-4 w-4 shrink-0 ${c.blocks === "all" || c.blocks === "email" ? "text-rose-600" : "text-amber-500"}`} aria-label="not ready" />}
                    <span><span className="font-medium text-slate-900">{c.label}</span> <span className="text-slate-500">· {c.detail}</span></span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-label="Candidates" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[["Shortlisted", r.pool.suggested], ["With email", r.pool.suggestedWithEmail], ["With WhatsApp opt-in", r.pool.suggestedWithConsent], ["Already invited", r.pool.invited + r.pool.confirmed]].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg border border-slate-200 p-2"><div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{k}</div><div className="text-xl font-bold tabular-nums text-slate-900">{num(Number(v))}</div></div>
              ))}
            </section>
            {r.pool.suggested === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Nobody is shortlisted yet. Close this and click <b>Find leads</b> on the drive first.</p>}
            {r.drive.status !== "active" && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">The drive is <b>{r.drive.status}</b>. Activate it to send invites (Preview works anyway).</p>}

            <section aria-label="Send" className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="batch" className="text-sm text-slate-700">Batch</label>
                <select id="batch" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPlan(null); setConfirm(false); }} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  {BATCHES.map((b) => <option key={b} value={b}>{b} candidates</option>)}
                </select>
                <button type="button" onClick={() => void preview()} disabled={busy != null || r.pool.suggested === 0} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Eye className="h-4 w-4" aria-hidden /> {busy === "preview" ? "Checking…" : "Preview"}</button>
                {plan && !confirm && (
                  <button type="button" onClick={() => setConfirm(true)} disabled={busy != null || plan.dryRun === 0 || r.drive.status !== "active"} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Send className="h-4 w-4" aria-hidden /> Send {num(plan.dryRun)} invites now</button>
                )}
                {confirm && plan && (
                  <span className="flex flex-wrap items-center gap-2 rounded-lg bg-blue-50 px-2 py-1 text-sm">
                    Send {num(willEmail)} emails{willWa ? ` and ${num(willWa)} WhatsApp` : ""} now?
                    <button type="button" onClick={() => void send()} disabled={busy != null} className="cursor-pointer rounded-md bg-blue-600 px-2.5 py-1 font-semibold text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{busy === "send" ? "Sending…" : "Yes, send"}</button>
                    <button type="button" onClick={() => setConfirm(false)} className="cursor-pointer rounded-md px-2 py-1 text-slate-600 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Cancel</button>
                  </span>
                )}
              </div>
              {plan && (
                <div className="mt-3">
                  <p className="text-sm text-slate-700"><b className="tabular-nums">{num(willEmail)}</b> by email · <b className="tabular-nums">{num(willWa)}</b> by WhatsApp · <b className="tabular-nums">{num(plan.considered - plan.dryRun)}</b> cannot be reached{Object.keys(plan.blocked).length ? ` (${Object.entries(plan.blocked).map(([k, v]) => `${v} ${k}`).join(", ")})` : ""}</p>
                  <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-100">
                    <table className="w-full text-left text-sm">
                      <thead className="sticky top-0 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-2 py-1.5">Candidate</th><th className="px-2 py-1.5">First touch</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {plan.planned.map((p) => (
                          <tr key={p.matchId}><td className="px-2 py-1.5">{p.name ?? "Unnamed"} <span className="font-mono text-xs text-slate-400">{p.mobile}</span></td>
                            <td className={`px-2 py-1.5 text-xs ${p.channel ? "text-slate-700" : "text-rose-700"}`}>{p.channel === "email" ? "Email" : p.channel === "whatsapp" ? "WhatsApp" : "Not sent"} · {p.reason}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            <section aria-label="Follow-ups" className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 text-sm text-slate-700">
                  <div className="font-medium text-slate-900">Follow-ups: automatic and manual</div>
                  <div className="text-xs text-slate-500">Sent so far for this drive: {num(r.sent.email ?? 0)} email · {num(r.sent.whatsapp ?? 0)} WhatsApp.</div>
                  <div role="status" className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${engine?.engineMode === "live" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"}`}>
                    <span className={`h-2 w-2 rounded-full ${engine?.engineMode === "live" ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
                    {engine?.engineMode === "live" ? `Automatic follow-ups are ON${engine.engineLastTick ? ` · last run ${new Date(engine.engineLastTick).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : " · first run within 5 minutes"}` : "Automatic follow-ups are OFF"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" role="switch" aria-checked={engine?.engineMode === "live"} disabled={busy != null || engine == null} onClick={() => void toggleAuto()} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${engine?.engineMode === "live" ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50" : "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"}`}>{engine?.engineMode === "live" ? "Turn automatic OFF" : "Turn automatic ON"}</button>
                  <button type="button" onClick={() => void followUps()} disabled={busy != null} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><RefreshCcw className={`h-4 w-4 ${busy === "follow" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> Run follow-ups now</button>
                </div>
              </div>
              <ol className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-600" aria-label="What happens automatically">
                <li><b className="text-slate-800">Email</b> goes out first (09:00 to 20:00 IST).</li>
                <li><b className="text-slate-800">WhatsApp invite</b> an hour later to anyone who has not replied, then the <b className="text-slate-800">bot call</b> an hour after that.</li>
                <li><b className="text-slate-800">On a Yes:</b> confirmation email and WhatsApp with the reference.</li>
                <li><b className="text-slate-800">The day before:</b> reminder email and WhatsApp. <b className="text-slate-800">Two hours before:</b> WhatsApp with the share-location button.</li>
                <li><b className="text-slate-800">Another time asked:</b> new slot by email and WhatsApp. <b className="text-slate-800">Missed interview:</b> follow-up email and WhatsApp.</li>
                <li><b className="text-slate-800">30 minutes before candidates are due:</b> branch HR gets the arrival alert.</li>
              </ol>
            </section>
            {msg && <p role="status" className={`rounded-lg p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{msg.text}</p>}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
