# Payroll Disbursal Management, PT Slab UI & Advance Auto-Recovery

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver three payroll features: (1) a full Disbursal Management page for Payroll HO to upload cheque numbers and track payment status; (2) a PT Slab Management tab inside the existing Statutory Config page; (3) a backend fix so salary advance records auto-close after full recovery.

**Architecture:** All three features are independent. The disbursal page is a new `src/pages/payroll/DisbursalManagement.tsx` wired into App.tsx. The PT slab tab is added directly to the existing `NativeStatutoryConfig.tsx` component. The advance fix is a single SQL UPDATE in `payrollCalculate.service.ts` executed after the advance deduction is computed.

**Tech Stack:** React 18 + TypeScript + Vite, shadcn/Radix UI, TanStack Query v5, Express + TypeScript, MySQL `mas_hrms`.

## Global Constraints

- Never delete existing routes, components, or SQL tables.
- All new routes must use `requireRole` — never expose payroll data without auth.
- Frontend: shadcn components only (Button, Table, Dialog, Select, Input, Tabs, Badge, toast).
- Backend: all SQL via parameterised `db.execute()` — no string interpolation of user input.
- Run `npx tsc --noEmit` in backend and `npx vite build --mode development` in root to verify before done.
- No mock data in production flows — only query real DB.

---

## Task 1: Disbursal Management Page

**Files:**
- Create: `src/pages/payroll/DisbursalManagement.tsx`
- Modify: `src/App.tsx` — add route `/payroll/disbursal`
- Modify: `src/components/layout/DashboardLayout.tsx` (or the payroll nav sidebar file) — add nav link

**APIs used (already exist, no backend changes needed):**
- `GET /api/payroll/runs` — list of runs with `{ id, run_month, status, run_label }`
- `GET /api/payroll/runs/:runId/disbursal` — returns `{ success, data: [{employee_code, first_name, last_name, cheque_no, payment_mode, payment_date, bank_ref, notes, uploaded_at}] }`
- `POST /api/payroll/runs/:runId/disbursal-upload` — JSON body `{ rows: [{employee_code, cheque_no, payment_mode, payment_date, bank_ref, notes}] }`
- `PATCH /api/payroll/runs/:id/status` — body `{ status: "disbursed" }` to mark run as disbursed

**Interfaces:**
- Produces: `DisbursalManagement` default export at `src/pages/payroll/DisbursalManagement.tsx`
- Consumes: `useQuery`, `useMutation` from `@tanstack/react-query`, axios via `import api from "@/lib/axios"`

---

- [ ] **Step 1.1: Create the page file with run selector and tabs**

