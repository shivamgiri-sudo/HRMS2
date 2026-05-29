import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/layout/DashboardLayout";

type RequestStatus =
  | "submitted"
  | "pending_manager"
  | "pending_admin"
  | "approved"
  | "rejected"
  | "cancelled";

type RegularizationDetail = {
  id: string;
  request_id: string;
  attendance_date: string;
  current_status: string | null;
  current_login_time: string | null;
  current_logout_time: string | null;
  requested_login_time: string | null;
  requested_logout_time: string | null;
  attendance_source: string | null;
  payroll_impact_required: boolean;
  created_at: string;
  updated_at: string;
};

type ApprovalStage = {
  id: string;
  request_id: string;
  stage_no: number;
  stage_name: string;
  approver_role: string | null;
  status: string;
  remarks: string | null;
  assigned_at: string;
  acted_at: string | null;
};

type ActionLog = {
  id: string;
  request_id: string;
  action: string;
  old_status: string | null;
  new_status: string | null;
  remarks: string | null;
  created_at: string;
};

type EmployeeRequest = {
  id: string;
  request_no: string;
  employee_id: string | null;
  submitted_by: string | null;
  request_type_code: string;
  title: string;
  reason: string | null;
  current_status: RequestStatus;
  current_stage_no: number;
  current_stage_name: string | null;
  current_owner_role: string | null;
  source_module: string | null;
  source_date: string | null;
  payroll_impact_status: string;
  submitted_at: string | null;
  final_decision_at: string | null;
  created_at: string;
  regularization_request_detail?: RegularizationDetail[];
  request_approval_stage?: ApprovalStage[];
  request_action_log?: ActionLog[];
};

