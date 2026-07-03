import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Copy, Eye, FilePenLine, Loader2, RefreshCw, Send, ShieldCheck, Upload } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";

type ChecklistItem = {
  id: string;
  document_code: string;
  document_name: string;
  status: string;
  fill_status?: string;
  owner_type: string;
  action_type: string;
  mandatory: number;
  latest_file_id: string | null;
  latest_file_name: string | null;
  latest_file_role: string | null;
  latest_file_mime: string | null;
  latest_esign_status: string | null;
  latest_esign_url: string | null;
  public_token: string | null;
  public_token_expires_at: string | null;
  verification_status: string | null;
  verification_remarks: string | null;
};

type Pack = {
  employee: {
    id: string;
    employee_code: string | null;
    full_name: string | null;
    joining_document_status: string | null;
    joining_document_completion_pct: number;
  };
  checklist: ChecklistItem[];
  permissions: { can_download: boolean; is_self: boolean };
  audit: Array<{ action_type: string; remarks: string | null; created_at: string; document_code: string | null }>;
};

type ReviewValue = {
  field_key: string;
  field_label: string;
  value_text: string | null;
  value_source: string;
  fill_status: string;
  requires_confirmation: number;
  employee_confirmed: number;
  hr_reason: string | null;
};

type ReviewState = {
  checklist: { checklist_id: string; document_code: string; document_name: string };
  values: ReviewValue[];
  latest_file: { id: string; original_filename: string; mime_type: string | null } | null;
};

function statusText(value?: string | null) {
  return String(value || "pending").replace(/_/g, " ");
}

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

