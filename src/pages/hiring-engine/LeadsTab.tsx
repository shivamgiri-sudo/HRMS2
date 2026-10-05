/**
 * Hiring Engine - Leads tab (unified lead pool).
 *
 * Reads GET /api/he/summary (counts by status / next action / source), GET /api/he/leads (paged) and
 * GET /api/he/leads/:id (timeline, messages, calls, extracted signals, consent). Every figure is a stored
 * value or a count of stored rows; the "next action" text is the reason string the engine itself wrote.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MessageCircle, Phone, RefreshCcw, Search, UserCheck, UserX, Users, X, Headphones } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState, StatTile, num } from "@/components/analytics/analytics-kit";
import Candidate360Drawer from "./Candidate360Drawer";

type Count = { n: number };
interface Summary {
  byStatus: Array<Count & { status: string }>;
  byAction: Array<Count & { next_action: string | null }>;
  bySource: Array<Count & { primary_source: string }>;
  humanFollowupOpen: number;
}
interface LeadRow {
  id: string; mobile10: string; full_name: string | null; status: string; primary_source: string;
  engagement_score: number | null; reliability_score: number | null; best_channel: string | null;
  best_hour_ist: number | null; next_action: string | null; next_action_reason: string | null; created_at: string;
}
interface Detail {
  lead: LeadRow & { email: string | null; pincode: string | null; locality: string | null };
  insight: { engagement_score: number; reliability_score: number | null; next_action: string; next_action_reason: string; objections_json: string | string[] | null } | null;
  events: Array<{ event_type: string; channel: string | null; detail: string | null; created_at: string }>;
  messages: Array<{ direction: string; channel: string; body: string | null; delivery_status: string | null; intent: string | null; created_at: string }>;
  calls: Array<{ attempt_no: number; started_at: string | null; duration_s: number | null; outcome: string | null; email_received: string | null; assessment_done: string | null; decline_reason: string | null; summary: string | null }>;
  signals: Array<{ signal_key: string; signal_value: string; confidence: number; source: string; observed_at: string }>;
  consent: Array<{ consent_type: string; source: string; granted_at: string; revoked_at: string | null }>;
}

const STATUS_STYLE: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700 ring-emerald-200", rescheduled: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  arrived: "bg-emerald-50 text-emerald-700 ring-emerald-200", joined: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  declined: "bg-rose-50 text-rose-700 ring-rose-200", no_show: "bg-rose-50 text-rose-700 ring-rose-200", opted_out: "bg-rose-50 text-rose-700 ring-rose-200",
  invited: "bg-blue-50 text-blue-700 ring-blue-200", interested: "bg-blue-50 text-blue-700 ring-blue-200",
};
const label = (s: string | null) => (s ? s.replace(/_/g, " ") : "—");
const PAGE = 25;

function Pill({ value }: { value: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset ${STATUS_STYLE[value] ?? "bg-slate-50 text-slate-600 ring-slate-200"}`}>
      {label(value)}
    </span>
  );
}

function Meter({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-400">—</span>;
  const tone = value >= 60 ? "bg-emerald-500" : value >= 30 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2" title={`${value}/100`}>
      <div className="h-1.5 w-16 rounded-full bg-slate-100"><div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${value}%` }} /></div>
      <span className="text-xs tabular-nums text-slate-600">{value}</span>
    </div>
  );
}

export default function LeadsTab() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [action, setAction] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [fullRecord, setFullRecord] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    // First page without filters: show the last result instantly, then refresh it (stale-while-revalidate).
    const plain = page === 1 && !status && !action && !search;
    if (plain) {
      try { const c = JSON.parse(sessionStorage.getItem("he-leads-p1") ?? "null") as { s: Summary; l: LeadRow[]; t: number } | null; if (c) { setSummary(c.s); setRows(c.l); setTotal(c.t); setLoading(false); } else setLoading(true); }
      catch { setLoading(true); }
    } else setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), size: String(PAGE) });
      if (status) p.set("status", status);
      if (action) p.set("action", action);
      if (search) p.set("q", search);
      const [s, l] = await Promise.all([
        hrmsApi.get<{ data: Summary }>("/api/he/summary"),
        hrmsApi.get<{ data: LeadRow[]; total: number }>(`/api/he/leads?${p.toString()}`),
      ]);
      setSummary(s.data); setRows(l.data ?? []); setTotal(Number(l.total ?? 0));
      if (plain) { try { sessionStorage.setItem("he-leads-p1", JSON.stringify({ s: s.data, l: l.data ?? [], t: Number(l.total ?? 0) })); } catch { /* storage unavailable */ } }
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || "Unable to load the lead pool");
    } finally { setLoading(false); }
  }, [page, status, action, search]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setTimeout(() => { setPage(1); setSearch(searchInput.trim()); }, 350); return () => clearTimeout(t); }, [searchInput]);

  const openLead = async (id: string) => {
    setDetail(null); setDetailLoading(true);
    try { const r = await hrmsApi.get<{ data: Detail }>(`/api/he/leads/${id}`); setDetail(r.data); }
    catch { setDetail(null); } finally { setDetailLoading(false); }
  };

  const count = (st: string[]) => (summary?.byStatus ?? []).filter((x) => st.includes(x.status)).reduce((a, b) => a + Number(b.n), 0);
  const totalLeads = useMemo(() => (summary?.byStatus ?? []).reduce((a, b) => a + Number(b.n), 0), [summary]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const objections = detail?.insight?.objections_json
    ? (Array.isArray(detail.insight.objections_json) ? detail.insight.objections_json : (() => { try { return JSON.parse(detail.insight!.objections_json as string) as string[]; } catch { return []; } })())
    : [];

  return (
    <>
      <div className="space-y-5">
        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Pool summary">
          <StatTile label="Lead pool" value={num(totalLeads)} denominator="unique mobiles" icon={<Users className="h-4 w-4" />} />
          <StatTile label="Confirmed" value={num(count(["confirmed", "rescheduled"]))} denominator="walk-in slot accepted" intent="good" icon={<UserCheck className="h-4 w-4" />} />
          <StatTile label="Declined / no-show" value={num(count(["declined", "no_show"]))} denominator="needs re-match or recovery" intent="warning" icon={<UserX className="h-4 w-4" />} />
          <StatTile label="Needs a human" value={num(summary?.humanFollowupOpen ?? 0)} denominator="second decline or voice handoff" intent={(summary?.humanFollowupOpen ?? 0) > 0 ? "critical" : "neutral"} icon={<Headphones className="h-4 w-4" />} />
        </section>

        <section className="flex flex-wrap items-center gap-2" aria-label="Filters">
          <button type="button" onClick={() => void load()} aria-label="Refresh leads"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden /> Refresh
          </button>
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search name or mobile" aria-label="Search leads"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
          </div>
          <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} aria-label="Filter by status"
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <option value="">All statuses</option>
            {(summary?.byStatus ?? []).map((s) => <option key={s.status} value={s.status}>{label(s.status)} ({num(Number(s.n))})</option>)}
          </select>
          <select value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }} aria-label="Filter by next action"
            className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <option value="">Any next action</option>
            {(summary?.byAction ?? []).filter((a) => a.next_action).map((a) => <option key={a.next_action!} value={a.next_action!}>{label(a.next_action)} ({num(Number(a.n))})</option>)}
          </select>
        </section>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr><th className="px-4 py-3">Candidate</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Engagement</th><th className="px-4 py-3">Best channel</th><th className="px-4 py-3">Next action</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} tabIndex={0} onClick={() => void openLead(r.id)} onKeyDown={(e) => { if (e.key === "Enter") void openLead(r.id); }}
                  className="cursor-pointer transition-colors hover:bg-blue-50/50 focus:outline-none focus-visible:bg-blue-50">
                  <td className="px-4 py-3"><div className="font-semibold text-slate-900">{r.full_name || "Unknown"}</div><div className="text-xs text-slate-500">{r.mobile10} · {label(r.primary_source)}</div></td>
                  <td className="px-4 py-3"><Pill value={r.status} /></td>
                  <td className="px-4 py-3"><Meter value={r.engagement_score} /></td>
                  <td className="px-4 py-3 text-slate-700 capitalize">{r.best_channel ?? "—"}{r.best_hour_ist != null ? <span className="text-xs text-slate-400"> · ~{r.best_hour_ist}:00</span> : null}</td>
                  <td className="px-4 py-3"><div className="font-medium capitalize text-slate-800">{label(r.next_action)}</div><div className="max-w-xs truncate text-xs text-slate-500" title={r.next_action_reason ?? ""}>{r.next_action_reason ?? ""}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && <EmptyState label="No leads match" hint="Run the backfill or clear the filters." />}
          {loading && rows.length === 0 && <div className="p-8 text-center text-sm text-slate-500">Loading…</div>}
        </div>

        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>{num(total)} leads · page {page} of {pages}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page" className="cursor-pointer rounded-lg border border-slate-200 bg-white p-2 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page" className="cursor-pointer rounded-lg border border-slate-200 bg-white p-2 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <Sheet open={detailLoading || detail != null} onOpenChange={(o) => { if (!o) { setDetail(null); setDetailLoading(false); } }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader><SheetTitle>{detail?.lead.full_name || "Candidate"}</SheetTitle></SheetHeader>
          {detail && <button type="button" onClick={() => setFullRecord(detail.lead.id)} className="mt-2 cursor-pointer rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Open full record</button>}
          {detailLoading && <p className="p-4 text-sm text-slate-500">Loading…</p>}
          {detail && (
            <div className="space-y-5 p-1 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Pill value={detail.lead.status} /><span className="text-slate-500">{detail.lead.mobile10}{detail.lead.email ? ` · ${detail.lead.email}` : ""}</span></div>
              {detail.insight && (
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700">Next best action</div>
                  <div className="mt-1 font-semibold capitalize text-slate-900">{label(detail.insight.next_action)}</div>
                  <div className="text-slate-600">{detail.insight.next_action_reason}</div>
                  {objections.length > 0 && <div className="mt-2 text-xs text-slate-600">Objections heard: {objections.map(label).join(", ")}</div>}
                </div>
              )}
              <section><h3 className="mb-2 font-semibold text-slate-900">Consent</h3>
                {detail.consent.length === 0 ? <p className="text-slate-500">No consent recorded — outreach is blocked.</p> :
                  <ul className="space-y-1">{detail.consent.map((c, i) => <li key={i} className="text-slate-700">{label(c.consent_type)} · {c.source} · {c.revoked_at ? <span className="text-rose-600">revoked</span> : <span className="text-emerald-600">active</span>}</li>)}</ul>}
              </section>
              <section><h3 className="mb-2 flex items-center gap-1.5 font-semibold text-slate-900"><Phone className="h-4 w-4" aria-hidden /> Voice calls</h3>
                {detail.calls.length === 0 ? <p className="text-slate-500">No calls yet.</p> : detail.calls.map((c, i) => (
                  <div key={i} className="mb-2 rounded-lg border border-slate-200 p-2.5">
                    <div className="font-medium text-slate-800">Attempt {c.attempt_no} · {label(c.outcome)}{c.duration_s != null ? ` · ${c.duration_s}s` : ""}</div>
                    <div className="text-xs text-slate-500">Email received: {label(c.email_received)} · Assessment: {label(c.assessment_done)}{c.decline_reason ? ` · Reason: ${label(c.decline_reason)}` : ""}</div>
                    {c.summary && <div className="mt-1 text-slate-600">{c.summary}</div>}
                  </div>))}
              </section>
              <section><h3 className="mb-2 flex items-center gap-1.5 font-semibold text-slate-900"><MessageCircle className="h-4 w-4" aria-hidden /> Messages</h3>
                {detail.messages.length === 0 ? <p className="text-slate-500">No messages yet.</p> : detail.messages.map((m, i) => (
                  <div key={i} className={`mb-1.5 max-w-[90%] rounded-lg px-3 py-2 ${m.direction === "in" ? "bg-slate-100" : "ml-auto bg-blue-50"}`}>
                    <div className="text-slate-800">{m.body}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{m.channel}{m.intent ? ` · read as ${label(m.intent)}` : ""}{m.delivery_status ? ` · ${m.delivery_status}` : ""} · {m.created_at}</div>
                  </div>))}
              </section>
              <section><h3 className="mb-2 font-semibold text-slate-900">What we learned</h3>
                {detail.signals.length === 0 ? <p className="text-slate-500">No signals yet.</p> :
                  <div className="flex flex-wrap gap-1.5">{detail.signals.slice(0, 40).map((s, i) => <span key={i} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700" title={`${s.source} · ${s.confidence}% · ${s.observed_at}`}>{label(s.signal_key)}: <b>{s.signal_value}</b></span>)}</div>}
              </section>
              <section><h3 className="mb-2 font-semibold text-slate-900">Timeline</h3>
                <ol className="space-y-1.5 border-l border-slate-200 pl-3">{detail.events.map((e, i) => <li key={i} className="text-slate-700"><span className="font-medium capitalize">{label(e.event_type)}</span>{e.channel ? ` · ${e.channel}` : ""}{e.detail ? <span className="text-slate-500"> — {e.detail}</span> : null}<div className="text-[11px] text-slate-400">{e.created_at}</div></li>)}</ol>
              </section>
            </div>
          )}
          <button type="button" onClick={() => { setDetail(null); setDetailLoading(false); }} aria-label="Close" className="sr-only"><X /></button>
        </SheetContent>
      </Sheet>
      <Candidate360Drawer leadId={fullRecord} onClose={() => setFullRecord(null)} />
    </>
  );
}
