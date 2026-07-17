import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Clock3, Eye, Loader2, RefreshCcw, Search, ShieldCheck, UserRoundCheck, UserRoundPlus, UsersRound, X } from "lucide-react";
import { VisitorRegistrationDialog } from "@/components/visitor/VisitorRegistrationDialog";
import { VisitorEmpty, VisitorShell, VisitorStat, VisitorStatusBadge } from "@/components/visitor/VisitorShell";
import { visitorApi, visitorDateTime, type VisitorStatus, type VisitorVisit, type VisitorVisitDetail } from "@/features/visitor/visitorApi";

const portalUrl = (import.meta.env.VITE_VISITOR_PORTAL_URL as string | undefined)?.replace(/\/$/, "")
  ?? "https://visitor-management-portal.shivam-giri.chatgpt.site";

function DetailDrawer({ visitId, onClose }: { visitId: string; onClose: () => void }) {
  const [visit, setVisit] = useState<VisitorVisitDetail | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    visitorApi.visit(visitId).then(setVisit).catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load visit"));
  }, [visitId]);

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Visit details">
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white/95 p-5 backdrop-blur">
          <div><p className="text-xs font-black uppercase tracking-[0.15em] text-[#2784c4]">Visit record</p><h2 className="mt-1 text-xl font-black text-slate-950">{visit?.visit_number ?? "Loading…"}</h2></div>
          <button onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100" aria-label="Close visit details"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-5 p-5">
          {message && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{message}</div>}
          {!visit && !message && <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-[#2784c4]" /></div>}
          {visit && <>
            <div className="rounded-3xl bg-slate-950 p-5 text-white"><div className="flex items-start justify-between gap-3"><div><p className="text-2xl font-black">{visit.visitor_name}</p><p className="mt-1 text-sm text-slate-300">{visit.company_name || "Independent visitor"}</p></div><VisitorStatusBadge status={visit.status} /></div><div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs font-bold text-slate-400">Mobile</p><p className="mt-1 font-bold">{visit.mobile || visit.masked_mobile || "—"}</p></div><div><p className="text-xs font-bold text-slate-400">Email</p><p className="mt-1 truncate font-bold">{visit.email || "—"}</p></div></div></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Branch", visit.branch_name], ["Host", visit.host_display_name || "Unassigned"], ["Visit type", visit.visit_type.replace(/_/g, " ")], ["Source", (visit.source_channel || "—").replace(/_/g, " ")],
                ["Scheduled start", visitorDateTime(visit.scheduled_start)], ["Scheduled end", visitorDateTime(visit.scheduled_end)], ["Checked in", visitorDateTime(visit.checked_in_at)], ["Checked out", visitorDateTime(visit.checked_out_at)],
              ].map(([label, value]) => <div key={label} className="rounded-2xl border border-slate-200 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1.5 text-sm font-bold capitalize text-slate-900">{value}</p></div>)}
            </div>
            <div className="rounded-2xl border border-slate-200 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-400">Purpose</p><p className="mt-2 text-sm leading-6 text-slate-700">{visit.purpose}</p></div>
            {(visit.vehicles?.length ?? 0) > 0 && <div><h3 className="text-sm font-black text-slate-950">Vehicle</h3><div className="mt-2 space-y-2">{visit.vehicles?.map((vehicle) => <div key={vehicle.id} className="rounded-2xl border border-slate-200 p-4 text-sm"><span className="font-black">{vehicle.vehicle_number}</span><span className="ml-2 text-slate-500">{vehicle.vehicle_type || "Vehicle"}</span></div>)}</div></div>}
            {(visit.belongings?.length ?? 0) > 0 && <div><h3 className="text-sm font-black text-slate-950">Carried belongings</h3><div className="mt-2 space-y-2">{visit.belongings?.map((item) => <div key={item.id} className="rounded-2xl border border-slate-200 p-4 text-sm"><p className="font-black">{item.item_type}</p><p className="mt-1 text-slate-500">{[item.description, item.serial_number].filter(Boolean).join(" · ") || "No additional details"}</p></div>)}</div></div>}
            {(visit.companions?.length ?? 0) > 0 && <div><h3 className="text-sm font-black text-slate-950">Companions</h3><div className="mt-2 space-y-2">{visit.companions?.map((person) => <div key={person.id} className="rounded-2xl border border-slate-200 p-4 text-sm"><span className="font-black">{person.full_name}</span><span className="ml-2 text-slate-500">{person.relationship_label || "Companion"}</span></div>)}</div></div>}
          </>}
        </div>
      </div>
    </div>
  );
}