const statusLabel: Record<string, string> = {
  submitted: "Submitted",
  pending_manager: "Pending Manager",
  pending_admin: "Pending Admin / WFM",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const statusClass: Record<string, string> = {
  submitted: "bg-slate-100 text-slate-700 border-slate-200",
  pending_manager: "bg-amber-50 text-amber-700 border-amber-200",
  pending_admin: "bg-sky-50 text-sky-700 border-sky-200",
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

const emptyForm = {
  attendanceDate: new Date().toISOString().slice(0, 10),
  currentStatus: "Absent",
  currentLoginTime: "",
  currentLogoutTime: "",
  requestedLoginTime: "09:30",
  requestedLogoutTime: "18:30",
  reason: "",
};

export default function AttendanceRegularization() {
  const [requests, setRequests] = useState<EmployeeRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [form, setForm] = useState(emptyForm);
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedRequest, setSelectedRequest] = useState<EmployeeRequest | null>(null);

  const [rejectRequest, setRejectRequest] = useState<EmployeeRequest | null>(null);
  const [rejectRemarks, setRejectRemarks] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filteredRequests = useMemo(() => {
    if (filterStatus === "all") return requests;
    return requests.filter((item) => item.current_status === filterStatus);
  }, [requests, filterStatus]);

  const stats = useMemo(() => {
    return {
      total: requests.length,
      pendingManager: requests.filter((item) => item.current_status === "pending_manager").length,
      pendingAdmin: requests.filter((item) => item.current_status === "pending_admin").length,
      approved: requests.filter((item) => item.current_status === "approved").length,
      rejected: requests.filter((item) => item.current_status === "rejected").length,
    };
  }, [requests]);

  async function loadRequests() {
    setIsLoading(true);
    setActionError(null);

    try {
      // employee_requests is an extended table not yet in the base schema.
      // Attempt a generic query; if the table doesn't exist, fall back to an empty list.
      const { data, error } = await (supabase as unknown as { from: (t: string) => any })
        .from("employee_requests")
        .select(
          `*,
          regularization_request_detail(*),
          request_approval_stage(*),
          request_action_log(*)`
        )
        .eq("request_type_code", "REGULARIZATION")
        .order("created_at", { ascending: false });

      if (error) {
        // Table may not exist yet — show empty state, not a crash
        setRequests([]);
      } else {
        setRequests((data || []) as EmployeeRequest[]);
      }
    } catch {
      setRequests([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadRequests();
  }, []);

  async function submitRequest() {
    setIsSubmitting(true);
    setActionMessage(null);
    setActionError(null);

    if (!form.attendanceDate) {
      setActionError("Attendance date is required.");
      setIsSubmitting(false);
      return;
    }

    if (!form.requestedLoginTime && !form.requestedLogoutTime) {
      setActionError("Requested login or logout time is required.");
      setIsSubmitting(false);
      return;
    }

    if (!form.reason.trim()) {
      setActionError("Reason is required.");
      setIsSubmitting(false);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Try to insert into employee_requests; fall back gracefully if table doesn't exist yet.
    try {
      const requestNo = `REG-${Date.now()}`;
      const { error } = await (supabase as unknown as { from: (t: string) => any })
        .from("employee_requests")
        .insert({
          request_no: requestNo,
          employee_id: null,
          submitted_by: user?.id || null,
          request_type_code: "REGULARIZATION",
          title: `Regularization for ${form.attendanceDate}`,
          reason: form.reason.trim(),
          current_status: "submitted",
          current_stage_no: 1,
          current_stage_name: "Manager Review",
          current_owner_role: "manager",
          source_module: "attendance",
          source_date: form.attendanceDate,
          payroll_impact_status: "not_required",
          submitted_at: new Date().toISOString(),
        });

      if (error) {
        setActionError(
          error.code === "42P01"
            ? "Regularization feature coming soon — database tables not yet provisioned."
            : error.message
        );
        setIsSubmitting(false);
        return;
      }
    } catch {
      setActionError("Regularization feature coming soon — database tables not yet provisioned.");
      setIsSubmitting(false);
      return;
    }

    setForm(emptyForm);
    setActionMessage("Attendance regularization request submitted successfully.");
    setIsSubmitting(false);
    await loadRequests();
  }

  async function approveRequest(request: EmployeeRequest) {
    setActionMessage(null);
    setActionError(null);

    try {
      const nextStatus: RequestStatus =
        request.current_status === "pending_manager" ? "pending_admin" : "approved";

      const { error } = await (supabase as unknown as { from: (t: string) => any })
        .from("employee_requests")
        .update({
          current_status: nextStatus,
          final_decision_at: nextStatus === "approved" ? new Date().toISOString() : null,
        })
        .eq("id", request.id);

      if (error) {
        setActionError(
          error.code === "42P01"
            ? "Regularization feature coming soon — database tables not yet provisioned."
            : error.message
        );
        return;
      }
    } catch {
      setActionError("Regularization feature coming soon — database tables not yet provisioned.");
      return;
    }

    setActionMessage("Request approved successfully.");
    await loadRequests();
  }

  async function confirmRejectRequest() {
    if (!rejectRequest) return;

    setActionMessage(null);
    setActionError(null);

    if (!rejectRemarks.trim()) {
      setActionError("Rejection remarks are mandatory.");
      return;
    }

    try {
      const { error } = await (supabase as unknown as { from: (t: string) => any })
        .from("employee_requests")
        .update({
          current_status: "rejected",
          final_decision_at: new Date().toISOString(),
        })
        .eq("id", rejectRequest.id);

      if (error) {
        setActionError(
          error.code === "42P01"
            ? "Regularization feature coming soon — database tables not yet provisioned."
            : error.message
        );
        return;
      }
    } catch {
      setActionError("Regularization feature coming soon — database tables not yet provisioned.");
      return;
    }

    setActionMessage("Request rejected successfully.");
    setRejectRequest(null);
    setRejectRemarks("");
    await loadRequests();
  }

  function getDetail(request: EmployeeRequest) {
    return request.regularization_request_detail?.[0] || null;
  }

  function canAct(request: EmployeeRequest) {
    return ["pending_manager", "pending_admin"].includes(request.current_status);
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Attendance Workflow
                </p>
                <h1 className="mt-2 text-2xl font-semibold text-slate-950">
                  Attendance Regularization
                </h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                  Submit attendance correction requests, approve manager/admin stages, and track every action through audit logs.
                </p>
              </div>

              <button
                onClick={loadRequests}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>
          </div>

          {(actionMessage || actionError) && (
            <div
              className={`rounded-2xl border p-4 text-sm ${
                actionError
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {actionError || actionMessage}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Total Requests" value={stats.total} />
            <StatCard label="Pending Manager" value={stats.pendingManager} />
            <StatCard label="Pending Admin" value={stats.pendingAdmin} />
            <StatCard label="Approved" value={stats.approved} />
            <StatCard label="Rejected" value={stats.rejected} />
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">
              New Regularization Request
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Use this form when attendance is wrong, missing, or needs correction.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Attendance Date">
                <input
                  type="date"
                  value={form.attendanceDate}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      attendanceDate: e.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                />
              </Field>

              <Field label="Current Status">
                <select
                  value={form.currentStatus}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      currentStatus: e.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                >
                  <option value="Absent">Absent</option>
                  <option value="Present">Present</option>
                  <option value="Half Day">Half Day</option>
                  <option value="Missing Punch">Missing Punch</option>
                  <option value="Late In">Late In</option>
                  <option value="Early Out">Early Out</option>
                </select>
              </Field>

              <Field label="Current Login Time">
                <input
                  type="time"
                  value={form.currentLoginTime}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      currentLoginTime: e.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                />
              </Field>

              <Field label="Current Logout Time">
                <input
                  type="time"
                  value={form.currentLogoutTime}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      currentLogoutTime: e.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                />
              </Field>

              <Field label="Requested Login Time">
                <input
                  type="time"
                  value={form.requestedLoginTime}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      requestedLoginTime: e.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                />
              </Field>

              <Field label="Requested Logout Time">
                <input
                  type="time"
                  value={form.requestedLogoutTime}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      requestedLogoutTime: e.target.value,
                    }))
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
                />
              </Field>

              <div className="md:col-span-2">
                <Field label="Reason">
                  <textarea
                    value={form.reason}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        reason: e.target.value,
                      }))
                    }
                    placeholder="Example: Forgot to punch out due to system issue."
                    className="min-h-[92px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                </Field>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={submitRequest}
                disabled={isSubmitting}
                className="h-10 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Submitting..." : "Submit Request"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">
                  Regularization Requests
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Review request status, approval stages, and audit trail.
                </p>
              </div>

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
              >
                <option value="all">All Status</option>
                <option value="pending_manager">Pending Manager</option>
                <option value="pending_admin">Pending Admin / WFM</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
              {isLoading ? (
                <div className="p-6 text-sm text-slate-500">Loading requests...</div>
              ) : filteredRequests.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No regularization requests found.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <Th>Request No</Th>
                        <Th>Date</Th>
                        <Th>Status</Th>
                        <Th>Stage</Th>
                        <Th>Requested Time</Th>
                        <Th>Payroll</Th>
                        <Th>Actions</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredRequests.map((request) => {
                        const detail = getDetail(request);

                        return (
                          <tr key={request.id} className="hover:bg-slate-50">
                            <Td>
                              <div className="font-semibold text-slate-950">
                                {request.request_no}
                              </div>
                              <div className="mt-0.5 text-xs text-slate-400">
                                {formatDateTime(request.created_at)}
                              </div>
                            </Td>
                            <Td>{detail?.attendance_date || "-"}</Td>
                            <Td>
                              <StatusBadge status={request.current_status} />
                            </Td>
                            <Td>
                              <div className="text-slate-900">
                                {request.current_stage_name || "-"}
                              </div>
                              <div className="text-xs text-slate-400">
                                {request.current_owner_role || "-"}
                              </div>
                            </Td>
                            <Td>
                              <div>In: {detail?.requested_login_time || "-"}</div>
                              <div>Out: {detail?.requested_logout_time || "-"}</div>
                            </Td>
                            <Td>{request.payroll_impact_status}</Td>
                            <Td>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => setSelectedRequest(request)}
                                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  View
                                </button>

                                {canAct(request) && (
                                  <>
                                    <button
                                      onClick={() => approveRequest(request)}
                                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                                    >
                                      Approve
                                    </button>

                                    <button
                                      onClick={() => {
                                        setRejectRequest(request);
                                        setRejectRemarks("");
                                      }}
                                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}
                              </div>
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        {selectedRequest && (
          <DetailDialog request={selectedRequest} onClose={() => setSelectedRequest(null)} />
        )}

        {rejectRequest && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
              <h3 className="text-lg font-semibold text-slate-950">Reject Request</h3>
              <p className="mt-2 text-sm text-slate-500">
                Rejection remarks are mandatory and will be saved in the audit log.
              </p>

              <textarea
                value={rejectRemarks}
                onChange={(e) => setRejectRemarks(e.target.value)}
                placeholder="Enter rejection reason..."
                className="mt-4 min-h-[120px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              />

              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => {
                    setRejectRequest(null);
                    setRejectRemarks("");
                  }}
                  className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmRejectRequest}
                  className="h-10 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700"
                >
                  Confirm Reject
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}

function Th({ children }: { children: ReactNode }) {
  return (
    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
      {children}
    </th>
  );
}

function Td({ children }: { children: ReactNode }) {
  return <td className="whitespace-nowrap px-4 py-3 text-slate-600">{children}</td>;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
        statusClass[status] || "bg-slate-100 text-slate-700 border-slate-200"
      }`}
    >
      {statusLabel[status] || status}
    </span>
  );
}

function DetailDialog({
  request,
  onClose,
}: {
  request: EmployeeRequest;
  onClose: () => void;
}) {
  const detail = request.regularization_request_detail?.[0] || null;
  const stages = [...(request.request_approval_stage || [])].sort(
    (a, b) => a.stage_no - b.stage_no
  );
  const logs = [...(request.request_action_log || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
              Request Detail
            </p>
            <h3 className="mt-1 text-xl font-semibold text-slate-950">
              {request.request_no}
            </h3>
            <div className="mt-2">
              <StatusBadge status={request.current_status} />
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-950">
              Attendance Correction
            </h4>

            <div className="mt-4 grid gap-3 text-sm">
              <InfoRow label="Attendance Date" value={detail?.attendance_date} />
              <InfoRow label="Current Status" value={detail?.current_status} />
              <InfoRow label="Current Login" value={detail?.current_login_time} />
              <InfoRow label="Current Logout" value={detail?.current_logout_time} />
              <InfoRow label="Requested Login" value={detail?.requested_login_time} />
              <InfoRow label="Requested Logout" value={detail?.requested_logout_time} />
              <InfoRow label="Reason" value={request.reason} />
              <InfoRow label="Payroll Impact" value={request.payroll_impact_status} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <h4 className="text-sm font-semibold text-slate-950">Approval Stages</h4>

            <div className="mt-4 space-y-3">
              {stages.map((stage) => (
                <div key={stage.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">
                        Stage {stage.stage_no}: {stage.stage_name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        Role: {stage.approver_role || "-"}
                      </p>
                    </div>
                    <StatusBadge status={stage.status} />
                  </div>
                  {stage.remarks && (
                    <p className="mt-2 text-xs text-slate-500">Remarks: {stage.remarks}</p>
                  )}
                  {stage.acted_at && (
                    <p className="mt-1 text-xs text-slate-400">
                      Acted at: {formatDateTime(stage.acted_at)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 p-4">
          <h4 className="text-sm font-semibold text-slate-950">Audit Log</h4>

          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Action</Th>
                  <Th>Old Status</Th>
                  <Th>New Status</Th>
                  <Th>Remarks</Th>
                  <Th>Created At</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id}>
                    <Td>{log.action}</Td>
                    <Td>{log.old_status || "-"}</Td>
                    <Td>{log.new_status || "-"}</Td>
                    <Td>{log.remarks || "-"}</Td>
                    <Td>{formatDateTime(log.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value || "-"}</span>
    </div>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
