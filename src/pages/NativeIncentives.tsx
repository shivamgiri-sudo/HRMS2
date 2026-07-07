import { useRef, useState } from "react";
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
  id: string;
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
  id: string;
  incentive_name?: string;
  pay_month: string;
  total_employees: number;
  total_amount: number;
  status: "draft" | "pending_approval" | "approved" | "rejected" | "applied";
  upload_date?: string;
  created_at?: string;
}

interface IncentiveLine {
  id: string;
  employee_code: string;
  employee_name?: string;
  amount: number;
  validation_status?: string;
  validation_msg?: string;
}

interface BulkUploadResult {
  batches_created: number;
  batch_ids: string[];
  lines_inserted: number;
  pay_month: string;
  per_type_totals: Record<string, number>;
  errors: string[];
}

interface PreviewRow {
  employee_code: string;
  month: string;
  branch: string;
  cost_centre: string;
  total_incentive: number;
  [key: string]: string | number;
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

// ─── Tab 1: Incentive Types Master ───────────────────────────────────────────

function emptyMasterForm(): Omit<IncentiveMaster, "id" | "status" | "active_status"> {
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
    queryKey: ["incentive-masters-all"],
    queryFn: () => hrmsApi.get("/api/incentives/masters?all=true"),
  });

  const masters: IncentiveMaster[] = Array.isArray(mastersData)
    ? mastersData
    : (mastersData as { data?: IncentiveMaster[] })?.data ?? [];

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(emptyMasterForm());

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyMasterForm());

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inv = () => {
    qc.invalidateQueries({ queryKey: ["incentive-masters-all"] });
    qc.invalidateQueries({ queryKey: ["incentive-masters"] });
  };

  const boolToInt = (f: ReturnType<typeof emptyMasterForm>) => ({
    ...f,
    taxable: toBool(f.taxable as 0 | 1 | boolean) ? 1 : 0,
    pf_applicable: toBool(f.pf_applicable as 0 | 1 | boolean) ? 1 : 0,
    esic_applicable: toBool(f.esic_applicable as 0 | 1 | boolean) ? 1 : 0,
  });

  const addMutation = useMutation({
    mutationFn: (body: ReturnType<typeof emptyMasterForm>) =>
      hrmsApi.post("/api/incentives/masters", boolToInt(body)),
    onSuccess: () => { inv(); setAddOpen(false); setAddForm(emptyMasterForm()); },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const editMutation = useMutation({
    mutationFn: (body: ReturnType<typeof emptyMasterForm>) =>
      hrmsApi.put(`/api/incentives/masters/${editId}`, boolToInt(body)),
    onSuccess: () => { inv(); setEditOpen(false); },
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.patch(`/api/incentives/masters/${id}/toggle`, {}),
    onSuccess: inv,
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
                    <Badge
                      variant={m.status === "active" ? "default" : "secondary"}
                      className={m.status === "active" ? "bg-green-600 text-white" : ""}
                    >
                      {m.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="space-x-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(m)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant={m.status === "active" ? "destructive" : "outline"}
                      onClick={() => toggleMutation.mutate(m.id)}
                      disabled={toggleMutation.isPending}
                    >
                      {m.status === "active" ? "Deactivate" : "Activate"}
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

    </div>
  );
}

interface MasterFormProps {
  form: Omit<IncentiveMaster, "id" | "status" | "active_status">;
  onChange: (f: Omit<IncentiveMaster, "id" | "status" | "active_status">) => void;
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

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadResult, setUploadResult] = useState<BulkUploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewCols, setPreviewCols] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [viewBatchId, setViewBatchId] = useState<string | null>(null);
  const [viewLinesOpen, setViewLinesOpen] = useState(false);

  const { data: linesData, isLoading: linesLoading } = useQuery<
    { data: IncentiveLine[] } | IncentiveLine[]
  >({
    queryKey: ["incentive-batch-lines", viewBatchId],
    queryFn: () => hrmsApi.get(`/api/incentives/batches/${viewBatchId}/lines`),
    enabled: viewBatchId !== null && viewLinesOpen,
  });
  const lines: IncentiveLine[] = Array.isArray(linesData)
    ? linesData
    : (linesData as { data?: IncentiveLine[] })?.data ?? [];

  const submitMutation = useMutation({
    mutationFn: (batchId: string) =>
      hrmsApi.post(`/api/incentives/batches/${batchId}/submit`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incentive-batches", selectedMonth] });
    },
  });

  function downloadTemplate() {
    const token = localStorage.getItem("hrms_access_token");
    fetch(`/api/incentives/upload-template?month=${selectedMonth}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `incentive_template_${selectedMonth}.csv`;
        a.click();
      })
      .catch(() => setUploadError("Failed to download template"));
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setUploadResult(null);
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = text.trim().split("\n");
      if (rows.length < 2) return;
      const headers = rows[0].split(",").map((h) => h.trim());
      const fixed = ["employee_code", "month", "branch", "cost_centre", "total_incentive"];
      setPreviewCols(headers.filter((h) => !fixed.includes(h)));
      setPreviewRows(
        rows.slice(1).map((line) => {
          const vals = line.split(",");
          const row: PreviewRow = {
            employee_code: vals[0]?.trim() ?? "",
            month: vals[1]?.trim() ?? "",
            branch: vals[2]?.trim() ?? "",
            cost_centre: vals[3]?.trim() ?? "",
            total_incentive: 0,
          };
          headers.forEach((h, i) => {
            if (!["employee_code", "month", "branch", "cost_centre"].includes(h)) {
              row[h] = parseFloat(vals[i]?.trim() ?? "0") || 0;
            }
          });
          return row;
        })
      );
    };
    reader.readAsText(file);
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("No file selected");
      const token = localStorage.getItem("hrms_access_token");
      const fd = new FormData();
      fd.append("file", selectedFile);
      fd.append("month", selectedMonth);
      const res = await fetch("/api/incentives/bulk-upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error((e as { message?: string }).message ?? "Upload failed");
      }
      return res.json() as Promise<BulkUploadResult>;
    },
    onSuccess: (result) => {
      setUploadResult(result);
      setUploadError(null);
      setSelectedFile(null);
      setPreviewRows([]);
      if (fileRef.current) fileRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["incentive-batches", selectedMonth] });
    },
    onError: (e: Error) => setUploadError(e.message),
  });

  return (
    <div className="space-y-6">
      {/* Controls bar */}
      <div className="flex flex-wrap items-end gap-4 bg-gray-50 rounded-lg p-4 border">
        <div className="space-y-1">
          <Label>Pay Month</Label>
          <Input
            type="month"
            value={selectedMonth}
            onChange={(e) => {
              setSelectedMonth(e.target.value);
              setUploadResult(null);
              setPreviewRows([]);
              setSelectedFile(null);
            }}
            className="w-44"
          />
        </div>
        <Button variant="outline" onClick={downloadTemplate}>
          Download Template
        </Button>
        <div className="space-y-1">
          <Label>Upload Filled CSV</Label>
          <Input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="w-64" />
        </div>
        {selectedFile && !uploadResult && (
          <Button onClick={() => uploadMutation.mutate()} disabled={uploadMutation.isPending}>
            {uploadMutation.isPending ? "Uploading..." : "Upload CSV"}
          </Button>
        )}
      </div>

      {uploadError && (
        <div className="text-sm text-red-600 bg-red-50 rounded p-3 flex justify-between">
          <span>{uploadError}</span>
          <button className="underline ml-2" onClick={() => setUploadError(null)}>Dismiss</button>
        </div>
      )}

      {/* Upload result */}
      {uploadResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
          <p className="font-semibold text-green-800">
            Upload successful - {uploadResult.batches_created} batch(es), {uploadResult.lines_inserted} line(s) for {uploadResult.pay_month}
          </p>
          {Object.keys(uploadResult.per_type_totals).length > 0 && (
            <div className="flex flex-wrap gap-3">
              {Object.entries(uploadResult.per_type_totals).map(([code, total]) => (
                <div key={code} className="bg-white rounded border px-3 py-2 text-sm">
                  <span className="font-mono font-semibold text-blue-700">{code}</span>
                  <span className="text-muted-foreground ml-2">
                    Rs.{Number(total).toLocaleString("en-IN")}
                  </span>
                </div>
              ))}
            </div>
          )}
          {uploadResult.errors.length > 0 && (
            <div className="text-xs text-red-700">
              <p className="font-medium">Errors ({uploadResult.errors.length}):</p>
              <ul className="list-disc list-inside mt-1">
                {uploadResult.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* CSV Preview */}
      {previewRows.length > 0 && !uploadResult && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Preview ({previewRows.length} rows)
          </h3>
          <div className="overflow-x-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Emp Code</TableHead>
                  <TableHead>Month</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Cost Centre</TableHead>
                  {previewCols.map((c) => <TableHead key={c} className="font-mono">{c}</TableHead>)}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.slice(0, 20).map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-sm">{row.employee_code}</TableCell>
                    <TableCell>{row.month}</TableCell>
                    <TableCell>{row.branch}</TableCell>
                    <TableCell>{row.cost_centre}</TableCell>
                    {previewCols.map((c) => (
                      <TableCell key={c} className="text-right">
                        {Number(row[c] ?? 0) > 0 ? `Rs.${Number(row[c]).toLocaleString("en-IN")}` : "-"}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold">
                      Rs.{Number(row.total_incentive).toLocaleString("en-IN")}
                    </TableCell>
                  </TableRow>
                ))}
                {previewRows.length > 20 && (
                  <TableRow>
                    <TableCell colSpan={5 + previewCols.length} className="text-center text-xs text-muted-foreground py-2">
                      ... {previewRows.length - 20} more rows
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Existing batches */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Batches for {selectedMonth}</h3>
        {batchesLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {!batchesLoading && batches.length === 0 && (
          <p className="text-sm text-muted-foreground">No batches for this month.</p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {batches.map((batch) => (
            <Card key={batch.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex justify-between items-start">
                  <span>{batch.incentive_name ?? "Incentive Batch"}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadgeClass(batch.status)}`}>
                    {statusLabel(batch.status)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Employees</span><span>{batch.total_employees}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Total</span>
                  <span className="font-semibold text-foreground">
                    Rs.{Number(batch.total_amount).toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button size="sm" variant="outline" onClick={() => { setViewBatchId(batch.id); setViewLinesOpen(true); }}>
                    View Lines
                  </Button>
                  {batch.status === "draft" && (
                    <Button size="sm" onClick={() => submitMutation.mutate(batch.id)} disabled={submitMutation.isPending}>
                      Submit
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* View Lines Dialog */}
      <Dialog open={viewLinesOpen} onOpenChange={setViewLinesOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Batch Lines</DialogTitle></DialogHeader>
          {linesLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Emp Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">No lines.</TableCell>
                  </TableRow>
                )}
                {lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-mono text-sm">{line.employee_code}</TableCell>
                    <TableCell>{line.employee_name ?? "-"}</TableCell>
                    <TableCell className="text-right">Rs.{Number(line.amount).toLocaleString("en-IN")}</TableCell>
                    <TableCell>
                      <Badge variant={line.validation_status === "error" ? "destructive" : "secondary"}>
                        {line.validation_status ?? "ok"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-red-600">{line.validation_msg ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewLinesOpen(false)}>Close</Button>
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
    queryKey: ["incentive-batches-all-queue"],
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
      qc.invalidateQueries({ queryKey: ["incentive-batches-all-queue"] });
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
      qc.invalidateQueries({ queryKey: ["incentive-batches-all-queue"] });
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
                  <span>{batch.incentive_name ?? "Batch"}</span>
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