export default function VisitorManagement() {
  const [visits, setVisits] = useState<VisitorVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | VisitorStatus>("all");
  const [showInvitation, setShowInvitation] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [created, setCreated] = useState<{ visit_number: string; tracking_token: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try { setVisits(await visitorApi.visits()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load visitor records"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const summary = useMemo(() => ({
    today: visits.filter((visit) => visit.scheduled_start.slice(0, 10) === today).length,
    pending: visits.filter((visit) => visit.status === "pending_approval").length,
    inside: visits.filter((visit) => visit.status === "checked_in").length,
    approved: visits.filter((visit) => visit.status === "approved").length,
  }), [today, visits]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return visits.filter((visit) => {
      if (status !== "all" && visit.status !== status) return false;
      if (!needle) return true;
      return [visit.visitor_name, visit.company_name, visit.visit_number, visit.host_display_name, visit.branch_name]
        .some((value) => String(value ?? "").toLowerCase().includes(needle));
    });
  }, [search, status, visits]);

  const trackingLink = created ? `${portalUrl}/?tracking_token=${created.tracking_token}` : "";

  return (
    <VisitorShell
      eyebrow="Visitor management"
      title="Visitor command center"
      description="A single operational view of invited, expected, approved, and on-site visitors. Access is automatically scoped to your host, branch, or administrative role."
      action={<><button onClick={load} disabled={loading} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/20"><RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button><button onClick={() => setShowInvitation(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#ed1c24] px-5 text-sm font-black text-white shadow-lg shadow-red-950/30 hover:bg-red-600"><UserRoundPlus className="h-4 w-4" />Invite visitor</button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <VisitorStat label="Scheduled today" value={summary.today} hint="Visits in your accessible scope" icon={<CalendarClock className="h-5 w-5" />} />
        <VisitorStat label="Awaiting approval" value={summary.pending} hint="Host decisions pending" icon={<Clock3 className="h-5 w-5" />} />
        <VisitorStat label="Inside now" value={summary.inside} hint="Currently checked in" icon={<UsersRound className="h-5 w-5" />} />
        <VisitorStat label="Ready at gate" value={summary.approved} hint="Approved, not yet checked in" icon={<ShieldCheck className="h-5 w-5" />} />
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div><h2 className="text-lg font-black text-slate-950">Visitor register</h2><p className="mt-1 text-sm text-slate-500">{filtered.length} accessible record{filtered.length === 1 ? "" : "s"}</p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-400 sm:w-64" placeholder="Name, company, visit no…" aria-label="Search visitor register" /></label>
            <select value={status} onChange={(e) => setStatus(e.target.value as "all" | VisitorStatus)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-400" aria-label="Filter by visitor status"><option value="all">All statuses</option><option value="pending_approval">Pending approval</option><option value="approved">Approved</option><option value="checked_in">Checked in</option><option value="checked_out">Checked out</option><option value="rejected">Rejected</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select>
          </div>
        </div>
        <div className="p-4 sm:p-5">
          {message && <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{message}</div>}
          {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-[#2784c4]" /></div> : filtered.length === 0 ? <VisitorEmpty title="No visitor records found" description="Adjust the filters or create a visitor invitation to begin." /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead><tr className="border-b border-slate-200 text-xs font-black uppercase tracking-wide text-slate-400"><th className="px-3 py-3">Visitor</th><th className="px-3 py-3">Visit</th><th className="px-3 py-3">Host & branch</th><th className="px-3 py-3">Schedule</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Details</th></tr></thead><tbody>{filtered.map((visit) => <tr key={visit.id} className="border-b border-slate-100 align-top last:border-0 hover:bg-slate-50/70"><td className="px-3 py-4"><p className="font-black text-slate-950">{visit.visitor_name}</p><p className="mt-1 text-xs text-slate-500">{visit.company_name || visit.masked_mobile || "Independent visitor"}</p></td><td className="px-3 py-4"><p className="text-sm font-bold text-slate-800">{visit.visit_number}</p><p className="mt-1 text-xs capitalize text-slate-500">{visit.visit_type.replace(/_/g, " ")}</p></td><td className="px-3 py-4"><p className="text-sm font-bold text-slate-800">{visit.host_display_name || "Unassigned"}</p><p className="mt-1 text-xs text-slate-500">{visit.branch_name}</p></td><td className="px-3 py-4"><p className="text-sm font-bold text-slate-800">{visitorDateTime(visit.scheduled_start)}</p><p className="mt-1 text-xs text-slate-500">to {visitorDateTime(visit.scheduled_end)}</p></td><td className="px-3 py-4"><VisitorStatusBadge status={visit.status} /></td><td className="px-3 py-4 text-right"><button onClick={() => setDetailId(visit.id)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-100"><Eye className="h-4 w-4" />Open</button></td></tr>)}</tbody></table></div>
          )}
        </div>
      </section>

      {showInvitation && <VisitorRegistrationDialog mode="invitation" onClose={() => setShowInvitation(false)} onCreated={(result) => { setShowInvitation(false); setCreated(result); void load(); }} />}
      {detailId && <DetailDrawer visitId={detailId} onClose={() => setDetailId(null)} />}
      {created && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-5 backdrop-blur-sm" role="dialog" aria-modal="true"><div className="w-full max-w-lg rounded-[2rem] bg-white p-6 shadow-2xl sm:p-8"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700"><UserRoundCheck className="h-7 w-7" /></div><h2 className="mt-5 text-2xl font-black text-slate-950">Invitation created</h2><p className="mt-2 text-sm leading-6 text-slate-600">Visit <strong>{created.visit_number}</strong> is pending approval. Share the private tracking link with the visitor.</p><div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="break-all text-xs font-semibold leading-5 text-slate-600">{trackingLink}</p></div><div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end"><button onClick={() => setCreated(null)} className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-700">Close</button><button onClick={() => void navigator.clipboard.writeText(trackingLink)} className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-black text-white">Copy tracking link</button></div></div></div>}
    </VisitorShell>
  );
}
