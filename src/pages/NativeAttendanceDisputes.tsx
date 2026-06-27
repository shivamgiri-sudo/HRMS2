import { useEffect, useState, useMemo } from "react";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";

interface Dispute {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  session_date: string;
  dispute_type: string | null;
  old_status: string | null;
  new_status: string | null;
  old_punch_in: string | null;
  old_punch_out: string | null;
  new_punch_in: string | null;
  new_punch_out: string | null;
  payroll_impact: number;
  payroll_head_approval_required: number;
  status: string;
  escalated_to: string | null;
  reason: string;
  reviewer_note: string | null;
  created_at: string;
  audit_timeline?: Array<{
    action_type: string;
    actor_role: string;
    reason: string;
    acted_at: string;
  }>;
}

const statusColor: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  escalated: "bg-blue-100 text-blue-800",
};

const disputeTypeLabel: Record<string, string> = {
  missing_punch: "Missing Punch",
  wrong_punch: "Wrong Punch",
  late_mark_dispute: "Late Mark",
  early_logout_dispute: "Early Logout",
  half_day_dispute: "Half Day",
  absent_wrongly_marked: "Wrongly Marked Absent",
  week_off_worked: "Week Off Worked",
  holiday_worked: "Holiday Worked",
  shift_mismatch: "Shift Mismatch",
  cosec_sync_issue: "COSEC Sync Issue",
  manual_punch_correction: "Manual Correction",
};

