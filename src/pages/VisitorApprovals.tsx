import { useEffect, useState } from "react";
import { Check, Clock3, Loader2, RefreshCcw, ShieldCheck, UserRoundCheck, X, CalendarClock } from "lucide-react";
import { VisitorEmpty, VisitorShell, VisitorStatusBadge } from "@/components/visitor/VisitorShell";
import { visitorApi, visitorDateTime, toLocalInputValue, type VisitorVisit } from "@/features/visitor/visitorApi";

export default function VisitorApprovals() {
  const [visits, setVisits] = useState<VisitorVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<VisitorVisit | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [extending, setExtending] = useState<VisitorVisit | null>(null);
  const [extendEnd, setExtendEnd] = useState("");
  const [extendReason, setExtendReason] = useState("");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [pending, active] = await Promise.all([
        visitorApi.visits({ status: "pending_approval" }),
        visitorApi.visits({ status: "checked_in" }),
      ]);
      setVisits([...pending, ...active]);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load approvals"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const approve = async (visit: VisitorVisit) => {
    setWorkingId(visit.id); setMessage(""); setSuccess("");
    try {
      await visitorApi.approve(visit.id);
      setSuccess(`${visit.visitor_name}'s visit has been approved.`);
      setVisits((current) => current.filter((item) => item.id !== visit.id));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to approve visit"); }
    finally { setWorkingId(null); }
  };

  const reject = async () => {
    if (!rejecting || reason.trim().length < 3) { setMessage("Enter a clear rejection reason of at least 3 characters."); return; }
    setWorkingId(rejecting.id); setMessage(""); setSuccess("");
    try {
      await visitorApi.reject(rejecting.id, reason.trim());
      setVisits((current) => current.filter((item) => item.id !== rejecting.id));
      setSuccess(`${rejecting.visitor_name}'s visit has been rejected.`);
      setRejecting(null); setReason("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to reject visit"); }
    finally { setWorkingId(null); }
  };

  const extend = async () => {
    if (!extending || extendReason.trim().length < 3 || !extendEnd) {
      setMessage("Select a new end time and enter a reason (min 3 characters)."); return;
    }
    setWorkingId(extending.id); setMessage(""); setSuccess("");
    try {
      await visitorApi.extend(extending.id, { scheduled_end: new Date(extendEnd).toISOString(), reason: extendReason.trim() });
      setSuccess(`${extending.visitor_name}'s visit has been extended.`);
      setExtending(null); setExtendEnd(""); setExtendReason("");
      void load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to extend visit"); }
    finally { setWorkingId(null); }
  };

  const pendingVisits = visits.filter(v => v.status === "pending_approval");
  const activeVisits = visits.filter(v => v.status === "checked_in");

  return (
    <VisitorShell
      eyebrow="Host workspace"
      title="Visitor approvals"
      description="Review who is visiting, why they need access, and when they are expected. Only assigned hosts and authorized branch approvers can make a decision."
      action={<button onClick={load} disabled={loading} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/20"><RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh queue</button>}
    >
      {message && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{message}</div>}
      {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{success}</div>}

      {/* Pending approvals */}
      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center justify-between"><div><h2 className="text-lg font-black text-slate-950">Awaiting your decision</h2><p className="mt-1 text-sm text-slate-500">{pendingVisits.length} pending visit{pendingVisits.length === 1 ? "" : "s"}</p></div><div className="rounded-2xl bg-amber-50 p-3 text-amber-700"><Clock3 className="h-5 w-5" /></div></div>
        {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-[#2784c4]" /></div> : pendingVisits.length === 0 ? <VisitorEmpty title="Your approval queue is clear" description="New visitor requests assigned to you will appear here automatically." /> : (
          <div className="grid gap-4 xl:grid-cols-2">{pendingVisits.map((visit) => (
            <article key={visit.id} className="rounded-3xl border border-slate-200 p-5 transition hover:border-slate-300 hover:shadow-md">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[#2784c4]"><UserRoundCheck className="h-6 w-6" /></div><div><h3 className="font-black text-slate-950">{visit.visitor_name}</h3><p className="mt-0.5 text-sm text-slate-500">{visit.company_name || visit.masked_mobile || "Independent visitor"}</p></div></div><VisitorStatusBadge status={visit.status} /></div>
              <div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-black uppercase tracking-wide text-slate-400">When</p><p className="mt-1 text-sm font-bold text-slate-800">{visitorDateTime(visit.scheduled_start)}</p></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-black uppercase tracking-wide text-slate-400">Where</p><p className="mt-1 text-sm font-bold text-slate-800">{visit.branch_name}</p></div></div>
              <div className="mt-3 rounded-2xl border border-slate-100 p-3"><p className="text-xs font-black uppercase tracking-wide text-slate-400">Purpose · <span className="capitalize">{visit.visit_type.replace(/_/g, " ")}</span></p><p className="mt-1 text-sm leading-6 text-slate-700">{visit.purpose}</p></div>
              <p className="mt-3 text-xs font-semibold text-slate-400">{visit.visit_number}</p>
              <div className="mt-5 flex gap-3"><button onClick={() => setRejecting(visit)} disabled={workingId === visit.id} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-rose-200 text-sm font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50"><X className="h-4 w-4" />Reject</button><button onClick={() => void approve(visit)} disabled={workingId === visit.id} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50">{workingId === visit.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve</button></div>
            </article>
          ))}</div>
        )}
      </section>

      {/* Active visits — extend */}
      {!loading && activeVisits.length > 0 && (
        <section className="rounded-3xl border border-blue-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center justify-between"><div><h2 className="text-lg font-black text-slate-950">Currently inside</h2><p className="mt-1 text-sm text-slate-500">{activeVisits.length} active visit{activeVisits.length === 1 ? "" : "s"} — extend if meeting runs over</p></div><div className="rounded-2xl bg-blue-50 p-3 text-blue-600"><CalendarClock className="h-5 w-5" /></div></div>
          <div className="grid gap-4 xl:grid-cols-2">{activeVisits.map((visit) => (
            <article key={visit.id} className="rounded-3xl border border-blue-100 bg-blue-50/30 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-700"><UserRoundCheck className="h-6 w-6" /></div><div><h3 className="font-black text-slate-950">{visit.visitor_name}</h3><p className="mt-0.5 text-sm text-slate-500">{visit.company_name || visit.masked_mobile || "Independent visitor"}</p></div></div><VisitorStatusBadge status={visit.status} /></div>
              <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-2xl bg-white p-3 border border-blue-100"><p className="text-xs font-black uppercase tracking-wide text-slate-400">Checked in</p><p className="mt-1 text-sm font-bold text-slate-800">{visitorDateTime(visit.checked_in_at)}</p></div><div className="rounded-2xl bg-white p-3 border border-blue-100"><p className="text-xs font-black uppercase tracking-wide text-slate-400">Expected end</p><p className="mt-1 text-sm font-bold text-slate-800">{visitorDateTime(visit.scheduled_end)}</p></div></div>
              <p className="mt-3 text-xs font-semibold text-slate-400">{visit.visit_number} · {visit.branch_name}</p>
              <button onClick={() => { setExtending(visit); setExtendEnd(visit.scheduled_end ? toLocalInputValue(new Date(visit.scheduled_end)) : ""); setExtendReason(""); }} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-blue-300 text-sm font-black text-blue-700 hover:bg-blue-50"><CalendarClock className="h-4 w-4" />Extend Visit</button>
            </article>
          ))}</div>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        {[{ icon: ShieldCheck, title: "Verify purpose", text: "Confirm the visit is expected and appropriate before granting access." }, { icon: UserRoundCheck, title: "Meet your visitor", text: "Hosts remain responsible for visitors while they are inside an MAS facility." }, { icon: Clock3, title: "Keep timing accurate", text: "Use the 'Extend Visit' button above if a checked-in meeting runs beyond its approved window." }].map(({ icon: Icon, title, text }) => <div key={title} className="rounded-3xl border border-slate-200 bg-white p-5"><Icon className="h-5 w-5 text-[#2784c4]" /><h3 className="mt-3 font-black text-slate-950">{title}</h3><p className="mt-1 text-sm leading-6 text-slate-500">{text}</p></div>)}
      </section>

      {rejecting && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-5 backdrop-blur-sm" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl"><h2 className="text-xl font-black text-slate-950">Reject {rejecting.visitor_name}'s visit?</h2><p className="mt-2 text-sm leading-6 text-slate-500">The reason is stored in the audit trail and helps the visitor or desk understand the decision.</p><label className="mt-5 block text-xs font-black uppercase tracking-wide text-slate-500">Reason *</label><textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={500} className="mt-2 h-28 w-full resize-none rounded-2xl border border-slate-200 p-3 text-sm outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-50" placeholder="Explain why access cannot be approved" autoFocus /><div className="mt-5 flex justify-end gap-3"><button onClick={() => { setRejecting(null); setReason(""); }} className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-700">Cancel</button><button onClick={() => void reject()} disabled={workingId === rejecting.id} className="inline-flex h-11 items-center gap-2 rounded-xl bg-rose-600 px-5 text-sm font-black text-white disabled:opacity-50">{workingId === rejecting.id && <Loader2 className="h-4 w-4 animate-spin" />}Reject visit</button></div></div></div>}
      {extending && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-5 backdrop-blur-sm" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl"><h2 className="text-xl font-black text-slate-950">Extend {extending.visitor_name}'s visit</h2><p className="mt-2 text-sm leading-6 text-slate-500">Set a new end time and provide a reason for the extension.</p><label className="mt-5 block text-xs font-black uppercase tracking-wide text-slate-500">New end time *</label><input type="datetime-local" value={extendEnd} onChange={e => setExtendEnd(e.target.value)} className="mt-2 h-11 w-full rounded-2xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" /><label className="mt-4 block text-xs font-black uppercase tracking-wide text-slate-500">Reason *</label><textarea value={extendReason} onChange={(e) => setExtendReason(e.target.value)} minLength={3} maxLength={500} className="mt-2 h-24 w-full resize-none rounded-2xl border border-slate-200 p-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" placeholder="e.g. Meeting running over — extending by 30 minutes" autoFocus /><div className="mt-5 flex justify-end gap-3"><button onClick={() => { setExtending(null); setExtendEnd(""); setExtendReason(""); }} className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-700">Cancel</button><button onClick={() => void extend()} disabled={workingId === extending.id} className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-black text-white disabled:opacity-50">{workingId === extending.id && <Loader2 className="h-4 w-4 animate-spin" />}Extend visit</button></div></div></div>}
    </VisitorShell>
  );
}
