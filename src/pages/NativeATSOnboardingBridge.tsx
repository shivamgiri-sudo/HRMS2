import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type Row = {
  id: string;
  candidate_code: string;
  full_name: string;
  mobile: string;
  email: string;
  branch_name: string;
  role_applied: string;
  recruiter_name?: string;
  status: string;
  created_at: string;
  latest_decision?: string;
  latest_stage?: string;
  latest_process?: string;
  offer_doj?: string;
  offer_salary?: string;
  employee_id?: string;
  employee_code?: string;
};

const badgeTone = (value: string) => {
  const v = (value || "").toLowerCase();
  if (v.includes("selected")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (v.includes("reject") || v.includes("no show")) return "bg-rose-50 text-rose-700 border-rose-200";
  if (v.includes("hold") || v.includes("pending")) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
};

export default function NativeATSOnboardingBridge() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [converting, setConverting] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        "/api/ats/candidates?limit=500&page=1"
      );
      setRows(
        (res.data ?? []).map((c: any) => ({
          id: c.id,
          candidate_code: c.candidate_code,
          full_name: c.full_name,
          mobile: c.mobile,
          email: c.email ?? undefined,
          branch_name: c.applied_for_branch ?? undefined,
          role_applied: c.applied_for_process ?? undefined,
          recruiter_name: c.sourcing_channel ?? undefined,
          status: c.current_stage ?? "Applied",
          created_at: c.created_at,
          latest_decision: c.current_stage ?? "Applied",
          latest_stage: c.current_stage ?? "Applied",
          latest_process: c.applied_for_process ?? "-",
          offer_salary: "",
          offer_doj: "",
          employee_id: "",
          employee_code: "",
        }))
      );
    } catch (err: any) {
      setMessage(err.message || "Unable to load candidates");
    } finally {
      setLoading(false);
    }
  };

  const convert = async (id: string) => {
    setConverting(id);
    setMessage("");
    try {
      await hrmsApi.post("/api/ats/onboarding-bridge", {
        candidateId: id,
        bridgeDate: new Date().toISOString().slice(0, 10),
      });
      setMessage("Onboarding bridge created. HR can now assign employee code.");
      await load();
    } catch (err: any) {
      setMessage(err.message || "Unable to create onboarding bridge");
    } finally {
      setConverting("");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const decision = r.latest_decision || r.status || "Waiting";
      const text = [r.candidate_code, r.full_name, r.mobile, r.email, r.branch_name, r.role_applied, r.recruiter_name, decision].join(" ").toLowerCase();
      return (!q || text.includes(q)) && (statusFilter === "All" || decision === statusFilter);
    });
  }, [rows, search, statusFilter]);

  const statusOptions = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => r.latest_decision || r.status || "Waiting")))], [rows]);
  const selectedCount = rows.filter((r) => r.latest_decision === "Selected").length;
  const convertedCount = rows.filter((r) => !!r.employee_id).length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Native ATS</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">ATS Candidate Journey + HRMS Onboarding Bridge</h1>
            <p className="mt-2 text-slate-600">Convert selected ATS candidates into HRMS onboarding employees. Decision comes from latest recruiter submission.</p>
          </div>
          <button onClick={load} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white">Refresh</button>
        </div>

        {message && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{message}</div>}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Total Candidates</p><p className="mt-2 text-3xl font-black">{rows.length}</p></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Selected</p><p className="mt-2 text-3xl font-black text-emerald-700">{selectedCount}</p></div>
          <div className="rounded-3xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Onboarding Created</p><p className="mt-2 text-3xl font-black text-violet-700">{convertedCount}</p></div>
        </div>

        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_240px]">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search candidate, mobile, recruiter, branch..." className="rounded-2xl border bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-400" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-2xl border bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-400">
              {statusOptions.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-bold text-slate-950">Candidates</h2>
            <p className="text-sm text-slate-500">Selected candidates become HRMS onboarding employees from here.</p>
          </div>

          {loading ? <div className="p-8 text-center text-slate-500">Loading...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="p-4">Candidate</th><th className="p-4">Contact</th><th className="p-4">Branch / Role</th><th className="p-4">Recruiter</th><th className="p-4">Decision / Stage</th><th className="p-4">Offer</th><th className="p-4">Lifecycle</th><th className="p-4">Action</th></tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const decision = r.latest_decision || r.status || "Waiting";
                    const converted = !!r.employee_id || r.status === "Selected - Onboarding";
                    const canConvert = decision === "Selected" && !converted;
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="p-4"><div className="font-bold text-slate-900">{r.full_name || "-"}</div><div className="text-xs text-slate-500">{r.candidate_code || "-"}</div></td>
                        <td className="p-4 text-slate-600"><div>{r.mobile || "-"}</div><div className="text-xs">{r.email || "-"}</div></td>
                        <td className="p-4 text-slate-600"><div>{r.branch_name || "-"}</div><div className="text-xs">{r.role_applied || "-"}</div></td>
                        <td className="p-4 text-slate-600">{r.recruiter_name || "-"}</td>
                        <td className="p-4"><span className={`rounded-full border px-3 py-1 text-xs font-bold ${badgeTone(decision)}`}>{decision}</span><div className="mt-2 text-xs text-slate-500">{r.latest_stage} • {r.latest_process}</div></td>
                        <td className="p-4 text-slate-600"><div>{r.offer_salary || "-"}</div><div className="text-xs">DOJ: {r.offer_doj || "-"}</div></td>
                        <td className="p-4">{converted ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">HRMS Onboarding {r.employee_code || ""}</span> : <span className="rounded-full border bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">Candidate Journey</span>}</td>
                        <td className="p-4"><button disabled={!canConvert || converting === r.id} onClick={() => convert(r.id)} className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:bg-slate-300">{converting === r.id ? "Converting..." : converted ? "Created" : "Move to HRMS"}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
