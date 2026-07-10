import { useState, useCallback } from "react";
import {
  AlertTriangle, CheckCircle2, Clock, ClipboardList,
  Loader, RefreshCcw, ThumbsUp, ThumbsDown, X,
  Settings2, User, Calendar, Tag, Inbox,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";
import { useIsAdminOrHR } from "@/hooks/useUserRole";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────

interface WorkflowDefinition {
  id: string | number;
  code: string;
  name?: string;
  description?: string;
  steps?: WorkflowStep[] | number;
  config?: Record<string, unknown>;
  is_active?: boolean;
  active?: boolean;
  created_at?: string;
}

interface WorkflowStep {
  step: number;
  role?: string;
  action?: string;
  [key: string]: unknown;
}

interface ApprovalRequest {
  id: string;
  entity_type?: string;
  entity_id?: string;
  summary?: string;
  requested_by?: string;
  requested_by_name?: string;
  status?: string;
  created_at?: string;
  workflow_code?: string;
  remarks?: string;
}

type ActionType = "approved" | "rejected" | "withdrawn";

interface ActForm {
  action: ActionType;
  remarks: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusBadge(status: string | undefined) {
  const s = status ?? "pending";
  const map: Record<string, string> = {
    pending:  "bg-amber-50 text-amber-700 border-amber-200",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rejected: "bg-rose-50 text-rose-700 border-rose-200",
    withdrawn:"bg-slate-100 text-slate-600 border-slate-200",
  };
  const cls = map[s] ?? "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${cls}`}>
      {s}
    </span>
  );
}

function entityTypePill(type: string | undefined) {
  return (
    <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 capitalize">
      {(type ?? "request").replace(/_/g, " ")}
    </span>
  );
}

function stepsLabel(steps: WorkflowStep[] | number | undefined) {
  if (typeof steps === "number") return `${steps} steps`;
  if (Array.isArray(steps)) return `${steps.length} steps`;
  return "–";
}

// ── Pending Approvals (inbox) ────────────────────────────────────────────────

interface ActModalProps {
  request: ApprovalRequest;
  onClose: () => void;
  onSubmit: (id: string, form: ActForm) => Promise<void>;
  defaultAction: ActionType;
}

function ActModal({ request, onClose, onSubmit, defaultAction }: ActModalProps) {
  const [form, setForm] = useState<ActForm>({ action: defaultAction, remarks: "" });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const handleSubmit = async () => {
    setErr("");
    setSubmitting(true);
    try {
      await onSubmit(request.id, form);
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Action failed");
    } finally {
      setSubmitting(false);
    }
  };

  const isApprove = form.action === "approved";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6">
          <h2 className="text-lg font-black text-slate-950">
            {isApprove ? "Approve" : "Reject"} Request
          </h2>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-6">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-700">{request.summary ?? "Approval request"}</p>
            {request.entity_type && (
              <div className="mt-1">{entityTypePill(request.entity_type)}</div>
            )}
            {request.requested_by_name && (
              <p className="mt-2 text-xs text-slate-400">
                Requested by {request.requested_by_name} · {formatISTDate(request.created_at)}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            {(["approved", "rejected"] as ActionType[]).map((a) => (
              <button
                key={a}
                onClick={() => setForm((f) => ({ ...f, action: a }))}
                className={`flex-1 cursor-pointer rounded-2xl border py-2 text-sm font-bold capitalize transition-colors ${
                  form.action === a
                    ? a === "approved"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-rose-300 bg-rose-50 text-rose-700"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {a}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Remarks</label>
            <textarea
              value={form.remarks}
              onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              placeholder="Add remarks (optional)…"
              rows={3}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>

          {err && (
            <p className="text-xs font-semibold text-rose-600">{err}</p>
          )}
        </div>
        <div className="flex gap-3 border-t p-6">
          <button
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={`flex-1 cursor-pointer rounded-2xl py-3 text-sm font-bold text-white transition-colors disabled:opacity-50 ${
              form.action === "approved"
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-rose-600 hover:bg-rose-700"
            }`}
          >
            {submitting ? "Submitting…" : `Confirm ${form.action}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Pending Inbox tab ────────────────────────────────────────────────────────

function PendingInbox() {
  const qc = useQueryClient();
  const [actModal, setActModal] = useState<{ request: ApprovalRequest; defaultAction: ActionType } | null>(null);
  const [message, setMessage] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["workflow-pending"],
    queryFn: () =>
      hrmsApi.get<{ data: ApprovalRequest[] } | ApprovalRequest[]>("/api/workflow/requests/pending"),
    staleTime: 30_000,
  });

  const requests: ApprovalRequest[] = Array.isArray(data)
    ? data
    : (data as { data: ApprovalRequest[] })?.data ?? [];

  const actMutation = useMutation({
    mutationFn: ({ id, form }: { id: string; form: ActForm }) =>
      hrmsApi.post(`/api/workflow/requests/${id}/act`, {
        action: form.action,
        remarks: form.remarks || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workflow-pending"] });
      setMessage("Action submitted successfully.");
    },
  });

  const handleAct = async (id: string, form: ActForm) => {
    await actMutation.mutateAsync({ id, form });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {requests.length} pending approval{requests.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={() => { void refetch(); }}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {message && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {message}
          <button onClick={() => setMessage("")} className="ml-auto cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error instanceof Error ? error.message : "Failed to load pending approvals"}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border bg-white py-20 shadow-sm text-slate-400">
          <Inbox className="mb-4 h-12 w-12 opacity-20" />
          <p className="font-semibold">No pending approvals</p>
          <p className="text-sm mt-1">You're all caught up!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <div
              key={req.id}
              className="rounded-3xl border bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex flex-wrap items-start gap-3 justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {entityTypePill(req.entity_type)}
                    {statusBadge(req.status)}
                    {req.workflow_code && (
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-mono text-slate-500">
                        {req.workflow_code}
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-slate-900 truncate">
                    {req.summary ?? "Approval request"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                    {req.requested_by_name && (
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {req.requested_by_name}
                      </span>
                    )}
                    {req.created_at && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatISTDate(req.created_at)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setActModal({ request: req, defaultAction: "rejected" })}
                    className="inline-flex items-center gap-1.5 cursor-pointer rounded-xl border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 transition-colors"
                  >
                    <ThumbsDown className="h-3.5 w-3.5" />
                    Reject
                  </button>
                  <button
                    onClick={() => setActModal({ request: req, defaultAction: "approved" })}
                    className="inline-flex items-center gap-1.5 cursor-pointer rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
                  >
                    <ThumbsUp className="h-3.5 w-3.5" />
                    Approve
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {actModal && (
        <ActModal
          request={actModal.request}
          defaultAction={actModal.defaultAction}
          onClose={() => setActModal(null)}
          onSubmit={handleAct}
        />
      )}
    </div>
  );
}

// ── Workflow Definitions tab ─────────────────────────────────────────────────

function WorkflowDefinitions() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["workflow-definitions"],
    queryFn: () =>
      hrmsApi.get<{ data: WorkflowDefinition[] } | WorkflowDefinition[]>("/api/workflow"),
    staleTime: 60_000,
  });

  const definitions: WorkflowDefinition[] = Array.isArray(data)
    ? data
    : (data as { data: WorkflowDefinition[] })?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{definitions.length} workflow definitions</p>
        <button
          onClick={() => { void refetch(); }}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error instanceof Error ? error.message : "Failed to load workflows"}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : definitions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border bg-white py-20 shadow-sm text-slate-400">
          <Settings2 className="mb-4 h-12 w-12 opacity-20" />
          <p className="font-semibold">No workflow definitions found.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  {["Code", "Name", "Steps", "Status", "Created"].map((h) => (
                    <th key={h} className="p-4 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {definitions.map((wf) => (
                  <tr key={wf.id} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-4">
                      <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-mono font-bold text-blue-700">
                        {wf.code}
                      </span>
                    </td>
                    <td className="p-4 font-semibold text-slate-900">{wf.name ?? "–"}</td>
                    <td className="p-4">
                      <span className="inline-flex items-center gap-1 text-sm text-slate-600">
                        <ClipboardList className="h-4 w-4 text-slate-400" />
                        {stepsLabel(wf.steps)}
                      </span>
                    </td>
                    <td className="p-4">
                      {wf.is_active !== false && wf.active !== false ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                          <Clock className="h-3 w-3" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="p-4 font-mono text-xs text-slate-400">
                      {wf.created_at ? formatISTDate(wf.created_at) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

type MainTab = "inbox" | "definitions";

export default function NativeWorkflowAdmin() {
  const { isAdminOrHR, roles } = useIsAdminOrHR();
  const hasApproverAccess = isAdminOrHR || roles.includes("manager") || roles.includes("tl");

  const [activeTab, setActiveTab] = useState<MainTab>(hasApproverAccess ? "inbox" : "definitions");

  const tabs: { key: MainTab; label: string; icon: React.ReactNode }[] = [
    ...(hasApproverAccess
      ? [{ key: "inbox" as MainTab, label: "Pending Approvals", icon: <Inbox className="h-4 w-4" /> }]
      : []),
    ...(isAdminOrHR
      ? [{ key: "definitions" as MainTab, label: "Workflow Definitions", icon: <Settings2 className="h-4 w-4" /> }]
      : []),
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">HR Operations</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Workflow & Approvals</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Manage approval requests, review pending items, and configure workflow definitions.
          </p>
        </div>

        {/* Role indicator */}
        {hasApproverAccess && (
          <div className="flex flex-wrap gap-2">
            {[...roles].filter((r) => ["admin", "hr", "manager", "tl"].includes(r)).map((r) => (
              <span
                key={r}
                className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 border border-violet-200 px-3 py-1 text-xs font-bold text-violet-700 capitalize"
              >
                <Tag className="h-3 w-3" />
                {r}
              </span>
            ))}
          </div>
        )}

        {tabs.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border bg-white py-24 shadow-sm text-slate-400">
            <Settings2 className="mb-4 h-14 w-14 opacity-20" />
            <p className="text-lg font-semibold">No workflow access</p>
            <p className="text-sm mt-1">Contact your administrator to get access.</p>
          </div>
        ) : (
          <>
            {/* Tabs */}
            {tabs.length > 1 && (
              <div className="flex gap-2 rounded-2xl border bg-slate-50 p-1.5 w-fit">
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors cursor-pointer ${
                      activeTab === tab.key
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            {activeTab === "inbox" && <PendingInbox />}
            {activeTab === "definitions" && <WorkflowDefinitions />}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
