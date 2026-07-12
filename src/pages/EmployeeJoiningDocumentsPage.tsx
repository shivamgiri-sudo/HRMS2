import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Copy, Download, Eye, FileText, Loader2, RefreshCw, Send, ShieldCheck, Upload, XCircle,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";

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
  publicTokenIssued: number;
  public_token_status: string | null;
  public_token_expires_at: string | null;
  verification_status: string | null;
  verification_remarks: string | null;
  linked_doc?: { doc_type: string; doc_name: string | null; file_url: string; verified: number } | null;
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

const STATUS_COLORS: Record<string, string> = {
  verified:                  "bg-emerald-50 text-emerald-700",
  completed:                 "bg-emerald-50 text-emerald-700",
  signed_verified:           "bg-emerald-50 text-emerald-700",
  esign_completed:           "bg-emerald-50 text-emerald-700",
  employee_confirmed:        "bg-emerald-50 text-emerald-700",
  needs_correction:          "bg-red-50 text-red-700",
  esign_failed:              "bg-red-50 text-red-700",
  pending_candidate_esign:   "bg-amber-50 text-amber-700",
  uploaded_pending_review:   "bg-blue-50 text-blue-700",
  esign_initiated:           "bg-blue-50 text-blue-700",
  linked_from_general_docs:  "bg-indigo-50 text-indigo-700",
  not_started:               "bg-slate-100 text-slate-500",
  pending:                   "bg-slate-100 text-slate-500",
};

