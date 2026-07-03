import { useEffect, useState } from "react";
import { RefreshCcw, ShieldCheck, AlertTriangle, CheckCircle2, Send, PackageCheck, ChevronDown, ChevronUp } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type QueueRow = {
  candidate_id: string;
  candidate_code?: string;
  full_name: string;
  mobile?: string;
  email?: string;
  branch_name?: string;
  process_name?: string;
  issue_count: number;
  verified_count: number;
  last_check_at?: string;
};

type BgvStatus = {
  candidate_id: string;
  score: number;
  overall_status: string;
  employee_creation_ready: boolean;
  payroll_activation_ready: boolean;
  checks: Check[];
  documents: Doc[];
};

type Check = {
  id: string;
  check_type: string;
  status: string;
  match_score?: number;
  result_summary?: string;
};

type Doc = {
  id: string;
  doc_type: string;
  doc_name: string;
  document_status: string;
};

type VendorDispatch = {
  id: string;
  check_type: string;
  vendor_name: string;
  vendor_contact_email?: string;
  vendor_contact_phone?: string;
  status: string;
  sent_at: string;
  sent_by_name?: string;
  vendor_reference_no?: string;
  vendor_result?: string;
  vendor_remarks?: string;
  result_received_at?: string;
  result_updated_by_name?: string;
  bgv_check_updated: number;
  dispatch_notes?: string;
};

type ApiResponse<T> = { success: boolean; data: T };

const STATUS_COLOR: Record<string, string> = {
  verified: "bg-emerald-50 text-emerald-700",
  waived: "bg-blue-50 text-blue-700",
  failed: "bg-red-50 text-red-700",
  mismatch: "bg-red-50 text-red-700",
  manual_review: "bg-amber-50 text-amber-700",
  pending: "bg-slate-100 text-slate-600",
  sent: "bg-blue-50 text-blue-700",
  result_received: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
};

const CHECK_LABELS: Record<string, string> = {
  aadhaar: "Aadhaar", pan: "PAN", bank: "Bank", address: "Address",
  education: "Education", experience: "Employment", court: "Court / Criminal", photo_match: "Photo Match",
};

