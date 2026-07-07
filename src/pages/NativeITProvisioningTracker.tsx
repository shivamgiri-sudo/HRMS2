import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { hrmsApi } from "@/lib/hrmsApi";
import { formatISTDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { HrmsBentoTile, HrmsModernShell } from "@/components/ui/hrms-modern";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  Server, Lock, CheckCircle, Clock, AlertTriangle, Search, XCircle,
  ShieldCheck, RefreshCw, Upload, Download, User, ChevronRight,
} from "lucide-react";
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
  official_email?: string | null;
  domain_account?: string | null;
  asset_tag?: string | null;
  biometric_enrolled?: number;
  id_card_printed?: number;
}

interface CandidateReport {
  task_id: string;
  task_code: string;
  status: string;
  locked: number;
  official_email: string | null;
  domain_account: string | null;
  asset_tag: string | null;
  biometric_enrolled: number;
  id_card_printed: number;
  evidence_note: string | null;
  requested_at: string;
  actioned_at: string | null;
  employee_id: string;
  employee_code: string;
  first_name: string;
  last_name: string | null;
  personal_email: string | null;
  mobile: string | null;
  designation: string | null;
  date_of_joining: string | null;
  branch_name: string | null;
  process_name: string | null;
}

interface ITForm {
  officialEmail: string;
  domainAccount: string;
  assetTag: string;
  evidenceNote: string;
}

interface AdminForm {
  biometricEnrolled: boolean;
  idCardPrinted: boolean;
  evidenceNote: string;
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
  IT_EMAIL_DOMAIN_ASSET: "Email, Domain & Asset Setup",
  ADMIN_BIOMETRIC_ID_CARD: "Biometric & ID Card",
  APPOINTMENT_LETTER_ESIGN: "Appointment Letter E-Sign",
};

const ROLE_LABELS: Record<string, string> = {
  it: "IT", branch_it: "Branch IT", admin: "Admin",
  branch_admin: "Branch Admin", wfm: "WFM", hr: "HR",
};

const QUEUE_PRESETS: Record<string, { role: string; taskCode: string; title: string }> = {
  "/provisioning/wfm-alignment": { role: "wfm", taskCode: "WFM_PROCESS_ALIGNMENT", title: "WFM Alignment Queue" },
  "/provisioning/it":            { role: "it",  taskCode: "IT_EMAIL_DOMAIN_ASSET",  title: "IT Provisioning Queue" },
  "/provisioning/admin":         { role: "admin", taskCode: "ADMIN_BIOMETRIC_ID_CARD", title: "Admin Provisioning Queue" },
  "/provisioning/appointment-letter": { role: "hr", taskCode: "APPOINTMENT_LETTER_ESIGN", title: "Appointment Letter Queue" },
};

function StatusBadge({ status, locked }: { status: string; locked: number }) {
  if (locked) return (
    <Badge variant="outline" className="gap-1 text-slate-500 border-slate-300">
      <Lock className="h-3 w-3" aria-hidden="true" /> Locked
    </Badge>
  );
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    pending:  { label: "Pending",   cls: "bg-amber-100 text-amber-800 border-amber-300",     icon: <Clock className="h-3 w-3" aria-hidden="true" /> },
    actioned: { label: "Actioned",  cls: "bg-sky-100 text-sky-800 border-sky-300",           icon: <CheckCircle className="h-3 w-3" aria-hidden="true" /> },
    confirmed:{ label: "Confirmed", cls: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: <CheckCircle className="h-3 w-3" aria-hidden="true" /> },
    waived:   { label: "Waived",    cls: "bg-slate-100 text-slate-700 border-slate-300",     icon: <XCircle className="h-3 w-3" aria-hidden="true" /> },
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
    ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-medium" variant="outline">JOIN</Badge>
    : <Badge className="bg-rose-100 text-rose-800 border-rose-300 font-medium" variant="outline">EXIT</Badge>;
}

// ── Candidate Report Sheet ─────────────────────────────────────────────────────

