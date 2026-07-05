import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Search,
  Upload,
  XCircle,
} from "lucide-react";

import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { hrmsApi } from "../../lib/hrmsApi";
import { useWorkforceAccess } from "../../hooks/useUserRole";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Textarea } from "../../components/ui/textarea";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmployeeResult {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  designation?: string;
  branch_name?: string;
}

interface NocRequiredResponse {
  required: boolean;
  reason: string | null;
}

interface NocRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  noc_type: "salary" | "fnf";
  run_month: string | null;
  upload_status: "pending" | "uploaded" | "validated" | "rejected";
  uploaded_by_name: string;
  uploaded_at: string;
  validated_by_name?: string;
  validated_at?: string;
  rejection_reason?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadgeClass(status: string): string {
  switch (status) {
    case "uploaded":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "validated":
      return "bg-green-100 text-green-800 border-green-200";
    case "rejected":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

function nocTypeBadgeClass(type: string): string {
  return type === "fnf"
    ? "bg-purple-100 text-purple-800 border-purple-200"
    : "bg-blue-100 text-blue-800 border-blue-200";
}

function formatDateTime(val: string | undefined): string {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleString();
  } catch {
    return val;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NocManagement() {
  const { roleKeys, isLoading: roleLoading } = useWorkforceAccess();

  const isBranchPayroll = roleKeys.some((r) =>
    ["payroll_branch", "payroll", "super_admin", "admin"].includes(r),
  );
  const isHeadPayroll = roleKeys.some((r) =>
    ["payroll_head", "super_admin"].includes(r),
  );

  // ------ Upload tab state ------
  const [empSearch, setEmpSearch] = useState("");
  const [empResults, setEmpResults] = useState<EmployeeResult[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<EmployeeResult | null>(null);
  const [nocRequired, setNocRequired] =
    useState<NocRequiredResponse | null>(null);
  const [checkingNoc, setCheckingNoc] = useState(false);
  const [nocType, setNocType] = useState<"salary" | "fnf">("salary");
  const [runMonth, setRunMonth] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ------ Validate tab state ------
  const [nocs, setNocs] = useState<NocRecord[]>([]);
  const [nocLoading, setNocLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("uploaded");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<string>("");
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [validating, setValidating] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Employee search debounce
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!empSearch.trim() || selectedEmp) {
      setEmpResults([]);
      setDropdownOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await hrmsApi.get<{ employees?: EmployeeResult[]; data?: EmployeeResult[] } | EmployeeResult[]>(
          `/api/employees?search=${encodeURIComponent(empSearch.trim())}&limit=10`,
        );
        const list = Array.isArray(data)
          ? data
          : (data as { employees?: EmployeeResult[]; data?: EmployeeResult[] }).employees ??
            (data as { data?: EmployeeResult[] }).data ??
            [];
        setEmpResults(list);
        setDropdownOpen(list.length > 0);
      } catch {
        setEmpResults([]);
        setDropdownOpen(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [empSearch, selectedEmp]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ---------------------------------------------------------------------------
  // Select employee → check NOC required
  // ---------------------------------------------------------------------------
  const handleSelectEmployee = useCallback(async (emp: EmployeeResult) => {
    setSelectedEmp(emp);
    setEmpSearch(`${emp.first_name} ${emp.last_name} (${emp.employee_code})`);
    setDropdownOpen(false);
    setEmpResults([]);
    setNocRequired(null);
    setCheckingNoc(true);
    try {
      const data = await hrmsApi.get<NocRequiredResponse>(
        `/api/payroll/noc/required/${emp.id}`,
      );
      setNocRequired(data);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to check NOC requirement",
      );
      setNocRequired(null);
    } finally {
      setCheckingNoc(false);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Upload submit
  // ---------------------------------------------------------------------------
  const handleUploadSubmit = async () => {
    if (!selectedEmp) {
      toast.error("Please select an employee.");
      return;
    }
    if (!file) {
      toast.error("Please select a NOC document to upload.");
      return;
    }
    if (nocType === "salary" && !runMonth) {
      toast.error("Please specify the run month for salary NOC.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("employee_id", selectedEmp.id);
      form.append("noc_type", nocType);
      if (nocType === "salary" && runMonth) form.append("run_month", runMonth);
      form.append("noc_document", file);
      await hrmsApi.postForm("/api/payroll/noc", form);
      toast.success("NOC uploaded successfully.");
      // Reset form
      setSelectedEmp(null);
      setEmpSearch("");
      setNocRequired(null);
      setNocType("salary");
      setRunMonth("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to upload NOC.");
    } finally {
      setUploading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Load NOC list (Validate tab)
  // ---------------------------------------------------------------------------
  const loadNocs = useCallback(async (filter: string) => {
    setNocLoading(true);
    try {
      const params = filter && filter !== "all" ? `?uploadStatus=${filter}` : "";
      const data = await hrmsApi.get<NocRecord[] | { nocs?: NocRecord[]; data?: NocRecord[] }>(
        `/api/payroll/noc${params}`,
      );
      const list = Array.isArray(data)
        ? data
        : (data as { nocs?: NocRecord[] }).nocs ??
          (data as { data?: NocRecord[] }).data ??
          [];
      setNocs(list);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load NOCs.");
    } finally {
      setNocLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isHeadPayroll) loadNocs(statusFilter);
  }, [statusFilter, isHeadPayroll, loadNocs]);

  // ---------------------------------------------------------------------------
  // Validate action
  // ---------------------------------------------------------------------------
  const handleValidate = async (id: string) => {
    setValidating(id);
    try {
      await hrmsApi.patch(`/api/payroll/noc/${id}/validate`, {});
      toast.success("NOC validated successfully.");
      loadNocs(statusFilter);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to validate NOC.");
    } finally {
      setValidating(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Reject dialog
  // ---------------------------------------------------------------------------
  const openRejectDialog = (id: string) => {
    setRejectTarget(id);
    setRejectReason("");
    setRejectOpen(true);
  };

  const handleRejectSubmit = async () => {
    if (!rejectReason.trim()) {
      toast.error("Rejection reason is required.");
      return;
    }
    setRejecting(true);
    try {
      await hrmsApi.patch(`/api/payroll/noc/${rejectTarget}/reject`, {
        reason: rejectReason.trim(),
      });
      toast.success("NOC rejected.");
      setRejectOpen(false);
      setRejectTarget("");
      setRejectReason("");
      loadNocs(statusFilter);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to reject NOC.");
    } finally {
      setRejecting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Access guard
  // ---------------------------------------------------------------------------
  if (roleLoading) {
    return (
      <DashboardLayout>
        <div className="p-8 text-slate-500">Loading access…</div>
      </DashboardLayout>
    );
  }

  if (!isBranchPayroll && !isHeadPayroll) {
    return (
      <DashboardLayout>
        <div className="p-8 flex flex-col items-center justify-center gap-3 text-red-600">
          <XCircle className="h-10 w-10" />
          <p className="text-lg font-medium">Access Denied</p>
          <p className="text-sm text-slate-500">
            You do not have permission to access NOC Management.
          </p>
        </div>
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
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">NOC Management</h1>
          <p className="text-slate-500 text-sm mt-1">
            No Objection Certificate workflow for inactive employee salary / FNF release
          </p>
        </div>

        <Tabs defaultValue={isBranchPayroll ? "upload" : "validate"}>
          <TabsList>
            {isBranchPayroll && (
              <TabsTrigger value="upload">Upload NOC</TabsTrigger>
            )}
            {isHeadPayroll && (
              <TabsTrigger value="validate">Validate NOC</TabsTrigger>
            )}
          </TabsList>

          {/* ---------------------------------------------------------------- */}
          {/* Tab 1 — Upload NOC                                               */}
          {/* ---------------------------------------------------------------- */}
          {isBranchPayroll && (
            <TabsContent value="upload" className="space-y-5 mt-4">
              {/* Employee Search */}
              <Card>
                <CardContent className="pt-5 space-y-4">
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-slate-700">
                      Search Inactive Employee
                    </label>
                    <div className="relative" ref={dropdownRef}>
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                      <Input
                        className="pl-9"
                        placeholder="Search by name or employee code…"
                        value={empSearch}
                        onChange={(e) => {
                          setEmpSearch(e.target.value);
                          if (selectedEmp) {
                            setSelectedEmp(null);
                            setNocRequired(null);
                          }
                        }}
                      />
                      {dropdownOpen && empResults.length > 0 && (
                        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-56 overflow-y-auto">
                          {empResults.map((emp) => (
                            <button
                              key={emp.id}
                              type="button"
                              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 focus:bg-slate-100 outline-none text-sm"
                              onMouseDown={() => handleSelectEmployee(emp)}
                            >
                              <span className="font-medium">
                                {emp.first_name} {emp.last_name}
                              </span>
                              <span className="ml-2 text-slate-500 text-xs">
                                {emp.employee_code}
                              </span>
                              {emp.designation && (
                                <span className="ml-2 text-slate-400 text-xs">
                                  · {emp.designation}
                                </span>
                              )}
                              {emp.branch_name && (
                                <span className="ml-2 text-slate-400 text-xs">
                                  · {emp.branch_name}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* NOC Required Status */}
                  {checkingNoc && (
                    <div className="text-sm text-slate-500 animate-pulse">
                      Checking NOC requirement…
                    </div>
                  )}
                  {!checkingNoc && nocRequired !== null && (
                    <div
                      className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${
                        nocRequired.required
                          ? "bg-amber-50 border-amber-200 text-amber-800"
                          : "bg-green-50 border-green-200 text-green-800"
                      }`}
                    >
                      {nocRequired.required ? (
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                      )}
                      <div>
                        <p className="font-medium">
                          {nocRequired.required
                            ? "NOC Required"
                            : "NOC Not Required"}
                        </p>
                        {nocRequired.reason && (
                          <p className="mt-0.5 text-xs opacity-80">
                            {nocRequired.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Upload Form */}
              {selectedEmp && nocRequired !== null && (
                <Card>
                  <CardContent className="pt-5 space-y-5">
                    {!nocRequired.required ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>
                          NOC is not required for this employee. Upload is
                          disabled.
                        </span>
                      </div>
                    ) : (
                      <>
                        {/* NOC Type */}
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-slate-700">
                            NOC Type
                          </label>
                          <Select
                            value={nocType}
                            onValueChange={(v) =>
                              setNocType(v as "salary" | "fnf")
                            }
                          >
                            <SelectTrigger className="w-52">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="salary">Salary Release</SelectItem>
                              <SelectItem value="fnf">
                                Full &amp; Final (FNF)
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Run Month — only for salary */}
                        {nocType === "salary" && (
                          <div className="space-y-1">
                            <label className="text-sm font-medium text-slate-700">
                              Run Month{" "}
                              <span className="text-slate-400 font-normal">
                                (YYYY-MM)
                              </span>
                            </label>
                            <Input
                              className="w-44"
                              placeholder="2025-06"
                              value={runMonth}
                              maxLength={7}
                              onChange={(e) => setRunMonth(e.target.value)}
                            />
                          </div>
                        )}

                        {/* File Upload */}
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-slate-700">
                            NOC Document
                          </label>
                          <div
                            className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 cursor-pointer transition-colors ${
                              file
                                ? "border-green-400 bg-green-50"
                                : "border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100"
                            }`}
                            onClick={() => fileInputRef.current?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const dropped = e.dataTransfer.files?.[0];
                              if (dropped) setFile(dropped);
                            }}
                          >
                            {file ? (
                              <>
                                <FileText className="h-8 w-8 text-green-500 mb-2" />
                                <p className="text-sm font-medium text-green-700">
                                  {file.name}
                                </p>
                                <p className="text-xs text-green-600 mt-0.5">
                                  {(file.size / 1024).toFixed(1)} KB
                                </p>
                              </>
                            ) : (
                              <>
                                <Upload className="h-8 w-8 text-slate-400 mb-2" />
                                <p className="text-sm text-slate-600">
                                  Click or drag and drop to upload
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">
                                  PDF, JPG, JPEG, PNG accepted
                                </p>
                              </>
                            )}
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) setFile(f);
                              }}
                            />
                          </div>
                          {file && (
                            <button
                              type="button"
                              className="text-xs text-red-500 hover:underline mt-1"
                              onClick={() => {
                                setFile(null);
                                if (fileInputRef.current)
                                  fileInputRef.current.value = "";
                              }}
                            >
                              Remove file
                            </button>
                          )}
                        </div>

                        {/* Submit */}
                        <div className="pt-1">
                          <Button
                            onClick={handleUploadSubmit}
                            disabled={uploading}
                          >
                            <Upload className="h-4 w-4 mr-2" />
                            {uploading ? "Uploading…" : "Submit NOC"}
                          </Button>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Tab 2 — Validate NOC                                             */}
          {/* ---------------------------------------------------------------- */}
          {isHeadPayroll && (
            <TabsContent value="validate" className="space-y-4 mt-4">
              {/* Filter bar */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-slate-700 shrink-0">
                  Status:
                </label>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v)}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="uploaded">Uploaded</SelectItem>
                    <SelectItem value="validated">Validated</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadNocs(statusFilter)}
                >
                  Refresh
                </Button>
              </div>

              {/* Table */}
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Run Month</TableHead>
                      <TableHead>Uploaded By</TableHead>
                      <TableHead>Uploaded At</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {nocLoading && (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-10 text-center text-slate-400"
                        >
                          Loading NOCs…
                        </TableCell>
                      </TableRow>
                    )}
                    {!nocLoading && nocs.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-10 text-center text-slate-400"
                        >
                          No NOC records found for the selected filter.
                        </TableCell>
                      </TableRow>
                    )}
                    {!nocLoading &&
                      nocs.map((noc) => (
                        <TableRow key={noc.id}>
                          <TableCell>
                            <div className="font-medium text-sm">
                              {noc.employee_name}
                            </div>
                            <div className="text-xs text-slate-500">
                              {noc.employee_code}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-xs ${nocTypeBadgeClass(noc.noc_type)}`}
                            >
                              {noc.noc_type === "fnf" ? "FNF" : "Salary"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {noc.run_month ?? "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {noc.uploaded_by_name}
                          </TableCell>
                          <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                            {formatDateTime(noc.uploaded_at)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-xs capitalize ${statusBadgeClass(noc.upload_status)}`}
                            >
                              {noc.upload_status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {noc.upload_status === "uploaded" ? (
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-green-700 border-green-300 hover:bg-green-50 h-7 px-2 text-xs"
                                  disabled={validating === noc.id}
                                  onClick={() => handleValidate(noc.id)}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                  {validating === noc.id
                                    ? "Saving…"
                                    : "Validate"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-700 border-red-300 hover:bg-red-50 h-7 px-2 text-xs"
                                  disabled={validating === noc.id}
                                  onClick={() => openRejectDialog(noc.id)}
                                >
                                  <XCircle className="h-3.5 w-3.5 mr-1" />
                                  Reject
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400 italic">
                                {noc.upload_status === "validated"
                                  ? `Validated by ${noc.validated_by_name ?? "—"}`
                                  : noc.upload_status === "rejected"
                                    ? "Rejected"
                                    : "—"}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          )}
        </Tabs>

        {/* Reject Dialog */}
        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-700">
                <XCircle className="h-5 w-5" />
                Reject NOC
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-slate-600">
                Provide a reason for rejection. The branch payroll team will be
                notified.
              </p>
              <Textarea
                placeholder="Enter rejection reason…"
                rows={4}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="resize-none"
              />
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setRejectOpen(false)}
                disabled={rejecting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={rejecting || !rejectReason.trim()}
                onClick={handleRejectSubmit}
              >
                {rejecting ? "Rejecting…" : "Confirm Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
