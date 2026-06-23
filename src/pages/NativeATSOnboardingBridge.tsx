import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { SecureDocumentList } from "@/components/documents/SecureDocumentList";

type Row = {
  id?: string;
  candidate_id: string;
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
  profile_status?: string;
  request_status?: string;
  onboarding_profile_status?: string;
  offer_status?: string;
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
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sendingToken, setSendingToken] = useState<string | null>(null);
  const [tokenSent, setTokenSent] = useState<Set<string>>(new Set());
  const [documentsCandidateId, setDocumentsCandidateId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: any[] }>(
        "/api/ats/onboarding-bridge"
      );
      setRows(res.data ?? []);
    } catch (err: any) {
      setMessage(err.message || "Unable to load candidates");
    } finally {
      setLoading(false);
    }
  };

  const handleSendToken = async (candidateId: string) => {
    setSendingToken(candidateId);
    try {
      await hrmsApi.post(`/api/ats/onboarding/send-token/${candidateId}`, {});
      setTokenSent(prev => new Set([...prev, candidateId]));
      setMessage("Secure onboarding link sent successfully.");
      await load();
    } catch (err: any) {
      setMessage(err?.message ?? "Failed to send onboarding link");
    } finally {
      setSendingToken(null);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const decision = r.latest_stage || r.status || "Waiting";
      const text = [r.candidate_code, r.full_name, r.mobile, r.email, r.branch_name, r.role_applied, r.recruiter_name, decision].join(" ").toLowerCase();
      return (!q || text.includes(q)) && (statusFilter === "All" || decision === statusFilter);
    });
  }, [rows, search, statusFilter]);

  const statusOptions = useMemo(() => ["All", ...Array.from(new Set(rows.map((r) => r.latest_stage || r.status || "Waiting")))], [rows]);
  const selectedCount = rows.filter((r) => ["Selected", "selected"].includes(r.latest_stage || "")).length;
  const convertedCount = rows.filter((r) =>
    Boolean(r.employee_id) || ["converted", "onboarded"].includes((r.latest_stage || "").toLowerCase())
  ).length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Native ATS</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">ATS Candidate Journey + HRMS Onboarding Bridge</h1>
            <p className="mt-2 text-slate-600">Track every selected candidate from secure profile collection through offer approval and employee creation.</p>
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
            <p className="text-sm text-slate-500">Employee records are created only after the approved offer workflow completes.</p>
          </div>

          {loading ? <div className="p-8 text-center text-slate-500">Loading...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="p-4">Candidate</th><th className="p-4">Contact</th><th className="p-4">Branch / Role</th><th className="p-4">Recruiter</th><th className="p-4">Decision / Stage</th><th className="p-4">Offer</th><th className="p-4">Lifecycle</th><th className="p-4">Action</th></tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const decision = r.latest_stage || r.status || "Waiting";
                    const empCode = r.employee_code ?? "";
                    const empId = r.employee_id ?? "";
                    const converted = !!empId || decision.toLowerCase() === "converted";
                    const legacyOnboarded = !empId && decision.toLowerCase() === "onboarded";
                    const lifecycleComplete = converted || legacyOnboarded;
                    const linkSent = ["onboarding_sent", "profile_in_progress", "profile_submitted", "onboarded"].includes(r.profile_status || "");
                    const profileSubmitted = ["submitted", "approved", "hr_review"].includes(r.onboarding_profile_status || "")
                      || r.profile_status === "profile_submitted";
                    const offerSubmitted = r.offer_status === "submitted" || r.request_status === "offer_submitted";
                    const canSendToken = ["Selected", "selected"].includes(decision) && !converted;
                    return (
                      <tr key={r.candidate_id} className="border-t">
                        <td className="p-4">
                          <div className="font-bold text-slate-900">{r.full_name || "-"}</div>
                          <div className="text-xs text-slate-500">{r.candidate_code || "-"}</div>
                        </td>
                        <td className="p-4 text-slate-600">
                          <div>{r.mobile || "-"}</div>
                          <div className="text-xs">{r.email || "-"}</div>
                        </td>
                        <td className="p-4 text-slate-600">
                          <div>{r.branch_name || "-"}</div>
                          <div className="text-xs">{r.role_applied || "-"}</div>
                        </td>
                        <td className="p-4 text-slate-600">{r.recruiter_name || "-"}</td>
                        <td className="p-4">
                          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${badgeTone(decision)}`}>{decision}</span>
                          <div className="mt-2 text-xs text-slate-500">{r.latest_stage} • {r.latest_process}</div>
                        </td>
                        <td className="p-4 text-slate-600">
                          <div>{r.offer_salary || "-"}</div>
                          <div className="text-xs">DOJ: {r.offer_doj || "-"}</div>
                        </td>
                        <td className="p-4">
                          {lifecycleComplete ? (
                            <div className="space-y-1">
                              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                                {converted ? "Converted" : "Legacy onboarded"} {empCode && `• ${empCode}`}
                              </span>
                              {empId && (
                                <div>
                                  <a
                                    href={`/employees?search=${encodeURIComponent(empCode)}`}
                                    className="text-xs font-semibold text-blue-600 underline hover:text-blue-800"
                                  >
                                    View Employee Profile
                                  </a>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="min-w-[210px] space-y-2 text-xs">
                              <div className="flex items-center justify-between"><span>Selected</span><span className="font-bold text-emerald-600">Done</span></div>
                              <div className="flex items-center justify-between"><span>Link sent</span><span className={linkSent ? "font-bold text-emerald-600" : "text-slate-400"}>{linkSent ? "Done" : "Pending"}</span></div>
                              <div className="flex items-center justify-between"><span>Profile submitted</span><span className={profileSubmitted ? "font-bold text-emerald-600" : "text-slate-400"}>{profileSubmitted ? "Done" : "Pending"}</span></div>
                              <div className="flex items-center justify-between"><span>Offer approval</span><span className={offerSubmitted ? "font-bold text-amber-600" : "text-slate-400"}>{offerSubmitted ? "In review" : "Pending"}</span></div>
                            </div>
                          )}
                        </td>
                        <td className="p-4 space-y-2">
                          <button
                            onClick={() => setDocumentsCandidateId(r.candidate_id)}
                            className="block rounded bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-700"
                          >
                            Review Documents
                          </button>
                          {canSendToken && (
                            <button
                              onClick={() => handleSendToken(r.candidate_id)}
                              disabled={sendingToken === r.candidate_id || tokenSent.has(r.candidate_id)}
                              className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                              {sendingToken === r.candidate_id
                                ? 'Sending...'
                                : tokenSent.has(r.candidate_id)
                                ? 'Link Sent'
                                : linkSent
                                ? 'Resend Link'
                                : 'Send Onboarding Link'}
                            </button>
                          )}
                          {!lifecycleComplete && (
                            <span className="block max-w-[170px] text-xs leading-5 text-slate-500">
                              {offerSubmitted ? "Awaiting branch-head approval" : profileSubmitted ? "Prepare and submit offer" : linkSent ? "Awaiting candidate profile" : "Start secure onboarding"}
                            </span>
                          )}
                          {legacyOnboarded && (
                            <span className="block max-w-[170px] text-xs leading-5 text-slate-500">
                              Imported before employee-link tracking
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {documentsCandidateId && (
          <div className="rounded-3xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-950">Secure Document Review</h2>
                <p className="text-sm text-slate-500">Protected preview, verify, reject, re-upload request, and access audit.</p>
              </div>
              <button onClick={() => setDocumentsCandidateId(null)} className="rounded border px-3 py-1 text-sm">Close</button>
            </div>
            <SecureDocumentList candidateId={documentsCandidateId} />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
