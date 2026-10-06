/**
 * Drive shortlist (inside the Start outreach panel): each matched candidate with why they fit the requisition,
 * where they are in the outreach (email -> WhatsApp -> bot call -> reply / slot) and which other open requisitions
 * they also fit. Reads GET /api/he/drives/:id/shortlist. Clicking a name opens the full candidate record.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Mail, MessageCircle, PhoneCall, Reply } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { num } from "@/components/analytics/analytics-kit";
import Candidate360Drawer from "./Candidate360Drawer";

interface Touch { status: string; at: string | null }
interface Row {
  matchId: string; leadId: string; name: string | null; mobile: string; hasEmail: boolean; waConsent: boolean; source: string; effort: string | null; walkins: number;
  state: string; leadStatus: string; slotAt: string | null;
  fit: { score: number; rating?: string; confidence: number | null; reasons: string[]; unknown: string[]; priority: number | null };
  email: Touch | null; whatsapp: Touch | null; call: Touch | null; reply: Touch | null;
  alsoFits: Array<{ code: string; role: string; process: string | null; branch: string; score: number }>;
}
interface Resp { total: number; page: number; size: number; byState: Record<string, number>; data: Row[] }

const FILTERS = [["all", "All"], ["not_contacted", "Not contacted"], ["emailed", "Emailed"], ["whatsapp", "WhatsApp sent"], ["called", "Called"], ["replied", "Replied"], ["confirmed", "Confirmed"], ["declined", "Declined / no-show"]] as const;
const STATE: Record<string, string> = { confirmed: "bg-emerald-50 text-emerald-700 ring-emerald-200", arrived: "bg-emerald-50 text-emerald-700 ring-emerald-200", invited: "bg-blue-50 text-blue-700 ring-blue-200", suggested: "bg-slate-50 text-slate-600 ring-slate-200", declined: "bg-rose-50 text-rose-700 ring-rose-200", no_show: "bg-rose-50 text-rose-700 ring-rose-200" };
const words = (s: string) => s.replace(/_/g, " ");

function Cell({ icon: Icon, t, empty }: { icon: typeof Mail; t: Touch | null; empty: string }) {
  if (!t) return <span className="text-xs text-slate-400">{empty}</span>;
  const bad = /failed|blocked/.test(t.status);
  return <span className={`inline-flex items-center gap-1 text-xs ${bad ? "text-rose-700" : "text-slate-700"}`} title={t.at ?? ""}><Icon className="h-3.5 w-3.5" aria-hidden />{words(t.status)}<span className="text-slate-400">{t.at ? t.at.slice(5) : ""}</span></span>;
}

export default function DriveShortlist({ driveId }: { driveId: string }) {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState(""); const [qIn, setQIn] = useState("");
  const [res, setRes] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const p = new URLSearchParams({ filter, page: String(page), size: "50" }); if (q) p.set("q", q);
      const r = await hrmsApi.get<{ data: Resp }>(`/api/he/drives/${driveId}/shortlist?${p.toString()}`);
      setRes(r.data);
    } catch (e: unknown) { setErr((e as { message?: string })?.message || "Could not load the shortlist"); }
  }, [driveId, filter, page, q]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); setQ(qIn.trim()); }, 350); return () => clearTimeout(t); }, [qIn]);
  const pages = res ? Math.max(1, Math.ceil(res.total / res.size)) : 1;

  return (
    <div className="space-y-3" aria-label="Shortlist">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter" className="flex flex-wrap gap-1">
          {FILTERS.map(([k, l]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => { setFilter(k); setPage(1); }}
              className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${filter === k ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{l}</button>
          ))}
        </div>
        <label className="sr-only" htmlFor="sl-q">Search shortlist</label>
        <input id="sl-q" value={qIn} onChange={(e) => setQIn(e.target.value)} placeholder="Name or mobile" className="ml-auto w-40 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
      </div>
      {err && <p role="alert" className="text-sm text-rose-700">{err}</p>}
      {!res ? <div className="h-40 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" aria-hidden /> : res.data.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Nobody here yet.</p> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500"><tr>
              <th className="px-2 py-2">Candidate</th><th className="px-2 py-2">Fit for this role</th><th className="px-2 py-2">1. Email</th><th className="px-2 py-2">2. WhatsApp</th><th className="px-2 py-2">3. Bot call</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Also fits</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {res.data.map((r) => (
                <tr key={r.matchId} className="align-top transition-colors duration-150 hover:bg-slate-50">
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => setOpen(r.leadId)} className="cursor-pointer text-left font-medium text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">{r.name ?? "Unnamed"}</button>
                    <div className="font-mono text-[11px] text-slate-400">{r.mobile} · {words(r.source)}</div>
                    <div className="text-[11px] text-slate-500">{r.hasEmail ? "email" : "no email"} · {r.waConsent ? "WA opt-in" : "no WA opt-in"}{r.walkins ? ` · walked in ${r.walkins}x` : ""}</div>
                  </td>
                  <td className="max-w-[240px] px-2 py-2">
                    <div className="flex items-center gap-2"><span className="font-semibold tabular-nums">{r.fit.score}</span>{r.fit.rating && <span className="text-[11px] text-slate-500">{r.fit.rating}</span>}
                      {r.fit.confidence != null && <span className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100" title={`${Math.round(r.fit.confidence * 100)}% of the requirements known`}><span className="block h-full rounded-full bg-blue-500" style={{ width: `${Math.round(r.fit.confidence * 100)}%` }} /></span>}
                    </div>
                    <button type="button" onClick={() => setExpanded(expanded === r.matchId ? null : r.matchId)} className="cursor-pointer text-left text-[11px] text-slate-600 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                      {(expanded === r.matchId ? r.fit.reasons : r.fit.reasons.slice(0, 2)).join(" · ") || "meets the requirements on file"}
                      {expanded === r.matchId && r.fit.unknown.length > 0 && <span className="block text-slate-400">not known yet: {r.fit.unknown.map(words).join(", ")}</span>}
                    </button>
                  </td>
                  <td className="px-2 py-2"><Cell icon={Mail} t={r.email} empty={r.hasEmail ? "not sent" : "no email"} /></td>
                  <td className="px-2 py-2"><Cell icon={MessageCircle} t={r.whatsapp} empty={r.waConsent ? "waiting" : "no opt-in"} /></td>
                  <td className="px-2 py-2"><Cell icon={PhoneCall} t={r.call} empty="not called" />{r.reply && <div className="mt-1"><Cell icon={Reply} t={r.reply} empty="" /></div>}</td>
                  <td className="px-2 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset ${STATE[r.state] ?? STATE.suggested}`}>{words(r.state)}</span>{r.slotAt && <div className="mt-1 text-[11px] text-slate-500">slot {r.slotAt.slice(11)}</div>}</td>
                  <td className="max-w-[200px] px-2 py-2 text-[11px] text-slate-600">{r.alsoFits.length ? r.alsoFits.map((a) => <div key={a.code}>{a.code} · {a.process ?? a.role} <span className="text-slate-400">({a.score})</span></div>) : <span className="text-slate-400">no other open role</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res && <div className="flex items-center justify-between text-sm text-slate-600"><span>{num(res.total)} candidates · page {res.page} of {pages}</span>
        <div className="flex gap-1">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="cursor-pointer rounded-md border border-slate-200 p-1 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
          <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="cursor-pointer rounded-md border border-slate-200 p-1 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronRight className="h-4 w-4" aria-hidden /></button>
        </div></div>}
      <Candidate360Drawer leadId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
