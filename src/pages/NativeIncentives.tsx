import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

interface IncentiveMaster {
  id: number;
  incentive_code: string;
  incentive_name: string;
  description?: string;
  gl_code?: string;
  taxable: boolean | 1 | 0;
  pf_applicable: boolean | 1 | 0;
  esic_applicable: boolean | 1 | 0;
  status: "active" | "inactive";
}

interface IncentiveBatch {
  id: number;
  incentive_type_id: number;
  incentive_name?: string;
  pay_month: string; // "YYYY-MM"
  total_employees: number;
  total_amount: number;
  status: "draft" | "pending_approval" | "approved" | "rejected" | "applied";
  upload_date?: string;
  created_at?: string;
}

interface IncentiveLine {
  id: number;
  batch_id: number;
  employee_code: string;
  employee_name?: string;
  amount: number;
  status?: string;
  error_message?: string;
}

interface ImportResult {
  ok: number;
  errors: number;
  error_details?: { row: string; error: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toBool(val: boolean | 1 | 0 | undefined): boolean {
  return val === true || val === 1;
}

function currentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function statusColor(
  status: IncentiveBatch["status"]
): "secondary" | "outline" | "default" | "destructive" {
  switch (status) {
    case "draft":
      return "secondary";
    case "pending_approval":
      return "outline";
    case "approved":
      return "default";
    case "rejected":
      return "destructive";
    case "applied":
      return "default";
    default:
      return "secondary";
  }
}

function statusLabel(status: IncentiveBatch["status"]): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "pending_approval":
      return "Pending Approval";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "applied":
      return "Applied";
    default:
      return status;
  }
}

function statusBadgeClass(status: IncentiveBatch["status"]): string {
  switch (status) {
    case "draft":
      return "bg-gray-100 text-gray-700";
    case "pending_approval":
      return "bg-amber-100 text-amber-800";
    case "approved":
      return "bg-green-100 text-green-800";
    case "rejected":
      return "bg-red-100 text-red-800";
    case "applied":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

// Parse textarea content: lines of "EMP001,5000" or a JSON array
function parseUploadLines(
  raw: string
): { employee_code: string; amount: number }[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => ({
          employee_code: String(item.employee_code ?? item.emp_code ?? ""),
          amount: Number(item.amount ?? 0),
        }));
      }
    } catch {
      // fall through to CSV parsing
    }
  }
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [code, amt] = line.split(",");
      return {
        employee_code: (code ?? "").trim(),
        amount: parseFloat((amt ?? "0").trim()) || 0,
      };
    });
}

// ─── Tab 1: Incentive Types Master ───────────────────────────────────────────

function emptyMasterForm(): Omit<IncentiveMaster, "id" | "status"> {
  return {
    incentive_code: "",
    incentive_name: "",
    description: "",
    gl_code: "",
    taxable: false,
    pf_applicable: false,
    esic_applicable: false,
  };
}