export default function NativeAttendanceDisputes() {
  const [tab, setTab] = useState("my");
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionType, setActionType] = useState<"approve" | "reject" | "escalate_to_hr" | "escalate_to_payroll" | "send_back" | null>(null);

  const fetchDisputes = async () => {
    setLoading(true);
    setError("");
    try {
      const params: Record<string, string> = {};
      if (tab === "my") {
        // Employee sees their own disputes
      } else if (tab === "manager") {
        // Manager queue - no special param needed, API scopes via auth
      } else if (tab === "hr") {
        // HR queue
      } else if (tab === "payroll") {
        // Payroll queue
      }

      const qs = new URLSearchParams(params).toString();
      const resp = await hrmsApi.get<{success:boolean;data:Dispute[];error?:string}>(`/api/attendance/disputes${qs ? `?${qs}` : ""}`);
      if (resp.success) {
        setDisputes(resp.data || []);
      } else {
        setError(resp.error || "Failed to load disputes");
      }
    } catch (err: any) {
      setError(err.message || "Error loading disputes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDisputes();
  }, [tab]);

  const handleAction = async (
    disputeId: string,
    action: "approve" | "reject" | "escalate_to_hr" | "escalate_to_payroll" | "send_back",
    reason?: string,
  ) => {
    setActionInProgress(disputeId);
    try {
      let endpoint = "";
      let payload: any = {};

      if (action === "approve" || action === "reject" || action === "escalate_to_hr") {
        endpoint = `/attendance/disputes/${disputeId}/manager-action`;
        payload = { action, reason: reason || "" };
      } else if (action === "escalate_to_payroll" || action === "send_back") {
        endpoint = `/attendance/disputes/${disputeId}/hr-action`;
        payload = { action: action === "escalate_to_payroll" ? "escalate_to_payroll" : "approve", reason };
      }

      const resp = await hrmsApi.post(endpoint, payload);
      if (resp.data?.success) {
        await fetchDisputes();
        setSelectedDispute(null);
        setActionReason("");
        setActionType(null);
      } else {
        setError(resp.data?.error || "Action failed");
      }
    } catch (err: any) {
      setError(err.response?.data?.error || "Error performing action");
    } finally {
      setActionInProgress(null);
    }
  };

  const DisputeRow = ({ dispute }: { dispute: Dispute }) => (
    <TableRow key={dispute.id}>
      <TableCell className="font-medium">{dispute.employee_code}</TableCell>
      <TableCell>{dispute.employee_name}</TableCell>
      <TableCell>{dispute.session_date}</TableCell>
      <TableCell>
        {dispute.dispute_type ? (
          <Badge variant="secondary">{disputeTypeLabel[dispute.dispute_type]}</Badge>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell>
        <span className="text-sm">
          {dispute.old_status} → {dispute.new_status}
        </span>
      </TableCell>
      <TableCell>
        {dispute.payroll_impact ? (
          <Badge variant="destructive">Payroll Impact</Badge>
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell>
        <Badge className={statusColor[dispute.status]}>{dispute.status}</Badge>
      </TableCell>
      <TableCell>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" onClick={() => setSelectedDispute(dispute)}>
              View
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Dispute: {dispute.employee_code} ({dispute.session_date})
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="font-semibold text-sm">Employee</label>
                  <p>{dispute.employee_name} ({dispute.employee_code})</p>
                </div>
                <div>
                  <label className="font-semibold text-sm">Date</label>
                  <p>{dispute.session_date}</p>
                </div>
                <div>
                  <label className="font-semibold text-sm">Dispute Type</label>
                  <p>{dispute.dispute_type ? disputeTypeLabel[dispute.dispute_type] : "—"}</p>
                </div>
                <div>
                  <label className="font-semibold text-sm">Status</label>
                  <Badge className={statusColor[dispute.status]}>{dispute.status}</Badge>
                </div>
                <div className="col-span-2">
                  <label className="font-semibold text-sm">Status Change</label>
                  <p className="text-sm">{dispute.old_status} → {dispute.new_status}</p>
                </div>
                {dispute.old_punch_in && (
                  <div className="col-span-2">
                    <label className="font-semibold text-sm">Punch Times</label>
                    <p className="text-sm">
                      Old: {dispute.old_punch_in} - {dispute.old_punch_out || "—"} | New: {dispute.new_punch_in} - {dispute.new_punch_out || "—"}
                    </p>
                  </div>
                )}
                {dispute.payroll_impact && (
                  <div className="col-span-2">
                    <Badge variant="destructive">Payroll Impact Required</Badge>
                  </div>
                )}
              </div>

              <div>
                <label className="font-semibold text-sm">Reason</label>
                <p className="text-sm bg-gray-50 p-2 rounded">{dispute.reason}</p>
              </div>

              {dispute.reviewer_note && (
                <div>
                  <label className="font-semibold text-sm">Reviewer Note</label>
                  <p className="text-sm bg-gray-50 p-2 rounded">{dispute.reviewer_note}</p>
                </div>
              )}

              {dispute.audit_timeline && dispute.audit_timeline.length > 0 && (
                <div>
                  <label className="font-semibold text-sm">Timeline</label>
                  <div className="space-y-2 text-sm">
                    {dispute.audit_timeline.map((event, i) => (
                      <div key={i} className="bg-gray-50 p-2 rounded border-l-2 border-blue-300">
                        <p className="font-medium">{event.action_type}</p>
                        <p className="text-gray-600">
                          {event.actor_role} • {formatIST(event.acted_at)}
                        </p>
                        {event.reason && <p className="text-gray-600 mt-1">{event.reason}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(dispute.status === "pending" || dispute.status === "escalated") && (
                <div className="border-t pt-4 space-y-3">
                  {tab === "manager" && (
                    <>
                      <Button
                        className="w-full"
                        onClick={() => {
                          setActionType("approve");
                          setSelectedDispute(dispute);
                        }}
                      >
                        Approve
                      </Button>
                      <Button variant="outline" className="w-full" onClick={() => {
                        setActionType("reject");
                        setSelectedDispute(dispute);
                      }}>
                        Reject
                      </Button>
                      <Button variant="secondary" className="w-full" onClick={() => {
                        setActionType("escalate_to_hr");
                        setSelectedDispute(dispute);
                      }}>
                        Escalate to HR
                      </Button>
                    </>
                  )}
                  {tab === "hr" && (
                    <>
                      {!dispute.payroll_impact && (
                        <Button className="w-full" onClick={() => handleAction(dispute.id, "approve", "Approved by HR")}>
                          Approve
                        </Button>
                      )}
                      <Button variant="outline" className="w-full" onClick={() => {
                        setActionType("reject");
                        setSelectedDispute(dispute);
                      }}>
                        Reject
                      </Button>
                      <Button variant="secondary" className="w-full" onClick={() => {
                        setActionType("escalate_to_payroll");
                        setSelectedDispute(dispute);
                      }}>
                        Escalate to Payroll
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );

  return (
    <DashboardLayout pageTitle="Attendance Disputes">
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="my">My Disputes</TabsTrigger>
          <TabsTrigger value="manager">Manager Queue</TabsTrigger>
          <TabsTrigger value="hr">HR/WFM Queue</TabsTrigger>
          <TabsTrigger value="payroll">Payroll Queue</TabsTrigger>
        </TabsList>

        {["my", "manager", "hr", "payroll"].map((t) => (
          <TabsContent key={t} value={t}>
            {error && (
              <Card className="border-red-200 bg-red-50 mb-4">
                <CardContent className="text-red-800 text-sm pt-4">{error}</CardContent>
              </Card>
            )}

            {loading ? (
              <Card>
                <CardContent className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </CardContent>
              </Card>
            ) : disputes.length === 0 ? (
              <Card>
                <CardContent className="text-center py-12 text-gray-500">
                  No disputes found
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
                          <TableHead>Type</TableHead>
                          <TableHead>Status Change</TableHead>
                          <TableHead>Payroll</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {disputes.map((d) => (
                          <DisputeRow key={d.id} dispute={d} />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {actionType && selectedDispute && (
        <Dialog open={!!actionType} onOpenChange={() => setActionType(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {actionType === "approve" && "Approve Dispute"}
                {actionType === "reject" && "Reject Dispute"}
                {actionType === "escalate_to_hr" && "Escalate to HR"}
                {actionType === "escalate_to_payroll" && "Escalate to Payroll"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="font-semibold text-sm">Reason (required)</label>
                <textarea
                  className="w-full border rounded p-2 mt-1 text-sm"
                  rows={4}
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="Enter reason for this action..."
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setActionType(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={!actionReason.trim() || actionInProgress === selectedDispute.id}
                  onClick={() => {
                    if (actionType === "escalate_to_hr" || actionType === "escalate_to_payroll" || actionType === "reject") {
                      handleAction(selectedDispute.id, actionType, actionReason);
                    } else {
                      handleAction(selectedDispute.id, "approve", actionReason);
                    }
                  }}
                >
                  {actionInProgress === selectedDispute.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {actionType === "approve" ? "Approve" : "Proceed"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </DashboardLayout>
  );
}
