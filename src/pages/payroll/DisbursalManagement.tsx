import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import api from "@/lib/axios";

interface PayrollRun {
  id: string;
  run_month: string;
  status: string;
  run_label?: string;
}

interface DisbursalRow {
  employee_code: string;
  first_name: string;
  last_name: string;
  cheque_no: string | null;
  payment_mode: string | null;
  payment_date: string | null;
  bank_ref: string | null;
  notes: string | null;
  uploaded_at: string | null;
}

const PAYMENT_MODES = ["NEFT", "IMPS", "Cheque", "Cash", "UPI", "RTGS"];

export default function DisbursalManagement() {
  const qc = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [tab, setTab] = useState("status");
  const [csvText, setCsvText] = useState("");
  const [manualRow, setManualRow] = useState({
    employee_code: "",
    cheque_no: "",
    payment_mode: "NEFT",
    payment_date: "",
    bank_ref: "",
    notes: "",
  });

  const { data: runsData } = useQuery<{ data: PayrollRun[] }>({
    queryKey: ["payroll-runs-list"],
    queryFn: () => api.get("/api/payroll/runs?limit=50").then((r) => r.data),
  });
  const runs = runsData?.data ?? [];

  const { data: disbData, isLoading: disbLoading } = useQuery<{ data: DisbursalRow[] }>({
    queryKey: ["disbursal", selectedRunId],
    queryFn: () =>
      api.get(`/api/payroll/runs/${selectedRunId}/disbursal`).then((r) => r.data),
    enabled: !!selectedRunId,
  });
  const disbRows = disbData?.data ?? [];
  const disbursedCount = disbRows.filter((r) => r.cheque_no).length;

  const uploadMutation = useMutation({
    mutationFn: (rows: object[]) =>
      api
        .post(`/api/payroll/runs/${selectedRunId}/disbursal-upload`, { rows })
        .then((r) => r.data),
    onSuccess: (data: any) => {
      toast.success(data.message ?? "Upload successful");
      qc.invalidateQueries({ queryKey: ["disbursal", selectedRunId] });
      setCsvText("");
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? "Upload failed"),
  });

  const markDisbursedMutation = useMutation({
    mutationFn: () =>
      api
        .patch(`/api/payroll/runs/${selectedRunId}/status`, { status: "disbursed" })
        .then((r) => r.data),
    onSuccess: () => {
      toast.success("Run marked as disbursed");
      qc.invalidateQueries({ queryKey: ["payroll-runs-list"] });
      qc.invalidateQueries({ queryKey: ["disbursal", selectedRunId] });
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.message ?? "Failed to mark disbursed"),
  });

  function handleCsvUpload() {
    if (!csvText.trim()) {
      toast.error("Paste CSV content first");
      return;
    }
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) {
      toast.error("CSV must have a header row + at least one data row");
      return;
    }
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idx = (col: string) => headers.indexOf(col);
    if (idx("employee_code") === -1) {
      toast.error("CSV must have an employee_code column");
      return;
    }
    const rows = lines
      .slice(1)
      .map((line) => {
        const cells = line.split(",").map((c) => c.trim());
        return {
          employee_code: cells[idx("employee_code")] ?? "",
          cheque_no: cells[idx("cheque_no")] || undefined,
          payment_mode: cells[idx("payment_mode")] || undefined,
          payment_date: cells[idx("payment_date")] || undefined,
          bank_ref: cells[idx("bank_ref")] || undefined,
          notes: cells[idx("notes")] || undefined,
        };
      })
      .filter((r) => r.employee_code);
    if (!rows.length) {
      toast.error("No valid rows found");
      return;
    }
    uploadMutation.mutate(rows);
  }

  function handleManualUpload() {
    if (!manualRow.employee_code.trim()) {
      toast.error("Employee code required");
      return;
    }
    uploadMutation.mutate([{ ...manualRow }]);
    setManualRow({
      employee_code: "",
      cheque_no: "",
      payment_mode: "NEFT",
      payment_date: "",
      bank_ref: "",
      notes: "",
    });
  }

  const selectedRun = runs.find((r) => r.id === selectedRunId);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Disbursal Management</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Upload cheque / payment details per payroll run
            </p>
          </div>
          {selectedRunId && (
            <Button
              variant="default"
              disabled={markDisbursedMutation.isPending}
              onClick={() => {
                if (
                  !window.confirm(
                    "Mark this run as fully disbursed? This cannot be undone."
                  )
                )
                  return;
                markDisbursedMutation.mutate();
              }}
            >
              Mark Run as Disbursed
            </Button>
          )}
        </div>

        {/* Run Selector */}
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm font-medium">Payroll Run:</label>
          <Select value={selectedRunId} onValueChange={setSelectedRunId}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Select a payroll run…" />
            </SelectTrigger>
            <SelectContent>
              {runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.run_label ?? r.run_month} — {r.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedRun && (
            <Badge
              variant={
                selectedRun.status === "disbursed" ? "default" : "secondary"
              }
            >
              {selectedRun.status}
            </Badge>
          )}
        </div>

        {selectedRunId ? (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="status">
                Status (
                {disbLoading ? "…" : `${disbursedCount}/${disbRows.length}`})
              </TabsTrigger>
              <TabsTrigger value="csv-upload">CSV Upload</TabsTrigger>
              <TabsTrigger value="manual">Manual Entry</TabsTrigger>
            </TabsList>

            {/* Status Tab */}
            <TabsContent value="status">
              <div className="rounded-md border overflow-auto mt-3">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      {[
                        "Code",
                        "Name",
                        "Cheque No",
                        "Mode",
                        "Date",
                        "Bank Ref",
                        "Notes",
                        "Uploaded",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left font-medium whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {disbLoading ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-3 py-8 text-center text-muted-foreground"
                        >
                          Loading…
                        </td>
                      </tr>
                    ) : disbRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-3 py-8 text-center text-muted-foreground"
                        >
                          No disbursal records yet for this run
                        </td>
                      </tr>
                    ) : (
                      disbRows.map((row) => (
                        <tr key={row.employee_code} className="border-t">
                          <td className="px-3 py-2 font-mono text-xs">
                            {row.employee_code}
                          </td>
                          <td className="px-3 py-2">
                            {row.first_name} {row.last_name}
                          </td>
                          <td className="px-3 py-2">
                            {row.cheque_no ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {row.payment_mode ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            {row.payment_date ?? "—"}
                          </td>
                          <td className="px-3 py-2">{row.bank_ref ?? "—"}</td>
                          <td className="px-3 py-2">{row.notes ?? "—"}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {row.uploaded_at
                              ? new Date(row.uploaded_at).toLocaleString()
                              : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            {/* CSV Upload Tab */}
            <TabsContent value="csv-upload" className="space-y-4 mt-3">
              <div className="rounded-md border p-4 bg-muted/30 text-sm space-y-1">
                <p className="font-medium">
                  Expected CSV columns (first row = header):
                </p>
                <p className="font-mono text-xs">
                  employee_code, cheque_no, payment_mode, payment_date,
                  bank_ref, notes
                </p>
                <p className="text-muted-foreground text-xs">
                  payment_date format: YYYY-MM-DD. payment_mode: NEFT / IMPS /
                  Cheque / Cash / UPI / RTGS
                </p>
              </div>
              <textarea
                className="w-full h-40 rounded-md border p-3 text-xs font-mono bg-background resize-y"
                placeholder={
                  "employee_code,cheque_no,payment_mode,payment_date,bank_ref,notes\nMAS001,CHQ12345,NEFT,2026-07-13,,\nMAS002,,Cash,2026-07-13,,"
                }
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
              />
              <Button
                onClick={handleCsvUpload}
                disabled={uploadMutation.isPending}
              >
                {uploadMutation.isPending ? "Uploading…" : "Upload CSV"}
              </Button>
              {(uploadMutation.data as any)?.unmatched?.length > 0 && (
                <p className="text-sm text-destructive">
                  Unmatched codes:{" "}
                  {(uploadMutation.data as any).unmatched.join(", ")}
                </p>
              )}
            </TabsContent>

            {/* Manual Entry Tab */}
            <TabsContent value="manual" className="space-y-4 mt-3">
              <div className="grid grid-cols-2 gap-4 max-w-xl">
                <div className="space-y-1">
                  <label className="text-sm font-medium">
                    Employee Code *
                  </label>
                  <Input
                    value={manualRow.employee_code}
                    onChange={(e) =>
                      setManualRow((p) => ({
                        ...p,
                        employee_code: e.target.value,
                      }))
                    }
                    placeholder="MAS001"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">
                    Cheque / Reference No
                  </label>
                  <Input
                    value={manualRow.cheque_no}
                    onChange={(e) =>
                      setManualRow((p) => ({
                        ...p,
                        cheque_no: e.target.value,
                      }))
                    }
                    placeholder="CHQ12345"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Payment Mode</label>
                  <Select
                    value={manualRow.payment_mode}
                    onValueChange={(v) =>
                      setManualRow((p) => ({ ...p, payment_mode: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_MODES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Payment Date</label>
                  <Input
                    type="date"
                    value={manualRow.payment_date}
                    onChange={(e) =>
                      setManualRow((p) => ({
                        ...p,
                        payment_date: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Bank Ref</label>
                  <Input
                    value={manualRow.bank_ref}
                    onChange={(e) =>
                      setManualRow((p) => ({
                        ...p,
                        bank_ref: e.target.value,
                      }))
                    }
                    placeholder="UTR / transaction ID"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Notes</label>
                  <Input
                    value={manualRow.notes}
                    onChange={(e) =>
                      setManualRow((p) => ({ ...p, notes: e.target.value }))
                    }
                  />
                </div>
              </div>
              <Button
                onClick={handleManualUpload}
                disabled={uploadMutation.isPending}
              >
                {uploadMutation.isPending ? "Saving…" : "Save Entry"}
              </Button>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="text-center text-muted-foreground py-16">
            Select a payroll run above to manage disbursal records
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
