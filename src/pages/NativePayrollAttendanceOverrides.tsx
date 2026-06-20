import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Loader2, Plus } from "lucide-react";

interface ManualOverride {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  attendance_date: string;
  old_status: string;
  new_status: string;
  old_lwp: number | null;
  new_lwp: number | null;
  reason: string;
  approval_status: "pending" | "approved" | "rejected";
  is_payroll_month_locked: number;
  higher_approval_required: number;
  payroll_impact_amount: number | null;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
}

const statusColor: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export default function NativePayrollAttendanceOverrides() {
  const [overrides, setOverrides] = useState<ManualOverride[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedOverride, setSelectedOverride] = useState<ManualOverride | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionReason, setActionReason] = useState("");

  const [formData, setFormData] = useState({
    employee_id: "",
    attendance_date: "",
    new_status: "present",
    reason: "",
    payroll_month: "",
  });

  const fetchOverrides = async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await hrmsApi.get("/attendance/manual-overrides");
      if (resp.data?.success) {
        setOverrides(resp.data.data || []);
      } else {
        setError(resp.data?.error || "Failed to load overrides");
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Error loading overrides");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverrides();
  }, []);

  const handleCreateOverride = async () => {
    if (!formData.employee_id || !formData.attendance_date || !formData.reason.trim()) {
      setError("Employee, date, and reason are required");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const resp = await hrmsApi.post("/attendance/manual-overrides", {
        employee_id: formData.employee_id,
        attendance_date: formData.attendance_date,
        new_status: formData.new_status,
        reason: formData.reason,
        payroll_month: formData.payroll_month || undefined,
      });

      if (resp.data?.success) {
        await fetchOverrides();
        setShowCreateDialog(false);
        setFormData({
          employee_id: "",
          attendance_date: "",
          new_status: "present",
          reason: "",
          payroll_month: "",
        });
      } else {
        setError(resp.data?.error || "Failed to create override");
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Error creating override");
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (overrideId: string, action: "approve" | "reject") => {
    if (!actionReason.trim()) {
      setError("Reason is required");
      return;
    }

    setActionInProgress(overrideId);
    try {
      const endpoint = `/attendance/manual-overrides/${overrideId}/${action}`;
      const resp = await hrmsApi.post(endpoint, { reason: actionReason });

      if (resp.data?.success) {
        await fetchOverrides();
        setSelectedOverride(null);
        setActionReason("");
      } else {
        setError(resp.data?.error || "Action failed");
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Error performing action");
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <DashboardLayout pageTitle="Attendance Overrides (Payroll Head)">
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Manual Attendance Overrides</h1>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Create Override
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Manual Attendance Override</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="font-semibold text-sm">Employee ID</label>
                  <Input
                    value={formData.employee_id}
                    onChange={(e) => setFormData({ ...formData, employee_id: e.target.value })}
                    placeholder="Employee ID"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="font-semibold text-sm">Attendance Date</label>
                  <Input
                    type="date"
                    value={formData.attendance_date}
                    onChange={(e) => setFormData({ ...formData, attendance_date: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="font-semibold text-sm">New Status</label>
                  <select
                    className="w-full border rounded p-2 mt-1"
                    value={formData.new_status}
                    onChange={(e) => setFormData({ ...formData, new_status: e.target.value })}
                  >
                    <option value="present">Present</option>
                    <option value="half_day">Half Day</option>
                    <option value="absent">Absent</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-sm">Payroll Month (YYYY-MM)</label>
                  <Input
                    value={formData.payroll_month}
                    onChange={(e) => setFormData({ ...formData, payroll_month: e.target.value })}
                    placeholder="2026-06"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="font-semibold text-sm">Reason (required, min 10 chars)</label>
                  <textarea
                    className="w-full border rounded p-2 mt-1 text-sm"
                    rows={4}
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    placeholder="Mandatory reason for override..."
                  />
                </div>
                {error && <Alert className="bg-red-50 text-red-800">{error}</Alert>}
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateOverride} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Create
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {loading && !overrides.length ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </CardContent>
          </Card>
        ) : overrides.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12 text-gray-500">
              No manual overrides found
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status Change</TableHead>
                      <TableHead>LWP Change</TableHead>
                      <TableHead>Locked</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overrides.map((override) => (
                      <TableRow key={override.id}>
                        <TableCell className="font-medium">{override.employee_code}</TableCell>
                        <TableCell>{override.employee_name}</TableCell>
                        <TableCell>{override.attendance_date}</TableCell>
                        <TableCell className="text-sm">
                          {override.old_status} → {override.new_status}
                        </TableCell>
                        <TableCell className="text-sm">
                          {override.old_lwp} → {override.new_lwp}
                        </TableCell>
                        <TableCell>
                          {override.is_payroll_month_locked ? (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Locked
                            </Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge className={statusColor[override.approval_status]}>
                            {override.approval_status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedOverride(override)}
                              >
                                View
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>
                                  Override: {override.employee_code} ({override.attendance_date})
                                </DialogTitle>
                              </DialogHeader>
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <label className="font-semibold text-sm">Employee</label>
                                    <p>{override.employee_name} ({override.employee_code})</p>
                                  </div>
                                  <div>
                                    <label className="font-semibold text-sm">Date</label>
                                    <p>{override.attendance_date}</p>
                                  </div>
                                  <div className="col-span-2">
                                    <label className="font-semibold text-sm">Status Change</label>
                                    <p className="text-sm">
                                      {override.old_status} → {override.new_status}
                                    </p>
                                  </div>
                                  <div className="col-span-2">
                                    <label className="font-semibold text-sm">LWP Change</label>
                                    <p className="text-sm">
                                      {override.old_lwp} → {override.new_lwp}
                                    </p>
                                  </div>
                                </div>

                                <div>
                                  <label className="font-semibold text-sm">Reason</label>
                                  <p className="text-sm bg-gray-50 p-2 rounded">{override.reason}</p>
                                </div>

                                {override.is_payroll_month_locked && (
                                  <Alert className="bg-red-50 border-red-200">
                                    <AlertTriangle className="h-4 w-4 text-red-600" />
                                    <AlertDescription className="text-red-800">
                                      Payroll month is locked. Super Admin approval required.
                                    </AlertDescription>
                                  </Alert>
                                )}

                                {override.payroll_impact_amount && (
                                  <div className="bg-blue-50 p-3 rounded">
                                    <label className="font-semibold text-sm">Payroll Impact</label>
                                    <p className="text-sm font-mono">₹{override.payroll_impact_amount.toFixed(2)}</p>
                                  </div>
                                )}

                                {override.approval_status === "pending" && (
                                  <div className="border-t pt-4 space-y-3">
                                    <div>
                                      <label className="font-semibold text-sm">Approval Reason (required)</label>
                                      <textarea
                                        className="w-full border rounded p-2 mt-1 text-sm"
                                        rows={3}
                                        value={actionReason}
                                        onChange={(e) => setActionReason(e.target.value)}
                                        placeholder="Reason for approval/rejection..."
                                      />
                                    </div>
                                    <div className="flex gap-2">
                                      <Button
                                        className="flex-1"
                                        onClick={() => handleAction(override.id, "approve")}
                                        disabled={!actionReason.trim() || actionInProgress === override.id}
                                      >
                                        {actionInProgress === override.id ? (
                                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        ) : null}
                                        Approve
                                      </Button>
                                      <Button
                                        variant="outline"
                                        className="flex-1"
                                        onClick={() => handleAction(override.id, "reject")}
                                        disabled={!actionReason.trim() || actionInProgress === override.id}
                                      >
                                        {actionInProgress === override.id ? (
                                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        ) : null}
                                        Reject
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </DialogContent>
                          </Dialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
