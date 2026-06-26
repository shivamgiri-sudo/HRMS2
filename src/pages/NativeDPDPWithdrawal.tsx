import { useEffect, useState } from "react";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { hrmsApi } from "@/lib/hrmsApi";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Button } from "@/components/ui/button";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Textarea } from "@/components/ui/textarea";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Checkbox } from "@/components/ui/checkbox";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Badge } from "@/components/ui/badge";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, ShieldOff } from "lucide-react";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { Label } from "@/components/ui/label";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WithdrawalRequest {
  id: string;
  request_ref?: string;
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
    if (!reason.trim()) {
      setSubmitError("Please provide a reason for your withdrawal request.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    setSubmitSuccess("");
    try {
      const scopeJson = Object.entries(selectedScope)
        .filter(([, v]) => v)
        .map(([k]) => k);

      await hrmsApi.post("/api/privacy/dpdp-withdrawal/request", {
        reason,
        scope_json: scopeJson.length ? scopeJson : null,
        channel: "self",
      });

      setSubmitSuccess("Your withdrawal request has been submitted and is pending review.");
      setReason("");
      setSelectedScope({});
      await fetchRequests();
    } catch (err: any) {
      setSubmitError(
        err?.response?.data?.message ?? "Failed to submit request. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

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
            {submitError && (
              <Alert variant="destructive">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}
            {submitSuccess && (
              <Alert className="border-green-200 bg-green-50 text-green-800">
                <AlertDescription>{submitSuccess}</AlertDescription>
              </Alert>
            )}

            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="reason" className="text-sm font-medium">
                Reason / purpose <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="reason"
                placeholder="Describe why you are requesting data withdrawal or restriction..."
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

            <Button onClick={handleSubmit} disabled={submitting} className="w-full sm:w-auto">
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
                      <TableHead>Submitted</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Restriction Applied</TableHead>
                      <TableHead>Remarks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm whitespace-nowrap">
                          {formatDate(r.created_at)}
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
                        <TableCell className="text-sm text-gray-600 max-w-[200px] truncate">
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
