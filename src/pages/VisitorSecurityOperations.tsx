import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Building2, Download, Loader2, LogOut, Printer, RefreshCcw, ShieldAlert, Siren, UsersRound } from "lucide-react";
import { VisitorEmpty, VisitorShell, VisitorStat } from "@/components/visitor/VisitorShell";
import { visitorApi, visitorDateTime, type EmergencyVisitor, type VisitorBranch, type VisitorOccupancy } from "@/features/visitor/visitorApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export default function VisitorSecurityOperations() {
  const { hasAnyRole, isLoading: accessLoading } = useWorkforceAccess();
  const canOperate = hasAnyRole("super_admin", "admin", "security_head", "visitor_security", "visitor_reception", "branch_head", "branch_hr", "hr_branch");
  const [branches, setBranches] = useState<VisitorBranch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [occupancy, setOccupancy] = useState<VisitorOccupancy[]>([]);
  const [register, setRegister] = useState<EmergencyVisitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!canOperate) { setLoading(false); return; }
    if (!quiet) setLoading(true);
    setMessage("");
    try {
      const [branchData, occupancyData, registerData] = await Promise.all([
        visitorApi.branches(),
        visitorApi.occupancy(branchId || undefined),
        visitorApi.emergencyRegister(branchId || undefined),
      ]);
      setBranches(branchData); setOccupancy(occupancyData); setRegister(registerData); setLastUpdated(new Date());
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load security operations"); }
    finally { setLoading(false); }
  }, [branchId, canOperate]);

  useEffect(() => { if (!accessLoading) void load(); }, [accessLoading, load]);
  useEffect(() => {
    if (!canOperate) return undefined;
    const interval = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(interval);
  }, [canOperate, load]);

  const totalInside = useMemo(() => occupancy.reduce((sum, item) => sum + Number(item.visitors_inside || 0), 0), [occupancy]);
  const longestStay = useMemo(() => {
    if (!register.length) return "—";
    const earliest = Math.min(...register.map((item) => new Date(item.checked_in_at).getTime()).filter(Number.isFinite));
    if (!Number.isFinite(earliest)) return "—";
    const now = lastUpdated?.getTime() ?? Date.now();
    const minutes = Math.max(0, Math.floor((now - earliest) / 60_000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
  }, [register, lastUpdated]);

  const checkout = async (visitor: EmergencyVisitor) => {
    if (!window.confirm(`Check out ${visitor.visitor_name} from ${visitor.branch_name}?`)) return;
    setWorkingId(visitor.id); setMessage("");
    try { await visitorApi.checkOut(visitor.id, { gate_code: "SECURITY-OPS", notes: "Checked out from security operations" }); await load(true); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to check out visitor"); }
    finally { setWorkingId(null); }
  };

  const exportRegister = () => {
    const rows = [
      ["Visit number", "Visitor", "Masked mobile", "Branch", "Host", "Checked in at"],
      ...register.map((item) => [item.visit_number, item.visitor_name, item.masked_mobile, item.branch_name, item.host_display_name ?? "", visitorDateTime(item.checked_in_at)]),
    ];
    const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `visitor-emergency-register-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <VisitorShell
      eyebrow="Live physical security"
      title="Security operations"
      description="Monitor real-time occupancy and keep an immediately printable emergency register of every visitor currently inside an MAS facility. Data refreshes every 30 seconds."
      action={canOperate ? <><button onClick={() => window.print()} className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/20"><Printer className="h-4 w-4" />Print register</button><button onClick={() => void load()} disabled={loading} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#ed1c24] px-5 text-sm font-black text-white"><RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh now</button></> : undefined}
    >
      {!accessLoading && !canOperate ? <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6"><div className="flex items-start gap-4"><div className="rounded-2xl bg-amber-100 p-3 text-amber-700"><ShieldAlert className="h-6 w-6" /></div><div><h2 className="text-lg font-black text-amber-950">Security access is required</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-amber-800">The live occupancy and emergency register contain physical-security information and are limited to approved branch and security roles.</p></div></div></div> : <>
        <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><Activity className="h-4 w-4" /></div><div><p className="text-sm font-black text-slate-900">Live register</p><p className="text-xs text-slate-500">{lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Connecting to security data…"}</p></div></div><select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-400" aria-label="Filter security register by branch"><option value="">All accessible branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}</select></div>
        {message && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{message}</div>}
        <div className="grid gap-4 sm:grid-cols-3"><VisitorStat label="Visitors inside" value={totalInside} hint="Across selected branches" icon={<UsersRound className="h-5 w-5" />} /><VisitorStat label="Branches occupied" value={occupancy.length} hint="Facilities with visitors" icon={<Building2 className="h-5 w-5" />} /><VisitorStat label="Longest current stay" value={longestStay} hint="Since earliest check-in" icon={<Siren className="h-5 w-5" />} /></div>

        {occupancy.length > 0 && <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{occupancy.map((item) => <div key={item.branch_id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-sm font-black text-slate-950">{item.branch_name}</p><p className="mt-1 text-xs text-slate-500">Live occupancy</p></div><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-xl font-black text-emerald-700">{Number(item.visitors_inside)}</div></div></div>)}</section>}

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-black text-slate-950">Emergency visitor register</h2><p className="mt-1 text-sm text-slate-500">Use during evacuation, roll call, or site lockdown.</p></div><button onClick={exportRegister} disabled={!register.length} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-40 print:hidden"><Download className="h-4 w-4" />Export CSV</button></div>
          <div className="p-4 sm:p-5">{loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-[#2784c4]" /></div> : register.length === 0 ? <VisitorEmpty title="No visitors are currently inside" description="The emergency register will populate as guards check approved visitors in." /> : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left"><thead><tr className="border-b border-slate-200 text-xs font-black uppercase tracking-wide text-slate-400"><th className="px-3 py-3">Visitor</th><th className="px-3 py-3">Contact</th><th className="px-3 py-3">Host</th><th className="px-3 py-3">Branch</th><th className="px-3 py-3">Entry time</th><th className="px-3 py-3 text-right print:hidden">Action</th></tr></thead><tbody>{register.map((visitor) => <tr key={visitor.id} className="border-b border-slate-100 last:border-0"><td className="px-3 py-4"><p className="font-black text-slate-950">{visitor.visitor_name}</p><p className="mt-1 text-xs text-slate-500">{visitor.visit_number}</p></td><td className="px-3 py-4 text-sm font-bold text-slate-700">{visitor.masked_mobile}</td><td className="px-3 py-4 text-sm font-bold text-slate-700">{visitor.host_display_name || "Unassigned"}</td><td className="px-3 py-4 text-sm font-bold text-slate-700">{visitor.branch_name}</td><td className="px-3 py-4 text-sm font-bold text-slate-700">{visitorDateTime(visitor.checked_in_at)}</td><td className="px-3 py-4 text-right print:hidden"><button onClick={() => void checkout(visitor)} disabled={workingId === visitor.id} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{workingId === visitor.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}Check out</button></td></tr>)}</tbody></table></div>}</div>
        </section>
      </>}
    </VisitorShell>
  );
}
