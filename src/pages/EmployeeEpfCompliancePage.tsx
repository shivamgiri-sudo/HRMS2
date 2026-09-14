import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, Copy, Download, Loader2, Plus, RefreshCw, Send, ShieldCheck } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";

type Nominee = {
  nominee_name: string;
  relationship: string;
  date_of_birth?: string | null;
  share_percentage: number;
  is_primary?: boolean;
};

type Pack = {
  profile: Record<string, any>;
  nominees: Nominee[];
  forms: Array<{ form_code: string; status: string; submitted_at: string | null; approved_at: string | null }>;
  validation_rows: Array<{ validation_code: string; severity: string; message: string; field_name: string | null }>;
  validation: { ready_for_submission: boolean; ecr_ready: boolean; missing_fields: string[]; inferred_status: string };
  consent_receipt: { consented_by_name: string; consented_at: string } | null;
  ecr: { ecr_status: string; blocked_reason: string | null } | null;
};

function ErrorBanner({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">{message}</p>
          {onRetry && <Button type="button" variant="outline" size="sm" className="mt-3 min-h-[44px] bg-white" onClick={onRetry}>Retry</Button>}
        </div>
      </div>
    </div>
  );
}

export default function EmployeeEpfCompliancePage() {
  const { employeeId = "" } = useParams();
  const [pack, setPack] = useState<Pack | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingNominees, setSavingNominees] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [reviewLink, setReviewLink] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState<Record<string, any>>({});
  const [nominees, setNominees] = useState<Nominee[]>([{ nominee_name: "", relationship: "", share_percentage: 100, is_primary: true }]);
  const [pfQueueStatus, setPfQueueStatus] = useState<Array<{ item_status: string; batch_number: string; epfo_uan_assigned: string | null; error_count: number }>>([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [response, pfRes] = await Promise.all([
        hrmsApi.get<{ data: Pack }>(`/api/employees/${employeeId}/epf-compliance`),
        hrmsApi.get<{ data: Array<{ item_status: string; batch_number: string; epfo_uan_assigned: string | null; error_count: number }> }>(`/api/payroll/pf/employee/${employeeId}`).catch(() => ({ data: [] })),
      ]);
      setPack(response.data);
      setProfileForm(response.data.profile || {});
      setNominees(response.data.nominees?.length ? response.data.nominees : [{ nominee_name: "", relationship: "", share_percentage: 100, is_primary: true }]);
      setPfQueueStatus(pfRes.data || []);
    } catch (err: any) {
      setError(err?.message || "Unable to load the EPF compliance pack.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [employeeId]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const response = await hrmsApi.put<{ data: { pack: Pack } }>(`/api/employees/${employeeId}/epf-compliance/profile`, profileForm);
      setPack(response.data.pack);
    } catch (err: any) {
      setError(err?.message || "Unable to save the EPF profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const saveNominees = async () => {
    setSavingNominees(true);
    try {
      const response = await hrmsApi.put<{ data: { pack: Pack } }>(`/api/employees/${employeeId}/epf-compliance/nominees`, { nominees });
      setPack(response.data.pack);
    } catch (err: any) {
      setError(err?.message || "Unable to save nominees.");
    } finally {
      setSavingNominees(false);
    }
  };

  const submitForReview = async () => {
    setSubmitting(true);
    try {
      const response = await hrmsApi.post<{ data: { reviewLink: { review_link: string }; pack: Pack } }>(`/api/employees/${employeeId}/epf-compliance/submit`);
      setPack(response.data.pack);
      setReviewLink(response.data.reviewLink.review_link);
    } catch (err: any) {
      setError(err?.message || "Unable to submit the EPF pack for employee review.");
    } finally {
      setSubmitting(false);
    }
  };

  const updateNominee = (index: number, key: keyof Nominee, value: string | number | boolean) => {
    setNominees((current) => current.map((nominee, nomineeIndex) => nomineeIndex === index ? { ...nominee, [key]: value } : nominee));
  };

  const downloadConsentReceipt = async () => {
    setDownloadingReceipt(true);
    try {
      const blob = await hrmsApi.getBlob(`/api/employees/${employeeId}/epf-compliance/consent-receipt`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `epf-consent-receipt-${employeeId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || "Unable to download the consent receipt.");
    } finally {
      setDownloadingReceipt(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">EPF Digital Compliance Pack</p>
                <h1 className="mt-2 text-2xl font-black text-slate-900">EPF, consent, nominee, and ECR readiness</h1>
                <p className="mt-1 text-sm text-slate-500">Draft the declaration, validate statutory rules, capture HR fallback inputs, and send the employee review link.</p>
              </div>
              <Button type="button" variant="outline" className="min-h-[44px] gap-2 self-start" onClick={() => void load()}>
                <RefreshCw className="h-4 w-4" /> Refresh pack
              </Button>
            </div>
          </div>

          <ErrorBanner message={error} onRetry={() => void load()} />

          {loading ? (
            <div className="flex h-64 items-center justify-center rounded-[28px] border bg-white"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-[24px] border bg-white p-5 shadow-sm">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-400">Submission</p>
                  <p className="mt-2 text-lg font-black text-slate-900">{String(pack?.profile?.status || "draft").replace(/_/g, " ")}</p>
                  <p className="mt-1 text-sm text-slate-500">{String(pack?.profile?.compliance_stage || "profile_pending").replace(/_/g, " ")}</p>
                </div>
                <div className="rounded-[24px] border bg-white p-5 shadow-sm">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-400">Validation</p>
                  <p className="mt-2 text-lg font-black text-slate-900">{pack?.validation?.ready_for_submission ? "Ready to submit" : "Needs attention"}</p>
                  <p className="mt-1 text-sm text-slate-500">{pack?.validation_rows?.length || 0} rule messages</p>
                </div>
                <div className="rounded-[24px] border bg-white p-5 shadow-sm">
                  <p className="text-xs font-black uppercase tracking-wide text-slate-400">ECR Readiness</p>
                  <p className="mt-2 text-lg font-black text-slate-900">{String(pack?.ecr?.ecr_status || "pending").replace(/_/g, " ")}</p>
                  <p className="mt-1 text-sm text-slate-500">{pack?.ecr?.blocked_reason || "No payroll block recorded."}</p>
                </div>
                {pfQueueStatus.length > 0 && (
                  <div className="rounded-[24px] border bg-white p-5 shadow-sm">
                    <p className="text-xs font-black uppercase tracking-wide text-slate-400">PF Creation Status</p>
                    <p className="mt-2 text-lg font-black text-slate-900">{pfQueueStatus[0].item_status.replace(/_/g, " ")}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Batch: {pfQueueStatus[0].batch_number}
                      {pfQueueStatus[0].epfo_uan_assigned && <> &middot; UAN: <span className="font-mono font-bold text-emerald-700">{pfQueueStatus[0].epfo_uan_assigned}</span></>}
                      {pfQueueStatus[0].error_count > 0 && <> &middot; <span className="text-red-600">{pfQueueStatus[0].error_count} errors</span></>}
                    </p>
                  </div>
                )}
              </div>

              <div className="grid gap-5 xl:grid-cols-[1.15fr,0.85fr]">
                <div className="space-y-5">
                  <div className="rounded-[28px] border bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-black text-slate-900">Profile</h2>
                        <p className="text-sm text-slate-500">Keep masked statutory values here and let payroll validate the rest.</p>
                      </div>
                      <Button type="button" className="min-h-[44px] bg-blue-600 text-white hover:bg-blue-700" onClick={() => void saveProfile()} disabled={savingProfile}>
                        {savingProfile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />} Save profile
                      </Button>
                    </div>
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      {[
                        ["employee_name", "Employee Name"],
                        ["father_or_spouse_name", "Father / Spouse Name"],
                        ["relationship_type", "Relationship Type"],
                        ["date_of_birth", "Date of Birth", "date"],
                        ["mobile_number", "Mobile Number"],
                        ["personal_email", "Personal Email"],
                        ["aadhaar_number", "Aadhaar (masked)"],
                        ["pan_number", "PAN (masked)"],
                        ["uan_number", "UAN"],
                        ["joining_date", "Date of Joining", "date"],
                        ["basic_wage", "Basic Wage"],
                        ["gross_monthly_wage", "Gross Monthly Wage"],
                      ].map(([key, label, type]) => (
                        <label key={key} className="block">
                          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
                          <input
                            type={type === "date" ? "date" : "text"}
                            value={profileForm[key] ?? ""}
                            onChange={(event) => setProfileForm((current) => ({ ...current, [key]: event.target.value }))}
                            className="min-h-[44px] w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:border-blue-500"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        ["previous_pf_member", "Previous PF Member"],
                        ["previous_eps_member", "Previous EPS Member"],
                        ["international_worker", "International Worker"],
                        ["excluded_employee", "Excluded Employee"],
                      ].map(([key, label]) => (
                        <label key={key} className="flex min-h-[44px] items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(profileForm[key])}
                            onChange={(event) => setProfileForm((current) => ({ ...current, [key]: event.target.checked }))}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[28px] border bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-black text-slate-900">Nominees</h2>
                        <p className="text-sm text-slate-500">Shares must total 100% before the EPF pack can move forward.</p>
                      </div>
                      <Button type="button" variant="outline" className="min-h-[44px] gap-2" onClick={() => setNominees((current) => [...current, { nominee_name: "", relationship: "", share_percentage: 0 }])}>
                        <Plus className="h-4 w-4" /> Add nominee
                      </Button>
                    </div>
                    <div className="mt-4 space-y-3">
                      {nominees.map((nominee, index) => (
                        <div key={`${nominee.nominee_name}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="grid gap-3 md:grid-cols-4">
                            <input value={nominee.nominee_name || ""} onChange={(event) => updateNominee(index, "nominee_name", event.target.value)} placeholder="Nominee name" className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm" />
                            <input value={nominee.relationship || ""} onChange={(event) => updateNominee(index, "relationship", event.target.value)} placeholder="Relationship" className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm" />
                            <input type="date" value={nominee.date_of_birth || ""} onChange={(event) => updateNominee(index, "date_of_birth", event.target.value)} className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm" />
                            <input type="number" value={nominee.share_percentage ?? 0} onChange={(event) => updateNominee(index, "share_percentage", Number(event.target.value))} placeholder="Share %" className="min-h-[44px] rounded-xl border border-slate-200 px-3 text-sm" />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex justify-end">
                      <Button type="button" className="min-h-[44px] bg-slate-900 text-white hover:bg-slate-800" onClick={() => void saveNominees()} disabled={savingNominees}>
                        {savingNominees ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />} Save nominees
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-[28px] border bg-white p-5 shadow-sm">
                    <h2 className="text-lg font-black text-slate-900">Validation Feed</h2>
                    <div className="mt-4 space-y-3">
                      {(pack?.validation_rows || []).length ? pack!.validation_rows.map((row) => (
                        <div key={`${row.validation_code}-${row.field_name || "general"}`} className={`rounded-2xl border px-4 py-3 text-sm ${row.severity === "error" ? "border-red-200 bg-red-50 text-red-700" : row.severity === "warning" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-blue-200 bg-blue-50 text-blue-700"}`}>
                          <p className="font-black">{row.validation_code.replace(/_/g, " ")}</p>
                          <p className="mt-1">{row.message}</p>
                        </div>
                      )) : <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">No blocking validation issues right now.</div>}
                    </div>
                  </div>

                  <div className="rounded-[28px] border bg-white p-5 shadow-sm">
                    <h2 className="text-lg font-black text-slate-900">Generated Form Pack</h2>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {(pack?.forms || []).map((form) => (
                        <div key={form.form_code} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <p className="text-xs font-black uppercase tracking-wide text-slate-400">{form.form_code.replace(/_/g, " ")}</p>
                          <p className="mt-2 text-sm font-semibold text-slate-900">{String(form.status || "draft").replace(/_/g, " ")}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {form.approved_at ? `Approved ${new Date(form.approved_at).toLocaleString("en-IN")}` : form.submitted_at ? `Submitted ${new Date(form.submitted_at).toLocaleString("en-IN")}` : "Draft payload prepared"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[28px] border bg-white p-5 shadow-sm">
                    <h2 className="text-lg font-black text-slate-900">Employee Review</h2>
                    <p className="mt-2 text-sm text-slate-500">The employee must review HR-entered or system-filled values before signing.</p>
                    {reviewLink ? (
                      <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
                        <p className="font-semibold break-all">{reviewLink}</p>
                        <Button type="button" variant="outline" className="mt-3 min-h-[44px] gap-2 bg-white" onClick={() => void navigator.clipboard.writeText(reviewLink)}>
                          <Copy className="h-4 w-4" /> Copy link
                        </Button>
                      </div>
                    ) : (
                      <Button type="button" className="mt-4 min-h-[44px] w-full bg-blue-600 text-white hover:bg-blue-700" onClick={() => void submitForReview()} disabled={submitting}>
                        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Submit for employee review
                      </Button>
                    )}
                    {pack?.consent_receipt && (
                      <div className="mt-4 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                        <p>Last consent by {pack.consent_receipt.consented_by_name || "Employee"} on {new Date(pack.consent_receipt.consented_at).toLocaleString("en-IN")}.</p>
                        <Button type="button" variant="outline" className="min-h-[44px] gap-2 bg-white" onClick={() => void downloadConsentReceipt()} disabled={downloadingReceipt}>
                          {downloadingReceipt ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download consent receipt
                        </Button>
                      </div>
                    )}
                    {pack?.profile?.retention_locked_at && (
                      <p className="mt-4 text-sm text-slate-500">Statutory retention lock active since {new Date(pack.profile.retention_locked_at).toLocaleString("en-IN")}.</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