export default function NativeBGVVerificationCenter() {
  const { user } = useAuth();
  const role = (user as any)?.role ?? "";
  const ALLOWED = ["admin", "super_admin", "hr", "recruiter"];
  if (user && !ALLOWED.includes(role)) {
    return <DashboardLayout><div className="p-8 text-center text-red-600 font-bold">You do not have access to this page.</div></DashboardLayout>;
  }
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [selected, setSelected] = useState<BgvStatus | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [dispatches, setDispatches] = useState<VendorDispatch[]>([]);
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "error">("info");

  // Vendor dispatch form
  const [showDispatchForm, setShowDispatchForm] = useState(false);
  const [dispatchCheckId, setDispatchCheckId] = useState("");
  const [dispatchCheckType, setDispatchCheckType] = useState("");
  const [dispatchForm, setDispatchForm] = useState({
    vendorName: "", vendorContactEmail: "", vendorContactPhone: "", dispatchNotes: "",
  });
  const [dispatchSaving, setDispatchSaving] = useState(false);

  // Vendor result update form
  const [resultDispatchId, setResultDispatchId] = useState("");
  const [resultForm, setResultForm] = useState({
    vendorResult: "verified" as "verified" | "not_verified" | "inconclusive",
    vendorReferenceNo: "", vendorRemarks: "", updateBgvCheck: true,
  });
  const [resultSaving, setResultSaving] = useState(false);

  const notify = (msg: string, type: "info" | "error" = "info") => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(""), 5000);
  };

  const loadQueue = async () => {
    setLoading(true);
    try {
      const res = await hrmsApi.get<ApiResponse<QueueRow[]>>("/api/ats/bgv/queue");
      setQueue(res.data || []);
    } catch (e: any) { notify(e.message || "Unable to load BGV queue", "error"); }
    finally { setLoading(false); }
  };

  const loadCandidate = async (candidateId: string) => {
    setSelectedId(candidateId);
    setShowDispatchForm(false);
    setResultDispatchId("");
    const [bgvRes, dispRes] = await Promise.all([
      hrmsApi.get<ApiResponse<BgvStatus>>(`/api/ats/bgv/candidates/${candidateId}`),
      hrmsApi.get<ApiResponse<VendorDispatch[]>>(`/api/ats/bgv/candidates/${candidateId}/vendor-dispatches`).catch(() => ({ data: [] as VendorDispatch[] })),
    ]);
    setSelected(bgvRes.data);
    setDispatches((dispRes as any).data || []);
  };

  const manualReview = async (status: "verified" | "mismatch" | "failed" | "manual_review", checkId?: string) => {
    if (!selectedId) return;
    if (!remarks.trim()) return notify("Enter remarks before clearing.", "error");
    await hrmsApi.post(`/api/ats/bgv/candidates/${selectedId}/manual-review`, { checkId, status, remarks });
    notify("Review updated.");
    await loadCandidate(selectedId);
    await loadQueue();
  };

  const waive = async (checkId?: string) => {
    if (!selectedId) return;
    if (!remarks.trim()) return notify("Reason is required for waiver.", "error");
    await hrmsApi.post(`/api/ats/bgv/candidates/${selectedId}/waive`, { checkId, reason: remarks });
    notify("Exception / waiver approved.");
    await loadCandidate(selectedId);
    await loadQueue();
  };

  const openDispatchForm = (check: Check) => {
    setDispatchCheckId(check.id);
    setDispatchCheckType(check.check_type);
    setDispatchForm({ vendorName: "", vendorContactEmail: "", vendorContactPhone: "", dispatchNotes: "" });
    setShowDispatchForm(true);
    setResultDispatchId("");
  };

  const submitDispatch = async () => {
    if (!selectedId) return;
    if (!dispatchForm.vendorName.trim()) return notify("Vendor name required.", "error");
    setDispatchSaving(true);
    try {
      await hrmsApi.post(`/api/ats/bgv/candidates/${selectedId}/vendor-dispatch`, {
        checkId: dispatchCheckId || undefined,
        checkType: dispatchCheckType,
        ...dispatchForm,
      });
      notify(`Dispatched to ${dispatchForm.vendorName}. BGV check moved to 'manual_review' pending vendor result.`);
      setShowDispatchForm(false);
      await loadCandidate(selectedId);
      await loadQueue();
    } catch (e: any) { notify(e.message || "Dispatch failed", "error"); }
    finally { setDispatchSaving(false); }
  };

  const openResultForm = (d: VendorDispatch) => {
    setResultDispatchId(d.id);
    setResultForm({ vendorResult: "verified", vendorReferenceNo: d.vendor_reference_no || "", vendorRemarks: "", updateBgvCheck: true });
    setShowDispatchForm(false);
  };

  const submitResult = async () => {
    if (!selectedId || !resultDispatchId) return;
    setResultSaving(true);
    try {
      await hrmsApi.patch(`/api/ats/bgv/candidates/${selectedId}/vendor-dispatch/${resultDispatchId}/result`, resultForm);
      notify(`Vendor result recorded${resultForm.updateBgvCheck ? " and synced to BGV check." : "."}`);
      setResultDispatchId("");
      await loadCandidate(selectedId);
      await loadQueue();
    } catch (e: any) { notify(e.message || "Result update failed", "error"); }
    finally { setResultSaving(false); }
  };

  useEffect(() => { void loadQueue(); }, []);

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6 lg:p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">ATS / BGV</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">BGV Verification Center</h1>
            <p className="mt-2 max-w-3xl text-slate-600">Track and resolve verification checks. When API auto-verify fails, dispatch documents to external vendor and record result.</p>
          </div>
          <Button onClick={loadQueue} disabled={loading} className="gap-2"><RefreshCcw className="h-4 w-4" />Refresh</Button>
        </div>

        {message && (
          <div className={`rounded-2xl border p-4 text-sm font-bold ${messageType === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
            {message}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          {/* ── Queue ── */}
          <Card>
            <CardHeader><CardTitle>Verification Queue</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {queue.length === 0 && <p className="text-sm text-slate-500">No candidates in BGV queue.</p>}
              {queue.map((row) => (
                <button key={row.candidate_id} onClick={() => loadCandidate(row.candidate_id)}
                  className={`w-full rounded-2xl border p-4 text-left transition hover:bg-slate-50 ${selectedId === row.candidate_id ? "border-blue-400 bg-blue-50" : "bg-white"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-slate-950">{row.full_name}</p>
                      <p className="text-xs text-slate-500">{row.candidate_code || row.candidate_id} · {row.branch_name || "No branch"} · {row.process_name || "No process"}</p>
                    </div>
                    {Number(row.issue_count) > 0 ? <AlertTriangle className="h-5 w-5 text-amber-500" /> : <ShieldCheck className="h-5 w-5 text-emerald-500" />}
                  </div>
                  <div className="mt-3 flex gap-2 text-xs">
                    <span className="rounded-full bg-emerald-50 px-2 py-1 font-bold text-emerald-700">Verified {row.verified_count || 0}</span>
                    <span className="rounded-full bg-amber-50 px-2 py-1 font-bold text-amber-700">Issues {row.issue_count || 0}</span>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* ── Detail panel ── */}
          <div className="space-y-4">
            {!selected ? (
              <Card><CardContent className="p-8 text-sm text-slate-500">Select a candidate from queue.</CardContent></Card>
            ) : (
              <>
                {/* Scorecard */}
                <Card>
                  <CardHeader><CardTitle>Candidate Scorecard</CardTitle></CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-4">
                      <Metric label="BGV score" value={`${selected.score}%`} />
                      <Metric label="Overall" value={selected.overall_status} />
                      <Metric label="Employee ready" value={selected.employee_creation_ready ? "Yes" : "No"} good={selected.employee_creation_ready} />
                      <Metric label="Payroll ready" value={selected.payroll_activation_ready ? "Yes" : "No"} good={selected.payroll_activation_ready} />
                    </div>

                    <div>
                      <Label>Remarks / Waiver reason (required for Clear / Waive actions)</Label>
                      <Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Enter reason..." rows={2} className="mt-1" />
                    </div>

                    {/* Checks table */}
                    <div className="overflow-x-auto rounded-2xl border">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="p-3 text-left">Check</th>
                            <th className="p-3 text-left">Status</th>
                            <th className="p-3 text-left">Match</th>
                            <th className="p-3 text-left">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.checks.map((c) => (
                            <>
                              <tr key={c.id} className="border-t">
                                <td className="p-3 font-medium">{CHECK_LABELS[c.check_type] ?? c.check_type}</td>
                                <td className="p-3">
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_COLOR[c.status] ?? "bg-slate-100 text-slate-600"}`}>{c.status}</span>
                                </td>
                                <td className="p-3 text-xs text-slate-500">{c.match_score != null ? `${c.match_score}%` : "-"}</td>
                                <td className="p-3">
                                  <div className="flex flex-wrap gap-1">
                                    <Button size="sm" variant="outline" onClick={() => manualReview("verified", c.id)}>
                                      <CheckCircle2 className="mr-1 h-3 w-3 text-emerald-600" />Clear
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => waive(c.id)}>Waive</Button>
                                    <Button size="sm" variant="outline" onClick={() => openDispatchForm(c)} className="gap-1 border-orange-300 text-orange-700 hover:bg-orange-50">
                                      <Send className="h-3 w-3" />Vendor
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                              {/* API failure banner: prompt manual BGV dispatch */}
                              {(c.status === "failed" || c.status === "error") && (
                                <tr key={`${c.id}-banner`} className="bg-amber-50">
                                  <td colSpan={4} className="px-3 py-2">
                                    <div className="flex items-center justify-between gap-3 flex-wrap">
                                      <div className="flex items-center gap-2 text-amber-800 text-xs">
                                        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                                        <span><strong>API verification failed</strong> — dispatch to an external vendor for manual BGV on this check.</span>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="border-amber-400 text-amber-800 hover:bg-amber-100 text-xs"
                                        onClick={() => openDispatchForm(c)}
                                      >
                                        <Send className="h-3 w-3 mr-1" />Dispatch to Vendor
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Uploaded documents */}
                    <div>
                      <p className="mb-2 font-black text-slate-900">Uploaded Documents</p>
                      <div className="grid gap-2 md:grid-cols-2">
                        {selected.documents.map((d) => (
                          <div key={d.id} className="rounded-xl border bg-slate-50 p-3 text-sm">
                            <p className="font-bold">{d.doc_type}</p>
                            <p className="text-slate-600">{d.doc_name}</p>
                            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_COLOR[d.document_status] ?? "bg-slate-100 text-slate-600"}`}>{d.document_status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Dispatch form */}
                {showDispatchForm && (
                  <Card className="border-orange-200">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-orange-800">
                        <Send className="h-4 w-4" />
                        Dispatch to External Vendor — {CHECK_LABELS[dispatchCheckType] ?? dispatchCheckType}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
                        This check failed automatic API verification. Send candidate documents to an external vendor. Once vendor confirms, record the result below to update the BGV check.
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <Label>Vendor Name *</Label>
                          <Input value={dispatchForm.vendorName} onChange={(e) => setDispatchForm({ ...dispatchForm, vendorName: e.target.value })} placeholder="e.g. AuthBridge, FirstAdvantage, KPMG" />
                        </div>
                        <div>
                          <Label>Vendor Contact Email</Label>
                          <Input type="email" value={dispatchForm.vendorContactEmail} onChange={(e) => setDispatchForm({ ...dispatchForm, vendorContactEmail: e.target.value })} placeholder="ops@vendor.com" />
                        </div>
                        <div>
                          <Label>Vendor Contact Phone</Label>
                          <Input type="tel" value={dispatchForm.vendorContactPhone} onChange={(e) => setDispatchForm({ ...dispatchForm, vendorContactPhone: e.target.value })} placeholder="+91 XXXXXXXXXX" />
                        </div>
                      </div>
                      <div>
                        <Label>Dispatch Notes (documents sent, courier tracking, instructions)</Label>
                        <Textarea value={dispatchForm.dispatchNotes} onChange={(e) => setDispatchForm({ ...dispatchForm, dispatchNotes: e.target.value })} rows={3} placeholder="e.g. Sent Aadhaar copy + PAN copy via email on 21-Jun-2026. Courier AWB: 123456789." />
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={submitDispatch} disabled={dispatchSaving} className="bg-orange-600 hover:bg-orange-700 gap-2">
                          <Send className="h-4 w-4" />{dispatchSaving ? "Sending..." : "Confirm Dispatch"}
                        </Button>
                        <Button variant="outline" onClick={() => setShowDispatchForm(false)}>Cancel</Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Vendor dispatch history + result entry */}
                {dispatches.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2"><PackageCheck className="h-4 w-4" />Manual BGV Fallback — Vendor Dispatch History</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      {dispatches.map((d) => (
                        <div key={d.id} className="rounded-2xl border p-4 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-black text-slate-900">{d.vendor_name}</p>
                              <p className="text-xs text-slate-500">
                                {CHECK_LABELS[d.check_type] ?? d.check_type} · Sent {formatISTDate(d.sent_at)} by {d.sent_by_name ?? "HR"}
                              </p>
                              {d.dispatch_notes && <p className="mt-1 text-xs text-slate-600">{d.dispatch_notes}</p>}
                            </div>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${STATUS_COLOR[d.status] ?? "bg-slate-100 text-slate-600"}`}>{d.status}</span>
                          </div>

                          {d.vendor_result && (
                            <div className="rounded-xl bg-slate-50 p-3 text-sm space-y-1">
                              <p><span className="font-bold">Result:</span> <span className={`font-bold ${d.vendor_result === "verified" ? "text-emerald-700" : d.vendor_result === "not_verified" ? "text-red-700" : "text-amber-700"}`}>{d.vendor_result}</span></p>
                              {d.vendor_reference_no && <p><span className="font-bold">Ref:</span> {d.vendor_reference_no}</p>}
                              {d.vendor_remarks && <p><span className="font-bold">Remarks:</span> {d.vendor_remarks}</p>}
                              <p className="text-xs text-slate-500">
                                Received {d.result_received_at ? formatISTDate(d.result_received_at) : "-"} · BGV synced: {d.bgv_check_updated ? "Yes" : "No"}
                              </p>
                            </div>
                          )}

                          {/* Record result inline */}
                          {!d.vendor_result && d.status === "sent" && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => openResultForm(d)} className="gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                                {resultDispatchId === d.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                Record Vendor Result
                              </Button>

                              {resultDispatchId === d.id && (
                                <div className="mt-3 space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                                  <p className="text-sm font-black text-emerald-900">Record Result from {d.vendor_name}</p>
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div>
                                      <Label>Vendor Result *</Label>
                                      <select
                                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        value={resultForm.vendorResult}
                                        onChange={(e) => setResultForm({ ...resultForm, vendorResult: e.target.value as any })}
                                      >
                                        <option value="verified">Verified ✓</option>
                                        <option value="not_verified">Not Verified ✗</option>
                                        <option value="inconclusive">Inconclusive</option>
                                      </select>
                                    </div>
                                    <div>
                                      <Label>Vendor Reference No</Label>
                                      <Input value={resultForm.vendorReferenceNo} onChange={(e) => setResultForm({ ...resultForm, vendorReferenceNo: e.target.value })} placeholder="Case ID / Report No" />
                                    </div>
                                  </div>
                                  <div>
                                    <Label>Vendor Remarks</Label>
                                    <Textarea value={resultForm.vendorRemarks} onChange={(e) => setResultForm({ ...resultForm, vendorRemarks: e.target.value })} rows={2} placeholder="Paste vendor remarks or summary..." />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      id="syncCheck"
                                      checked={resultForm.updateBgvCheck}
                                      onChange={(e) => setResultForm({ ...resultForm, updateBgvCheck: e.target.checked })}
                                      className="h-4 w-4 rounded border-gray-300"
                                    />
                                    <label htmlFor="syncCheck" className="text-sm font-medium cursor-pointer">
                                      Sync result to BGV check (updates candidate readiness score)
                                    </label>
                                  </div>
                                  <div className="flex gap-2">
                                    <Button onClick={submitResult} disabled={resultSaving} className="gap-2">
                                      <PackageCheck className="h-4 w-4" />{resultSaving ? "Saving..." : "Save Vendor Result"}
                                    </Button>
                                    <Button variant="outline" onClick={() => setResultDispatchId("")}>Cancel</Button>
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-2xl border bg-slate-50 p-4">
      <p className="text-xs font-black uppercase text-slate-500">{label}</p>
      <p className={`mt-2 text-xl font-black capitalize ${good === true ? "text-emerald-700" : good === false ? "text-red-600" : "text-slate-950"}`}>{value}</p>
    </div>
  );
}