function IncentiveTypesTab() {
  const qc = useQueryClient();

  const { data: mastersData, isLoading } = useQuery<{ data: IncentiveMaster[] } | IncentiveMaster[]>({
    queryKey: ["incentive-masters"],
    queryFn: () => hrmsApi.get("/api/incentives/masters"),
  });

  const masters: IncentiveMaster[] = Array.isArray(mastersData)
    ? mastersData
    : (mastersData as { data?: IncentiveMaster[] })?.data ?? [];

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyMasterForm());

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState(emptyMasterForm());

  // Delete confirm
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const addMutation = useMutation({
    mutationFn: (body: typeof addForm) =>
      hrmsApi.post("/api/incentives/masters", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incentive-masters"] });
      setAddOpen(false);
      setAddForm(emptyMasterForm());
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const editMutation = useMutation({
    mutationFn: (body: typeof editForm) =>
      hrmsApi.put(`/api/incentives/masters/${editId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incentive-masters"] });
      setEditOpen(false);
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => hrmsApi.delete(`/api/incentives/masters/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incentive-masters"] });
      setDeleteOpen(false);
      setDeleteId(null);
    },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  function openEdit(m: IncentiveMaster) {
    setEditId(m.id);
    setEditForm({
      incentive_code: m.incentive_code,
      incentive_name: m.incentive_name,
      description: m.description ?? "",
      gl_code: m.gl_code ?? "",
      taxable: toBool(m.taxable),
      pf_applicable: toBool(m.pf_applicable),
      esic_applicable: toBool(m.esic_applicable),
    });
    setEditOpen(true);
  }

  function openDelete(id: number) {
    setDeleteId(id);
    setDeleteOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Incentive Types</h2>
        <Button onClick={() => { setAddForm(emptyMasterForm()); setAddOpen(true); }}>
          + Add Incentive Type
        </Button>
      </div>

      {errorMsg && (
        <div className="text-sm text-red-600 bg-red-50 rounded p-2">
          {errorMsg}
          <button className="ml-2 underline" onClick={() => setErrorMsg(null)}>Dismiss</button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Taxable</TableHead>
                <TableHead>PF Applicable</TableHead>
                <TableHead>ESIC Applicable</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && masters.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No incentive types found.
                  </TableCell>
                </TableRow>
              )}
              {masters.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-sm">{m.incentive_code}</TableCell>
                  <TableCell>{m.incentive_name}</TableCell>
                  <TableCell>{toBool(m.taxable) ? "Yes" : "No"}</TableCell>
                  <TableCell>{toBool(m.pf_applicable) ? "Yes" : "No"}</TableCell>
                  <TableCell>{toBool(m.esic_applicable) ? "Yes" : "No"}</TableCell>
                  <TableCell>
                    <Badge variant={m.status === "active" ? "default" : "secondary"}>
                      {m.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(m)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => openDelete(m.id)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Incentive Type</DialogTitle>
          </DialogHeader>
          <MasterForm form={addForm} onChange={setAddForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => addMutation.mutate(addForm)}
              disabled={addMutation.isPending}
            >
              {addMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Incentive Type</DialogTitle>
          </DialogHeader>
          <MasterForm form={editForm} onChange={setEditForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => editMutation.mutate(editForm)}
              disabled={editMutation.isPending}
            >
              {editMutation.isPending ? "Saving…" : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will soft-delete the incentive type. Existing batch records will
            not be affected. Continue?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface MasterFormProps {
  form: Omit<IncentiveMaster, "id" | "status">;
  onChange: (f: Omit<IncentiveMaster, "id" | "status">) => void;
}

function MasterForm({ form, onChange }: MasterFormProps) {
  function field(
    key: keyof Omit<IncentiveMaster, "id" | "status">,
    value: string
  ) {
    onChange({ ...form, [key]: value });
  }
  function toggle(key: "taxable" | "pf_applicable" | "esic_applicable") {
    onChange({ ...form, [key]: !form[key] });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Incentive Code *</Label>
          <Input
            value={form.incentive_code}
            onChange={(e) => field("incentive_code", e.target.value)}
            placeholder="e.g. PERF_BONUS"
          />
        </div>
        <div className="space-y-1">
          <Label>Incentive Name *</Label>
          <Input
            value={form.incentive_name}
            onChange={(e) => field("incentive_name", e.target.value)}
            placeholder="e.g. Performance Bonus"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label>GL Code</Label>
        <Input
          value={form.gl_code ?? ""}
          onChange={(e) => field("gl_code", e.target.value)}
          placeholder="e.g. 5001"
        />
      </div>
      <div className="space-y-1">
        <Label>Description</Label>
        <Textarea
          value={form.description ?? ""}
          onChange={(e) => field("description", e.target.value)}
          rows={2}
        />
      </div>
      <div className="flex gap-6 pt-1">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={toBool(form.taxable)}
            onChange={() => toggle("taxable")}
          />
          Taxable
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={toBool(form.pf_applicable)}
            onChange={() => toggle("pf_applicable")}
          />
          PF Applicable
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={toBool(form.esic_applicable)}
            onChange={() => toggle("esic_applicable")}
          />
          ESIC Applicable
        </label>
      </div>
    </div>
  );
}

// ─── Tab 2: Monthly Upload ────────────────────────────────────────────────────

function MonthlyUploadTab() {
  const qc = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth());

  const { data: batchesData, isLoading: batchesLoading } = useQuery<
    { data: IncentiveBatch[] } | IncentiveBatch[]
  >({
    queryKey: ["incentive-batches", selectedMonth],
    queryFn: () =>
      hrmsApi.get(`/api/incentives/batches?month=${selectedMonth}`),
  });

  const batches: IncentiveBatch[] = Array.isArray(batchesData)
    ? batchesData
    : (batchesData as { data?: IncentiveBatch[] })?.data ?? [];

  const { data: mastersData } = useQuery<
    { data: IncentiveMaster[] } | IncentiveMaster[]
  >({
    queryKey: ["incentive-masters"],
    queryFn: () => hrmsApi.get("/api/incentives/masters"),
  });
  const masters: IncentiveMaster[] = Array.isArray(mastersData)
    ? mastersData
    : (mastersData as { data?: IncentiveMaster[] })?.data ?? [];

  // New upload dialog
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTypeId, setUploadTypeId] = useState<string>("");
  const [uploadLines, setUploadLines] = useState("");
  const [uploadResult, setUploadResult] = useState<ImportResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // View lines dialog
  const [viewBatchId, setViewBatchId] = useState<number | null>(null);
  const [viewLinesOpen, setViewLinesOpen] = useState(false);

  const { data: linesData, isLoading: linesLoading } = useQuery<
    { data: IncentiveLine[] } | IncentiveLine[]
  >({
    queryKey: ["incentive-batch-lines", viewBatchId],
    queryFn: () =>
      hrmsApi.get(`/api/incentives/batches/${viewBatchId}/lines`),
    enabled: viewBatchId !== null && viewLinesOpen,
  });
  const lines: IncentiveLine[] = Array.isArray(linesData)
    ? linesData
    : (linesData as { data?: IncentiveLine[] })?.data ?? [];

  const createBatchMutation = useMutation({
    mutationFn: async () => {
      setUploadError(null);
      setUploadResult(null);
      const parsed = parseUploadLines(uploadLines);
      if (!uploadTypeId) throw new Error("Select an incentive type.");
      if (parsed.length === 0) throw new Error("No lines to upload.");

      // Step 1: create batch
      const batch = await hrmsApi.post<{ id: number } | { data: { id: number } }>(
        "/api/incentives/batches",
        {
          incentive_type_id: Number(uploadTypeId),
          pay_month: selectedMonth,
        }
      );
      const batchId =
        "data" in batch
          ? (batch as { data: { id: number } }).data.id
          : (batch as { id: number }).id;

      // Step 2: import lines
      const result = await hrmsApi.post<ImportResult>(
        `/api/incentives/batches/${batchId}/lines/import`,
        { lines: parsed }
      );
      return result;
    },
    onSuccess: (result) => {
      setUploadResult(result);
      qc.invalidateQueries({ queryKey: ["incentive-batches", selectedMonth] });
    },
    onError: (e: Error) => setUploadError(e.message),
  });

  const submitMutation = useMutation({
    mutationFn: (batchId: number) =>
      hrmsApi.post(`/api/incentives/batches/${batchId}/submit`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incentive-batches", selectedMonth] });
    },
  });

  function openViewLines(batchId: number) {
    setViewBatchId(batchId);
    setViewLinesOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Label>Month</Label>
          <Input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-40"
          />
        </div>
        <Button onClick={() => { setUploadOpen(true); setUploadResult(null); setUploadError(null); setUploadLines(""); setUploadTypeId(""); }}>
          + New Upload
        </Button>
      </div>

      {batchesLoading && (
        <p className="text-sm text-muted-foreground">Loading batches…</p>
      )}

      {!batchesLoading && batches.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No batches for {selectedMonth}.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {batches.map((batch) => (
          <Card key={batch.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex justify-between items-start">
                <span>{batch.incentive_name ?? `Type #${batch.incentive_type_id}`}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadgeClass(batch.status)}`}
                >
                  {statusLabel(batch.status)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Month</span>
                <span>{batch.pay_month}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Employees</span>
                <span>{batch.total_employees}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Total Amount</span>
                <span>₹{Number(batch.total_amount).toLocaleString("en-IN")}</span>
              </div>
              {(batch.upload_date ?? batch.created_at) && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Uploaded</span>
                  <span>
                    {new Date(
                      batch.upload_date ?? batch.created_at ?? ""
                    ).toLocaleDateString()}
                  </span>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openViewLines(batch.id)}
                >
                  View Lines
                </Button>
                {batch.status === "draft" && (
                  <Button
                    size="sm"
                    onClick={() => submitMutation.mutate(batch.id)}
                    disabled={submitMutation.isPending}
                  >
                    Submit for Approval
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* New Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Incentive Upload</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Incentive Type *</Label>
              <Select value={uploadTypeId} onValueChange={setUploadTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select incentive type" />
                </SelectTrigger>
                <SelectContent>
                  {masters
                    .filter((m) => m.status === "active")
                    .map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.incentive_name} ({m.incentive_code})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Month</Label>
              <Input value={selectedMonth} readOnly className="bg-muted" />
            </div>
            <div className="space-y-1">
              <Label>Employee Lines *</Label>
              <p className="text-xs text-muted-foreground">
                One per line: <code>EMP001,5000</code> — or paste a JSON array{" "}
                <code>{`[{"employee_code":"EMP001","amount":5000}]`}</code>
              </p>
              <Textarea
                rows={8}
                value={uploadLines}
                onChange={(e) => setUploadLines(e.target.value)}
                placeholder={"EMP001,5000\nEMP002,3500\nEMP003,4200"}
                className="font-mono text-sm"
              />
            </div>
            {uploadError && (
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded">
                {uploadError}
              </p>
            )}
            {uploadResult && (
              <div className="text-sm bg-green-50 border border-green-200 rounded p-3 space-y-1">
                <p className="font-medium text-green-800">
                  Import complete — {uploadResult.ok} line(s) imported successfully
                  {uploadResult.errors > 0 &&
                    `, ${uploadResult.errors} error(s)`}
                  .
                </p>
                {uploadResult.error_details &&
                  uploadResult.error_details.length > 0 && (
                    <ul className="list-disc list-inside text-red-700 text-xs mt-1">
                      {uploadResult.error_details.map((d, i) => (
                        <li key={i}>
                          {d.row}: {d.error}
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUploadOpen(false)}
            >
              {uploadResult ? "Close" : "Cancel"}
            </Button>
            {!uploadResult && (
              <Button
                onClick={() => createBatchMutation.mutate()}
                disabled={createBatchMutation.isPending}
              >
                {createBatchMutation.isPending ? "Uploading…" : "Upload"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Lines Dialog */}
      <Dialog open={viewLinesOpen} onOpenChange={setViewLinesOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Batch Lines</DialogTitle>
          </DialogHeader>
          {linesLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground py-6"
                    >
                      No lines found.
                    </TableCell>
                  </TableRow>
                )}
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-mono text-sm">
                      {line.employee_code}
                    </TableCell>
                    <TableCell>{line.employee_name ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      ₹{Number(line.amount).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={line.status === "error" ? "destructive" : "secondary"}>
                        {line.status ?? "ok"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-red-600">
                      {line.error_message ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewLinesOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Tab 3: Approval Queue ────────────────────────────────────────────────────

function ApprovalQueueTab() {
  const qc = useQueryClient();

  const { data: allBatchesData, isLoading } = useQuery<
    { data: IncentiveBatch[] } | IncentiveBatch[]
  >({
    queryKey: ["incentive-batches-all"],
    queryFn: () => hrmsApi.get("/api/incentives/batches"),
  });
  const allBatches: IncentiveBatch[] = Array.isArray(allBatchesData)
    ? allBatchesData
    : (allBatchesData as { data?: IncentiveBatch[] })?.data ?? [];

  const pendingBatches = allBatches.filter(
    (b) => b.status === "pending_approval"
  );

  // Approve / Reject dialog
  const [actionOpen, setActionOpen] = useState(false);
  const [actionType, setActionType] = useState<"approve" | "reject">("approve");
  const [actionBatch, setActionBatch] = useState<IncentiveBatch | null>(null);
  const [remarks, setRemarks] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Apply to run
  const [runId, setRunId] = useState("");
  const [applyMonth, setApplyMonth] = useState(currentMonth());
  const [applyResult, setApplyResult] = useState<{
    batches_applied: number;
    lines_applied: number;
  } | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const actionMutation = useMutation({
    mutationFn: () => {
      if (!actionBatch) throw new Error("No batch selected.");
      const endpoint =
        actionType === "approve"
          ? `/api/incentives/batches/${actionBatch.id}/approve`
          : `/api/incentives/batches/${actionBatch.id}/reject`;
      return hrmsApi.post(endpoint, { remarks });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incentive-batches-all"] });
      qc.invalidateQueries({ queryKey: ["incentive-batches"] });
      setActionOpen(false);
      setRemarks("");
      setActionBatch(null);
    },
    onError: (e: Error) => setActionError(e.message),
  });

  const applyMutation = useMutation({
    mutationFn: () => {
      if (!runId.trim()) throw new Error("Run ID is required.");
      return hrmsApi.post<{ batches_applied: number; lines_applied: number }>(
        "/api/incentives/apply-to-run",
        { run_id: runId.trim(), pay_month: applyMonth }
      );
    },
    onSuccess: (res) => {
      setApplyResult(res);
      setApplyError(null);
      qc.invalidateQueries({ queryKey: ["incentive-batches-all"] });
    },
    onError: (e: Error) => {
      setApplyError(e.message);
      setApplyResult(null);
    },
  });

  function openAction(
    batch: IncentiveBatch,
    type: "approve" | "reject"
  ) {
    setActionBatch(batch);
    setActionType(type);
    setRemarks("");
    setActionError(null);
    setActionOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* Pending Approvals */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Pending Approvals</h2>

        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {!isLoading && pendingBatches.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No batches pending approval.
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pendingBatches.map((batch) => (
            <Card key={batch.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex justify-between items-start">
                  <span>{batch.incentive_name ?? `Type #${batch.incentive_type_id}`}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
                    Pending Approval
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Month</span>
                  <span>{batch.pay_month}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Employees</span>
                  <span>{batch.total_employees}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Total Amount</span>
                  <span>₹{Number(batch.total_amount).toLocaleString("en-IN")}</span>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => openAction(batch, "approve")}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => openAction(batch, "reject")}
                  >
                    Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Apply to Payroll Run */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Apply Approved Incentives to Payroll Run</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Payroll Run ID *</Label>
              <Input
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
                placeholder="e.g. RUN_2026_06_001"
              />
            </div>
            <div className="space-y-1">
              <Label>Pay Month *</Label>
              <Input
                type="month"
                value={applyMonth}
                onChange={(e) => setApplyMonth(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => { setApplyResult(null); setApplyError(null); applyMutation.mutate(); }}
                disabled={applyMutation.isPending}
                className="w-full sm:w-auto"
              >
                {applyMutation.isPending
                  ? "Applying…"
                  : "Apply Approved Incentives"}
              </Button>
            </div>
          </div>

          {applyError && (
            <p className="text-sm text-red-600 bg-red-50 p-2 rounded">
              {applyError}
            </p>
          )}

          {applyResult && (
            <div className="text-sm bg-green-50 border border-green-200 rounded p-3">
              <p className="font-medium text-green-800">
                Applied successfully — {applyResult.batches_applied} batch(es),{" "}
                {applyResult.lines_applied} line(s) added to run.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Approve / Reject Dialog */}
      <Dialog open={actionOpen} onOpenChange={setActionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionType === "approve" ? "Approve Batch" : "Reject Batch"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {actionBatch && (
              <p className="text-sm text-muted-foreground">
                <strong>{actionBatch.incentive_name ?? `Batch #${actionBatch.id}`}</strong>{" "}
                — {actionBatch.pay_month} — ₹
                {Number(actionBatch.total_amount).toLocaleString("en-IN")}
              </p>
            )}
            <div className="space-y-1">
              <Label>Remarks</Label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={3}
                placeholder="Optional remarks for audit trail"
              />
            </div>
            {actionError && (
              <p className="text-sm text-red-600 bg-red-50 p-2 rounded">
                {actionError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={actionType === "approve" ? "default" : "destructive"}
              onClick={() => actionMutation.mutate()}
              disabled={actionMutation.isPending}
            >
              {actionMutation.isPending
                ? actionType === "approve"
                  ? "Approving…"
                  : "Rejecting…"
                : actionType === "approve"
                ? "Confirm Approve"
                : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Page Root ────────────────────────────────────────────────────────────────

export default function NativeIncentives() {
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Incentives</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage incentive types, monthly uploads and payroll application.
          </p>
        </div>

        <Tabs defaultValue="types">
          <TabsList>
            <TabsTrigger value="types">Incentive Types</TabsTrigger>
            <TabsTrigger value="upload">Monthly Upload</TabsTrigger>
            <TabsTrigger value="approval">Approval Queue</TabsTrigger>
          </TabsList>

          <TabsContent value="types" className="mt-4">
            <IncentiveTypesTab />
          </TabsContent>

          <TabsContent value="upload" className="mt-4">
            <MonthlyUploadTab />
          </TabsContent>

          <TabsContent value="approval" className="mt-4">
            <ApprovalQueueTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
