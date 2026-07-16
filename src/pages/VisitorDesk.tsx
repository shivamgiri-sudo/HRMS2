import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Clock3, DoorOpen, Loader2, LogOut, RefreshCcw, Search, ShieldAlert, UserRoundPlus } from "lucide-react";
import { VisitorRegistrationDialog } from "@/components/visitor/VisitorRegistrationDialog";
import { VisitorEmpty, VisitorShell, VisitorStat, VisitorStatusBadge } from "@/components/visitor/VisitorShell";
import { visitorApi, visitorDateTime, type VisitorVisit } from "@/features/visitor/visitorApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

type GateAction = { visit: VisitorVisit; event: "check_in" | "check_out" };

export default function VisitorDesk() {
  const { hasAnyRole, isLoading: accessLoading } = useWorkforceAccess();
  const canOperate = hasAnyRole("super_admin", "admin", "security_head", "visitor_security", "visitor_reception", "branch_head", "branch_hr", "hr_branch");
  const [visits, setVisits] = useState<VisitorVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [showRegister, setShowRegister] = useState(false);
  const [gateAction, setGateAction] = useState<GateAction | null>(null);
  const [gateCode, setGateCode] = useState("MAIN-GATE");
  const [badgeNumber, setBadgeNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    if (!canOperate) { setLoading(false); return; }
    setLoading(true); setMessage("");
    try {
      const [pending, approved, inside] = await Promise.all([
        visitorApi.visits({ status: "pending_approval" }),
        visitorApi.visits({ status: "approved" }),
        visitorApi.visits({ status: "checked_in" }),
      ]);
      setVisits([...inside, ...approved, ...pending]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load guard desk queue"); }
    finally { setLoading(false); }
  }, [canOperate]);

  useEffect(() => { if (!accessLoading) void load(); }, [accessLoading, load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return visits.filter((visit) => !needle || [visit.visitor_name, visit.visit_number, visit.company_name, visit.host_display_name].some((value) => String(value ?? "").toLowerCase().includes(needle)));
  }, [search, visits]);

  const processGate = async () => {
    if (!gateAction || !gateCode.trim()) { setMessage("Enter the gate or reception point code."); return; }
    setWorking(true); setMessage(""); setSuccess("");
    try {
      if (gateAction.event === "check_in") {
        await visitorApi.checkIn(gateAction.visit.id, { gate_code: gateCode.trim(), badge_number: badgeNumber.trim() || undefined, notes: notes.trim() || undefined });
        setSuccess(`${gateAction.visit.visitor_name} checked in successfully.`);
      } else {
        await visitorApi.checkOut(gateAction.visit.id, { gate_code: gateCode.trim(), notes: notes.trim() || undefined });
        setSuccess(`${gateAction.visit.visitor_name} checked out successfully. Any issued badge is now available.`);
      }
      setGateAction(null); setBadgeNumber(""); setNotes("");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to process gate event"); }
    finally { setWorking(false); }
  };

  const inside = visits.filter((visit) => visit.status === "checked_in").length;
  const expected = visits.filter((visit) => visit.status === "approved").length;
  const pending = visits.filter((visit) => visit.status === "pending_approval").length;

  return (
    <VisitorShell
      eyebrow="Reception & front desk"
      title="Guard desk"
      description="Register walk-ins, find expected visitors, issue badges, and record every entry and exit against a named gate."
      action={canOperate ? <><button onClick={load} disabled={loading} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/20"><RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button><button onClick={() => setShowRegister(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#ed1c24] px-5 text-sm font-black text-white"><UserRoundPlus className="h-4 w-4" />Register walk-in</button></> : undefined}
    >
      {!accessLoading && !canOperate ? <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6"><div className="flex items-start gap-4"><div className="rounded-2xl bg-amber-100 p-3 text-amber-700"><ShieldAlert className="h-6 w-6" /></div><div><h2 className="text-lg font-black text-amber-950">Reception access is required</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-amber-800">This workspace is limited to visitor reception, security, branch HR, branch heads, and administrators. Ask your HRMS administrator to assign the visitor reception role for your branch.</p></div></div></div> : <>
        <div className="grid gap-4 sm:grid-cols-3"><VisitorStat label="Inside now" value={inside} hint="Awaiting check-out" icon={<DoorOpen className="h-5 w-5" />} /><VisitorStat label="Expected at gate" value={expected} hint="Approved and ready" icon={<BadgeCheck className="h-5 w-5" />} /><VisitorStat label="Host approval pending" value={pending} hint="Cannot check in yet" icon={<Clock3 className="h-5 w-5" />} /></div>
        {message && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{message}</div>}
        {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{success}</div>}
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-black text-slate-950">Gate queue</h2><p className="mt-1 text-sm text-slate-500">Approved visitors appear here for secure check-in.</p></div><label className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-400 sm:w-72" placeholder="Search visitor or visit number" /></label></div>
          <div className="p-4 sm:p-5">{loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-[#2784c4]" /></div> : filtered.length === 0 ? <VisitorEmpty title="No visitors in the gate queue" description="Approved arrivals, pending desk entries, and checked-in visitors will appear here." /> : <div className="grid gap-4 xl:grid-cols-2">{filtered.map((visit) => <article key={visit.id} className={`rounded-3xl border p-5 ${visit.checkout_requested_at ? "border-orange-300 bg-orange-50/40" : "border-slate-200"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-black text-slate-950">{visit.visitor_name}</h3><p className="mt-1 text-sm text-slate-500">{visit.company_name || visit.masked_mobile || "Independent visitor"}</p></div><VisitorStatusBadge status={visit.status} /></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-400">Host</p><p className="mt-1 text-sm font-bold text-slate-800">{visit.host_display_name || "Unassigned"}</p></div><div className="rounded-2xl bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-400">Scheduled</p><p className="mt-1 text-sm font-bold text-slate-800">{visitorDateTime(visit.scheduled_start)}</p></div></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-400">{visit.visit_number} · {visit.branch_name}</p>{visit.checkout_requested_at && <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-black text-orange-800">Visitor requested exit</span>}</div><div className="mt-4">{visit.status === "approved" && <button onClick={() => setGateAction({ visit, event: "check_in" })} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700"><DoorOpen className="h-4 w-4" />Check in & issue badge</button>}{visit.status === "checked_in" && <button onClick={() => setGateAction({ visit, event: "check_out" })} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-black text-white hover:bg-slate-800"><LogOut className="h-4 w-4" />Check out visitor</button>}{visit.status === "pending_approval" && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-bold text-amber-800">Waiting for host approval</div>}</div></article>)}</div>}</div>
        </section>
      </>}

      {showRegister && <VisitorRegistrationDialog mode="desk" onClose={() => setShowRegister(false)} onCreated={(result) => { setShowRegister(false); setSuccess(`Walk-in ${result.visit_number} registered and sent to the host for approval.`); void load(); }} />}
      {gateAction && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-5 backdrop-blur-sm" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl"><h2 className="text-xl font-black text-slate-950">{gateAction.event === "check_in" ? "Check in" : "Check out"} {gateAction.visit.visitor_name}</h2><p className="mt-2 text-sm text-slate-500">{gateAction.visit.visit_number} · {gateAction.visit.branch_name}</p><div className="mt-5 space-y-4"><label className="block"><span className="text-xs font-black uppercase tracking-wide text-slate-500">Gate code *</span><input value={gateCode} onChange={(e) => setGateCode(e.target.value)} maxLength={80} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400" placeholder="MAIN-GATE" /></label>{gateAction.event === "check_in" && <label className="block"><span className="text-xs font-black uppercase tracking-wide text-slate-500">Badge number</span><input value={badgeNumber} onChange={(e) => setBadgeNumber(e.target.value.toUpperCase())} maxLength={80} className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400" placeholder="VIS-001 (optional)" /></label>}<label className="block"><span className="text-xs font-black uppercase tracking-wide text-slate-500">Security notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} className="mt-2 h-24 w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-blue-400" placeholder={gateAction.event === "check_out" ? "Confirm returned badge and belongings" : "Optional entry notes"} /></label></div><div className="mt-5 flex justify-end gap-3"><button onClick={() => setGateAction(null)} className="h-11 rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-700">Cancel</button><button onClick={() => void processGate()} disabled={working} className={`inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-black text-white disabled:opacity-50 ${gateAction.event === "check_in" ? "bg-emerald-600" : "bg-slate-950"}`}>{working && <Loader2 className="h-4 w-4 animate-spin" />}{gateAction.event === "check_in" ? "Confirm check-in" : "Confirm check-out"}</button></div></div></div>}
    </VisitorShell>
  );
}
