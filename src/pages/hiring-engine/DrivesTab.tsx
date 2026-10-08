/**
 * Drives: turn a requisition's open positions into a dated walk-in drive. Shows the plan the engine derives
 * (target shows, invites needed at the chosen show rate, seat capacity) and the live funnel per drive.
 * A drive only auto-sends once it is Active AND "auto-send" is on AND the scheduler is live (server flags).
 */
import { useCallback, useEffect, useState } from "react";
import { Plus, Pause, Play, Send, Sparkles, XCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, num } from "@/components/analytics/analytics-kit";
import DriveLaunchPanel from "./DriveLaunchPanel";

interface Drive {
  id: string; branch_name: string; drive_date: string; designation_name: string; requisition_code: string; open_positions: number;
  slot_capacity: number; target_shows: number; show_rate_pct: number; status: string; auto_send: number;
  suggested: number | null; invited: number | null; confirmed: number | null; arrived: number | null; no_show: number | null; declined: number | null;
}
interface Req { id: string; requisition_code: string; designation_name: string; branch_name: string; open_positions: number; priority: string }

const STATUS: Record<string, string> = { active: "bg-emerald-50 text-emerald-700 ring-emerald-200", paused: "bg-amber-50 text-amber-700 ring-amber-200", closed: "bg-slate-100 text-slate-500 ring-slate-200", draft: "bg-slate-50 text-slate-600 ring-slate-200" };
const n = (v: number | null) => num(Number(v ?? 0));
const field = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";