function CandidateReportSheet({ taskId, open, onClose }: { taskId: string | null; open: boolean; onClose: () => void }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["candidate-report", taskId],
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: CandidateReport }>(`/api/it-provisioning/tasks/${taskId}/candidate-report`);
      return res.data;
    },
    enabled: !!taskId && open,
  });

  const r = data?.data;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <User className="h-5 w-5" aria-hidden="true" /> Candidate Report
          </SheetTitle>
          <SheetDescription>Joining & provisioning details for this employee</SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading candidate report">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <p className="text-sm text-rose-700 font-medium">{(error as any)?.message ?? "Failed to load candidate report"}</p>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="mt-3">
              Retry
            </Button>
          </div>
        ) : !r ? (
          <p className="text-sm text-muted-foreground">No data found.</p>
        ) : (
          <div className="space-y-4">
            {/* Identity */}
            <div className="rounded-xl border bg-blue-50 p-4 space-y-2">
              <p className="text-xs font-bold text-blue-800 uppercase tracking-wider">Employee Identity</p>
              <ReportRow label="Full Name" value={`${r.first_name} ${r.last_name ?? ""}`.trim()} />
              <ReportRow label="Employee Code" value={r.employee_code} />
              <ReportRow label="Designation" value={r.designation} />
              <ReportRow label="Date of Joining" value={r.date_of_joining ? formatISTDate(r.date_of_joining) : null} />
              <ReportRow label="Mobile" value={r.mobile} />
            </div>

            {/* Placement */}
            <div className="rounded-xl border bg-slate-50 p-4 space-y-2">
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Placement</p>
              <ReportRow label="Branch" value={r.branch_name} />
              <ReportRow label="Process / LOB" value={r.process_name} />
            </div>

            {/* Provisioning Status */}
            <div className="rounded-xl border bg-emerald-50 p-4 space-y-2">
              <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Provisioning Status</p>
              <ReportRow label="Task" value={TASK_LABELS[r.task_code] ?? r.task_code} />
              <ReportRow label="Status" value={r.status.charAt(0).toUpperCase() + r.status.slice(1)} />
              <ReportRow label="Official Email" value={r.official_email ?? "— Not yet assigned"} />
              <ReportRow label="Domain Account" value={r.domain_account ?? "— Not yet assigned"} />
              <ReportRow label="Asset Tag" value={r.asset_tag ?? "— Not assigned"} />
              <ReportRow label="Biometric Enrolled" value={r.biometric_enrolled ? "Yes" : "No"} />
              <ReportRow label="ID Card Printed" value={r.id_card_printed ? "Yes" : "No"} />
              <ReportRow label="Evidence Note" value={r.evidence_note} />
              <ReportRow label="Requested At" value={r.requested_at ? formatISTDate(r.requested_at) : null} />
              <ReportRow label="Actioned At" value={r.actioned_at ? formatISTDate(r.actioned_at) : null} />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReportRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-slate-500 shrink-0 w-36">{label}</span>
      <span className="font-medium text-slate-800 text-right">{value ?? "—"}</span>
    </div>
  );
}

// ── Bulk Upload Dialog ─────────────────────────────────────────────────────────

function BulkUploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvRows, setCsvRows] = useState<Array<{ employee_code: string; official_email: string; domain_account: string; asset_tag: string }>>([]);
  const [parseError, setParseError] = useState("");

  const CSV_TEMPLATE = "employee_code,official_email,domain_account,asset_tag\nEMP001,firstname.lastname@masgroup.in,firstname.l,LAP-0042";

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setParseError("");
    setCsvRows([]);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.trim().split(/\r?\n/);
      if (lines.length < 2) { setParseError("CSV must have a header row and at least one data row."); return; }
      const header = lines[0].split(",").map(h => h.trim().toLowerCase());
      const colIdx = (col: string) => header.indexOf(col);
      const ecIdx = colIdx("employee_code");
      if (ecIdx === -1) { setParseError("Column 'employee_code' not found."); return; }
      const oeIdx = colIdx("official_email");
      const daIdx = colIdx("domain_account");
      const atIdx = colIdx("asset_tag");
      const parsed = lines.slice(1).filter(l => l.trim()).map(line => {
        const cols = line.split(",").map(c => c.trim());
        return {
          employee_code: cols[ecIdx] ?? "",
          official_email: oeIdx >= 0 ? (cols[oeIdx] ?? "") : "",
          domain_account: daIdx >= 0 ? (cols[daIdx] ?? "") : "",
          asset_tag: atIdx >= 0 ? (cols[atIdx] ?? "") : "",
        };
      });
      setCsvRows(parsed);
    };
    reader.readAsText(file);
  }

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const res = await hrmsApi.post<{ success: boolean; processed: number; completed: number; results: any[] }>(
        "/api/it-provisioning/tasks/bulk-complete",
        { rows: csvRows },
      );
      return res;
    },
    onSuccess: (res: any) => {
      toast.success(`Bulk upload: ${res.completed ?? 0} / ${res.processed ?? 0} tasks completed`);
      queryClient.invalidateQueries({ queryKey: ["it-provisioning"] });
      onClose();
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? "Bulk upload failed"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5" aria-hidden="true" /> Bulk IT Provisioning Upload</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            Upload a CSV with columns: <strong>employee_code</strong>, <strong>official_email</strong>, <strong>domain_account</strong>, asset_tag (optional).
            Official email and domain account are mandatory for each row.
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => {
            const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "it_provisioning_template.csv"; a.click();
            URL.revokeObjectURL(url);
          }}>
            <Download className="h-4 w-4" /> Download CSV Template
          </Button>
          <div>
            <Label htmlFor="bulk-csv-upload">Upload CSV File</Label>
            <input id="bulk-csv-upload" ref={fileRef} type="file" accept=".csv" onChange={handleFileChange} className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100" />
          </div>
          {parseError && <p className="text-sm text-red-600">{parseError}</p>}
          {csvRows.length > 0 && (
            <div className="rounded-xl border max-h-48 overflow-y-auto">
              <Table>
                <TableHeader><TableRow className="bg-slate-50">
                  <TableHead className="text-xs">Code</TableHead>
                  <TableHead className="text-xs">Email</TableHead>
                  <TableHead className="text-xs">Domain</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {csvRows.slice(0, 10).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs py-1">{r.employee_code}</TableCell>
                      <TableCell className="text-xs py-1">{r.official_email}</TableCell>
                      <TableCell className="text-xs py-1">{r.domain_account}</TableCell>
                    </TableRow>
                  ))}
                  {csvRows.length > 10 && <TableRow><TableCell colSpan={3} className="text-xs text-center text-muted-foreground py-1">…and {csvRows.length - 10} more</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={csvRows.length === 0 || bulkMutation.isPending}
            onClick={() => bulkMutation.mutate()}
          >
            {bulkMutation.isPending ? "Uploading…" : `Submit ${csvRows.length} Row${csvRows.length !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Task-Specific Action Form ──────────────────────────────────────────────────

function ITTaskForm({ form, setForm, disabled }: {
  form: ITForm;
  setForm: React.Dispatch<React.SetStateAction<ITForm>>;
  disabled: boolean;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="it-official-email">Official Email ID Created <span className="text-rose-500">*</span></Label>
        <Input
          id="it-official-email"
          value={form.officialEmail}
          onChange={e => setForm(f => ({ ...f, officialEmail: e.target.value }))}
          placeholder="firstname.lastname@masgroup.in"
          disabled={disabled}
          className="mt-1 min-h-[44px]"
        />
      </div>
      <div>
        <Label htmlFor="it-domain-account">Domain Account / AD Username <span className="text-rose-500">*</span></Label>
        <Input
          id="it-domain-account"
          value={form.domainAccount}
          onChange={e => setForm(f => ({ ...f, domainAccount: e.target.value }))}
          placeholder="firstname.l"
          disabled={disabled}
          className="mt-1 min-h-[44px]"
        />
      </div>
      <div>
        <Label htmlFor="it-asset-tag">Asset Tag <span className="text-slate-400 font-normal">(optional)</span></Label>
        <Input
          id="it-asset-tag"
          value={form.assetTag}
          onChange={e => setForm(f => ({ ...f, assetTag: e.target.value }))}
          placeholder="LAP-0042 or leave blank"
          disabled={disabled}
          className="mt-1 min-h-[44px]"
        />
      </div>
      <div>
        <Label htmlFor="it-notes">Additional Notes <span className="text-slate-400 font-normal">(optional)</span></Label>
        <Textarea
          id="it-notes"
          value={form.evidenceNote}
          onChange={e => setForm(f => ({ ...f, evidenceNote: e.target.value }))}
          placeholder="Any additional notes..."
          rows={2}
          disabled={disabled}
          className="mt-1"
        />
      </div>
    </div>
  );
}

function AdminTaskForm({ form, setForm, disabled }: {
  form: AdminForm;
  setForm: React.Dispatch<React.SetStateAction<AdminForm>>;
  disabled: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Check off completed actions:</p>
      <label className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${form.biometricEnrolled ? "border-emerald-300 bg-emerald-50" : "hover:bg-slate-50"}`}>
        <Checkbox
          checked={form.biometricEnrolled}
          onCheckedChange={v => setForm(f => ({ ...f, biometricEnrolled: !!v }))}
          disabled={disabled}
        />
        <span className="font-medium text-sm">Biometric enrollment completed</span>
      </label>
      <label className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${form.idCardPrinted ? "border-emerald-300 bg-emerald-50" : "hover:bg-slate-50"}`}>
        <Checkbox
          checked={form.idCardPrinted}
          onCheckedChange={v => setForm(f => ({ ...f, idCardPrinted: !!v }))}
          disabled={disabled}
        />
        <span className="font-medium text-sm">Employee ID card printed and issued</span>
      </label>
      <div>
        <Label htmlFor="admin-notes">Notes <span className="text-slate-400 font-normal">(optional)</span></Label>
        <Textarea
          id="admin-notes"
          value={form.evidenceNote}
          onChange={e => setForm(f => ({ ...f, evidenceNote: e.target.value }))}
          placeholder="Any notes about this action..."
          rows={2}
          disabled={disabled}
          className="mt-1"
        />
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeITProvisioningTracker() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const preset = QUEUE_PRESETS[location.pathname];

  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter]     = useState("all");
  const [roleFilter, setRoleFilter]     = useState(preset?.role ?? "all");
  const [taskFilter, setTaskFilter]     = useState(preset?.taskCode ?? "all");
  const [searchQuery, setSearchQuery]   = useState("");
  const [page, setPage]                 = useState(1);
  const LIMIT = 50;

  // Dialogs
  const [actionDialog, setActionDialog] = useState<{ open: boolean; request: ProvisioningRequest | null; mode: "action" | "waive" | "confirm" }>({
    open: false, request: null, mode: "action",
  });
  const [evidenceNote, setEvidenceNote] = useState("");
  const [itForm, setItForm]       = useState<ITForm>({ officialEmail: "", domainAccount: "", assetTag: "", evidenceNote: "" });
  const [adminForm, setAdminForm] = useState<AdminForm>({ biometricEnrolled: false, idCardPrinted: false, evidenceNote: "" });
  const [reportTaskId, setReportTaskId] = useState<string | null>(null);
  const [reportOpen, setReportOpen]     = useState(false);
  const [bulkOpen, setBulkOpen]         = useState(false);

  // ── Data fetch ───────────────────────────────────────────────────────────────
  const queryParams = {
    ...(statusFilter !== "all" && { status: statusFilter }),
    ...(typeFilter   !== "all" && { request_type: typeFilter }),
    ...(roleFilter   !== "all" && { assigned_role: roleFilter }),
    ...(taskFilter   !== "all" && { task_code: taskFilter }),
    page, limit: LIMIT,
  };

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
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

  const stats = useMemo(() => ({
    pending:  requests.filter(r => r.status === "pending").length,
    actioned: requests.filter(r => r.status === "actioned").length,
    locked:   requests.filter(r => r.locked).length,
  }), [requests]);

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
    mutationFn: async ({ id, mode, body }: { id: string; mode: string; body: Record<string, unknown> }) => {
      const endpoint = mode === "confirm"
        ? `/api/it-provisioning/requests/${id}/confirm`
        : mode === "action"
          ? `/api/it-provisioning/tasks/${id}/complete`
          : `/api/onboarding-provisioning/tasks/${id}/waive`;
      await hrmsApi.post(endpoint, body);
    },
    onSuccess: () => {
      toast.success("Request updated successfully");
      invalidate();
      setActionDialog({ open: false, request: null, mode: "action" });
      resetForms();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? err?.response?.data?.error ?? "Failed to update request");
    },
  });

  function resetForms() {
    setEvidenceNote("");
    setItForm({ officialEmail: "", domainAccount: "", assetTag: "", evidenceNote: "" });
    setAdminForm({ biometricEnrolled: false, idCardPrinted: false, evidenceNote: "" });
  }

  function openDialog(request: ProvisioningRequest, mode: "action" | "waive" | "confirm") {
    setActionDialog({ open: true, request, mode });
    resetForms();
    // Pre-populate if already has values
    if (request.official_email) setItForm(f => ({ ...f, officialEmail: request.official_email ?? "" }));
    if (request.domain_account) setItForm(f => ({ ...f, domainAccount: request.domain_account ?? "" }));
    if (request.asset_tag)      setItForm(f => ({ ...f, assetTag: request.asset_tag ?? "" }));
    if (request.biometric_enrolled) setAdminForm(f => ({ ...f, biometricEnrolled: !!request.biometric_enrolled }));
    if (request.id_card_printed)    setAdminForm(f => ({ ...f, idCardPrinted: !!request.id_card_printed }));
  }

  function handleSubmitAction() {
    if (!actionDialog.request) return;
    const { mode, request } = actionDialog;

    if (mode === "waive" && !evidenceNote.trim()) {
      toast.error("A reason is required to waive a request");
      return;
    }

    let body: Record<string, unknown> = {};

    if (mode === "action") {
      if (request.task_code === "IT_EMAIL_DOMAIN_ASSET") {
        if (!itForm.officialEmail.trim() || !itForm.domainAccount.trim()) {
          toast.error("Official Email and Domain Account are required");
          return;
        }
        body = {
          official_email: itForm.officialEmail.trim(),
          domain_account: itForm.domainAccount.trim(),
          asset_tag: itForm.assetTag.trim() || null,
          evidence_note: itForm.evidenceNote.trim() || `Email: ${itForm.officialEmail}, Domain: ${itForm.domainAccount}`,
        };
      } else if (request.task_code === "ADMIN_BIOMETRIC_ID_CARD") {
        body = {
          biometric_enrolled: adminForm.biometricEnrolled ? 1 : 0,
          id_card_printed: adminForm.idCardPrinted ? 1 : 0,
          evidence_note: adminForm.evidenceNote.trim() || `Biometric: ${adminForm.biometricEnrolled ? "done" : "pending"}, ID Card: ${adminForm.idCardPrinted ? "issued" : "pending"}`,
        };
      } else {
        body = { evidence_note: evidenceNote.trim() || "Completed from provisioning queue" };
      }
    } else {
      body = { evidence_note: evidenceNote.trim() };
    }

    actionMutation.mutate({ id: request.id, mode, body });
  }

  function openReport(taskId: string) {
    setReportTaskId(taskId);
    setReportOpen(true);
  }

  const isITQueue   = preset?.taskCode === "IT_EMAIL_DOMAIN_ASSET";
  const isAdminQueue = preset?.taskCode === "ADMIN_BIOMETRIC_ID_CARD";

  const currentTaskCode = actionDialog.request?.task_code ?? "";
  const isITTask    = currentTaskCode === "IT_EMAIL_DOMAIN_ASSET";
  const isAdminTask = currentTaskCode === "ADMIN_BIOMETRIC_ID_CARD";

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
    <HrmsModernShell
      eyebrow="Provisioning"
      title={preset?.title ?? "IT Provisioning Tracker"}
      description="Track domain, email, biometric, ID card, WFM, and appointment-letter tasks generated from employee joins and exits."
      icon={<Server className="h-6 w-6" />}
      actions={
        <div className="flex gap-2">
          {isITQueue && (
            <Button variant="outline" onClick={() => setBulkOpen(true)} className="gap-2 min-h-[44px]">
              <Upload className="h-4 w-4" aria-hidden="true" /> Bulk Upload
            </Button>
          )}
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-2 min-h-[44px]">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      }
    >
      {/* Stats bar */}
      <div className="grid gap-4 md:grid-cols-3">
        <HrmsBentoTile title="Pending"        value={stats.pending}  detail={`${total} open records in this queue`}       icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}  accentClassName="from-amber-500 to-orange-500" />
        <HrmsBentoTile title="Actioned"       value={stats.actioned} detail="Completed, waiting for lock or confirmation" icon={<CheckCircle   className="h-5 w-5 text-sky-600" />}     accentClassName="from-sky-500 to-blue-500" />
        <HrmsBentoTile title="Locked Evidence" value={stats.locked}  detail="Immutable audit trail records"               icon={<ShieldCheck   className="h-5 w-5 text-emerald-600" />} accentClassName="from-emerald-500 to-teal-500" />
      </div>

      {/* Filters */}
      <Card className="rounded-xl border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-slate-900">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Label htmlFor="search-employees" className="sr-only">Search employees</Label>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
              <Input id="search-employees" placeholder="Search employee name, code..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 min-h-[44px]" />
            </div>
            <div className="w-[140px]">
              <Label htmlFor="filter-status" className="sr-only">Filter by status</Label>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger id="filter-status" className="min-h-[44px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="actioned">Actioned</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="waived">Waived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-[120px]">
              <Label htmlFor="filter-type" className="sr-only">Filter by request type</Label>
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
                <SelectTrigger id="filter-type" className="min-h-[44px]"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="join">Join</SelectItem>
                  <SelectItem value="exit">Exit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-[140px]">
              <Label htmlFor="filter-role" className="sr-only">Filter by assigned role</Label>
              <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1); }}>
                <SelectTrigger id="filter-role" className="min-h-[44px]"><SelectValue placeholder="Assigned To" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="it">IT</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="branch_admin">Branch Admin</SelectItem>
                  <SelectItem value="wfm">WFM</SelectItem>
                  <SelectItem value="hr">HR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-[190px]">
              <Label htmlFor="filter-task" className="sr-only">Filter by task type</Label>
              <Select value={taskFilter} onValueChange={(v) => { setTaskFilter(v); setPage(1); }}>
                <SelectTrigger id="filter-task" className="min-h-[44px]"><SelectValue placeholder="Task" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tasks</SelectItem>
                  {Object.entries(TASK_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden rounded-xl border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-slate-900">
            Provisioning Requests
            {total > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">({total} total)</span>}
          </CardTitle>
          <CardDescription>Click an employee row to view the full candidate report. Locked records are immutable audit evidence.</CardDescription>
        </CardHeader>
        <CardContent>
          {isError && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3 mb-4">
              <AlertTriangle className="h-5 w-5 text-rose-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-rose-700 font-medium">{(error as any)?.message ?? "Failed to load provisioning requests"}</p>
                <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-2 min-h-[44px]">
                  <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" /> Retry
                </Button>
              </div>
            </div>
          )}
          {isLoading ? (
            <div className="space-y-3" aria-busy="true" aria-label="Loading provisioning requests">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Server className="h-10 w-10 text-slate-300 mb-3" aria-hidden="true" />
              <h3 className="text-base font-bold text-slate-700">No provisioning requests found</h3>
              <p className="text-sm text-slate-500 mt-1">Requests appear automatically when employees join or exit</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50">
                    <TableHead>Employee</TableHead>
                    <TableHead>Task</TableHead>
                    {isITQueue && <TableHead>Email / Domain</TableHead>}
                    {isAdminQueue && <TableHead>Biometric / ID</TableHead>}
                    <TableHead>Type</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((req) => (
                    <TableRow key={req.id} className={req.locked ? "bg-slate-50 opacity-70" : "hover:bg-blue-50/40"}>
                      <TableCell>
                        <button
                          onClick={() => openReport(req.id)}
                          className="flex items-center gap-1 group text-left w-full focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded p-1 -m-1"
                          aria-label={`View candidate report for ${req.employee_name}`}
                        >
                          <div>
                            <p className="font-medium">{req.employee_name}</p>
                            <p className="text-xs text-muted-foreground">{req.employee_code} {req.branch_name ? `· ${req.branch_name}` : ""}</p>
                          </div>
                          <ChevronRight className="h-3 w-3 text-slate-300 group-hover:text-blue-500 ml-1 flex-shrink-0" aria-hidden="true" />
                        </button>
                      </TableCell>
                      <TableCell className="text-sm">{TASK_LABELS[req.task_code] ?? req.task_code}</TableCell>
                      {isITQueue && (
                        <TableCell className="text-xs text-muted-foreground">
                          {req.official_email ? <span className="text-emerald-700 font-medium">{req.official_email}</span> : "—"}
                          {req.domain_account && <><br />{req.domain_account}</>}
                        </TableCell>
                      )}
                      {isAdminQueue && (
                        <TableCell className="text-xs">
                          <span className={req.biometric_enrolled ? "text-emerald-600" : "text-slate-400"}>Bio: {req.biometric_enrolled ? "Done" : "Pending"}</span>
                          {" · "}
                          <span className={req.id_card_printed ? "text-emerald-600" : "text-slate-400"}>ID: {req.id_card_printed ? "Done" : "Pending"}</span>
                        </TableCell>
                      )}
                      <TableCell><TypeBadge type={req.request_type} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{ROLE_LABELS[req.assigned_role] ?? req.assigned_role}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{formatISTDate(req.requested_at)}</TableCell>
                      <TableCell><StatusBadge status={req.status} locked={req.locked} /></TableCell>
                      <TableCell className="text-right">
                        {req.locked ? (
                          <span className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                            <Lock className="h-3 w-3" aria-hidden="true" /> Evidence locked
                          </span>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            {req.status === "pending" && (
                              <Button
                                variant="default"
                                onClick={() => openDialog(req, "action")}
                                aria-label={`${isITQueue ? "Submit IT details for" : isAdminQueue ? "Mark admin actions done for" : "Mark actioned for"} ${req.employee_name}`}
                                className="min-h-[44px]"
                              >
                                {isITQueue ? "Submit Details" : isAdminQueue ? "Mark Done" : "Mark Actioned"}
                              </Button>
                            )}
                            {(req.status === "pending" || req.status === "actioned") && (
                              <Button
                                variant="outline"
                                onClick={() => openDialog(req, "waive")}
                                aria-label={`Waive provisioning task for ${req.employee_name}`}
                                className="min-h-[44px]"
                              >
                                Waive
                              </Button>
                            )}
                            {req.status === "actioned" && (
                              <Button
                                variant="ghost"
                                onClick={() => openDialog(req, "confirm")}
                                aria-label={`Lock provisioning evidence for ${req.employee_name}`}
                                className="min-h-[44px]"
                              >
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

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <Button variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="min-h-[44px]">Previous</Button>
              <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="min-h-[44px]">Next</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action / Waive / Confirm Dialog */}
      <Dialog open={actionDialog.open} onOpenChange={(open) => {
        if (!open) { setActionDialog({ open: false, request: null, mode: "action" }); resetForms(); }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {actionDialog.mode === "action"  && (isITTask ? "Submit IT Provisioning Details" : isAdminTask ? "Record Admin Actions" : "Mark Request as Actioned")}
              {actionDialog.mode === "waive"   && "Waive Provisioning Request"}
              {actionDialog.mode === "confirm" && "Lock Request as Evidence"}
            </DialogTitle>
          </DialogHeader>

          {actionDialog.request && (
            <div className="space-y-4 py-2">
              <div className="rounded-xl border p-3 bg-muted/30 space-y-1">
                <p className="text-sm font-medium">{actionDialog.request.employee_name} · {actionDialog.request.employee_code}</p>
                <p className="text-xs text-muted-foreground">{TASK_LABELS[actionDialog.request.task_code] ?? actionDialog.request.task_code}</p>
                <TypeBadge type={actionDialog.request.request_type} />
              </div>

              {actionDialog.mode === "confirm" ? (
                <p className="text-sm text-muted-foreground">This will immediately lock the record as immutable evidence. This cannot be undone.</p>
              ) : actionDialog.mode === "waive" ? (
                <div className="space-y-2">
                  <Label htmlFor="waive_reason">Reason for waiving <span className="text-rose-500">*</span></Label>
                  <Textarea
                    id="waive_reason"
                    placeholder="Explain why this task is being waived..."
                    value={evidenceNote}
                    onChange={(e) => setEvidenceNote(e.target.value)}
                    rows={3}
                  />
                </div>
              ) : isITTask ? (
                <ITTaskForm form={itForm} setForm={setItForm} disabled={actionMutation.isPending} />
              ) : isAdminTask ? (
                <AdminTaskForm form={adminForm} setForm={setAdminForm} disabled={actionMutation.isPending} />
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="evidence_note">Evidence note (optional)</Label>
                  <Textarea
                    id="evidence_note"
                    placeholder="Describe the action taken..."
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
              resetForms();
            }}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitAction}
              disabled={actionMutation.isPending}
              variant={actionDialog.mode === "waive" ? "destructive" : "default"}
              className="min-h-[44px]"
            >
              {actionMutation.isPending && <Loader2 className="animate-spin h-4 w-4 mr-1" aria-hidden="true" />}
              {actionMutation.isPending ? "Saving..." : (
                actionDialog.mode === "action"  ? (isITTask ? "Submit & Mark Done" : isAdminTask ? "Save Status" : "Confirm Action") :
                actionDialog.mode === "waive"   ? "Waive Request" : "Lock Evidence"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Candidate Report Sheet */}
      <CandidateReportSheet taskId={reportTaskId} open={reportOpen} onClose={() => setReportOpen(false)} />

      {/* Bulk Upload Dialog */}
      <BulkUploadDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </HrmsModernShell>
    </DashboardLayout>
  );
}
