import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

// ─── Types ───────────────────────────────────────────────────────────────────

type EsignStatus =
  | "created"
  | "candidate_esign_initiated"
  | "candidate_signed"
  | "company_sign_initiated"
  | "company_signed"
  | "finalized"
  | "manual_override_requested"
  | "manual_override_approved"
  | "manual_override_rejected";

interface AppointmentRequest {
  id: number;
  candidate_id: number;
  status: EsignStatus;
  esign_provider: string | null;
  esign_transaction_id: string | null;
  candidate_esign_url: string | null;
  company_sign_url: string | null;
  manual_override_reason: string | null;
  manual_override_by: string | null;
  manual_override_at: string | null;
}

interface AuditEvent {
  id: number;
  action_type: string;
  actor: string | null;
  actor_role: string | null;
  created_at: string;
  notes: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STEPS = [
  { key: "created", label: "Create" },
  { key: "candidate_signed", label: "Candidate E-Sign" },
  { key: "company_signed", label: "Company Sign" },
  { key: "finalized", label: "Finalized" },
] as const;

function statusToStep(status: EsignStatus): number {
  if (status === "created") return 0;
  if (
    status === "candidate_esign_initiated" ||
    status === "candidate_signed"
  )
    return 1;
  if (
    status === "company_sign_initiated" ||
    status === "company_signed"
  )
    return 2;
  if (status === "finalized") return 3;
  // manual override states — keep at whatever step was reached
  return 0;
}

const STATUS_BADGE: Record<EsignStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  created: { label: "Created", variant: "secondary" },
  candidate_esign_initiated: { label: "Candidate E-Sign Initiated", variant: "secondary" },
  candidate_signed: { label: "Candidate Signed", variant: "default" },
  company_sign_initiated: { label: "Company Sign Initiated", variant: "secondary" },
  company_signed: { label: "Company Signed", variant: "default" },
  finalized: { label: "Finalized", variant: "default" },
  manual_override_requested: { label: "Override Requested", variant: "outline" },
  manual_override_approved: { label: "Override Approved", variant: "default" },
  manual_override_rejected: { label: "Override Rejected", variant: "destructive" },
};

// ─── Skeleton ────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      <div className="h-8 w-48 bg-gray-200 rounded" />
      <div className="h-6 w-32 bg-gray-200 rounded" />
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 flex-1 bg-gray-200 rounded" />
        ))}
      </div>
      <div className="h-24 bg-gray-200 rounded" />
      <div className="h-32 bg-gray-200 rounded" />
    </div>
  );
}

// ─── Progress Stepper ────────────────────────────────────────────────────────

