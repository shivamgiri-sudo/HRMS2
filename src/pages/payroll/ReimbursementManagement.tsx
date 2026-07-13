import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  DollarSign,
  PlusCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ClaimStatus = "draft" | "submitted" | "approved" | "rejected" | "processed";
type ClaimType = "LTA" | "MEDICAL" | "INTERNET" | "PHONE" | "FUEL" | "OTHER";

interface ReimbursementClaim {
  id: string;
  employee_id: string;
  employee_name?: string;
  employee_code?: string;
  claim_type: ClaimType;
  claim_month: string;
  amount_claimed: string | number;
  amount_approved: string | number | null;
  description: string | null;
  status: ClaimStatus;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  payroll_run_id: string | null;
  processed_at: string | null;
  created_at: string;
}

interface ClaimsListResponse {
  success: boolean;
  data: ReimbursementClaim[];
  total: number;
  page: number;
  limit: number;
}

interface MyClaimsResponse {
  success: boolean;
  data: ReimbursementClaim[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLAIM_TYPES: ClaimType[] = ["LTA", "MEDICAL", "INTERNET", "PHONE", "FUEL", "OTHER"];
const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  LTA: "LTA",
  MEDICAL: "Medical",
  INTERNET: "Internet",
  PHONE: "Phone",
  FUEL: "Fuel",
  OTHER: "Other",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: ClaimStatus) {
  const map: Record<ClaimStatus, { label: string; className: string }> = {
    draft:     { label: "Draft",     className: "bg-slate-100 text-slate-700 border-slate-200" },
    submitted: { label: "Submitted", className: "bg-blue-100 text-blue-800 border-blue-200" },
    approved:  { label: "Approved",  className: "bg-green-100 text-green-800 border-green-200" },
    rejected:  { label: "Rejected",  className: "bg-red-100 text-red-800 border-red-200" },
    processed: { label: "Processed", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  };
  const { label, className } = map[status] ?? { label: status, className: "" };
  return <Badge variant="outline" className={`text-xs ${className}`}>{label}</Badge>;
}

function formatINR(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function formatDt(val: string | null | undefined): string {
  if (!val) return "—";
  try { return new Date(val).toLocaleDateString("en-IN"); } catch { return val; }
}

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Stat Cards
// ---------------------------------------------------------------------------

function StatCards({ claims }: { claims: ReimbursementClaim[] }) {
  const month = thisMonth();
  const thisMonthClaims = claims.filter((c) => c.claim_month === month);
  const submitted = thisMonthClaims.filter((c) => c.status === "submitted").length;
  const approved  = thisMonthClaims.filter((c) => c.status === "approved").length;
  const pending   = claims.filter((c) => c.status === "submitted").length;
  const total     = thisMonthClaims.reduce((s, c) => s + Number(c.amount_claimed), 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-blue-500 shrink-0" />
            <div>
              <p className="text-xs text-slate-500">Submitted (this month)</p>
              <p className="text-xl font-bold">{submitted}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
            <div>
              <p className="text-xs text-slate-500">Approved (this month)</p>
              <p className="text-xl font-bold">{approved}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-3">
            <XCircle className="h-5 w-5 text-amber-500 shrink-0" />
            <div>
              <p className="text-xs text-slate-500">Pending Approval</p>
              <p className="text-xl font-bold">{pending}</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-purple-500 shrink-0" />
            <div>
              <p className="text-xs text-slate-500">Total Amount (this month)</p>
              <p className="text-xl font-bold">{formatINR(total)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Claim Dialog
// ---------------------------------------------------------------------------

interface NewClaimDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function NewClaimDialog({ open, onClose, onCreated }: NewClaimDialogProps) {
  const { toast } = useToast();
  const [claimType, setClaimType] = useState<ClaimType>("MEDICAL");
  const [claimMonth, setClaimMonth] = useState(thisMonth());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [submitAndApprove, setSubmitAndApprove] = useState(false);

  const queryClient = useQueryClient();

  const createMutation = useMutation<{ success: boolean; data: ReimbursementClaim }, Error, Record<string, unknown>>({
    mutationFn: (payload) => hrmsApi.post("/api/payroll/reimbursements", payload),
    onSuccess: async (res) => {
      if (submitAndApprove) {
        // Submit right away
        try {
          await hrmsApi.post(`/api/payroll/reimbursements/${res.data.id}/submit`, {});
          toast({ title: "Claim submitted for approval" });
        } catch {
          toast({ title: "Claim created but submit failed", variant: "destructive" });
        }
      } else {
        toast({ title: "Draft claim created" });
      }
      void queryClient.invalidateQueries({ queryKey: ["my-reimbursements"] });
      onCreated();
      onClose();
      reset();
    },
    onError: (err) => {
      toast({ title: "Failed to create claim", description: err.message, variant: "destructive" });
    },
  });

  function reset() {
    setClaimType("MEDICAL");
    setClaimMonth(thisMonth());
    setAmount("");
    setDescription("");
    setSubmitAndApprove(false);
  }

  function handleCreate(andSubmit: boolean) {
    if (!amount || Number(amount) <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    setSubmitAndApprove(andSubmit);
    createMutation.mutate({
      claim_type: claimType,
      claim_month: claimMonth,
      amount_claimed: Number(amount),
      description: description || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); reset(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-blue-600" />
            New Reimbursement Claim
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Claim Type</Label>
            <Select value={claimType} onValueChange={(v) => setClaimType(v as ClaimType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLAIM_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{CLAIM_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Claim Month</Label>
            <Input
              type="month"
              value={claimMonth}
              onChange={(e) => setClaimMonth(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label>Amount Claimed (₹)</Label>
            <Input
              type="number"
              min={0}
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea
              placeholder="Brief description of the claim…"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={() => { onClose(); reset(); }} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => handleCreate(false)}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending && !submitAndApprove ? "Saving…" : "Save as Draft"}
          </Button>
          <Button
            onClick={() => handleCreate(true)}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending && submitAndApprove ? "Submitting…" : "Submit for Approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Approve Dialog
// ---------------------------------------------------------------------------

interface ApproveDialogProps {
  open: boolean;
  claimId: string;
  amountClaimed: number;
  onClose: () => void;
  onDone: () => void;
}

function ApproveDialog({ open, claimId, amountClaimed, onClose, onDone }: ApproveDialogProps) {
  const { toast } = useToast();
  const [approvedAmt, setApprovedAmt] = useState<string>(String(amountClaimed));
  const queryClient = useQueryClient();

  const approveMutation = useMutation<unknown, Error, { amount_approved?: number }>({
    mutationFn: (payload) => hrmsApi.patch(`/api/payroll/reimbursements/${claimId}/approve`, payload),
    onSuccess: () => {
      toast({ title: "Claim approved" });
      void queryClient.invalidateQueries({ queryKey: ["all-reimbursements"] });
      onDone();
      onClose();
    },
    onError: (err) => {
      toast({ title: "Approval failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-green-700">Approve Claim</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-slate-600">
            Claimed amount: <strong>{formatINR(amountClaimed)}</strong>
          </p>
          <div className="space-y-1">
            <Label>Approved Amount (₹)</Label>
            <Input
              type="number"
              min={0}
              value={approvedAmt}
              onChange={(e) => setApprovedAmt(e.target.value)}
            />
            <p className="text-xs text-slate-400">Leave unchanged to approve full amount.</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={approveMutation.isPending}>Cancel</Button>
          <Button
            onClick={() => approveMutation.mutate({ amount_approved: Number(approvedAmt) })}
            disabled={approveMutation.isPending}
          >
            {approveMutation.isPending ? "Approving…" : "Confirm Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reject Dialog
// ---------------------------------------------------------------------------

interface RejectDialogProps {
  open: boolean;
  claimId: string;
  onClose: () => void;
  onDone: () => void;
}

function RejectDialog({ open, claimId, onClose, onDone }: RejectDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const rejectMutation = useMutation<unknown, Error, { reason: string }>({
    mutationFn: (payload) => hrmsApi.patch(`/api/payroll/reimbursements/${claimId}/reject`, payload),
    onSuccess: () => {
      toast({ title: "Claim rejected" });
      void queryClient.invalidateQueries({ queryKey: ["all-reimbursements"] });
      onDone();
      onClose();
      setReason("");
    },
    onError: (err) => {
      toast({ title: "Rejection failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setReason(""); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-red-700">Reject Claim</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Textarea
            placeholder="Enter reason for rejection…"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="resize-none"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { onClose(); setReason(""); }} disabled={rejectMutation.isPending}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={rejectMutation.isPending || !reason.trim()}
            onClick={() => rejectMutation.mutate({ reason: reason.trim() })}
          >
            {rejectMutation.isPending ? "Rejecting…" : "Confirm Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ReimbursementManagement() {
  const { toast } = useToast();
  const { roleKeys, isLoading: roleLoading } = useWorkforceAccess();
  const queryClient = useQueryClient();

  const isApprover = roleKeys.some((r) =>
    ["admin", "hr", "payroll_head", "finance", "super_admin"].includes(r)
  );
  const isProcessor = roleKeys.some((r) => ["payroll_head", "super_admin"].includes(r));

  // ------ Dialogs ------
  const [newClaimOpen, setNewClaimOpen] = useState(false);
  const [approveTarget, setApproveTarget] = useState<ReimbursementClaim | null>(null);
  const [rejectTargetId, setRejectTargetId] = useState<string>("");
  const [rejectOpen, setRejectOpen] = useState(false);

  // ------ Filters ------
  const [queueMonthFilter, setQueueMonthFilter] = useState("");
  const [processedMonthFilter, setProcessedMonthFilter] = useState("");
  const [processedRunIdFilter, setProcessedRunIdFilter] = useState("");

  // ---------------------------------------------------------------------------
  // My Claims query
  // ---------------------------------------------------------------------------
  const {
    data: myData,
    isLoading: myLoading,
    refetch: refetchMy,
  } = useQuery<MyClaimsResponse>({
    queryKey: ["my-reimbursements"],
    queryFn: () => hrmsApi.get<MyClaimsResponse>("/api/payroll/reimbursements/my"),
  });
  const myClaims = myData?.data ?? [];

  // ---------------------------------------------------------------------------
  // All Claims query (approver+)
  // ---------------------------------------------------------------------------
  const {
    data: allData,
    isLoading: allLoading,
    refetch: refetchAll,
  } = useQuery<ClaimsListResponse>({
    queryKey: ["all-reimbursements", queueMonthFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (queueMonthFilter) params.set("claim_month", queueMonthFilter);
      const q = params.toString();
      return hrmsApi.get<ClaimsListResponse>(`/api/payroll/reimbursements${q ? `?${q}` : ""}`);
    },
    enabled: isApprover,
  });
  const allClaims = allData?.data ?? [];

  const submittedClaims = allClaims.filter((c) => c.status === "submitted");

  const processedClaims = useMemo(() => {
    return allClaims.filter((c) => {
      if (c.status !== "processed" && c.status !== "approved") return false;
      if (processedMonthFilter && c.claim_month !== processedMonthFilter) return false;
      if (processedRunIdFilter && c.payroll_run_id !== processedRunIdFilter) return false;
      return true;
    });
  }, [allClaims, processedMonthFilter, processedRunIdFilter]);

  // ---------------------------------------------------------------------------
  // Submit own claim
  // ---------------------------------------------------------------------------
  const submitMutation = useMutation<unknown, Error, string>({
    mutationFn: (id) => hrmsApi.post(`/api/payroll/reimbursements/${id}/submit`, {}),
    onSuccess: () => {
      toast({ title: "Claim submitted for approval" });
      void queryClient.invalidateQueries({ queryKey: ["my-reimbursements"] });
    },
    onError: (err) => {
      toast({ title: "Submit failed", description: err.message, variant: "destructive" });
    },
  });

  // ---------------------------------------------------------------------------
  // Delete own draft
  // ---------------------------------------------------------------------------
  const deleteMutation = useMutation<unknown, Error, string>({
    mutationFn: (id) => hrmsApi.delete(`/api/payroll/reimbursements/${id}`),
    onSuccess: () => {
      toast({ title: "Draft deleted" });
      void queryClient.invalidateQueries({ queryKey: ["my-reimbursements"] });
    },
    onError: (err) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  // ---------------------------------------------------------------------------
  // Process a claim
  // ---------------------------------------------------------------------------
  const processMutation = useMutation<unknown, Error, string>({
    mutationFn: (id) => hrmsApi.patch(`/api/payroll/reimbursements/${id}/process`, {}),
    onSuccess: () => {
      toast({ title: "Claim marked as processed" });
      void queryClient.invalidateQueries({ queryKey: ["all-reimbursements"] });
    },
    onError: (err) => {
      toast({ title: "Process failed", description: err.message, variant: "destructive" });
    },
  });

  // ---------------------------------------------------------------------------
  // Loading guard
  // ---------------------------------------------------------------------------
  if (roleLoading) {
    return (
      <DashboardLayout>
        <div className="p-8 text-slate-500">Loading access…</div>
      </DashboardLayout>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Reimbursement Management</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Manage LTA, medical, internet and other reimbursement claims
            </p>
          </div>
          <Button onClick={() => setNewClaimOpen(true)}>
            <PlusCircle className="h-4 w-4 mr-2" />
            New Claim
          </Button>
        </div>

        {/* Stat Cards — use my claims for self; all claims for approvers */}
        <StatCards claims={isApprover ? allClaims : myClaims} />

        <Tabs defaultValue="my">
          <TabsList>
            <TabsTrigger value="my">My Claims</TabsTrigger>
            {isApprover && <TabsTrigger value="queue">Approval Queue</TabsTrigger>}
            {isApprover && <TabsTrigger value="processed">Processed</TabsTrigger>}
          </TabsList>

          {/* ---------------------------------------------------------------- */}
          {/* My Claims Tab                                                    */}
          {/* ---------------------------------------------------------------- */}
          <TabsContent value="my" className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-slate-500">{myClaims.length} claims found</span>
              <Button variant="outline" size="sm" onClick={() => void refetchMy()} disabled={myLoading}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Refresh
              </Button>
            </div>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Month</TableHead>
                    <TableHead>Claimed</TableHead>
                    <TableHead>Approved</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-slate-400">Loading…</TableCell>
                    </TableRow>
                  )}
                  {!myLoading && myClaims.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-slate-400">No claims found. Click "New Claim" to get started.</TableCell>
                    </TableRow>
                  )}
                  {myClaims.map((claim) => (
                    <TableRow key={claim.id}>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{CLAIM_TYPE_LABELS[claim.claim_type]}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{claim.claim_month}</TableCell>
                      <TableCell className="text-sm font-medium">{formatINR(claim.amount_claimed)}</TableCell>
                      <TableCell className="text-sm">
                        {claim.amount_approved != null ? formatINR(claim.amount_approved) : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-slate-500 max-w-xs truncate">
                        {claim.description ?? "—"}
                      </TableCell>
                      <TableCell>{statusBadge(claim.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {claim.status === "draft" && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-blue-700 border-blue-300 hover:bg-blue-50"
                                disabled={submitMutation.isPending}
                                onClick={() => submitMutation.mutate(claim.id)}
                              >
                                Submit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-red-700 border-red-300 hover:bg-red-50"
                                disabled={deleteMutation.isPending}
                                onClick={() => deleteMutation.mutate(claim.id)}
                              >
                                Delete
                              </Button>
                            </>
                          )}
                          {claim.status === "rejected" && claim.rejection_reason && (
                            <span className="text-xs text-red-500 italic max-w-[160px] truncate">
                              {claim.rejection_reason}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ---------------------------------------------------------------- */}
          {/* Approval Queue Tab                                               */}
          {/* ---------------------------------------------------------------- */}
          {isApprover && (
            <TabsContent value="queue" className="mt-4">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label className="text-xs shrink-0">Month:</Label>
                  <Input
                    type="month"
                    className="w-36 h-8 text-sm"
                    value={queueMonthFilter}
                    onChange={(e) => setQueueMonthFilter(e.target.value)}
                  />
                  {queueMonthFilter && (
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => setQueueMonthFilter("")}>
                      Clear
                    </Button>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => void refetchAll()} disabled={allLoading}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Refresh
                </Button>
                <span className="text-xs text-slate-500">{submittedClaims.length} submitted claims</span>
              </div>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Month</TableHead>
                      <TableHead>Claimed</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Submitted At</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allLoading && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-slate-400">Loading…</TableCell>
                      </TableRow>
                    )}
                    {!allLoading && submittedClaims.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-8 text-center text-slate-400">No submitted claims pending approval.</TableCell>
                      </TableRow>
                    )}
                    {submittedClaims.map((claim) => (
                      <TableRow key={claim.id}>
                        <TableCell>
                          <div className="font-medium text-sm">{claim.employee_name ?? "—"}</div>
                          <div className="text-xs text-slate-500">{claim.employee_code}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{CLAIM_TYPE_LABELS[claim.claim_type]}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{claim.claim_month}</TableCell>
                        <TableCell className="text-sm font-medium">{formatINR(claim.amount_claimed)}</TableCell>
                        <TableCell className="text-sm text-slate-500 max-w-xs truncate">{claim.description ?? "—"}</TableCell>
                        <TableCell className="text-xs text-slate-500">{formatDt(claim.submitted_at)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs text-green-700 border-green-300 hover:bg-green-50"
                              onClick={() => setApproveTarget(claim)}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs text-red-700 border-red-300 hover:bg-red-50"
                              onClick={() => { setRejectTargetId(claim.id); setRejectOpen(true); }}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                              Reject
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Processed Tab                                                    */}
          {/* ---------------------------------------------------------------- */}
          {isApprover && (
            <TabsContent value="processed" className="mt-4">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label className="text-xs shrink-0">Month:</Label>
                  <Input
                    type="month"
                    className="w-36 h-8 text-sm"
                    value={processedMonthFilter}
                    onChange={(e) => setProcessedMonthFilter(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs shrink-0">Run ID:</Label>
                  <Input
                    className="w-44 h-8 text-sm"
                    placeholder="Payroll run ID"
                    value={processedRunIdFilter}
                    onChange={(e) => setProcessedRunIdFilter(e.target.value)}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={() => void refetchAll()} disabled={allLoading}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Refresh
                </Button>
              </div>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Month</TableHead>
                      <TableHead>Claimed</TableHead>
                      <TableHead>Approved</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Payroll Run</TableHead>
                      {isProcessor && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processedClaims.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={isProcessor ? 8 : 7} className="py-8 text-center text-slate-400">
                          No processed or approved claims found for the selected filters.
                        </TableCell>
                      </TableRow>
                    )}
                    {processedClaims.map((claim) => (
                      <TableRow key={claim.id}>
                        <TableCell>
                          <div className="font-medium text-sm">{claim.employee_name ?? "—"}</div>
                          <div className="text-xs text-slate-500">{claim.employee_code}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{CLAIM_TYPE_LABELS[claim.claim_type]}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{claim.claim_month}</TableCell>
                        <TableCell className="text-sm">{formatINR(claim.amount_claimed)}</TableCell>
                        <TableCell className="text-sm font-medium">
                          {claim.amount_approved != null ? formatINR(claim.amount_approved) : "—"}
                        </TableCell>
                        <TableCell>{statusBadge(claim.status)}</TableCell>
                        <TableCell className="text-xs text-slate-500">{claim.payroll_run_id ?? "—"}</TableCell>
                        {isProcessor && (
                          <TableCell className="text-right">
                            {claim.status === "approved" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                                disabled={processMutation.isPending}
                                onClick={() => processMutation.mutate(claim.id)}
                              >
                                Mark Processed
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* New Claim Dialog */}
      <NewClaimDialog
        open={newClaimOpen}
        onClose={() => setNewClaimOpen(false)}
        onCreated={() => void queryClient.invalidateQueries({ queryKey: ["my-reimbursements"] })}
      />

      {/* Approve Dialog */}
      {approveTarget && (
        <ApproveDialog
          open={!!approveTarget}
          claimId={approveTarget.id}
          amountClaimed={Number(approveTarget.amount_claimed)}
          onClose={() => setApproveTarget(null)}
          onDone={() => void refetchAll()}
        />
      )}

      {/* Reject Dialog */}
      <RejectDialog
        open={rejectOpen}
        claimId={rejectTargetId}
        onClose={() => { setRejectOpen(false); setRejectTargetId(""); }}
        onDone={() => void refetchAll()}
      />
    </DashboardLayout>
  );
}