Create `src/pages/payroll/DisbursalManagement.tsx`:

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
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

  // CSV upload state
  const [csvText, setCsvText] = useState("");
  // Manual entry state — single row
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
    queryFn: () => api.get(`/api/payroll/runs/${selectedRunId}/disbursal`).then((r) => r.data),
    enabled: !!selectedRunId,
  });
  const disbRows = disbData?.data ?? [];
  const disbursedCount = disbRows.filter((r) => r.cheque_no).length;

  const uploadMutation = useMutation({
    mutationFn: (rows: object[]) =>
      api.post(`/api/payroll/runs/${selectedRunId}/disbursal-upload`, { rows }),
    onSuccess: (res) => {
      toast.success(res.data.message ?? "Upload successful");
      qc.invalidateQueries({ queryKey: ["disbursal", selectedRunId] });
      setCsvText("");
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "Upload failed"),
  });

  const markDisbursedMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/payroll/runs/${selectedRunId}/status`, { status: "disbursed" }),
    onSuccess: () => {
      toast.success("Run marked as disbursed");
      qc.invalidateQueries({ queryKey: ["payroll-runs-list"] });
      qc.invalidateQueries({ queryKey: ["disbursal", selectedRunId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "Failed to mark disbursed"),
  });

  function handleCsvUpload() {
    if (!csvText.trim()) { toast.error("Paste CSV content first"); return; }
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) { toast.error("CSV must have a header row + at least one data row"); return; }
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const idx = (col: string) => headers.indexOf(col);
    if (idx("employee_code") === -1) { toast.error("CSV must have an employee_code column"); return; }
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(",").map((c) => c.trim());
      return {
        employee_code: cells[idx("employee_code")] ?? "",
        cheque_no: cells[idx("cheque_no")] || undefined,
        payment_mode: cells[idx("payment_mode")] || undefined,
        payment_date: cells[idx("payment_date")] || undefined,
        bank_ref: cells[idx("bank_ref")] || undefined,
        notes: cells[idx("notes")] || undefined,
      };
    }).filter((r) => r.employee_code);
    if (!rows.length) { toast.error("No valid rows found"); return; }
    uploadMutation.mutate(rows);
  }

  function handleManualUpload() {
    if (!manualRow.employee_code.trim()) { toast.error("Employee code required"); return; }
    uploadMutation.mutate([{ ...manualRow }]);
    setManualRow({ employee_code: "", cheque_no: "", payment_mode: "NEFT", payment_date: "", bank_ref: "", notes: "" });
  }

  const selectedRun = runs.find((r) => r.id === selectedRunId);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Disbursal Management</h1>
            <p className="text-muted-foreground text-sm mt-1">Upload cheque / payment details per payroll run</p>
          </div>
          {selectedRunId && (
            <Button
              variant="default"
              disabled={markDisbursedMutation.isPending}
              onClick={() => {
                if (!window.confirm("Mark this run as fully disbursed? This cannot be undone.")) return;
                markDisbursedMutation.mutate();
              }}
            >
              Mark Run as Disbursed
            </Button>
          )}
        </div>

        {/* Run Selector */}
        <div className="flex items-center gap-3">
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
            <Badge variant={selectedRun.status === "disbursed" ? "default" : "secondary"}>
              {selectedRun.status}
            </Badge>
          )}
        </div>

        {selectedRunId && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="status">
                Status ({disbLoading ? "…" : `${disbursedCount}/${disbRows.length}`})
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
                      {["Code","Name","Cheque No","Mode","Date","Bank Ref","Notes","Uploaded"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {disbLoading ? (
                      <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
                    ) : disbRows.length === 0 ? (
                      <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No disbursal records yet</td></tr>
                    ) : disbRows.map((row) => (
                      <tr key={row.employee_code} className="border-t">
                        <td className="px-3 py-2 font-mono">{row.employee_code}</td>
                        <td className="px-3 py-2">{row.first_name} {row.last_name}</td>
                        <td className="px-3 py-2">{row.cheque_no ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-3 py-2">{row.payment_mode ?? "—"}</td>
                        <td className="px-3 py-2">{row.payment_date ?? "—"}</td>
                        <td className="px-3 py-2">{row.bank_ref ?? "—"}</td>
                        <td className="px-3 py-2">{row.notes ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {row.uploaded_at ? new Date(row.uploaded_at).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            {/* CSV Upload Tab */}
            <TabsContent value="csv-upload" className="space-y-4 mt-3">
              <div className="rounded-md border p-4 bg-muted/30 text-sm space-y-1">
                <p className="font-medium">Expected CSV columns (first row = header):</p>
                <p className="font-mono text-xs">employee_code, cheque_no, payment_mode, payment_date, bank_ref, notes</p>
                <p className="text-muted-foreground text-xs">payment_date format: YYYY-MM-DD. payment_mode: NEFT / IMPS / Cheque / Cash / UPI / RTGS</p>
              </div>
              <textarea
                className="w-full h-40 rounded-md border p-3 text-xs font-mono bg-background resize-y"
                placeholder={"employee_code,cheque_no,payment_mode,payment_date,bank_ref,notes\nMAS001,CHQ12345,NEFT,2026-07-13,,\nMAS002,,Cash,2026-07-13,,"}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
              />
              <Button onClick={handleCsvUpload} disabled={uploadMutation.isPending}>
                {uploadMutation.isPending ? "Uploading…" : "Upload CSV"}
              </Button>
              {(uploadMutation.data as any)?.data?.unmatched?.length > 0 && (
                <p className="text-sm text-destructive">
                  Unmatched codes: {(uploadMutation.data as any).data.unmatched.join(", ")}
                </p>
              )}
            </TabsContent>

            {/* Manual Entry Tab */}
            <TabsContent value="manual" className="space-y-4 mt-3">
              <div className="grid grid-cols-2 gap-4 max-w-xl">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Employee Code *</label>
                  <Input value={manualRow.employee_code} onChange={(e) => setManualRow((p) => ({ ...p, employee_code: e.target.value }))} placeholder="MAS001" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Cheque / Reference No</label>
                  <Input value={manualRow.cheque_no} onChange={(e) => setManualRow((p) => ({ ...p, cheque_no: e.target.value }))} placeholder="CHQ12345" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Payment Mode</label>
                  <Select value={manualRow.payment_mode} onValueChange={(v) => setManualRow((p) => ({ ...p, payment_mode: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Payment Date</label>
                  <Input type="date" value={manualRow.payment_date} onChange={(e) => setManualRow((p) => ({ ...p, payment_date: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Bank Ref</label>
                  <Input value={manualRow.bank_ref} onChange={(e) => setManualRow((p) => ({ ...p, bank_ref: e.target.value }))} placeholder="UTR / transaction ID" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Notes</label>
                  <Input value={manualRow.notes} onChange={(e) => setManualRow((p) => ({ ...p, notes: e.target.value }))} />
                </div>
              </div>
              <Button onClick={handleManualUpload} disabled={uploadMutation.isPending}>
                {uploadMutation.isPending ? "Saving…" : "Save Entry"}
              </Button>
            </TabsContent>
          </Tabs>
        )}

        {!selectedRunId && (
          <div className="text-center text-muted-foreground py-16">Select a payroll run above to manage disbursal records</div>
        )}
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 1.2: Add route in App.tsx**

In `src/App.tsx`, find the block that contains `/payroll/full-final` (line 531) and add after it:

```tsx
<Route path="/payroll/disbursal" element={<ProtectedRoute><Gate pageCode="PAYROLL_DISBURSAL"><DisbursalManagement /></Gate></ProtectedRoute>} />
```

Also add the import near the top of App.tsx (look for the other payroll page imports, e.g. `NativeFullFinal`):

```tsx
import DisbursalManagement from "./pages/payroll/DisbursalManagement";
```

- [ ] **Step 1.3: Build verification**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
npx vite build --mode development 2>&1 | tail -20
```