function ProgressStepper({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-0 w-full">
      {STEPS.map((step, idx) => {
        const done = idx < currentStep;
        const active = idx === currentStep;
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors",
                  done
                    ? "bg-green-600 border-green-600 text-white"
                    : active
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-white border-gray-300 text-gray-400",
                ].join(" ")}
              >
                {done ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  idx + 1
                )}
              </div>
              <span
                className={[
                  "text-xs font-medium whitespace-nowrap",
                  done ? "text-green-600" : active ? "text-blue-600" : "text-gray-400",
                ].join(" ")}
              >
                {step.label}
              </span>
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={[
                  "flex-1 h-0.5 mx-2 mb-5 transition-colors",
                  idx < currentStep ? "bg-green-500" : "bg-gray-200",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Audit Timeline ──────────────────────────────────────────────────────────

function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-2">No audit events recorded yet.</p>
    );
  }
  return (
    <ol className="relative border-l border-gray-200 ml-3 space-y-4">
      {events.map((ev) => (
        <li key={ev.id} className="ml-4">
          <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-blue-500 border-2 border-white" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-800">{ev.action_type}</span>
            {ev.actor && (
              <span className="text-xs text-gray-500">by {ev.actor}{ev.actor_role ? ` (${ev.actor_role})` : ""}</span>
            )}
          </div>
          {ev.notes && (
            <p className="text-xs text-gray-500 mt-0.5">{ev.notes}</p>
          )}
          <time className="text-xs text-gray-400">
            {formatIST(ev.created_at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

// ─── Toast notification ──────────────────────────────────────────────────────

interface Toast {
  id: number;
  type: "error" | "success";
  message: string;
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            "flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg text-sm font-medium",
            t.type === "error"
              ? "bg-red-50 text-red-800 border border-red-200"
              : "bg-green-50 text-green-800 border border-green-200",
          ].join(" ")}
        >
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0 leading-none"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function NativeAppointmentEsign() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const requestIdParam = searchParams.get("requestId");
  const candidateIdParam = searchParams.get("candidateId");

  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [request, setRequest] = useState<AppointmentRequest | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [resolvedRequestId, setResolvedRequestId] = useState<number | null>(
    requestIdParam ? Number(requestIdParam) : null
  );

  // Manual override form state
  const [overrideReason, setOverrideReason] = useState("");
  const [showOverrideInput, setShowOverrideInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  let toastCounter = 0;

  function pushToast(type: "error" | "success", message: string) {
    const id = ++toastCounter + Date.now();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // ── Fetch request detail ────────────────────────────────────────────────

  const fetchRequest = useCallback(
    async (rid: number) => {
      try {
        const res = await hrmsApi.get<{ data: AppointmentRequest }>(
          `/api/letters/appointment/${rid}`
        );
        setRequest(res.data);
      } catch (err) {
        pushToast("error", err instanceof Error ? err.message : "Failed to load appointment request.");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const fetchAudit = useCallback(async (rid: number) => {
    try {
      const res = await hrmsApi.get<{ data: AuditEvent[] }>(
        `/api/letters/appointment/${rid}/audit`
      );
      setAuditEvents(Array.isArray(res.data) ? res.data : []);
    } catch {
      // Audit is non-critical; silently ignore
    }
  }, []);

  const refreshAll = useCallback(
    async (rid: number) => {
      await Promise.all([fetchRequest(rid), fetchAudit(rid)]);
    },
    [fetchRequest, fetchAudit]
  );

  // ── Initial load ────────────────────────────────────────────────────────

  useEffect(() => {
    let active = true;

    async function init() {
      setLoading(true);
      try {
        if (requestIdParam) {
          const rid = Number(requestIdParam);
          setResolvedRequestId(rid);
          await refreshAll(rid);
        } else if (candidateIdParam) {
          // Create a new request for this candidate
          const created = await hrmsApi.post<{ data: AppointmentRequest }>(
            `/api/letters/appointment/${candidateIdParam}/create`
          );
          if (!active) return;
          const rid = created.data.id;
          setResolvedRequestId(rid);
          await refreshAll(rid);
        } else {
          pushToast("error", "No requestId or candidateId provided in URL.");
        }
      } catch (err) {
        if (!active) return;
        pushToast("error", err instanceof Error ? err.message : "Initialisation failed.");
      } finally {
        if (active) setLoading(false);
      }
    }

    init();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestIdParam, candidateIdParam]);

  // ── Action handler ──────────────────────────────────────────────────────

  async function handleAction(endpoint: string, body?: Record<string, string>) {
    if (!resolvedRequestId) return;
    setActing(true);
    try {
      await hrmsApi.post(`/api/letters/appointment/${resolvedRequestId}/${endpoint}`, body);
      await refreshAll(resolvedRequestId);
      pushToast("success", "Action completed successfully.");
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : "Action failed. Please try again.");
    } finally {
      setActing(false);
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────

  if (loading) return <LoadingSkeleton />;

  if (!request) {
    return (
      <div className="p-6 text-center text-gray-500">
        <p className="text-base">Could not load appointment e-sign request.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>
          Go Back
        </Button>
      </div>
    );
  }

  const status = request.status;
  const badgeInfo = STATUS_BADGE[status] ?? { label: status, variant: "secondary" as const };
  const currentStep = statusToStep(status);
  const isFinalized = status === "finalized";
  const docUrl = request.company_sign_url ?? request.candidate_esign_url;

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 rounded-md hover:bg-gray-100 transition-colors text-gray-600"
            aria-label="Go back"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-gray-900">Appointment Letter E-Sign</h1>
            <p className="text-xs text-gray-500 mt-0.5">Request #{request.id} · Candidate #{request.candidate_id}</p>
          </div>
          <Badge variant={badgeInfo.variant}>{badgeInfo.label}</Badge>
        </div>

        <Separator />

        {/* Progress stepper */}
        <Card>
          <CardContent className="pt-5 pb-4">
            <ProgressStepper currentStep={currentStep} />
          </CardContent>
        </Card>

        {/* Action buttons */}
        {!isFinalized && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Primary flow actions */}
              {status === "created" && (
                <Button
                  className="w-full"
                  disabled={acting}
                  onClick={() => handleAction("candidate-esign/initiate")}
                >
                  {acting ? "Processing…" : "Initiate Candidate E-Sign"}
                </Button>
              )}

              {status === "candidate_esign_initiated" && (
                <Button
                  className="w-full"
                  disabled={acting}
                  onClick={() => handleAction("candidate-esign/complete")}
                >
                  {acting ? "Processing…" : "Mark Candidate Signed"}
                </Button>
              )}

              {status === "candidate_signed" && (
                <Button
                  className="w-full"
                  disabled={acting}
                  onClick={() => handleAction("company-sign/initiate")}
                >
                  {acting ? "Processing…" : "Initiate Company Sign"}
                </Button>
              )}

              {status === "company_sign_initiated" && (
                <Button
                  className="w-full"
                  disabled={acting}
                  onClick={() => handleAction("company-sign/complete")}
                >
                  {acting ? "Processing…" : "Mark Company Signed"}
                </Button>
              )}

              {status === "company_signed" && (
                <Button
                  className="w-full"
                  disabled={acting}
                  onClick={() => handleAction("finalize")}
                >
                  {acting ? "Finalizing…" : "Finalize & Lock PDF"}
                </Button>
              )}

              {/* Manual override: request */}
              {status !== "manual_override_requested" &&
                status !== "manual_override_approved" && (
                  <div className="space-y-2 pt-1">
                    {!showOverrideInput ? (
                      <Button
                        variant="outline"
                        className="w-full text-amber-700 border-amber-300 hover:bg-amber-50"
                        onClick={() => setShowOverrideInput(true)}
                      >
                        Request Manual Override
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">
                          Override reason <span className="text-red-500">*</span>
                        </label>
                        <textarea
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                          rows={3}
                          placeholder="Describe why a manual override is required…"
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <Button
                            className="flex-1"
                            disabled={acting || !overrideReason.trim()}
                            onClick={async () => {
                              await handleAction("manual-override/request", {
                                reason: overrideReason.trim(),
                              });
                              setOverrideReason("");
                              setShowOverrideInput(false);
                            }}
                          >
                            {acting ? "Submitting…" : "Submit Override Request"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowOverrideInput(false);
                              setOverrideReason("");
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

              {/* Manual override: approve / reject (admin/hr) */}
              {status === "manual_override_requested" && (
                <div className="space-y-3 border border-amber-200 rounded-md p-3 bg-amber-50">
                  <div>
                    <p className="text-sm font-medium text-amber-800">Override Requested</p>
                    {request.manual_override_reason && (
                      <p className="text-sm text-amber-700 mt-1 italic">
                        "{request.manual_override_reason}"
                      </p>
                    )}
                    {request.manual_override_by && (
                      <p className="text-xs text-amber-600 mt-1">
                        Requested by: {request.manual_override_by}
                        {request.manual_override_at
                          ? ` · ${formatIST(request.manual_override_at)}`
                          : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                      disabled={acting}
                      onClick={() => handleAction("manual-override/approve")}
                    >
                      {acting ? "Processing…" : "Approve Override"}
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      disabled={acting || showRejectInput}
                      onClick={() => setShowRejectInput(true)}
                    >
                      Reject Override
                    </Button>
                  </div>
                  {showRejectInput && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">
                        Rejection reason <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                        rows={2}
                        placeholder="Reason for rejecting the override…"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          className="flex-1"
                          disabled={acting || !rejectReason.trim()}
                          onClick={async () => {
                            await handleAction("manual-override/reject", {
                              reason: rejectReason.trim(),
                            });
                            setRejectReason("");
                            setShowRejectInput(false);
                          }}
                        >
                          {acting ? "Rejecting…" : "Confirm Rejection"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowRejectInput(false);
                            setRejectReason("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Finalized notice */}
        {isFinalized && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-md bg-green-50 border border-green-200">
            <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm font-medium text-green-800">
              Appointment letter has been finalized and vaulted.
            </p>
          </div>
        )}

        {/* Document vault section */}
        {docUrl && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Document Vault</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {request.company_sign_url && (
                <div className="flex items-center justify-between py-2 px-3 rounded-md bg-gray-50 border border-gray-200">
                  <div>
                    <p className="text-sm font-medium text-gray-800">Company-Signed Document</p>
                    <p className="text-xs text-gray-500 truncate max-w-xs">{request.company_sign_url}</p>
                  </div>
                  <a
                    href={request.company_sign_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium flex-shrink-0 ml-3"
                  >
                    View
                  </a>
                </div>
              )}
              {request.candidate_esign_url && !request.company_sign_url && (
                <div className="flex items-center justify-between py-2 px-3 rounded-md bg-gray-50 border border-gray-200">
                  <div>
                    <p className="text-sm font-medium text-gray-800">Candidate E-Sign Document</p>
                    <p className="text-xs text-gray-500 truncate max-w-xs">{request.candidate_esign_url}</p>
                  </div>
                  <a
                    href={request.candidate_esign_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium flex-shrink-0 ml-3"
                  >
                    View
                  </a>
                </div>
              )}
              {request.esign_provider && (
                <p className="text-xs text-gray-400">
                  Provider: {request.esign_provider}
                  {request.esign_transaction_id ? ` · TXN: ${request.esign_transaction_id}` : ""}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Audit timeline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Audit Trail</CardTitle>
          </CardHeader>
          <CardContent>
            <AuditTimeline events={auditEvents} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