function StatusChip({ value }: { value: string }) {
  const color = STATUS_COLORS[value] ?? "bg-slate-100 text-slate-500";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${color}`}>
      {statusText(value)}
    </span>
  );
}

function ErrorBanner({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1">
          <p className="font-semibold">{message}</p>
          {onRetry && (
            <Button type="button" variant="outline" size="sm" className="mt-3 min-h-[44px] bg-white" onClick={onRetry}>
              Retry
            </Button>
          )}
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
  const [auditOpen, setAuditOpen] = useState(false);

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

  const stats = useMemo(() => {
    const list = pack?.checklist ?? [];
    const completed = list.filter(i =>
      ["completed", "verified", "signed_verified", "esign_completed", "employee_confirmed"].includes(i.status)
    ).length;
    const correction = list.filter(i => i.verification_status === "needs_correction").length;
    const pending = list.length - completed - correction;
    return { total: list.length, completed, pending: Math.max(0, pending), correction };
  }, [pack]);

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
      values: current.values.map((v) => v.field_key === fieldKey ? { ...v, value_text: valueText } : v),
    } : current);
  };

  const saveManualFields = async () => {
    if (!selected || !review) return;
    setSavingFields(true);
    try {
      const updates = review.values.map((v) => ({
        field_key: v.field_key,
        value_text: v.value_text ?? "",
        reason: v.value_source === "SYSTEM" ? "HR fallback review" : v.hr_reason ?? "HR edit",
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
      const response = await hrmsApi.patch<{ data: Pack }>(`/api/employees/${employeeId}/joining-documents/checklist/${selected.id}/review`, { decision, remarks });
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
      setPreviewUrl(URL.createObjectURL(blob));
      setPreviewTitle(title);
    } catch (err: any) {
      setReviewError(err?.message || "Unable to preview this document.");
    }
  };

  const downloadFile = async (fileId: string | null, fileName: string) => {
    if (!fileId) return;
    try {
      const blob = await hrmsApi.getBlob(`/api/employees/${employeeId}/joining-documents/files/${fileId}/download`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || "document.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || "Unable to download the document.");
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

  const statTiles = [
    { label: "Total Documents",  value: stats.total,      Icon: FileText,      color: "text-slate-600",  bg: "bg-slate-50"  },
    { label: "Completed",         value: stats.completed,  Icon: CheckCircle2,  color: "text-emerald-600",bg: "bg-emerald-50"},
    { label: "Pending",           value: stats.pending,    Icon: Clock,         color: "text-amber-600",  bg: "bg-amber-50"  },
    { label: "Needs Correction",  value: stats.correction, Icon: XCircle,       color: "text-red-600",    bg: "bg-red-50"    },
  ];

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-5">

          {/* Back nav */}
          <Link
            to="/ats/onboarding-requests"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Onboarding Requests
          </Link>

          {/* Page header */}
          <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-500" />
            <div className="flex flex-wrap items-start justify-between gap-4 p-5 pt-6 sm:p-6 sm:pt-7">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Employee · Joining Pack</p>
                <h1 className="mt-1 text-2xl font-bold text-slate-900">
                  {pack?.employee.full_name || (loading ? "Loading…" : "Joining Documents")}
                </h1>
                <p className="mt-0.5 font-mono text-xs text-slate-400">{pack?.employee.employee_code || "—"}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-3xl font-black text-slate-900">{Math.round(progress)}%</span>
                <p className="text-xs capitalize text-slate-400">{statusText(pack?.employee.joining_document_status)}</p>
                <div className="h-2 w-48 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-500"
                    style={{ width: `${Math.max(4, progress)}%` }}
                  />
                </div>
              </div>
              <Button type="button" variant="outline" className="min-h-[44px] gap-2 self-start" onClick={() => void load()}>
                <RefreshCw className="h-4 w-4" /> Refresh
              </Button>
            </div>
          </div>

          <ErrorBanner message={error} onRetry={() => void load()} />

          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {statTiles.map(({ label, value, Icon, color, bg }) => (
              <div key={label} className="rounded-xl border bg-white p-4 shadow-sm">
                <div className={`mb-2 inline-flex rounded-lg p-2 ${bg}`}>
                  <Icon className={`h-4 w-4 ${color}`} />
                </div>
                <p className="text-2xl font-black text-slate-900">{value}</p>
                <p className="text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="flex h-64 items-center justify-center rounded-xl border bg-white shadow-sm">
              <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              {/* Checklist table + detail panel */}
              <div className={selected ? "grid gap-5 xl:grid-cols-[1fr,420px]" : ""}>

                {/* Checklist table */}
                <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
                  {(pack?.checklist ?? []).length === 0 ? (
                    <div className="px-6 py-16 text-center text-sm text-slate-400">
                      No documents in the joining pack yet.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="border-b bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3 text-left">#</th>
                          <th className="px-4 py-3 text-left">Document</th>
                          <th className="px-4 py-3 text-left">Owner</th>
                          <th className="px-4 py-3 text-left">Status</th>
                          <th className="px-4 py-3 text-left">Verification</th>
                          <th className="px-4 py-3 text-left">eSign</th>
                          <th className="px-4 py-3 text-left">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(pack?.checklist ?? []).map((item, i) => (
                          <tr
                            key={item.id}
                            className={`cursor-pointer transition-colors duration-150 ${
                              selected?.id === item.id ? "bg-blue-50" : "hover:bg-slate-50"
                            }`}
                            onClick={() => void openReview(item)}
                          >
                            <td className="px-4 py-3 text-xs text-slate-400">{i + 1}</td>
                            <td className="px-4 py-3">
                              <p className="font-semibold text-slate-900">{item.document_name}</p>
                              <p className="font-mono text-[10px] text-slate-400">{item.document_code}</p>
                              {item.mandatory === 1 && (
                                <span className="mt-1 inline-block rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-600">
                                  Mandatory
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs capitalize text-slate-600">{item.owner_type}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-1">
                                <StatusChip value={item.linked_doc && !item.latest_file_id ? "linked_from_general_docs" : item.status} />
                                {item.linked_doc && !item.latest_file_id && (
                                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 uppercase">Linked</span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3"><StatusChip value={item.verification_status || "pending"} /></td>
                            <td className="px-4 py-3"><StatusChip value={item.latest_esign_status || "not_started"} /></td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-0.5">
                                {item.linked_doc && !item.latest_file_id ? (
                                  <a
                                    href={item.linked_doc.file_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="View linked document"
                                    onClick={e => e.stopPropagation()}
                                    className="rounded-lg p-1.5 text-indigo-500 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </a>
                                ) : (
                                <button
                                  title="Preview document"
                                  aria-label="Preview document"
                                  disabled={!item.latest_file_id}
                                  onClick={e => { e.stopPropagation(); void previewFile(item.latest_file_id, item.document_name); }}
                                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                                >
                                  <Eye className="h-4 w-4" />
                                </button>
                                )}
                                <button
                                  title="Download document"
                                  aria-label="Download document"
                                  disabled={!item.latest_file_id}
                                  onClick={e => { e.stopPropagation(); void downloadFile(item.latest_file_id, `${item.document_name}.pdf`); }}
                                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                                >
                                  <Download className="h-4 w-4" />
                                </button>
                                <label
                                  title="Upload document"
                                  aria-label="Upload document"
                                  className="cursor-pointer rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                                >
                                  <Upload className="h-4 w-4" />
                                  <input
                                    type="file"
                                    className="hidden"
                                    onChange={e => { e.stopPropagation(); void uploadSupportFile(item, e.target.files?.[0] ?? null); }}
                                  />
                                </label>
                                <button
                                  title="Issue eSign link"
                                  aria-label="Issue eSign link"
                                  disabled={actionBusy === "esign"}
                                  onClick={e => { e.stopPropagation(); setSelected(item); void sendEsignLink(); }}
                                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-100 hover:text-blue-700 disabled:opacity-30"
                                >
                                  {actionBusy === "esign" && selected?.id === item.id
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <Send className="h-4 w-4" />}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Detail panel */}
                {selected && (
                  <div className="mt-5 overflow-hidden rounded-xl border bg-white shadow-sm xl:mt-0">
                    {/* Panel header */}
                    <div className="flex items-start justify-between border-b px-5 py-4">
                      <div className="min-w-0 flex-1 pr-3">
                        <p className="font-bold text-slate-900 leading-snug">{selected.document_name}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <StatusChip value={selected.status} />
                          {selected.mandatory === 1 && (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-600">Mandatory</span>
                          )}
                        </div>
                      </div>
                      <button
                        aria-label="Close panel"
                        onClick={() => { setSelected(null); setReview(null); setReviewError(null); }}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="space-y-4 p-5">
                      <ErrorBanner message={reviewError} />

                      {reviewLoading ? (
                        <div className="flex h-40 items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                        </div>
                      ) : review ? (
                        <>
                          {/* Draft actions */}
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              type="button" variant="outline"
                              className="min-h-[44px] gap-2 text-sm"
                              onClick={() => void generateDraft()}
                              disabled={actionBusy === "draft"}
                            >
                              {actionBusy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              Generate Draft
                            </Button>
                            <Button
                              type="button" variant="outline"
                              className="min-h-[44px] gap-2 text-sm"
                              onClick={() => void previewFile(review.latest_file?.id ?? selected.latest_file_id, selected.document_name)}
                              disabled={!review.latest_file && !selected.latest_file_id}
                            >
                              <Eye className="h-4 w-4" /> Open Draft
                            </Button>
                          </div>

                          {/* Field values */}
                          {review.values.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Field Values</p>
                              {review.values.map((v) => (
                                <div key={v.field_key} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
                                    <p className="text-xs font-semibold text-slate-800">{v.field_label}</p>
                                    {v.requires_confirmation === 1 && (
                                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-700">
                                        Employee review
                                      </span>
                                    )}
                                  </div>
                                  {v.value_text?.includes("\n") || v.field_key.includes("address") ? (
                                    <textarea
                                      rows={2}
                                      value={v.value_text || ""}
                                      onChange={e => updateField(v.field_key, e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-blue-500"
                                    />
                                  ) : (
                                    <input
                                      value={v.value_text || ""}
                                      onChange={e => updateField(v.field_key, e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-blue-500"
                                    />
                                  )}
                                  <p className="mt-1 text-[10px] uppercase text-slate-400">
                                    {v.value_source} · {v.fill_status}
                                  </p>
                                </div>
                              ))}
                              <Button
                                type="button" variant="outline"
                                className="min-h-[44px] w-full gap-2 text-sm"
                                onClick={() => void saveManualFields()}
                                disabled={savingFields}
                              >
                                {savingFields ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                                Save HR Fallback Values
                              </Button>
                            </div>
                          )}

                          {/* Remarks + decision */}
                          <div className="space-y-2">
                            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Verification Decision</p>
                            <textarea
                              rows={2}
                              value={remarks}
                              onChange={e => setRemarks(e.target.value)}
                              placeholder="Remarks or correction reason…"
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500"
                            />
                            <div className="grid grid-cols-3 gap-2">
                              <Button
                                type="button" variant="outline"
                                className="min-h-[44px] gap-1.5 text-sm"
                                onClick={() => void sendEsignLink()}
                                disabled={actionBusy === "esign"}
                              >
                                {actionBusy === "esign" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />}
                                Link
                              </Button>
                              <Button
                                type="button" variant="outline"
                                className="min-h-[44px] border-amber-300 text-amber-700 hover:bg-amber-50 text-sm"
                                onClick={() => void submitReview("needs_correction")}
                                disabled={actionBusy === "needs_correction"}
                              >
                                {actionBusy === "needs_correction" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Correction"}
                              </Button>
                              <Button
                                type="button"
                                className="min-h-[44px] gap-1.5 bg-emerald-600 text-sm text-white hover:bg-emerald-700"
                                onClick={() => void submitReview("verified")}
                                disabled={actionBusy === "verified"}
                              >
                                {actionBusy === "verified" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                Verify
                              </Button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
                          Select a checklist item to review field values and take action.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Audit trail */}
              <div className="rounded-xl border bg-white shadow-sm">
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center justify-between px-5 py-4"
                  onClick={() => setAuditOpen(o => !o)}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Activity className="h-4 w-4 text-slate-400" />
                    Audit Trail ({pack?.audit.length ?? 0} events)
                  </span>
                  {auditOpen
                    ? <ChevronDown className="h-4 w-4 text-slate-400" />
                    : <ChevronRight className="h-4 w-4 text-slate-400" />}
                </button>
                {auditOpen && (
                  <div className="divide-y divide-slate-100 border-t">
                    {(pack?.audit ?? []).length === 0 ? (
                      <p className="px-5 py-4 text-sm text-slate-400">No audit events yet.</p>
                    ) : (
                      (pack?.audit ?? []).map((entry, i) => (
                        <div key={i} className="flex gap-3 px-5 py-3">
                          <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                          <div>
                            <p className="text-sm font-semibold capitalize text-slate-800">{statusText(entry.action_type)}</p>
                            {entry.remarks && <p className="text-xs text-slate-500">{entry.remarks}</p>}
                            <p className="text-[11px] text-slate-400">
                              {entry.document_code ?? "—"} · {formatISTDate(entry.created_at)}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Preview modal */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/60 p-0 sm:p-6">
          <div className="flex h-full w-full flex-col rounded-none bg-white sm:rounded-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <p className="font-bold text-slate-900">{previewTitle}</p>
                <p className="text-xs text-slate-400">Secure in-app preview</p>
              </div>
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setPreviewUrl(null)}>
                Close
              </Button>
            </div>
            <div className="flex-1 bg-slate-100 p-2">
              <iframe src={previewUrl} title={previewTitle || "Preview"} className="h-full w-full rounded-xl bg-white" />
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