export default function EmployeeJoiningDocumentsPage() {
  const { employeeId = "" } = useParams();
  const [pack, setPack] = useState<Pack | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ChecklistItem | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [savingFields, setSavingFields] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await hrmsApi.get<{ data: Pack }>(`/api/employees/${employeeId}/joining-documents`);
      setPack(response.data);
    } catch (err: any) {
      setError(err?.message || "Unable to load employee joining documents.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [employeeId]);

  useEffect(() => () => {
    if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const progress = useMemo(() => Number(pack?.employee.joining_document_completion_pct ?? 0), [pack]);

  const openReview = async (item: ChecklistItem) => {
    setSelected(item);
    setReviewLoading(true);
    setReviewError(null);
    try {
      const response = await hrmsApi.get<{ data: ReviewState }>(`/api/employees/${employeeId}/joining-documents/checklist/${item.id}/review`);
      setReview(response.data);
      setRemarks(item.verification_remarks || "");
    } catch (err: any) {
      setReviewError(err?.message || "Unable to load field review.");
      setReview(null);
    } finally {
      setReviewLoading(false);
    }
  };

  const updateField = (fieldKey: string, valueText: string) => {
    setReview((current) => current ? {
      ...current,
      values: current.values.map((value) => value.field_key === fieldKey ? { ...value, value_text: valueText } : value),
    } : current);
  };

  const saveManualFields = async () => {
    if (!selected || !review) return;
    setSavingFields(true);
    try {
      const updates = review.values.map((value) => ({
        field_key: value.field_key,
        value_text: value.value_text ?? "",
        reason: value.value_source === "SYSTEM" ? "HR fallback review" : value.hr_reason ?? "HR edit",
      }));
      const response = await hrmsApi.put<{ data: ReviewState }>(`/api/employees/${employeeId}/joining-documents/checklist/${selected.id}/review`, { updates });
      setReview(response.data);
      await load();
    } catch (err: any) {
      setReviewError(err?.message || "Unable to save manual field values.");
    } finally {
      setSavingFields(false);
    }
  };

  const generateDraft = async () => {
    if (!selected) return;
    setActionBusy("draft");
    try {
      const response = await hrmsApi.post<{ data: { review: ReviewState } }>(`/api/employees/${employeeId}/joining-documents/checklist/${selected.id}/generate-draft`);
      setReview(response.data.review);
      await load();
    } catch (err: any) {
      setReviewError(err?.message || "Unable to generate the draft.");
    } finally {
      setActionBusy(null);
    }
  };

  const sendEsignLink = async () => {
    if (!selected) return;
    setActionBusy("esign");
    try {
      const response = await hrmsApi.post<{ data: { sign_link: string; pack: Pack } }>(`/api/employees/${employeeId}/joining-documents/checklist/${selected.id}/esign-link`);
      setPack(response.data.pack);
      if (response.data.sign_link) {
        await navigator.clipboard.writeText(response.data.sign_link);
      }
    } catch (err: any) {
      setReviewError(err?.message || "Unable to create employee review/eSign link.");
    } finally {
      setActionBusy(null);
    }
  };

  const submitReview = async (decision: "verified" | "needs_correction") => {
    if (!selected) return;
    setActionBusy(decision);
    try {
      const response = await hrmsApi.patch<{ data: Pack }>(`/api/employees/${employeeId}/joining-documents/checklist/${selected.id}/review`, {
        decision,
        remarks,
      });
      setPack(response.data);
      setSelected(null);
      setReview(null);
    } catch (err: any) {
      setReviewError(err?.message || "Unable to save the verification decision.");
    } finally {
      setActionBusy(null);
    }
  };

  const previewFile = async (fileId: string | null, title: string) => {
    if (!fileId) return;
    try {
      const blob = await hrmsApi.getBlob(`/api/employees/${employeeId}/joining-documents/files/${fileId}/preview`);
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewTitle(title);
    } catch (err: any) {
      setReviewError(err?.message || "Unable to preview this document.");
    }
  };

  const uploadSupportFile = async (item: ChecklistItem, file: File | null) => {
    if (!file) return;
    setActionBusy(`upload-${item.id}`);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await hrmsApi.postForm(`/api/employees/${employeeId}/joining-documents/checklist/${item.id}/upload`, formData);
      await load();
      if (selected?.id === item.id) await openReview(item);
    } catch (err: any) {
      setError(err?.message || "Unable to upload the document.");
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">Employee Joining Pack</p>
                <h1 className="mt-2 text-2xl font-black text-slate-900">{pack?.employee.full_name || "Joining Documents"}</h1>
                <p className="mt-1 text-sm text-slate-500">{pack?.employee.employee_code || "Employee"} · secure drafts, field fill, review, eSign, and audit trail.</p>
              </div>
              <Button type="button" variant="outline" className="min-h-[44px] gap-2 self-start" onClick={() => void load()}>
                <RefreshCw className="h-4 w-4" /> Refresh pack
              </Button>
            </div>

            <div className="mt-5 rounded-3xl bg-slate-950 px-5 py-4 text-white">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Completion</p>
                  <p className="mt-2 text-3xl font-black">{Math.round(progress)}%</p>
                  <p className="mt-1 text-sm text-slate-300">{statusText(pack?.employee.joining_document_status)}</p>
                </div>
                <div className="w-full max-w-xl rounded-full bg-white/10 p-1">
                  <div className="h-3 rounded-full bg-gradient-to-r from-emerald-400 via-blue-400 to-cyan-300" style={{ width: `${Math.max(8, progress)}%` }} />
                </div>
              </div>
            </div>
          </div>

          <ErrorBanner message={error} onRetry={() => void load()} />

          {loading ? (
            <div className="flex h-64 items-center justify-center rounded-[28px] border bg-white">
              <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[1.1fr,0.9fr]">
              <div className="space-y-4">
                {(pack?.checklist || []).map((item) => (
                  <div key={item.id} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-black text-slate-900">{item.document_name}</h2>
                          {item.mandatory === 1 && <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-red-600">Mandatory</span>}
                          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-blue-700">{statusText(item.fill_status || item.status)}</span>
                        </div>
                        <p className="mt-2 text-sm text-slate-500">{item.document_code} · {statusText(item.action_type)} owned by {statusText(item.owner_type)}</p>
                        <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                          <p>Latest file: <span className="font-semibold text-slate-700">{item.latest_file_name || "Not generated yet"}</span></p>
                          <p>Verification: <span className="font-semibold text-slate-700">{statusText(item.verification_status || "pending")}</span></p>
                          <p>Employee link: <span className="font-semibold text-slate-700">{item.public_token ? "Issued" : "Not issued"}</span></p>
                          <p>eSign: <span className="font-semibold text-slate-700">{statusText(item.latest_esign_status || "not_started")}</span></p>
                        </div>
                      </div>
                      <div className="grid w-full gap-2 sm:grid-cols-2 lg:w-auto">
                        <Button type="button" variant="outline" className="min-h-[44px] gap-2" onClick={() => void openReview(item)}>
                          <FilePenLine className="h-4 w-4" /> Review fields
                        </Button>
                        <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                          <Upload className="h-4 w-4" /> Upload
                          <input type="file" className="hidden" onChange={(event) => void uploadSupportFile(item, event.target.files?.[0] ?? null)} />
                        </label>
                        <Button type="button" variant="outline" className="min-h-[44px] gap-2" onClick={() => void previewFile(item.latest_file_id, item.document_name)} disabled={!item.latest_file_id}>
                          <Eye className="h-4 w-4" /> Preview
                        </Button>
                        <Button type="button" className="min-h-[44px] gap-2 bg-blue-600 text-white hover:bg-blue-700" onClick={() => { setSelected(item); void sendEsignLink(); }} disabled={actionBusy === "esign"}>
                          {actionBusy === "esign" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Issue link
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white shadow-sm">
                <div className="border-b px-5 py-4">
                  <h2 className="text-lg font-black text-slate-900">{selected ? selected.document_name : "Field Review"}</h2>
                  <p className="mt-1 text-sm text-slate-500">Auto-fill values, HR fallback edits, employee confirmation readiness, and secure draft actions.</p>
                </div>
                <div className="space-y-4 p-5">
                  <ErrorBanner message={reviewError} />
                  {!selected ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
                      Select a checklist item to review field mappings, missing values, and secure draft actions.
                    </div>
                  ) : reviewLoading ? (
                    <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
                  ) : review ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Button type="button" variant="outline" className="min-h-[44px] gap-2" onClick={() => void generateDraft()} disabled={actionBusy === "draft"}>
                          {actionBusy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Generate draft
                        </Button>
                        <Button type="button" variant="outline" className="min-h-[44px] gap-2" onClick={() => void previewFile(review.latest_file?.id ?? selected.latest_file_id, selected.document_name)} disabled={!review.latest_file && !selected.latest_file_id}>
                          <Eye className="h-4 w-4" /> Open latest draft
                        </Button>
                      </div>

                      <div className="space-y-3">
                        {review.values.map((value) => (
                          <div key={value.field_key} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-black text-slate-900">{value.field_label}</p>
                                <p className="text-[11px] uppercase tracking-wide text-slate-400">{value.field_key} · {statusText(value.value_source)} · {statusText(value.fill_status)}</p>
                              </div>
                              {value.requires_confirmation === 1 && (
                                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-700">Employee review required</span>
                              )}
                            </div>
                            <textarea
                              value={value.value_text || ""}
                              onChange={(event) => updateField(value.field_key, event.target.value)}
                              className="mt-3 min-h-[88px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-0 focus:border-blue-500"
                            />
                          </div>
                        ))}
                      </div>

                      <Button type="button" variant="outline" className="min-h-[44px] gap-2" onClick={() => void saveManualFields()} disabled={savingFields}>
                        {savingFields ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Save HR fallback values
                      </Button>

                      <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Verification remarks or correction reason..." className="min-h-[84px] w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500" />

                      <div className="grid gap-2 sm:grid-cols-3">
                        <Button type="button" variant="outline" className="min-h-[44px] gap-2" onClick={() => void sendEsignLink()} disabled={actionBusy === "esign"}>
                          {actionBusy === "esign" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />} Copy review link
                        </Button>
                        <Button type="button" variant="outline" className="min-h-[44px] border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => void submitReview("needs_correction")} disabled={actionBusy === "needs_correction"}>
                          {actionBusy === "needs_correction" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Needs Correction"}
                        </Button>
                        <Button type="button" className="min-h-[44px] bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void submitReview("verified")} disabled={actionBusy === "verified"}>
                          {actionBusy === "verified" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Verify
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/60 p-0 sm:p-6">
          <div className="flex h-full w-full flex-col rounded-none bg-white sm:rounded-[28px]">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <p className="font-black text-slate-900">{previewTitle}</p>
                <p className="text-xs text-slate-400">Secure in-app preview</p>
              </div>
              <Button type="button" variant="outline" onClick={() => setPreviewUrl(null)}>Close</Button>
            </div>
            <div className="flex-1 bg-slate-100 p-2">
              <iframe src={previewUrl} title={previewTitle || "Preview"} className="h-full w-full rounded-2xl bg-white" />
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
