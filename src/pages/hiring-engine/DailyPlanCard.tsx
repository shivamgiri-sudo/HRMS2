/**
 * Daily plan (Master tab): the numbers the engine works to each day, and which requisitions run on them.
 * Walk-ins wanted + show-up rate decide how many people are messaged (never fewer than the minimum), and the slot hours decide the seats.
 * Every evening the engine makes the next working day's drive for each ticked requisition; "Plan tomorrow now" does it on demand.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

interface Plan { walkInsPerDay: number; minOutreachPerDay: number; showRatePct: number; slotStart: string; slotEnd: string; slotMinutes: number }
interface PlanResp { plan: Plan; numbers: { invites: number; targetShows: number; slots: number; perSlot: number; capacity: number }; requisitionIds: string[]; nextDay: string; metaOnly?: boolean }
interface Req { id: string; requisition_code: string; designation_name: string; branch_name: string; open_positions: number }
interface Day { code: string; role: string; branch: string; date: string; status: "created" | "exists" | "skipped"; reason?: string; invitesWanted: number; lined: number }

const toMin = (v: string) => { const [h, m] = v.split(":").map(Number); return h * 60 + (m || 0); };
const input = "w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

export default function DailyPlanCard() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [ids, setIds] = useState<string[]>([]);
  const [metaOnly, setMetaOnly] = useState(false);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [nextDay, setNextDay] = useState("");
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [days, setDays] = useState<Day[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([hrmsApi.get<PlanResp>("/api/he/plan"), hrmsApi.get<{ data: Req[] }>("/api/he/requisitions/open")]);
      setPlan(p.plan); setSaved(JSON.stringify({ p: p.plan, i: [...p.requisitionIds].sort(), m: p.metaOnly === true })); setMetaOnly(p.metaOnly === true); setIds(p.requisitionIds); setNextDay(p.nextDay); setReqs(r.data ?? []);
    } catch { setMsg({ ok: false, text: "Could not load the daily plan" }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const calc = useMemo(() => {
    if (!plan) return null;
    const show = Math.max(5, Math.min(100, plan.showRatePct)) / 100;
    const invites = Math.max(Math.ceil(Math.max(1, plan.walkInsPerDay) / show), Math.max(0, plan.minOutreachPerDay));
    const span = toMin(plan.slotEnd) - toMin(plan.slotStart);
    const slots = span > 0 ? Math.max(1, Math.floor(span / plan.slotMinutes)) : 0;
    const perSlot = slots ? Math.min(50, Math.ceil(invites / slots)) : 0;
    return { invites, slots, perSlot, covered: slots * perSlot >= invites };
  }, [plan]);
  const dirty = plan != null && saved !== JSON.stringify({ p: plan, i: [...ids].sort(), m: metaOnly });
  const set = (k: keyof Plan, v: string | number) => setPlan((p) => (p ? { ...p, [k]: v } : p));

  const save = async () => {
    if (!plan) return; setBusy("save"); setMsg(null);
    try { const r = await hrmsApi.put<PlanResp>("/api/he/plan", { plan, requisitionIds: ids, metaOnly }); setPlan(r.plan); setIds(r.requisitionIds); setMetaOnly(r.metaOnly === true); setSaved(JSON.stringify({ p: r.plan, i: [...r.requisitionIds].sort(), m: r.metaOnly === true })); setMsg({ ok: true, text: "Saved. The engine works to these numbers from now on." }); }
    catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Only an admin can change the plan" }); }
    finally { setBusy(null); }
  };
  const run = async () => {
    setBusy("run"); setMsg(null); setDays(null);
    try { const r = await hrmsApi.post<{ date: string; days: Day[] }>("/api/he/plan/run", {}, 600000); setDays(r.days); setMsg({ ok: true, text: r.days.length ? `Planned ${r.date}.` : "No requisition is on the plan yet. Tick at least one above and save." }); }
    catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Could not plan the day" }); }
    finally { setBusy(null); }
  };

  return (
    <section aria-label="Daily plan" className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarClock className="h-4 w-4 text-blue-600" aria-hidden /> Daily plan</h2>
      <p className="mt-1 text-xs text-slate-600">The numbers the engine works to every day. Each evening it makes the next working day&apos;s drive for the requisitions ticked below, lines people up, and sends the invites the next morning.</p>
      {plan && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <label className="text-xs text-slate-600">Walk-ins wanted a day<input aria-label="Walk-ins wanted a day" type="number" min={1} max={1000} className={`${input} mt-1`} value={plan.walkInsPerDay} onChange={(e) => set("walkInsPerDay", Number(e.target.value))} /></label>
            <label className="text-xs text-slate-600">People messaged a day, at least<input aria-label="People messaged a day, at least" type="number" min={0} max={5000} className={`${input} mt-1`} value={plan.minOutreachPerDay} onChange={(e) => set("minOutreachPerDay", Number(e.target.value))} /></label>
            <label className="text-xs text-slate-600">Show-up rate %<input aria-label="Show-up rate percent" type="number" min={5} max={100} className={`${input} mt-1`} value={plan.showRatePct} onChange={(e) => set("showRatePct", Number(e.target.value))} /></label>
            <label className="text-xs text-slate-600">First slot<input aria-label="First slot" type="time" className={`${input} mt-1`} value={plan.slotStart} onChange={(e) => set("slotStart", e.target.value)} /></label>
            <label className="text-xs text-slate-600">Last slot ends<input aria-label="Last slot ends" type="time" className={`${input} mt-1`} value={plan.slotEnd} onChange={(e) => set("slotEnd", e.target.value)} /></label>
            <label className="text-xs text-slate-600">Slot length<select aria-label="Slot length" className={`${input} mt-1`} value={plan.slotMinutes} onChange={(e) => set("slotMinutes", Number(e.target.value))}>{[15, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
          </div>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" checked={metaOnly} onChange={(e) => setMetaOnly(e.target.checked)} className="mt-1" />
            <span><b>Meta campaign leads only.</b> <span className="text-xs text-slate-600">Line up only people who filled a Meta lead form, instead of the whole pool. Their separate funnel is above.</span></span>
          </label>
          {calc && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900" role="status">Each day: message <b>{calc.invites}</b> qualified people (email, then WhatsApp) to get about <b>{plan.walkInsPerDay}</b> walk-ins, spread over <b>{calc.slots}</b> slots with <b>{calc.perSlot}</b> invitees per slot{calc.covered ? "" : ", which is not enough seats: widen the hours or shorten the slots"}.</p>}
          <fieldset className="mt-4">
            <legend className="text-xs font-semibold text-slate-700">Requisitions on the plan{nextDay ? ` (next drive: ${nextDay})` : ""}</legend>
            <div className="mt-2 grid max-h-52 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
              {reqs.length === 0 && <p className="text-xs text-slate-500">No open requisitions.</p>}
              {reqs.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" className="mt-1 h-4 w-4 cursor-pointer" checked={ids.includes(r.id)} onChange={(e) => setIds((cur) => (e.target.checked ? [...cur, r.id] : cur.filter((x) => x !== r.id)))} aria-label={`Plan ${r.requisition_code}`} />
                  <span className="min-w-0"><span className="font-medium text-slate-900">{r.requisition_code}</span> <span className="text-slate-600">{r.designation_name} · {r.branch_name} · {r.open_positions} open</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!dirty || busy != null} onClick={() => void save()} className="cursor-pointer rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors duration-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">{busy === "save" ? "Saving…" : "Save the plan"}</button>
            <button type="button" disabled={dirty || busy != null} onClick={() => void run()} title={dirty ? "Save first" : undefined} className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{busy === "run" ? "Planning…" : "Plan tomorrow now"}</button>
            {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
          </div>
        </>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p>}
      {days && days.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm" aria-label="Planned drives">
          {days.map((d) => (
            <li key={d.code} className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium text-slate-900">{d.code}</span>
              <span className="text-slate-600">{d.status === "created" ? `drive created, ${d.lined} qualified people lined up for ${d.invitesWanted} wanted${d.lined < d.invitesWanted ? " (not enough qualified people in the pool yet)" : ""}` : d.status === "exists" ? "already has a drive for that day" : `skipped: ${d.reason}`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
