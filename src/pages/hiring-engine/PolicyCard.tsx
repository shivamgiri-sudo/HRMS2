/**
 * Outreach policy the owner can change without a deploy (Master tab). Today: how long someone rejected in a process waits before
 * they can be lined up for it again. 0 switches the cooling-off off for a one-time wide outreach; permanent blocks stay.
 */
import { useCallback, useEffect, useState } from "react";
import { Hourglass } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

const CHOICES = [0, 30, 60, 90];

export default function PolicyCard() {
  const [days, setDays] = useState<number | null>(null);
  const [pick, setPick] = useState(90);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try { const r = await hrmsApi.get<{ coolingOffDays: number }>("/api/he/policy"); setDays(r.coolingOffDays); setPick(r.coolingOffDays); }
    catch { setMsg({ ok: false, text: "Could not load the policy" }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await hrmsApi.put<{ coolingOffDays: number }>("/api/he/policy", { coolingOffDays: pick });
      setDays(r.coolingOffDays);
      setMsg({ ok: true, text: r.coolingOffDays === 0 ? "Cooling-off is OFF. Click Find leads on a drive to line up people who were rejected recently." : `Cooling-off is ${r.coolingOffDays} days.` });
    } catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Only an admin can change this" }); }
    finally { setBusy(false); }
  };

  return (
    <section aria-label="Outreach policy" className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Hourglass className="h-4 w-4 text-blue-600" aria-hidden /> Cooling-off after a rejection</h2>
      <p className="mt-1 text-xs text-slate-600">How long someone rejected in a process waits before they can be lined up for it again. Turn it off for a one-time outreach to everyone, then set it back. Hard rejections, ex-employees, joined people and anyone who opted out are never lined up, whatever this is set to.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label htmlFor="cooling" className="text-sm text-slate-700">Cooling-off</label>
        <select id="cooling" value={pick} onChange={(e) => setPick(Number(e.target.value))} disabled={days == null || busy} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          {CHOICES.map((c) => <option key={c} value={c}>{c === 0 ? "Off (0 days)" : `${c} days`}</option>)}
        </select>
        <button type="button" disabled={busy || days == null || pick === days} onClick={() => void save()} className="cursor-pointer rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">{busy ? "Saving…" : "Save"}</button>
        {days != null && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${days === 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>Now: {days === 0 ? "OFF" : `${days} days`}</span>}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p>}
    </section>
  );
}