export default function DrivesTab() {
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [drives, setDrives] = useState<Drive[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ requisitionId: "", driveDate: "", slotStart: "10:00", slotEnd: "17:30", slotCapacity: 6, showRatePct: 40, targetShows: 0, autoSend: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try { const r = await hrmsApi.get<{ data: Drive[] }>("/api/he/drives"); setDrives(r.data ?? []); }
    catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "Unable to load drives" }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const openDialog = async () => {
    setOpen(true);
    try { const r = await hrmsApi.get<{ data: Req[] }>("/api/he/requisitions/open"); setReqs(r.data ?? []); } catch { setReqs([]); }
  };

  // `ok` may be a function of the result so a caller can show what the server computed (e.g. the drive plan).
  const act = async <T,>(key: string, fn: () => Promise<T>, ok: string | ((r: T) => string)) => {
    setBusy(key); setMsg(null);
    try { const r = await fn(); setMsg({ ok: true, text: typeof ok === "function" ? ok(r) : ok }); await load(); }
    catch (e: unknown) { setMsg({ ok: false, text: (e as { message?: string })?.message || "That did not work" }); }
    finally { setBusy(null); }
  };

  const create = () => act(
    "create",
    async () => {
      const r = await hrmsApi.post<{ data: { invites: number; targetShows: number; capacity: number } }>("/api/he/drives", form);
      setOpen(false);
      return r;
    },
    (r) => `Drive created: aim for ${r.data.targetShows} walk-ins, which means about ${r.data.invites} invites (capacity ${r.data.capacity}). Click "Find leads", then Activate.`,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">A drive turns open positions into a dated walk-in with seats, invites and reminders.</p>
        <button type="button" onClick={() => void openDialog()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
          <Plus className="h-4 w-4" aria-hidden /> New drive
        </button>
      </div>
      {msg && <div role={msg.ok ? "status" : "alert"} className={`rounded-lg border px-4 py-3 text-sm ${msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{msg.text}</div>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr><th className="px-4 py-3">Drive</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Funnel</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {drives.map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-3"><div className="font-semibold text-slate-900">{d.designation_name}</div><div className="text-xs text-slate-500">{d.branch_name} · {String(d.drive_date).slice(0, 10)} · {d.requisition_code}</div></td>
                <td className="px-4 py-3 text-slate-700"><div>{n(d.open_positions)} open · aim {n(d.target_shows)} shows</div><div className="text-xs text-slate-500">show rate {d.show_rate_pct}% · {n(d.slot_capacity)}/slot{d.auto_send ? " · auto-send" : ""}</div></td>
                <td className="px-4 py-3 tabular-nums text-slate-700"><div>{n(d.suggested)} suggested · {n(d.invited)} invited · <b>{n(d.confirmed)}</b> confirmed</div><div className="text-xs text-slate-500">{n(d.arrived)} arrived · {n(d.no_show)} no-show · {n(d.declined)} declined</div></td>
                <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset ${STATUS[d.status] ?? STATUS.draft}`}>{d.status}</span></td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    {d.status !== "closed" && <button type="button" onClick={() => setLaunchId(d.id)} className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors duration-200 hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Send className="h-3.5 w-3.5" aria-hidden /> Start outreach</button>}
                    <button type="button" disabled={busy !== null || d.status === "closed"} onClick={() => void act(`s${d.id}`, () => hrmsApi.post<{ data: { suggested: number; considered: number; blockedByReason: Record<string, number> } }>(`/api/he/drives/${d.id}/suggest`, {}), (r) => {
                      const x = r.data; const left = Object.entries(x.blockedByReason ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${num(v)} ${k.replace(/_/g, " ")}`).join(", ");
                      return `${num(x.suggested)} matched to this drive from ${num(x.considered)} checked${left ? `. Left out: ${left}` : ""}.`;
                    })} className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><Sparkles className="h-3.5 w-3.5" aria-hidden /> Find leads</button>
                    {d.status !== "active" && d.status !== "closed" && <button type="button" disabled={busy !== null} onClick={() => void act(`a${d.id}`, () => hrmsApi.post(`/api/he/drives/${d.id}/status`, { status: "active" }), "Drive is active")} className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-emerald-200 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"><Play className="h-3.5 w-3.5" aria-hidden /> Activate</button>}
                    {d.status === "active" && <button type="button" disabled={busy !== null} onClick={() => void act(`p${d.id}`, () => hrmsApi.post(`/api/he/drives/${d.id}/status`, { status: "paused" }), "Drive paused: no more sends")} className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-amber-200 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"><Pause className="h-3.5 w-3.5" aria-hidden /> Pause</button>}
                    {d.status !== "closed" && <button type="button" disabled={busy !== null} onClick={() => void act(`c${d.id}`, () => hrmsApi.post(`/api/he/drives/${d.id}/status`, { status: "closed" }), "Drive closed")} aria-label="Close drive" className="inline-flex cursor-pointer items-center rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><XCircle className="h-4 w-4" aria-hidden /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {drives.length === 0 && <EmptyState label="No drives yet" hint="Create one from an open requisition." />}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New walk-in drive</DialogTitle><DialogDescription>Invites needed = open positions, adjusted for how many interviews it takes to hire and how many invitees actually show up.</DialogDescription></DialogHeader>
          <div className="space-y-3 text-sm">
            <label className="block"><span className="mb-1 block font-medium text-slate-700">Requisition</span>
              <select className={field} value={form.requisitionId} onChange={(e) => setForm({ ...form, requisitionId: e.target.value })}>
                <option value="">Select an open requisition</option>
                {reqs.map((r) => <option key={r.id} value={r.id}>{r.designation_name} · {r.branch_name} · {r.open_positions} open ({r.requisition_code})</option>)}
              </select></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block font-medium text-slate-700">Date</span><input type="date" className={field} value={form.driveDate} onChange={(e) => setForm({ ...form, driveDate: e.target.value })} /></label>
              <label className="block"><span className="mb-1 block font-medium text-slate-700">Seats per 30-min slot</span><input type="number" min={1} max={50} className={field} value={form.slotCapacity} onChange={(e) => setForm({ ...form, slotCapacity: Number(e.target.value) })} /></label>
              <label className="block"><span className="mb-1 block font-medium text-slate-700">First slot</span><input type="time" className={field} value={form.slotStart} onChange={(e) => setForm({ ...form, slotStart: e.target.value })} /></label>
              <label className="block"><span className="mb-1 block font-medium text-slate-700">Last slot ends</span><input type="time" className={field} value={form.slotEnd} onChange={(e) => setForm({ ...form, slotEnd: e.target.value })} /></label>
              <label className="block"><span className="mb-1 block font-medium text-slate-700">Walk-ins wanted that day</span><input type="number" min={0} max={2000} placeholder="from open positions" className={field} value={form.targetShows || ""} onChange={(e) => setForm({ ...form, targetShows: Number(e.target.value) })} />
                <span className="mt-1 block text-xs text-slate-500">{form.targetShows > 0 ? `About ${Math.ceil(form.targetShows / (Math.max(5, form.showRatePct) / 100))} invites at a ${form.showRatePct}% show rate; the seats must cover them.` : "Leave empty to size it from the open positions."}</span></label>
              <label className="block"><span className="mb-1 block font-medium text-slate-700">Expected show rate %</span><input type="number" min={5} max={100} className={field} value={form.showRatePct} onChange={(e) => setForm({ ...form, showRatePct: Number(e.target.value) })} /></label>
              <label className="flex items-end gap-2 pb-2"><input type="checkbox" className="h-4 w-4 cursor-pointer" checked={form.autoSend} onChange={(e) => setForm({ ...form, autoSend: e.target.checked })} /><span className="font-medium text-slate-700">Auto-send invites</span></label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="cursor-pointer rounded-lg border border-slate-200 px-3.5 py-2 font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Cancel</button>
              <button type="button" disabled={!form.requisitionId || !form.driveDate || busy === "create"} onClick={() => void create()} className="cursor-pointer rounded-lg bg-blue-600 px-3.5 py-2 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">{busy === "create" ? "Creating…" : "Create drive"}</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <DriveLaunchPanel driveId={launchId} onClose={() => setLaunchId(null)} onChanged={() => void load()} />
    </div>
  );
}
