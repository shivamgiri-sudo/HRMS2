/**
 * Launch a campaign (Master tab): take the people of one or more Meta campaigns (a re-run of old leads, or a live one) or of one or more upload
 * batches, pick an OPEN requisition and a date, and the engine runs the normal journey for them (email, WhatsApp, bot call, reminders, arrival,
 * no-show). Every launch is listed below with its own funnel, so an original push and a re-run never mix.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Rocket } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";

interface Cfg { campaignId: string; campaignName: string; status: string; requisitionCode: string | null; branchName: string | null; qualified: number }
interface Batch { id: string; label: string; fileName: string | null; source: string; consentAttested: boolean; rows: number; created: number; enriched: number; rejected: number; blocked: Record<string, number>; createdAt: string; byStatus: Record<string, number> }
interface Req { id: string; requisition_code: string; designation_name: string; branch_name: string; open_positions: number }
interface Preview { requisition: { code: string; role: string; branch: string; open: number }; audience: { people: number; qualified?: number; inWindow?: number; alreadyInPool: number; optedOut: number; joinedOrEmployee: number; liveBooking: number } }
interface Launch { driveId: string; label: string; kind: string; date: string; status: string; requisition: string; role: string; branch: string; reinvite: boolean; audienceNames: string[]; lined: number; invited: number; confirmed: number; arrived: number; noShow: number; declined: number; emailed: number; whatsapped: number; called: number; replied: number }

const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";
const nextWorkday = () => { const d = new Date(Date.now() + 5.5 * 3600_000 + 86_400_000); if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

export default function LaunchCard() {
  const [kind, setKind] = useState<"campaign" | "batch">("campaign");
  const [camps, setCamps] = useState<Cfg[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [launches, setLaunches] = useState<Launch[] | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [requisitionId, setRequisitionId] = useState("");
  const [date, setDate] = useState(nextWorkday());
  const [label, setLabel] = useState("");
  const [age, setAge] = useState("");
  const [reinvite, setReinvite] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"preview" | "launch" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, b, r, l] = await Promise.all([
        hrmsApi.get<{ data: Cfg[] }>("/api/he/campaign-config"), hrmsApi.get<{ data: Batch[] }>("/api/he/import-batches"),
        hrmsApi.get<{ data: Req[] }>("/api/he/requisitions/open"), hrmsApi.get<{ data: Launch[] }>("/api/he/launches"),
      ]);
      setCamps(c.data); setBatches(b.data); setReqs(r.data ?? []); setLaunches(l.data);
    } catch { setMsg({ ok: false, text: "Could not load campaigns and launches" }); setLaunches([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setIds([]); setPreview(null); }, [kind]);

  const body = useMemo(() => ({ kind, ids, requisitionId, date, label: label.trim() || undefined, maxLeadAgeDays: age.trim() ? Number(age) : null, reinvite }), [kind, ids, requisitionId, date, label, age, reinvite]);
  const ready = ids.length > 0 && requisitionId !== "" && date !== "";
  const toggle = (id: string) => { setPreview(null); setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id])); };
  const errText = (e: unknown, d: string) => (e as { message?: string })?.message || d;

  const doPreview = async () => {
    setBusy("preview"); setMsg(null);
    try { setPreview((await hrmsApi.post<{ data: Preview }>("/api/he/launch/preview", body, 60000)).data); } catch (e) { setPreview(null); setMsg({ ok: false, text: errText(e, "Could not preview") }); }
    finally { setBusy(null); }
  };
  const doLaunch = async () => {
    setBusy("launch"); setMsg(null);
    try {
      const r = await hrmsApi.post<{ data: { driveId: string; shortlist: { suggested: number; considered: number; blockedByReason: Record<string, number> } } }>("/api/he/launch", body, 300000);
      const s = r.data.shortlist;
      const blocked = Object.entries(s.blockedByReason).filter(([, v]) => v > 0).map(([k, v]) => `${num(v)} ${k.replace(/_/g, " ")}`).join(", ");
      setMsg({ ok: true, text: `Launched: ${num(s.suggested)} people lined up from ${num(s.considered)} considered${blocked ? ` (left out: ${blocked})` : ""}. Invites go out automatically when automatic follow-ups are on, or use "Send invites now" on the drive.` });
      setPreview(null); await load();
    } catch (e) { setMsg({ ok: false, text: errText(e, "Could not start the launch") }); }
    finally { setBusy(null); }
  };

  const list = kind === "campaign" ? camps.map((c) => ({ id: c.campaignId, name: c.campaignName, sub: `${c.status}${c.requisitionCode ? ` · ${c.requisitionCode}` : ""} · ${num(c.qualified)} qualified` }))
    : batches.map((b) => ({ id: b.id, name: b.label, sub: `${b.source} · ${num(b.created + b.enriched)} people · ${b.createdAt.slice(0, 10)}` }));
  return (
    <section aria-label="Launch a campaign" className="rounded-xl border border-violet-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Rocket className="h-4 w-4 text-violet-600" aria-hidden /> Launch a campaign: re-run old Meta leads or an upload</h2>
      <p className="mt-1 text-xs text-slate-600">Pick who to reach, an open requisition and a date. The engine then emails, WhatsApps and calls them, reminds them, and follows up on no-shows. A closed or filled requisition is refused: pick an open one of the same branch.</p>

      <div className="mt-3 flex gap-2" role="group" aria-label="Audience type">
        {([["campaign", "Meta campaigns"], ["batch", "Upload batches"]] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${kind === k ? "border-violet-500 bg-violet-50 font-semibold text-violet-900" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>
      <fieldset className="mt-3">
        <legend className="text-xs font-semibold text-slate-700">{kind === "campaign" ? "Campaigns" : "Upload batches"} (pick one or more)</legend>
        <div className="mt-1 grid max-h-44 gap-1 overflow-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
          {list.map((x) => (
            <label key={x.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"><input type="checkbox" className="mt-1" checked={ids.includes(x.id)} onChange={() => toggle(x.id)} aria-label={x.name} /><span><span className="font-medium text-slate-900">{x.name}</span><span className="block text-xs text-slate-500">{x.sub}</span></span></label>
          ))}
          {list.length === 0 && <p className="p-2 text-sm text-slate-500">{kind === "batch" ? "No uploads yet: use \"Add candidates\" above." : "No campaigns."}</p>}
        </div>
      </fieldset>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-slate-600">Open requisition
          <select aria-label="Open requisition" className={field} value={requisitionId} onChange={(e) => { setRequisitionId(e.target.value); setPreview(null); }}>
            <option value="">Choose…</option>{reqs.map((r) => <option key={r.id} value={r.id}>{r.requisition_code} · {r.designation_name} · {r.branch_name} ({r.open_positions} open)</option>)}
          </select></label>
        <label className="text-xs text-slate-600">Walk-in date<input aria-label="Walk-in date" type="date" min={nextWorkday()} className={field} value={date} onChange={(e) => { setDate(e.target.value); setPreview(null); }} /></label>
        <label className="text-xs text-slate-600">Only form fills newer than (days, optional)<input aria-label="Form fill age in days" inputMode="numeric" className={field} value={age} onChange={(e) => { setAge(e.target.value.replace(/\D/g, "")); setPreview(null); }} placeholder="any age" disabled={kind === "batch"} /></label>
        <label className="text-xs text-slate-600">Name this launch<input aria-label="Launch name" className={field} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Ahmedabad re-run" /></label>
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-slate-800"><input type="checkbox" className="mt-1" checked={reinvite} onChange={(e) => setReinvite(e.target.checked)} /><span><b>Use the re-invite wording</b> <span className="text-xs text-slate-600">for people who never booked. It is sent once Meta approves it (template T12); until then the normal invite goes out.</span></span></label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!ready || busy != null} onClick={() => void doPreview()} className="cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{busy === "preview" ? "Checking…" : "Preview"}</button>
        <button type="button" disabled={!ready || !preview || busy != null} onClick={() => void doLaunch()} className="cursor-pointer rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">{busy === "launch" ? "Launching…" : "Launch"}</button>
        {!preview && ready && <span className="text-xs text-slate-500">Preview first, then launch.</span>}
      </div>
      {preview && (
        <p role="status" className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">
          For <b>{preview.requisition.code}</b> ({preview.requisition.role}, {preview.requisition.branch}, {num(preview.requisition.open)} open): <b>{num(preview.audience.people)}</b> people in the audience
          {preview.audience.qualified != null && <> · <b>{num(preview.audience.qualified)}</b> qualified{preview.audience.inWindow != null && age ? <>, <b>{num(preview.audience.inWindow)}</b> within {age} days</> : null}</>}
          {" · "}{num(preview.audience.alreadyInPool)} already in the pool · {num(preview.audience.optedOut)} opted out · {num(preview.audience.joinedOrEmployee)} joined or employees · {num(preview.audience.liveBooking)} already booked. Those are skipped; the rest are checked against the role's requirements and location when you launch.
        </p>
      )}
      {msg && <p role="status" className={`mt-2 text-sm ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p>}

      <h3 className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-500">Launches</h3>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2">Launch</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Lined up</th><th className="px-3 py-2">Emailed</th><th className="px-3 py-2">WhatsApp</th><th className="px-3 py-2">Called</th><th className="px-3 py-2">Replied</th><th className="px-3 py-2">Confirmed</th><th className="px-3 py-2">Arrived</th><th className="px-3 py-2">No-show</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {(launches ?? []).map((l) => (
              <tr key={l.driveId}>
                <td className="px-3 py-2"><div className="font-medium text-slate-900">{l.label || "Launch"}</div><div className="text-xs text-slate-500">{l.requisition} · {l.role} · {l.branch} · {l.status}{l.reinvite ? " · re-invite" : ""}</div><div className="max-w-[320px] truncate text-xs text-slate-400" title={l.audienceNames.join(", ")}>{l.audienceNames.join(", ")}</div></td>
                <td className="px-3 py-2 tabular-nums">{l.date}</td>
                {[l.lined, l.emailed, l.whatsapped, l.called, l.replied, l.confirmed, l.arrived, l.noShow].map((v, i) => <td key={i} className="px-3 py-2 tabular-nums">{num(v)}</td>)}
              </tr>
            ))}
            {launches && launches.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-500">No launches yet.</td></tr>}
            {!launches && <tr><td colSpan={10} className="px-3 py-6"><div className="h-6 animate-pulse rounded bg-slate-50 motion-reduce:animate-none" /></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
