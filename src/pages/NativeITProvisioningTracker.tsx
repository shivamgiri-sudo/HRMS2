import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Server, Lock, CheckCircle, Clock, AlertTriangle, Search, XCircle } from "lucide-react";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProvisioningRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  branch_name: string | null;
  request_type: "join" | "exit";
  task_code: string;
  assigned_role: string;
  status: "pending" | "actioned" | "confirmed" | "waived";
  locked: number;
  trigger_event_id: string | null;
  requested_at: string;
  actioned_at: string | null;
  actioned_by: string | null;
  evidence_note: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const TASK_LABELS: Record<string, string> = {
  domain_create:    "Create Domain Account",
  biometric_enroll: "Biometric Enroll",
  domain_delete:    "Delete Domain Account",
  email_delete:     "Delete Official Email",
  biometric_delete: "Remove from Biometric",
  dialler_delete:   "Remove from Dialler / External IDs",
  WFM_PROCESS_ALIGNMENT: "WFM Process Alignment",
  IT_EMAIL_DOMAIN_ASSET: "Email, Domain, and Asset Setup",
  ADMIN_BIOMETRIC_ID_CARD: "Biometric and ID Card",
  APPOINTMENT_LETTER_ESIGN: "Appointment Letter E-Sign",
};

const ROLE_LABELS: Record<string, string> = {
  it:        "IT",
  branch_it: "Branch IT",
  admin:     "Admin",
  branch_admin: "Branch Admin",
  wfm:       "WFM",
  hr:        "HR",
};

const QUEUE_PRESETS: Record<string, { role: string; taskCode: string; title: string }> = {
  "/provisioning/wfm-alignment": {
    role: "wfm",
    taskCode: "WFM_PROCESS_ALIGNMENT",
    title: "WFM Alignment Queue",
  },
  "/provisioning/it": {
    role: "it",
    taskCode: "IT_EMAIL_DOMAIN_ASSET",
    title: "IT Provisioning Queue",
  },
  "/provisioning/admin": {
    role: "admin",
    taskCode: "ADMIN_BIOMETRIC_ID_CARD",
    title: "Admin Provisioning Queue",
  },
  "/provisioning/appointment-letter": {
    role: "hr",
    taskCode: "APPOINTMENT_LETTER_ESIGN",
    title: "Appointment Letter Queue",
  },
};

function StatusBadge({ status, locked }: { status: string; locked: number }) {
  if (locked) return (
    <Badge variant="outline" className="gap-1 text-slate-500 border-slate-300">
      <Lock className="h-3 w-3" /> Locked
    </Badge>
  );
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    pending:  { label: "Pending",  cls: "bg-amber-100 text-amber-800 border-amber-300",   icon: <Clock className="h-3 w-3" /> },
    actioned: { label: "Actioned", cls: "bg-sky-100 text-sky-800 border-sky-300",         icon: <CheckCircle className="h-3 w-3" /> },
    confirmed:{ label: "Confirmed",cls: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: <CheckCircle className="h-3 w-3" /> },
    waived:   { label: "Waived",   cls: "bg-slate-100 text-slate-700 border-slate-300",   icon: <XCircle className="h-3 w-3" /> },
  };
  const def = map[status] ?? map.pending;
  return (
    <Badge variant="outline" className={`gap-1 ${def.cls}`}>
      {def.icon}{def.label}
    </Badge>
  );
}

