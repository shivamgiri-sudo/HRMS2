import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, ShieldOff } from "lucide-react";
import { Label } from "@/components/ui/label";
import { formatISTDate } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WithdrawalRequest {
  id: string;
  request_ref?: string;
  reference_number?: string | null;
  sla_due_at?: string | null;
  status: string;
  withdrawal_reason: string;
  withdrawal_scope_json: string | null;
  request_channel: string;
  review_remarks: string | null;
  created_at: string;
  data_restriction_applied: number;
}

const SCOPE_OPTIONS = [
  { key: "personal_data", label: "Personal data" },
  { key: "employment_data", label: "Employment data" },
  { key: "biometric_data", label: "Biometric data" },
  { key: "financial_data", label: "Financial data" },
  { key: "bgv_data", label: "BGV data" },
];

const STATUS_COLORS: Record<string, string> = {
  submitted: "bg-yellow-100 text-yellow-800",
  in_review: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  hold_released: "bg-gray-100 text-gray-800",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function NativeDPDPWithdrawal() {
  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState("");

  const [reason, setReason] = useState("");
  const [selectedScope, setSelectedScope] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState("");

  const fetchRequests = async () => {
    setLoadingList(true);
    setListError("");
    try {
      const res = await hrmsApi.get<{ data: WithdrawalRequest[] }>(
        "/api/privacy/dpdp-withdrawal/my-requests"
      );
      setRequests(res.data ?? []);
    } catch {
      setListError("Failed to load withdrawal requests.");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const toggleScope = (key: string) => {
    setSelectedScope((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = async () => {
    // The reason is optional: withdrawing consent must be as easy as giving it (DPDP Act s.6(4)).
    setSubmitting(true);
    setSubmitError("");
    setSubmitSuccess("");
    try {
      const scopeJson = Object.entries(selectedScope)
        .filter(([, v]) => v)
        .map(([k]) => k);

      const res = await hrmsApi.post<{ data?: { request_ref?: string; sla_due_at?: string | null } }>("/api/privacy/dpdp-withdrawal/request", {
        reason: reason.trim() || undefined,
        scope_json: scopeJson.length ? scopeJson : null,
        channel: "self",
      });

      const ref = res?.data?.request_ref;
      const due = res?.data?.sla_due_at;
      setSubmitSuccess(
        `Your withdrawal request has been received${ref ? ` — reference ${ref}` : ""}.` +
        `${due ? ` We aim to decide by ${formatISTDate(due)}.` : ""} You will see the decision on this page and in your inbox.`
      );
      setReason("");
      setSelectedScope({});
      await fetchRequests();
    } catch (err: any) {
      // hrmsApi rejects with an Error carrying the server's message (e.g. "You already have an open request…").
      setSubmitError(err?.message || "Failed to submit request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const openRequest = requests.find((r) => r.status === "submitted" || r.status === "in_review");

  const formatDate = (d: string) =>
    d ? formatISTDate(d) : "-";

  const parseScopeJson = (raw: string | null): string => {
    if (!raw) return "-";
    try {
      const arr = JSON.parse(raw) as string[];
      return arr.map((k) => SCOPE_OPTIONS.find((o) => o.key === k)?.label ?? k).join(", ");
    } catch {
      return raw;
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <ShieldOff className="h-6 w-6 text-red-500" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Request Data Withdrawal</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Under the Digital Personal Data Protection Act, you may request restriction or
              withdrawal of processing for specific categories of your personal data.
            </p>
          </div>
        </div>

        {/* Submission form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Withdrawal Request</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div role="note" className="space-y-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              <p>
                You can withdraw your consent at any time, and you do not have to give a reason.
              </p>
              <p>
                Withdrawing stops the <strong>optional</strong> uses of the data you choose below. Some information must still be
                used and kept for your employment and for the law, such as payroll, tax, provident-fund and ESI records and
                attendance used to pay wages. Payroll and employee records are kept for 8 years, and leave and attendance
                records for 5 years, as our retention policy and the law require.
              </p>
              <p>
                We aim to decide within 7 days. We will tell you which parts we can restrict, what we must keep and why. If you
                disagree with the decision you can raise a grievance with the Grievance Officer.
              </p>
            </div>
            {openRequest && (
              <Alert role="status">
                <AlertDescription>
                  You already have an open request ({openRequest.reference_number ?? openRequest.request_ref ?? "in progress"}).
                  You can submit another once it has been decided.
                </AlertDescription>
              </Alert>
            )}
            {submitError && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}
            {submitSuccess && (
              <Alert role="status" className="border-green-200 bg-green-50 text-green-800">
                <AlertDescription>{submitSuccess}</AlertDescription>
              </Alert>
            )}

            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="reason" className="text-sm font-medium">
                Reason <span className="text-gray-400 font-normal">(optional)</span>
              </Label>
              <Textarea
                id="reason"
                placeholder="You may tell us why, but you do not have to."
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="resize-none"
              />
            </div>

            {/* Scope */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Data categories to restrict (optional)</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SCOPE_OPTIONS.map((opt) => (
                  <div key={opt.key} className="flex items-center gap-2">
                    <Checkbox
                      id={opt.key}
                      checked={!!selectedScope[opt.key]}
                      onCheckedChange={() => toggleScope(opt.key)}
                    />
                    <Label htmlFor={opt.key} className="text-sm font-normal cursor-pointer">
                      {opt.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <Button onClick={handleSubmit} disabled={submitting || !!openRequest} className="w-full sm:w-auto">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Withdrawal Request"
              )}
            </Button>
          </CardContent>
        </Card>

        {/* My Requests table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My Requests</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingList ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : listError ? (
              <Alert variant="destructive">
                <AlertDescription>{listError}</AlertDescription>
              </Alert>
            ) : requests.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">
                No withdrawal requests submitted yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Decision due</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Restriction Applied</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm font-mono whitespace-nowrap">
                          {r.reference_number ?? r.request_ref ?? "-"}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {formatDate(r.created_at)}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {r.status === "submitted" || r.status === "in_review" ? formatDate(r.sla_due_at ?? "") : "-"}
                        </TableCell>
                        <TableCell className="text-sm max-w-[180px] truncate">
                          {parseScopeJson(r.withdrawal_scope_json)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              STATUS_COLORS[r.status] ?? "bg-gray-100 text-gray-700"
                            }
                          >
                            {r.status.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.data_restriction_applied ? (
                            <Badge className="bg-green-100 text-green-800">Yes</Badge>
                          ) : (
                            <span className="text-gray-400">No</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600 max-w-[260px] whitespace-normal break-words">
                          {r.review_remarks ?? "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
