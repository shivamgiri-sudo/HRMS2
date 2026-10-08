/**
 * Outreach policy the owner can change without a deploy (Master tab).
 *  - WhatsApp: message qualified candidates about their own application without an opt-in (the default), or only people who ticked WhatsApp.
 *  - Cooling-off: how long someone rejected in a process waits before they can be lined up for it again (0 = off).
 * A STOP from a candidate is always honoured, and live location always needs the candidate's own tap.
 */
import { useCallback, useEffect, useState } from "react";
import { Hourglass, MessageCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

const CHOICES = [0, 30, 60, 90];
interface Policy { coolingOffDays: number; whatsappRequiresOptIn: boolean }

export default function PolicyCard() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try { const r = await hrmsApi.get<Policy>("/api/he/policy"); setPolicy({ coolingOffDays: r.coolingOffDays, whatsappRequiresOptIn: r.whatsappRequiresOptIn }); setDays(r.coolingOffDays); }
    catch { setMsg({ ok: false, text: "Could not load the policy" }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (body: Partial<Policy>, okText: (p: Policy) => string) => {
    setBusy(true); setMsg(null);
    try {
      const r = await hrmsApi.put<Policy>("/api/he/policy", body);
      setPolicy({ coolingOffDays: r.coolingOffDays, whatsappRequiresOptIn: r.whatsappRequiresOptIn }); setDays(r.coolingOffDays);
      setMsg({ ok: true, text: okText(r) });
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Only an admin can change this" }); }
    finally { setBusy(false); }
  };
  const ready = policy != null && !busy;

  return (
    <section aria-label="Outreach policy" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><MessageCircle className="h-4 w-4 text-emerald-600" aria-hidden /> WhatsApp to qualified candidates</h2>
        <p className="mt-1 text-xs text-slate-600">Qualified candidates are messaged about their own application, with no WhatsApp opt-in needed. Anyone who sends STOP is never messaged again. Sharing live location always needs the candidate's own tap.</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label htmlFor="wa-optin" className="text-sm text-slate-700">Who can be messaged</label>
          <select id="wa-optin" disabled={!ready} value={policy?.whatsappRequiresOptIn ? "optin" : "all"}
            onChange={(e) => void save({ whatsappRequiresOptIn: e.target.value === "optin" }, (p) => p.whatsappRequiresOptIn ? "WhatsApp now goes only to people who opted in." : "WhatsApp now goes to qualified candidates without an opt-in. STOP is always honoured.")}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <option value="all">Qualified candidates, no opt-in needed</option>
            <option value="optin">Only people who opted in</option>
          </select>
        </div>
      </div>
      <div className="border-t border-slate-100 pt-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Hourglass className="h-4 w-4 text-blue-600" aria-hidden /> Cooling-off after a rejection</h2>
        <p className="mt-1 text-xs text-slate-600">How long someone rejected in a process waits before they can be lined up for it again. Turn it off for a one-time outreach to everyone, then set it back. Hard rejections, ex-employees, joined people and anyone who opted out are never lined up, whatever this is set to.</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label htmlFor="cooling" className="text-sm text-slate-700">Cooling-off</label>
          <select id="cooling" value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={!ready} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            {CHOICES.map((c) => <option key={c} value={c}>{c === 0 ? "Off (0 days)" : `${c} days`}</option>)}
          </select>
          <button type="button" disabled={!ready || days === policy?.coolingOffDays} onClick={() => void save({ coolingOffDays: days }, (p) => p.coolingOffDays === 0 ? "Cooling-off is OFF. Click Find leads on a drive to line up people who were rejected recently." : `Cooling-off is ${p.coolingOffDays} days.`)} className="cursor-pointer rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">{busy ? "Saving…" : "Save"}</button>
          {policy && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${policy.coolingOffDays === 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>Now: {policy.coolingOffDays === 0 ? "OFF" : `${policy.coolingOffDays} days`}</span>}
        </div>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p>}
    </section>
  );
}