Expected: `✓ built in` with no TypeScript errors. If errors appear, fix them before proceeding.

- [ ] **Step 1.4: Commit**

```bash
git add src/pages/payroll/DisbursalManagement.tsx src/App.tsx
git commit -m "feat(payroll): Disbursal Management page — run selector, CSV/manual upload, status table"
```

---

## Task 2: PT Slab Management Tab in Statutory Config

**Files:**
- Modify: `src/pages/NativeStatutoryConfig.tsx` — add "PT Slabs" tab (file is 1100 lines; add at end before closing export, no structural rewrite)

**APIs used (already exist):**
- `GET /api/payroll/pt-slabs?state_code=MH` — returns `[{id, state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from, is_active}]`
- `POST /api/payroll/pt-slabs` — body `{state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from}` → returns created slab
- `PATCH /api/payroll/pt-slabs/:id` — body with any subset of fields

**Interfaces:**
- Consumes: existing `useQuery`, `useMutation` from `@tanstack/react-query`, `api` from `@/lib/axios`

---

- [ ] **Step 2.1: Read the existing tab structure in NativeStatutoryConfig.tsx**

The file already has tab-style sections rendered as JSX accordion/card sections inside one big `return`. Before adding, check how tabs are implemented:

```bash
grep -n "Tabs\|TabsList\|TabsTrigger\|TabsContent\|activeTab\|setActive" src/pages/NativeStatutoryConfig.tsx | head -30
```

If the file uses `<Tabs>` from shadcn, add a new `<TabsTrigger>` and `<TabsContent>`. If it uses manual section cards (no Tabs component), add the PT slab section as a new card section at the bottom, following the existing card pattern.

- [ ] **Step 2.2: Add PT Slab state and query at the top of the component**

Find the `export default function NativeStatutoryConfig()` (line 501). Inside the function body, after the existing `useState` declarations, add:

```tsx
// PT Slab management state
const [ptStateCode, setPtStateCode] = useState("MH");
const [ptFormOpen, setPtFormOpen] = useState(false);
const [ptEditId, setPtEditId] = useState<string | null>(null);
const [ptForm, setPtForm] = useState({
  state_code: "MH",
  state_name: "Maharashtra",
  income_from: "",
  income_to: "",
  pt_amount: "",
  frequency: "monthly",
  effective_from: new Date().toISOString().slice(0, 10),
});

const { data: ptSlabsRaw, refetch: refetchPtSlabs } = useQuery({
  queryKey: ["pt-slabs", ptStateCode],
  queryFn: () =>
    api.get(`/api/payroll/pt-slabs?state_code=${ptStateCode}`).then((r) => r.data.data ?? r.data),
});
const ptSlabs: any[] = ptSlabsRaw ?? [];

const ptSaveMutation = useMutation({
  mutationFn: (payload: object) =>
    ptEditId
      ? api.patch(`/api/payroll/pt-slabs/${ptEditId}`, payload).then((r) => r.data)
      : api.post("/api/payroll/pt-slabs", payload).then((r) => r.data),
  onSuccess: () => {
    toast.success(ptEditId ? "Slab updated" : "Slab created");
    refetchPtSlabs();
    setPtFormOpen(false);
    setPtEditId(null);
    setPtForm({ state_code: "MH", state_name: "Maharashtra", income_from: "", income_to: "", pt_amount: "", frequency: "monthly", effective_from: new Date().toISOString().slice(0, 10) });
  },
  onError: (e: any) => toast.error(e?.response?.data?.message ?? "Save failed"),
});

const ptToggleMutation = useMutation({
  mutationFn: ({ id, is_active }: { id: string; is_active: number }) =>
    api.patch(`/api/payroll/pt-slabs/${id}`, { is_active }).then((r) => r.data),
  onSuccess: () => refetchPtSlabs(),
  onError: (e: any) => toast.error(e?.response?.data?.message ?? "Toggle failed"),
});
```

Note: `toast` and `useMutation` should already be imported in this file. If `useMutation` is not imported, add it to the `@tanstack/react-query` import.

- [ ] **Step 2.3: Add the PT Slab JSX section**

Find the comment `{/* ── Section 7: Raw All-Keys Table */}` (around line 833). Insert the following PT Slab section BEFORE that raw-keys table section:

