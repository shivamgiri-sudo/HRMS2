import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  Loader,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type ExitRequest = {
  id: string;
  employee_id: string;
  reason: string;
  status: string;
  created_at: string;
  last_working_day: string | null;
  updated_at: string;
};

type RetentionOffer = {
  id: string;
  offer_type: string;
  offer_details: string;
  offered_by?: string;
  created_at: string;
  status: string;
  employee_response: string | null;
  response_remarks: string | null;
};

type AuditEntry = {
  id: string;
  action: string;
  performed_by?: string;
  performed_at: string;
  remarks?: string | null;
};

type ApiListResponse<T> = { success: boolean; data: T[] };

// ─── Status badge config ───────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  submitted: { label: "Submitted", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  accepted: { label: "Accepted", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  withdrawn: { label: "Withdrawn", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  clearance_pending: { label: "Clearance Pending", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  fnf_pending: { label: "F&F Pending", cls: "bg-red-50 text-red-700 border-red-200" },
  closed: { label: "Closed", cls: "bg-green-50 text-green-700 border-green-200" },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, cls: "bg-slate-100 text-slate-600 border-slate-200" };
}

function StatusBadge({ status }: { status: string }) {
  const cfg = getStatusConfig(status);
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return value;
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-slate-100 px-5 py-4">
        <span className="text-slate-500">{icon}</span>
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ─── Withdraw Confirmation Dialog ─────────────────────────────────────────────

function WithdrawDialog({
  onCancel,
  onConfirm,
  busy,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-50">
            <AlertTriangle size={20} className="text-amber-600" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-900">Withdraw Resignation</h3>
            <p className="mt-1 text-sm text-slate-500">
              Are you sure you want to withdraw your resignation? This will cancel your current exit request.
            </p>
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {busy && <Loader size={14} className="animate-spin" />}
            Confirm Withdraw
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Retention Offer Row ──────────────────────────────────────────────────────

function RetentionOfferRow({
  offer,
  exitId,
  onRefresh,
}: {
  offer: RetentionOffer;
  exitId: string;
  onRefresh: () => void;
}) {
  const [responding, setResponding] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [showRemarks, setShowRemarks] = useState(false);
  const [pendingResponse, setPendingResponse] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitResponse(response: "accept" | "reject") {
    setError(null);
    setResponding(true);
    try {
      await hrmsApi.patch(
        `/api/exit/resignation/${exitId}/retention-offer/${offer.id}/respond`,
        { employee_response: response, response_remarks: remarks }
      );
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit response");
    } finally {
      setResponding(false);
      setShowRemarks(false);
      setPendingResponse(null);
    }
  }

  function initiateResponse(resp: "accept" | "reject") {
    setPendingResponse(resp);
    setShowRemarks(true);
    setRemarks("");
    setError(null);
  }

  const isPending = offer.status === "pending" && offer.employee_response === null;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 capitalize">
            {offer.offer_type?.replace(/_/g, " ") ?? "Retention Offer"}
          </p>
          <p className="mt-0.5 text-sm text-slate-600">{offer.offer_details}</p>
          {offer.offered_by && (
            <p className="mt-1 text-xs text-slate-400">Offered by: {offer.offered_by}</p>
          )}
          <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(offer.created_at)}</p>
        </div>
        <div className="flex-shrink-0">
          {offer.employee_response ? (
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                offer.employee_response === "accept"
                  ? "border-green-200 bg-green-50 text-green-700"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {offer.employee_response === "accept" ? "Accepted" : "Rejected"}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-medium text-slate-500">
              Awaiting response
            </span>
          )}
        </div>
      </div>

      {offer.response_remarks && (
        <p className="text-xs text-slate-500 italic">Your remarks: {offer.response_remarks}</p>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
      )}

      {isPending && !showRemarks && (
        <div className="flex gap-2">
          <button
            onClick={() => initiateResponse("accept")}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
          >
            <CheckCircle2 size={13} /> Accept
          </button>
          <button
            onClick={() => initiateResponse("reject")}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            <X size={13} /> Reject
          </button>
        </div>
      )}

      {isPending && showRemarks && pendingResponse && (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-600">
            Remarks (optional)
          </label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            placeholder="Add any remarks..."
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => submitResponse(pendingResponse)}
              disabled={responding}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
                pendingResponse === "accept" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {responding && <Loader size={12} className="animate-spin" />}
              Confirm {pendingResponse === "accept" ? "Accept" : "Reject"}
            </button>
            <button
              onClick={() => setShowRemarks(false)}
              disabled={responding}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Audit Timeline ────────────────────────────────────────────────────────────

function AuditTimeline({ exitId }: { exitId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await hrmsApi.get<ApiListResponse<AuditEntry>>(
          `/api/exit/resignation/${exitId}/audit`
        );
        if (!cancelled) setEntries(res.data ?? []);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load audit trail");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [exitId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
        <Loader size={14} className="animate-spin" /> Loading audit trail…
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }

  if (!entries.length) {
    return <p className="text-sm text-slate-400">No audit entries found.</p>;
  }

  return (
    <ol className="space-y-0">
      {entries.map((entry, idx) => (
        <li key={entry.id ?? idx} className="flex gap-4">
          <div className="flex flex-col items-center">
            <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 border-slate-200 bg-white">
              <ChevronRight size={12} className="text-slate-400" />
            </div>
            {idx < entries.length - 1 && (
              <div className="w-px flex-1 bg-slate-200" />
            )}
          </div>
          <div className="pb-5 pt-0.5 min-w-0">
            <p className="text-sm font-medium text-slate-800 capitalize">
              {entry.action?.replace(/_/g, " ") ?? "Event"}
            </p>
            {entry.performed_by && (
              <p className="text-xs text-slate-500">by {entry.performed_by}</p>
            )}
            {entry.remarks && (
              <p className="mt-0.5 text-xs text-slate-500 italic">{entry.remarks}</p>
            )}
            <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(entry.performed_at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ─── View B — Active Resignation ──────────────────────────────────────────────

function ActiveResignation({
  request,
  onRefresh,
}: {
  request: ExitRequest;
  onRefresh: () => void;
}) {
  const [offers, setOffers] = useState<RetentionOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [offersError, setOffersError] = useState<string | null>(null);

  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const canWithdraw = request.status === "submitted";

  useEffect(() => {
    let cancelled = false;
    async function loadOffers() {
      setOffersLoading(true);
      setOffersError(null);
      try {
        const res = await hrmsApi.get<ApiListResponse<RetentionOffer>>(
          `/api/exit/resignation/${request.id}/retention-offers`
        );
        if (!cancelled) setOffers(res.data ?? []);
      } catch (err) {
        if (!cancelled)
          setOffersError(err instanceof Error ? err.message : "Failed to load retention offers");
      } finally {
        if (!cancelled) setOffersLoading(false);
      }
    }
    loadOffers();
    return () => { cancelled = true; };
  }, [request.id]);

  async function handleWithdraw() {
    setWithdrawBusy(true);
    setWithdrawError(null);
    try {
      await hrmsApi.post(`/api/exit/resignation/${request.id}/withdraw`);
      setShowWithdrawDialog(false);
      onRefresh();
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Failed to withdraw resignation");
      setWithdrawBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Request summary */}
      <SectionCard title="Resignation Details" icon={<FileText size={16} />}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</p>
            <div className="mt-1.5">
              <StatusBadge status={request.status} />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Last Working Day
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-800">
              <CalendarDays size={14} className="text-slate-400" />
              {formatDate(request.last_working_day)}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Submitted On
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-800">
              <Clock size={14} className="text-slate-400" />
              {formatDateTime(request.created_at)}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Last Updated
            </p>
            <p className="mt-1.5 text-sm text-slate-800">{formatDateTime(request.updated_at)}</p>
          </div>

          <div className="sm:col-span-2">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Reason</p>
            <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              {request.reason || "—"}
            </p>
          </div>
        </div>

        {withdrawError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{withdrawError}</p>
        )}

        {canWithdraw && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <button
              onClick={() => { setWithdrawError(null); setShowWithdrawDialog(true); }}
              className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
            >
              <RotateCcw size={15} />
              Withdraw Resignation
            </button>
          </div>
        )}
      </SectionCard>

      {/* Retention offers */}
      <SectionCard title="Retention Offers" icon={<CheckCircle2 size={16} />}>
        {offersLoading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-slate-400">
            <Loader size={14} className="animate-spin" /> Loading offers…
          </div>
        ) : offersError ? (
          <p className="text-sm text-red-500">{offersError}</p>
        ) : offers.length === 0 ? (
          <p className="text-sm text-slate-400">No retention offers at this time.</p>
        ) : (
          <div className="space-y-3">
            {offers.map((offer) => (
              <RetentionOfferRow
                key={offer.id}
                offer={offer}
                exitId={request.id}
                onRefresh={() => {
                  // Re-fetch offers after response
                  setOffersLoading(true);
                  hrmsApi
                    .get<ApiListResponse<RetentionOffer>>(
                      `/api/exit/resignation/${request.id}/retention-offers`
                    )
                    .then((res) => setOffers(res.data ?? []))
                    .catch((err) =>
                      setOffersError(
                        err instanceof Error ? err.message : "Failed to reload offers"
                      )
                    )
                    .finally(() => setOffersLoading(false));
                }}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* Audit timeline */}
      <SectionCard title="Activity Timeline" icon={<Clock size={16} />}>
        <AuditTimeline exitId={request.id} />
      </SectionCard>

      {/* Withdraw confirm dialog */}
      {showWithdrawDialog && (
        <WithdrawDialog
          onCancel={() => setShowWithdrawDialog(false)}
          onConfirm={handleWithdraw}
          busy={withdrawBusy}
        />
      )}
    </div>
  );
}

// ─── View A — Submit Resignation Form ────────────────────────────────────────

function ResignationForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [lastWorkingDay, setLastWorkingDay] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!lastWorkingDay) {
      setError("Please select your last working day.");
      return;
    }
    if (!reason.trim()) {
      setError("Please provide a reason for your resignation.");
      return;
    }

    setSubmitting(true);
    try {
      await hrmsApi.post("/api/exit/resignation", {
        reason: reason.trim(),
        last_working_day: lastWorkingDay,
      });
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit resignation");
    } finally {
      setSubmitting(false);
    }
  }

  // Minimum date: tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];

  return (
    <div className="space-y-5">
      {/* Warning card */}
      <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-amber-600" />
        <div>
          <p className="text-sm font-semibold text-amber-800">Please read before proceeding</p>
          <p className="mt-0.5 text-sm text-amber-700">
            This action cannot be undone after acceptance. Your resignation will be reviewed by your
            manager and HR. You may withdraw it only while it is in the <strong>Submitted</strong> state.
          </p>
        </div>
      </div>

      {/* Form */}
      <SectionCard title="Submit Resignation" icon={<Send size={16} />}>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="lwd">
              Last Working Day <span className="text-red-500">*</span>
            </label>
            <input
              id="lwd"
              type="date"
              min={minDate}
              value={lastWorkingDay}
              onChange={(e) => setLastWorkingDay(e.target.value)}
              className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="mt-1 text-xs text-slate-400">
              This is the date you propose as your last day of work.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="reason">
              Reason for Resignation <span className="text-red-500">*</span>
            </label>
            <textarea
              id="reason"
              rows={5}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Please provide your reason for resigning…"
              className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {error && (
            <div className="flex gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? (
                <>
                  <Loader size={14} className="animate-spin" /> Submitting…
                </>
              ) : (
                <>
                  <Send size={14} /> Submit Resignation
                </>
              )}
            </button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}

// ─── Page Root ────────────────────────────────────────────────────────────────

export default function NativeMyResignation() {
  const [requests, setRequests] = useState<ExitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchResignation() {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<ApiListResponse<ExitRequest>>(
        "/api/exit/resignation/my"
      );
      setRequests(res.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load resignation details");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchResignation();
  }, []);

  // Find the first non-withdrawn, active request if any
  const activeRequest =
    requests.find((r) => r.status !== "withdrawn") ?? requests[0] ?? null;

  const hasActiveResignation = activeRequest !== null;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-black tracking-tight text-slate-900">
              <FileText size={22} className="text-blue-600" />
              My Resignation
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              View and manage your resignation journey.
            </p>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-slate-100 bg-white py-16 shadow-sm">
            <Loader size={20} className="animate-spin text-blue-500" />
            <span className="text-sm text-slate-500">Loading your resignation details…</span>
          </div>
        ) : error ? (
          <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-semibold text-red-700">Unable to load data</p>
              <p className="mt-0.5 text-sm text-red-600">{error}</p>
              <button
                onClick={fetchResignation}
                className="mt-2 text-xs font-medium text-red-600 underline hover:text-red-800"
              >
                Try again
              </button>
            </div>
          </div>
        ) : hasActiveResignation ? (
          <ActiveResignation request={activeRequest!} onRefresh={fetchResignation} />
        ) : (
          <ResignationForm onSubmitted={fetchResignation} />
        )}
      </div>
    </DashboardLayout>
  );
}