function TypeBadge({ type }: { type: string }) {
  return type === "join"
    ? <Badge className="bg-green-100 text-green-800 border-green-300 font-medium" variant="outline">JOIN</Badge>
    : <Badge className="bg-red-100 text-red-800 border-red-300 font-medium" variant="outline">EXIT</Badge>;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeITProvisioningTracker() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const preset = QUEUE_PRESETS[location.pathname];

  const [statusFilter, setStatusFilter]     = useState("all");
  const [typeFilter, setTypeFilter]         = useState("all");
  const [roleFilter, setRoleFilter]         = useState(preset?.role ?? "all");
  const [taskFilter, setTaskFilter]         = useState(preset?.taskCode ?? "all");
  const [searchQuery, setSearchQuery]       = useState("");
  const [page, setPage]                     = useState(1);
  const LIMIT = 50;

  // Action dialog
  const [actionDialog, setActionDialog] = useState<{ open: boolean; request: ProvisioningRequest | null; mode: "action" | "waive" | "confirm" }>({
    open: false, request: null, mode: "action",
  });
  const [evidenceNote, setEvidenceNote] = useState("");

  // ── Data fetch ───────────────────────────────────────────────────────────────
  const queryParams = {
    ...(statusFilter !== "all" && { status: statusFilter }),
    ...(typeFilter   !== "all" && { request_type: typeFilter }),
    ...(roleFilter   !== "all" && { assigned_role: roleFilter }),
    ...(taskFilter   !== "all" && { task_code: taskFilter }),
    page,
    limit: LIMIT,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["it-provisioning", queryParams],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: ProvisioningRequest[]; total: number }>(
        "/api/onboarding-provisioning/tasks",
        { params: queryParams },
      );
      return res.data;
    },
  });

  const requests: ProvisioningRequest[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT) || 1;

  // ── Stats ────────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    pending:  requests.filter(r => r.status === "pending").length,
    actioned: requests.filter(r => r.status === "actioned").length,
    locked:   requests.filter(r => r.locked).length,
  }), [requests]);

  // ── Client-side search filter ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return requests;
    const q = searchQuery.toLowerCase();
    return requests.filter(r =>
      r.employee_name.toLowerCase().includes(q) ||
      r.employee_code.toLowerCase().includes(q) ||
      (r.branch_name ?? "").toLowerCase().includes(q)
    );
  }, [requests, searchQuery]);

  // ── Mutations ────────────────────────────────────────────────────────────────
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["it-provisioning"] });

  const actionMutation = useMutation({
    mutationFn: async ({ id, mode, note }: { id: string; mode: string; note: string }) => {
      const endpoint = mode === "confirm"
        ? `/api/it-provisioning/requests/${id}/confirm`
        : mode === "action"
          ? `/api/onboarding-provisioning/tasks/${id}/complete`
          : `/api/onboarding-provisioning/tasks/${id}/waive`;
      const method = "post";
      await hrmsApi[method](endpoint, { evidence_note: note });
    },
    onSuccess: () => {
      toast.success("Request updated successfully");
      invalidate();
      setActionDialog({ open: false, request: null, mode: "action" });
      setEvidenceNote("");
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error ?? "Failed to update request");
    },
  });

  function openDialog(request: ProvisioningRequest, mode: "action" | "waive" | "confirm") {
    setActionDialog({ open: true, request, mode });
    setEvidenceNote("");
  }

  function handleSubmitAction() {
    if (!actionDialog.request) return;
    if (actionDialog.mode === "waive" && !evidenceNote.trim()) {
      toast.error("A reason is required to waive a request");
      return;
    }
    actionMutation.mutate({ id: actionDialog.request.id, mode: actionDialog.mode, note: evidenceNote });
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="h-6 w-6 text-primary" />
            {preset?.title ?? "IT Provisioning Tracker"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track domain, email, biometric, and dialler provisioning tasks for all employee joins and exits
          </p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-amber-200">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <div>
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-sky-200">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-sky-500" />
              <div>
                <p className="text-xs text-muted-foreground">Actioned</p>
                <p className="text-2xl font-bold text-sky-600">{stats.actioned}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-slate-500" />
              <div>
                <p className="text-xs text-muted-foreground">Locked (Evidence)</p>
                <p className="text-2xl font-bold text-slate-600">{stats.locked}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search employee name, code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="actioned">Actioned</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="waived">Waived</SelectItem>
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="join">Join</SelectItem>
                <SelectItem value="exit">Exit</SelectItem>
              </SelectContent>
            </Select>
            <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Assigned To" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="it">IT</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="branch_admin">Branch Admin</SelectItem>
                <SelectItem value="wfm">WFM</SelectItem>
                <SelectItem value="hr">HR</SelectItem>
              </SelectContent>
            </Select>
            <Select value={taskFilter} onValueChange={(v) => { setTaskFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[190px]"><SelectValue placeholder="Task" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tasks</SelectItem>
                {Object.entries(TASK_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Provisioning Requests
            {total > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">({total} total)</span>}
          </CardTitle>
          <CardDescription>
            Locked records are immutable audit evidence. Once locked, no further changes are allowed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Server className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="font-medium">No provisioning requests found</p>
              <p className="text-sm text-muted-foreground mt-1">Requests appear automatically when employees join or exit</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((req) => (
                    <TableRow key={req.id} className={req.locked ? "opacity-60 bg-slate-50" : undefined}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{req.employee_name}</p>
                          <p className="text-xs text-muted-foreground">{req.employee_code} {req.branch_name ? `· ${req.branch_name}` : ""}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{TASK_LABELS[req.task_code] ?? req.task_code}</TableCell>
                      <TableCell><TypeBadge type={req.request_type} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{ROLE_LABELS[req.assigned_role] ?? req.assigned_role}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(req.requested_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell><StatusBadge status={req.status} locked={req.locked} /></TableCell>
                      <TableCell className="text-right">
                        {req.locked ? (
                          <span className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                            <Lock className="h-3 w-3" /> Evidence locked
                          </span>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            {req.status === "pending" && (
                              <Button size="sm" variant="default" onClick={() => openDialog(req, "action")}>
                                Mark Actioned
                              </Button>
                            )}
                            {(req.status === "pending" || req.status === "actioned") && (
                              <Button size="sm" variant="outline" onClick={() => openDialog(req, "waive")}>
                                Waive
                              </Button>
                            )}
                            {req.status === "actioned" && (
                              <Button size="sm" variant="ghost" onClick={() => openDialog(req, "confirm")}>
                                Lock Now
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action / Waive / Confirm Dialog */}
      <Dialog open={actionDialog.open} onOpenChange={(open) => {
        if (!open) { setActionDialog({ open: false, request: null, mode: "action" }); setEvidenceNote(""); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog.mode === "action"  && "Mark Request as Actioned"}
              {actionDialog.mode === "waive"   && "Waive Provisioning Request"}
              {actionDialog.mode === "confirm" && "Lock Request as Evidence"}
            </DialogTitle>
          </DialogHeader>

          {actionDialog.request && (
            <div className="space-y-4 py-2">
              <div className="rounded-md border p-3 bg-muted/30 space-y-1">
                <p className="text-sm font-medium">{actionDialog.request.employee_name} · {actionDialog.request.employee_code}</p>
                <p className="text-xs text-muted-foreground">{TASK_LABELS[actionDialog.request.task_code] ?? actionDialog.request.task_code}</p>
                <TypeBadge type={actionDialog.request.request_type} />
              </div>

              {actionDialog.mode === "confirm" ? (
                <p className="text-sm text-muted-foreground">
                  This will immediately lock the record as immutable evidence. This cannot be undone.
                </p>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="evidence_note">
                    {actionDialog.mode === "waive" ? "Reason for waiving (required)" : "Evidence note (optional)"}
                  </Label>
                  <Textarea
                    id="evidence_note"
                    placeholder={
                      actionDialog.mode === "waive"
                        ? "Explain why this task is being waived..."
                        : "Describe the action taken (e.g. email created, biometric enrolled)..."
                    }
                    value={evidenceNote}
                    onChange={(e) => setEvidenceNote(e.target.value)}
                    rows={3}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setActionDialog({ open: false, request: null, mode: "action" });
              setEvidenceNote("");
            }}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitAction}
              disabled={actionMutation.isPending}
              variant={actionDialog.mode === "waive" ? "destructive" : "default"}
            >
              {actionMutation.isPending ? "Saving..." : (
                actionDialog.mode === "action"  ? "Confirm Action" :
                actionDialog.mode === "waive"   ? "Waive Request"  : "Lock Evidence"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