```tsx
{/* ── Section PT: PT Slab Master ────────────────────────────────────── */}
<div className="rounded-xl border bg-card p-6 space-y-4">
  <div className="flex items-center justify-between">
    <div>
      <h3 className="text-base font-semibold">Professional Tax Slabs</h3>
      <p className="text-xs text-muted-foreground mt-0.5">State-wise PT slab configuration for payroll deduction</p>
    </div>
    <div className="flex items-center gap-2">
      <select
        className="rounded-md border px-2 py-1 text-sm bg-background"
        value={ptStateCode}
        onChange={(e) => setPtStateCode(e.target.value)}
      >
        {["MH","KA","TN","AP","TS","WB","GJ","MP","UP","HR","RJ"].map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <Button size="sm" onClick={() => {
        setPtEditId(null);
        setPtForm((p) => ({ ...p, state_code: ptStateCode }));
        setPtFormOpen(true);
      }}>
        + Add Slab
      </Button>
    </div>
  </div>

  <table className="w-full text-sm">
    <thead className="bg-muted">
      <tr>
        {["State","Income From","Income To","PT Amount","Frequency","Effective From","Active","Actions"].map((h) => (
          <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {ptSlabs.length === 0 ? (
        <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No slabs for {ptStateCode}</td></tr>
      ) : ptSlabs.map((slab: any) => (
        <tr key={slab.id} className="border-t">
          <td className="px-3 py-2 font-mono">{slab.state_code}</td>
          <td className="px-3 py-2">₹{Number(slab.income_from).toLocaleString()}</td>
          <td className="px-3 py-2">{slab.income_to ? `₹${Number(slab.income_to).toLocaleString()}` : "No limit"}</td>
          <td className="px-3 py-2 font-medium">₹{slab.pt_amount}</td>
          <td className="px-3 py-2 capitalize">{slab.frequency}</td>
          <td className="px-3 py-2">{slab.effective_from?.slice(0,10)}</td>
          <td className="px-3 py-2">
            <button
              className={`text-xs px-2 py-0.5 rounded-full border ${slab.is_active ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-500 border-gray-200"}`}
              onClick={() => ptToggleMutation.mutate({ id: slab.id, is_active: slab.is_active ? 0 : 1 })}
            >
              {slab.is_active ? "Active" : "Inactive"}
            </button>
          </td>
          <td className="px-3 py-2">
            <Button size="sm" variant="outline" onClick={() => {
              setPtEditId(slab.id);
              setPtForm({
                state_code: slab.state_code,
                state_name: slab.state_name ?? "",
                income_from: String(slab.income_from),
                income_to: slab.income_to ? String(slab.income_to) : "",
                pt_amount: String(slab.pt_amount),
                frequency: slab.frequency ?? "monthly",
                effective_from: slab.effective_from?.slice(0,10) ?? "",
              });
              setPtFormOpen(true);
            }}>Edit</Button>
          </td>
        </tr>
      ))}
    </tbody>
  </table>

  {/* Add/Edit dialog */}
  {ptFormOpen && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-xl border shadow-lg p-6 w-full max-w-md space-y-4">
        <h4 className="font-semibold text-base">{ptEditId ? "Edit PT Slab" : "Add PT Slab"}</h4>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "State Code", key: "state_code", placeholder: "MH" },
            { label: "State Name", key: "state_name", placeholder: "Maharashtra" },
            { label: "Income From (₹)", key: "income_from", placeholder: "0" },
            { label: "Income To (₹, blank = no limit)", key: "income_to", placeholder: "" },
            { label: "PT Amount (₹)", key: "pt_amount", placeholder: "200" },
            { label: "Effective From", key: "effective_from", placeholder: "YYYY-MM-DD" },
          ].map(({ label, key, placeholder }) => (
            <div key={key} className="space-y-1">
              <label className="text-xs font-medium">{label}</label>
              <Input
                value={(ptForm as any)[key]}
                placeholder={placeholder}
                onChange={(e) => setPtForm((p) => ({ ...p, [key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="space-y-1">
            <label className="text-xs font-medium">Frequency</label>
            <select
              className="w-full rounded-md border px-2 py-1.5 text-sm bg-background"
              value={ptForm.frequency}
              onChange={(e) => setPtForm((p) => ({ ...p, frequency: e.target.value }))}
            >
              <option value="monthly">Monthly</option>
              <option value="semi-annual">Semi-Annual</option>
              <option value="annual">Annual</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => { setPtFormOpen(false); setPtEditId(null); }}>Cancel</Button>
          <Button
            disabled={ptSaveMutation.isPending}
            onClick={() => {
              const payload: any = {
                state_code: ptForm.state_code,
                state_name: ptForm.state_name,
                income_from: Number(ptForm.income_from),
                income_to: ptForm.income_to ? Number(ptForm.income_to) : null,
                pt_amount: Number(ptForm.pt_amount),
                frequency: ptForm.frequency,
                effective_from: ptForm.effective_from,
              };
              ptSaveMutation.mutate(payload);
            }}
          >
            {ptSaveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 2.4: Build verification**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
npx vite build --mode development 2>&1 | tail -20
```

Expected: clean build. Fix any TypeScript type errors before committing.

- [ ] **Step 2.5: Commit**

```bash
git add src/pages/NativeStatutoryConfig.tsx
git commit -m "feat(payroll): PT Slab Management tab in Statutory Config — add/edit/toggle active"
```

---

## Task 3: Advance Auto-Recovery Backend Fix

**Files:**
- Modify: `backend/src/modules/payroll/payrollCalculate.service.ts` — lines ~596–602 (after `advanceRecovery` is computed)

**What the fix does:** After the payroll engine deducts `advanceRecovery` from net pay and stores it in `salary_prep_line.advance_recovery`, we need to update `salary_advance_log` to accumulate `recovered_amount` and flip `status = 'recovered'` when fully repaid. Currently this UPDATE never happens, so `recovered_amount` stays 0 and `status` stays `'active'` forever, meaning the same deduction recurs indefinitely.

**SQL to add (parameterised):**
```sql
UPDATE salary_advance_log
   SET recovered_amount = recovered_amount + ?,
       status = IF(recovered_amount + ? >= amount, 'recovered', status)
 WHERE employee_id = ? AND status = 'active'
```

This uses `ROUND(amount / recovery_months, 2)` monthly installment × count of active records. Since we already computed `advanceRecovery` as the aggregate from all active advances, we distribute equally — the simplest safe approach is to update each row individually with its own `ROUND(amount / recovery_months, 2)`.

---

- [ ] **Step 3.1: Read the advance query context**

Read `backend/src/modules/payroll/payrollCalculate.service.ts` around lines 595–605 to confirm the exact variable names in scope before editing.

The relevant block reads:
```ts
// 5d. Salary advance monthly recovery
const [advRows] = await db.execute<RowDataPacket[]>(
  `SELECT COALESCE(SUM(ROUND(amount / recovery_months, 2)), 0) AS monthly_recovery
     FROM salary_advance_log
    WHERE employee_id = ? AND status = 'active'`,
  [emp.employee_id]
);
const advanceRecovery = Number((advRows as Array<{ monthly_recovery: number }>)[0]?.monthly_recovery ?? 0);
```

- [ ] **Step 3.2: Add the UPDATE after the SELECT**

The UPDATE must run AFTER the payroll run is committed (i.e., after the `salary_prep_line` upsert). Find the comment `// Step 11: Audit log per employee` (around line 793). Insert the following block BEFORE that audit log step:

```ts
// 10b. Update advance recovery ledger — accumulate recovered_amount, flip to 'recovered' when done
if (advanceRecovery > 0) {
  // Update each active advance row with its own installment so per-row balances are correct
  const [activeAdvances] = await conn.execute<RowDataPacket[]>(
    `SELECT id, amount, recovery_months, recovered_amount
       FROM salary_advance_log
      WHERE employee_id = ? AND status = 'active'`,
    [emp.employee_id]
  );
  for (const adv of activeAdvances as Array<{ id: string; amount: number; recovery_months: number; recovered_amount: number }>) {
    const installment = Math.round((adv.amount / adv.recovery_months) * 100) / 100;
    const newRecovered = Math.min(adv.recovered_amount + installment, adv.amount);
    const newStatus = newRecovered >= adv.amount ? "recovered" : "active";
    await conn.execute(
      `UPDATE salary_advance_log
          SET recovered_amount = ?,
              status = ?,
              last_recovery_run_id = ?
        WHERE id = ?`,
      [newRecovered, newStatus, runId, adv.id]
    );
  }
}
```

Note: the column `last_recovery_run_id` may not exist yet. Add it via a safe additive migration (Step 3.3). If you prefer to skip that column for now, remove the `last_recovery_run_id = ?` SET clause and its parameter — the rest is safe.

- [ ] **Step 3.3: Create migration to add last_recovery_run_id column**

Create `backend/sql/397_advance_recovery_run_id.sql`:

```sql
-- Additive: track which payroll run last recovered this advance
ALTER TABLE salary_advance_log
  ADD COLUMN IF NOT EXISTS last_recovery_run_id VARCHAR(36) NULL AFTER recovered_amount;
```

This is additive and backward-compatible. Do NOT run against production without user approval.

- [ ] **Step 3.4: Backend TypeScript check**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest\backend"
npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 new errors introduced by the change. If pre-existing errors appear, confirm they existed before (check `git stash; npx tsc --noEmit` count, then `git stash pop`).

- [ ] **Step 3.5: Commit**

```bash
git add backend/src/modules/payroll/payrollCalculate.service.ts backend/sql/397_advance_recovery_run_id.sql
git commit -m "fix(payroll): auto-close salary advances after full recovery — update recovered_amount per run"
```

---

## Final Verification Checklist

- [ ] `npx vite build --mode development` — clean with no TS errors
- [ ] `cd backend && npx tsc --noEmit` — 0 new errors
- [ ] Open `/payroll/disbursal` in browser — run selector loads, status table renders, CSV upload tab shows format hint, manual entry saves and appears in status tab
- [ ] Open `/payroll/statutory-config` in browser — PT Slab section visible, state code selector works, Add Slab dialog opens, toggle active/inactive works
- [ ] Advance fix: after running payroll for an employee with 3-month active advance, verify `salary_advance_log.recovered_amount` increments and `status` flips to `'recovered'` after month 3
