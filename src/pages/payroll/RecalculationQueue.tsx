import { useEffect, useState, useCallback } from "react";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ALLOWED_ROLES = ["payroll_head", "payroll_branch", "admin", "super_admin"];
const TRIGGER_ROLES = ["payroll_head", "admin", "super_admin"];

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  processing: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  skipped_locked: "bg-gray-100 text-gray-700",
};

interface QueueItem {
  id: number;
  employee_name: string;
  employee_code: string;
  payroll_month: string;
  source_event_type: string;
  reason: string;
  status: string;
  requested_at: string;
}

interface Employee { id: string; employee_code: string; name: string; }

export default function RecalculationQueue() {
  const { roleKeys } = useWorkforceAccess();
  const canTrigger = TRIGGER_ROLES.some(r => roleKeys.includes(r));

  const [items, setItems] = useState<QueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Trigger form state
  const [showTrigger, setShowTrigger] = useState(false);
  const [trigSearch, setTrigSearch] = useState("");
  const [trigSuggestions, setTrigSuggestions] = useState<Employee[]>([]);
  const [trigEmployee, setTrigEmployee] = useState<Employee | null>(null);
  const [trigMonth, setTrigMonth] = useState("");
  const [trigReason, setTrigReason] = useState("");
  const [trigSubmitting, setTrigSubmitting] = useState(false);
  const [trigError, setTrigError] = useState<string | null>(null);
  const [trigSuccess, setTrigSuccess] = useState<string | null>(null);

  // E1.8: Bulk recalculation state
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkRunId, setBulkRunId] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);

  const fetchQueue = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (monthFilter) params.set("payrollMonth", monthFilter);
    hrmsApi.get<any>(`/api/payroll/recalculation-queue?${params}`)
      .then((data: any) => {
        setItems(Array.isArray(data) ? data : data.data ?? data.items ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(() => setError("Failed to load recalculation queue."))
      .finally(() => setLoading(false));
  }, [statusFilter, monthFilter]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const searchEmployees = (q: string) => {
    setTrigSearch(q);
    setTrigEmployee(null);
    if (q.length < 2) { setTrigSuggestions([]); return; }
    hrmsApi.get<any>(`/api/employees?search=${encodeURIComponent(q)}`)
      .then((res: any) => setTrigSuggestions(Array.isArray(res) ? res : res.employees ?? res.data ?? []))
      .catch(() => {});
  };

  const selectTrigEmployee = (emp: Employee) => {
    setTrigEmployee(emp);
    setTrigSearch(`${emp.name} (${emp.employee_code})`);
    setTrigSuggestions([]);
  };

  const submitTrigger = async () => {
    if (!trigEmployee || !trigMonth) return;
    setTrigSubmitting(true);
    setTrigError(null);
    setTrigSuccess(null);
    try {
      await hrmsApi.post("/api/payroll/recalculation-queue", {
        employee_id: trigEmployee.id,
        payroll_month: trigMonth,
        reason: trigReason || "Manual recalculation request",
      });
      setTrigSuccess(`Queued recalculation for ${trigEmployee.name} — ${trigMonth}`);
      setTrigSearch("");
      setTrigEmployee(null);
      setTrigMonth("");
      setTrigReason("");
      fetchQueue();
    } catch (e: any) {
      setTrigError(e.message ?? "Failed to queue recalculation");
    } finally {
      setTrigSubmitting(false);
    }
  };

  // E1.8: Submit bulk recalculation for entire run
  const submitBulkRecalculation = async () => {
    if (!bulkRunId) return;
    setBulkSubmitting(true);
    setBulkError(null);
    setBulkSuccess(null);
    try {
      await hrmsApi.post("/api/payroll/recalculation-queue/bulk", {
        run_id: bulkRunId,
        reason: bulkReason || "Bulk recalculation request",
      });
      setBulkSuccess("Bulk recalculation queued for all employees in this run");
      setBulkRunId("");
      setBulkReason("");
      setShowBulkModal(false);
      fetchQueue();
    } catch (e: any) {
      setBulkError(e.message ?? "Failed to queue bulk recalculation");
    } finally {
      setBulkSubmitting(false);
    }
  };

  if (!ALLOWED_ROLES.some(r => roleKeys.includes(r))) {
    return (
      <DashboardLayout>
        <div className="p-8 text-red-600">Access denied.</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Payroll Recalculation Queue</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Monitor automatic recalculation events triggered by regularization, roster changes, or manual request.</p>
          </div>
          {canTrigger && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowTrigger(p => !p)}>
                {showTrigger ? "Hide Trigger" : "+ Trigger Recalculation"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowBulkModal(true)}>
                Bulk Recalculate for Run
              </Button>
            </div>
          )}
        </div>

        {canTrigger && showTrigger && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Manually Trigger Recalculation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="relative">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Employee <span className="text-red-500">*</span></label>
                  <Input
                    className="text-sm"
                    placeholder="Search employee…"
                    value={trigSearch}
                    onChange={e => searchEmployees(e.target.value)}
                  />
                  {trigSuggestions.length > 0 && (
                    <div className="absolute z-10 bg-popover border border-border rounded shadow mt-1 w-full max-h-48 overflow-y-auto">
                      {trigSuggestions.map(emp => (
                        <div key={emp.id} className="px-3 py-2 text-sm cursor-pointer hover:bg-muted" onClick={() => selectTrigEmployee(emp)}>
                          {emp.name} <span className="text-muted-foreground text-xs">({emp.employee_code})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Payroll Month <span className="text-red-500">*</span></label>
                  <Input
                    type="month"
                    className="text-sm"
                    value={trigMonth}
                    onChange={e => setTrigMonth(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Reason</label>
                  <Input
                    className="text-sm"
                    placeholder="Optional reason"
                    value={trigReason}
                    onChange={e => setTrigReason(e.target.value)}
                  />
                </div>
              </div>
              {trigError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{trigError}</p>}
              {trigSuccess && <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">{trigSuccess}</p>}
              <Button
                size="sm"
                disabled={trigSubmitting || !trigEmployee || !trigMonth}
                onClick={submitTrigger}
              >
                {trigSubmitting ? "Queuing…" : "Queue Recalculation"}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap gap-3 items-center">
          <select
            className="border rounded px-3 py-1.5 text-sm bg-background"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="skipped_locked">Skipped (Locked)</option>
          </select>
          <Input
            className="w-36 h-8 text-sm"
            placeholder="YYYY-MM"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={fetchQueue}>Refresh</Button>
          {total > 0 && <span className="text-xs text-muted-foreground">{total} total items</span>}
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2">Employee</th>
                <th className="text-left px-4 py-2">Code</th>
                <th className="text-left px-4 py-2">Payroll Month</th>
                <th className="text-left px-4 py-2">Source Event</th>
                <th className="text-left px-4 py-2">Reason</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="text-left px-4 py-2">Requested At</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!loading && items.map((item) => (
                <tr key={item.id} className="border-t hover:bg-muted/40">
                  <td className="px-4 py-2 font-medium">{item.employee_name}</td>
                  <td className="px-4 py-2 text-xs">{item.employee_code}</td>
                  <td className="px-4 py-2 text-xs">{item.payroll_month?.slice(0, 7)}</td>
                  <td className="px-4 py-2 text-xs">{item.source_event_type?.replace(/_/g, " ")}</td>
                  <td className="px-4 py-2 max-w-xs truncate text-xs" title={item.reason}>{item.reason}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_BADGE[item.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {item.status?.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {item.requested_at ? new Date(item.requested_at).toLocaleString("en-IN") : "—"}
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No items in queue.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* E1.8: Bulk Recalculation Modal */}
        {showBulkModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
            <Card className="w-full max-w-md mx-4">
              <CardHeader>
                <CardTitle>Bulk Recalculate for Run</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {bulkSuccess && (
                  <div className="p-3 bg-green-50 text-green-800 text-sm rounded border border-green-200">
                    {bulkSuccess}
                  </div>
                )}
                {bulkError && (
                  <div className="p-3 bg-red-50 text-red-800 text-sm rounded border border-red-200">
                    {bulkError}
                  </div>
                )}
                <div>
                  <label className="text-sm font-medium block mb-1">Run ID <span className="text-red-500">*</span></label>
                  <Input
                    placeholder="Enter payroll run ID"
                    value={bulkRunId}
                    onChange={(e) => setBulkRunId(e.target.value)}
                    disabled={bulkSubmitting}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Reason</label>
                  <Input
                    placeholder="Enter reason for recalculation"
                    value={bulkReason}
                    onChange={(e) => setBulkReason(e.target.value)}
                    disabled={bulkSubmitting}
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowBulkModal(false)}
                    disabled={bulkSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={submitBulkRecalculation}
                    disabled={bulkSubmitting || !bulkRunId}
                  >
                    {bulkSubmitting ? "Submitting..." : "Submit"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
