# Spec A: Salary Advance Request + Finance Approval Surface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable employee self-service advance requests and provide Finance team with a dedicated approval surface for disbursement authorization before runs move to `disbursed` status.

**Architecture:** Advance Request tab integrated into `NativePayrollHOQueues` (existing HR queues page) with employee request form and HR/Finance approval queue. Finance Approval tab added to `/payroll` dashboard with run review modal. Both use existing backend APIs; Finance sign-off endpoint is new (`POST /api/payroll/runs/:id/finance-approve`).

**Tech Stack:** React 18 + TypeScript + Vite, shadcn/Radix UI, TanStack Query v5, Sonner toast. Backend: Express + TypeScript, MySQL, `salary_advance_log` table (already exists).

## Global Constraints

- All new routes use `requireRole` middleware — never trust URL params for auth
- React pages use shadcn components only (Button, Dialog, Input, Select, Tabs, Badge, toast)
- Backend SQL via parameterised `db.execute()` — no string interpolation
- Run finance approval checks `status = 'locked'` before allowing transition to `disbursed`
- Audit log every approval/rejection via `logSensitiveAction`
- Frontend: `npx vite build --mode development` must pass
- Backend: `npx tsc --noEmit` must pass

---

## Task 1: Backend Finance Approval Endpoint

**Files:**
- Modify: `backend/src/modules/payroll/payroll.routes.ts` — add `POST /api/payroll/runs/:id/finance-approve` endpoint (after line ~1500)
- Modify: `backend/src/modules/payroll/payroll.service.ts` — add `approveRunForDisbursement()` method

**Interfaces:**
- Consumes: `salary_prep_run` table with `status` column; `requireRole`, `logSensitiveAction` utilities
- Produces: Returns `{ success: true, run_id, status: "disbursed" }`; audit log entry with `action_type: 'FINANCE_APPROVAL'`

---

- [ ] **Step 1.1: Add service method in payroll.service.ts**

In `backend/src/modules/payroll/payroll.service.ts`, add this method after existing exports:

```typescript
export async function approveRunForDisbursement(
  runId: string,
  approverUserId: string
): Promise<{ success: boolean; run_id: string; status: string }> {
  // Verify run exists and is in 'locked' status
  const [runRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, status FROM salary_prep_run WHERE id = ? LIMIT 1`,
    [runId]
  );
  const run = (runRows as any[])[0];
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }
  if (run.status !== "locked") {
    throw new Error(`Run must be in 'locked' status to approve for disbursement (current: ${run.status})`);
  }

  // Update run status to 'disbursed' + record approver
  await db.execute(
    `UPDATE salary_prep_run
        SET status = 'disbursed',
            finance_approved_by = ?,
            finance_approved_at = NOW()
      WHERE id = ?`,
    [approverUserId, runId]
  );

  // Log audit
  await logSensitiveAction({
    actor_user_id: approverUserId,
    action_type: "FINANCE_APPROVAL",
    module_key: "payroll",
    entity_type: "salary_prep_run",
    entity_id: runId,
    change_summary: { run_id: runId, new_status: "disbursed" },
  });

  return { success: true, run_id: runId, status: "disbursed" };
}
```

- [ ] **Step 1.2: Add route in payroll.routes.ts**

In `backend/src/modules/payroll/payroll.routes.ts`, find the last route definition (before `export { router }`) and add:

```typescript
// POST /api/payroll/runs/:id/finance-approve — Finance team approves run for disbursement
router.post(
  "/runs/:id/finance-approve",
  requireAuth,
  requireRole("finance", "admin", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const actorUserId = req.authUser!.id;
    try {
      const result = await payrollService.approveRunForDisbursement(id, actorUserId);
      return res.json(result);
    } catch (err: any) {
      const msg = err.message ?? "Approval failed";
      if (msg.includes("not found")) {
        return res.status(404).json({ success: false, message: msg });
      }
      if (msg.includes("must be in")) {
        return res.status(400).json({ success: false, message: msg });
      }
      throw err;
    }
  })
);
```

- [ ] **Step 1.3: Verify schema has finance_approved_by/at columns**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
grep -n "finance_approved_by\|finance_approved_at" backend/sql/*.sql
```

Expected: columns exist in `salary_prep_run` table. If missing, add migration (but don't execute — this requires approval):

```sql
-- In a new file backend/sql/398_finance_approval_columns.sql:
ALTER TABLE salary_prep_run
  ADD COLUMN IF NOT EXISTS finance_approved_by VARCHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS finance_approved_at DATETIME NULL;
```

- [ ] **Step 1.4: Backend TypeScript check**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest\backend"
npx tsc --noEmit 2>&1 | head -50
```

Expected: 0 new errors introduced.

- [ ] **Step 1.5: Commit**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
git add backend/src/modules/payroll/payroll.routes.ts backend/src/modules/payroll/payroll.service.ts backend/sql/398_finance_approval_columns.sql 2>/dev/null || true
git commit -m "feat(payroll): Finance approval endpoint — approve runs for disbursement with audit"
```

---

## Task 2: Advance Request Tab in NativePayrollHOQueues

**Files:**
- Modify: `src/pages/NativePayrollHOQueues.tsx` — add "Advance Requests" tab (new 7th tab) with employee form + HR/Finance queue

**Interfaces:**
- Consumes: `GET /api/payroll/advances` (existing), `POST /api/payroll/advances` (existing), `PATCH /api/payroll/advances/:id/approve` (existing), `PATCH /api/payroll/advances/:id/reject` (existing); `useUserRole` hook
- Produces: New tab UI for advance request self-service and approval queue

---

- [ ] **Step 2.1: Read current NativePayrollHOQueues.tsx structure**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
grep -n "TabsList\|TabsTrigger\|TabsContent\|export default" src/pages/NativePayrollHOQueues.tsx | head -15
```

Identify where to add new tab (find final `TabsTrigger` and `TabsContent`).

- [ ] **Step 2.2: Add tab trigger and content**

After the last `TabsTrigger` in the `<TabsList>`, add:

```tsx
<TabsTrigger value="advances">
  Advance Requests
</TabsTrigger>
```

And before the closing `</Tabs>`, add the content section:

```tsx
<TabsContent value="advances" className="space-y-4 mt-4">
  <AdvanceRequestsTab />
</TabsContent>
```

- [ ] **Step 2.3: Build AdvanceRequestsTab component**

Add this sub-component at the bottom of the file (before `export default`):

```typescript
function AdvanceRequestsTab() {
  const { roleKeys } = useUserRole();
  const isHRorFinance = roleKeys.some((r) => ["payroll_head", "finance", "admin", "super_admin"].includes(r));
  const [requestForm, setRequestForm] = useState({ amount: "", purpose: "Personal", recovery_months: "3" });
  const [statusFilter, setStatusFilter] = useState("pending");
  const qc = useQueryClient();
  const { toast } = useToast();

  // Fetch advances
  const { data: advancesRaw } = useQuery({
    queryKey: ["advances"],
    queryFn: () => hrmsApi.get("/api/payroll/advances").then((r) => r.data),
  });
  const advances = (advancesRaw as any[]) ?? [];

  // Request mutation
  const requestMut = useMutation({
    mutationFn: (payload: object) => hrmsApi.post("/api/payroll/advances", payload),
    onSuccess: () => {
      toast({ title: "Success", description: "Advance request submitted" });
      setRequestForm({ amount: "", purpose: "Personal", recovery_months: "3" });
      qc.invalidateQueries({ queryKey: ["advances"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.response?.data?.message ?? "Request failed", variant: "destructive" }),
  });

  // Approve mutation
  const approveMut = useMutation({
    mutationFn: ({ id }: { id: string }) => hrmsApi.patch(`/api/payroll/advances/${id}/approve`, {}),
    onSuccess: () => {
      toast({ title: "Success", description: "Advance approved" });
      qc.invalidateQueries({ queryKey: ["advances"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.response?.data?.message ?? "Approval failed", variant: "destructive" }),
  });

  // Reject mutation
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      hrmsApi.patch(`/api/payroll/advances/${id}/reject`, { reason }),
    onSuccess: () => {
      toast({ title: "Success", description: "Advance rejected" });
      qc.invalidateQueries({ queryKey: ["advances"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e?.response?.data?.message ?? "Rejection failed", variant: "destructive" }),
  });

  const filteredAdvances = advances.filter((a) => statusFilter === "all" || a.status === statusFilter);

  return (
    <div className="space-y-6">
      {/* Employee Request Form */}
      {!isHRorFinance && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="font-semibold mb-3">Request a Salary Advance</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs font-medium">Amount (₹)</Label>
              <Input
                type="number"
                placeholder="10000"
                value={requestForm.amount}
                onChange={(e) => setRequestForm((p) => ({ ...p, amount: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs font-medium">Purpose</Label>
              <Select value={requestForm.purpose} onValueChange={(v) => setRequestForm((p) => ({ ...p, purpose: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Personal">Personal</SelectItem>
                  <SelectItem value="Medical">Medical</SelectItem>
                  <SelectItem value="Emergency">Emergency</SelectItem>
                  <SelectItem value="Educational">Educational</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium">Recovery Months</Label>
              <Select value={requestForm.recovery_months} onValueChange={(v) => setRequestForm((p) => ({ ...p, recovery_months: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 3, 6, 9, 12].map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m} months
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            className="mt-3"
            onClick={() => {
              if (!requestForm.amount || Number(requestForm.amount) <= 0) {
                toast({ title: "Error", description: "Amount must be positive", variant: "destructive" });
                return;
              }
              requestMut.mutate({
                amount: Number(requestForm.amount),
                purpose: requestForm.purpose,
                recovery_months: Number(requestForm.recovery_months),
              });
            }}
            disabled={requestMut.isPending}
          >
            {requestMut.isPending ? "Submitting..." : "Submit Request"}
          </Button>
        </div>
      )}

      {/* Approval Queue or My Requests */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{isHRorFinance ? "Approval Queue" : "My Requests"}</h3>
          {isHRorFinance && (
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {filteredAdvances.length === 0 ? (
          <p className="text-sm text-muted-foreground">No advances {statusFilter !== "all" ? `with status "${statusFilter}"` : "yet"}</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Emp Code</th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Purpose</th>
                  <th className="px-3 py-2 text-left">Months</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  {isHRorFinance && <th className="px-3 py-2 text-left">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredAdvances.map((adv: any) => (
                  <tr key={adv.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{adv.employee_code}</td>
                    <td className="px-3 py-2">{adv.employee_name}</td>
                    <td className="px-3 py-2 text-right font-medium">₹{fmt(adv.amount)}</td>
                    <td className="px-3 py-2">{adv.purpose}</td>
                    <td className="px-3 py-2">{adv.recovery_months}</td>
                    <td className="px-3 py-2">
                      <Badge className={`text-xs ${STATUS_CHIP[adv.status] || "bg-slate-100"}`}>{adv.status}</Badge>
                    </td>
                    {isHRorFinance && (
                      <td className="px-3 py-2 space-x-1">
                        {adv.status === "pending" && (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => approveMut.mutate({ id: adv.id })}
                              disabled={approveMut.isPending}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                const reason = window.prompt("Rejection reason:");
                                if (reason) rejectMut.mutate({ id: adv.id, reason });
                              }}
                              disabled={rejectMut.isPending}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2.4: Frontend build verification**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
npx vite build --mode development 2>&1 | tail -20
```

Expected: `✓ built in X.XXs` with no TypeScript errors.

- [ ] **Step 2.5: Commit**

```bash
git add src/pages/NativePayrollHOQueues.tsx
git commit -m "feat(payroll): Advance Requests tab — employee self-service + HR/Finance approval queue"
```

---

## Task 3: Finance Approval Tab in /payroll Dashboard

**Files:**
- Modify: `src/pages/Payroll.tsx` — add "Finance Queue" tab showing runs in `locked` status awaiting approval

**Interfaces:**
- Consumes: `GET /api/payroll/runs?status=locked` (existing), `GET /api/payroll/runs/:id/disbursal` (existing), `POST /api/payroll/runs/:id/finance-approve` (new from Task 1)
- Produces: New tab UI for Finance team to review and approve runs

---

- [ ] **Step 3.1: Read Payroll.tsx structure**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
grep -n "TabsList\|TabsTrigger\|export default\|const Payroll" src/pages/Payroll.tsx | head -20
```

Find where tabs are defined.

- [ ] **Step 3.2: Add Finance Queue tab trigger**

After the last `<TabsTrigger>`, add:

```tsx
<TabsTrigger value="finance-queue">
  Finance Queue
</TabsTrigger>
```

- [ ] **Step 3.3: Add Finance Queue content**

Before the closing `</Tabs>`, add:

```tsx
<TabsContent value="finance-queue">
  <FinanceApprovalQueue />
</TabsContent>
```

- [ ] **Step 3.4: Build FinanceApprovalQueue component**

Add at the bottom of Payroll.tsx (before `export default`):

```typescript
function FinanceApprovalQueue() {
  const { roleKeys } = useUserRole();
  const isFinance = roleKeys.some((r) => ["finance", "admin", "super_admin"].includes(r));
  const qc = useQueryClient();
  const { toast } = useToast();
  const [approvalModal, setApprovalModal] = useState<{ runId: string; runMonth: string } | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);

  if (!isFinance) {
    return <div className="rounded-lg border bg-card p-6 text-center text-muted-foreground">Finance role required to view this queue</div>;
  }

  // Fetch locked runs
  const { data: runsRaw, refetch: refetchRuns } = useQuery({
    queryKey: ["payroll-runs-locked"],
    queryFn: () => hrmsApi.get("/api/payroll/runs?status=locked").then((r) => r.data),
  });
  const runs = (runsRaw as any[]) ?? [];

  // Approve mutation
  const approveMut = useMutation({
    mutationFn: (runId: string) => hrmsApi.post(`/api/payroll/runs/${runId}/finance-approve`, {}),
    onSuccess: () => {
      toast({ title: "Success", description: "Run approved and marked for disbursement" });
      setApprovalModal(null);
      setConfirmChecked(false);
      void refetchRuns();
    },
    onError: (e: any) => toast({ title: "Error", description: e?.response?.data?.message ?? "Approval failed", variant: "destructive" }),
  });

  return (
    <div className="space-y-4 mt-4">
      <div className="rounded-lg border bg-card p-4">
        <h3 className="font-semibold mb-2">Runs Awaiting Finance Approval</h3>
        <p className="text-sm text-muted-foreground mb-4">Runs locked and ready for disbursement authorization</p>

        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No runs pending finance approval</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Run Month</th>
                  <th className="px-3 py-2 text-right">Employees</th>
                  <th className="px-3 py-2 text-right">Total Gross (₹)</th>
                  <th className="px-3 py-2 text-left">Payment Methods</th>
                  <th className="px-3 py-2 text-left">Last Updated</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run: any) => (
                  <tr key={run.id} className="border-t">
                    <td className="px-3 py-2 font-medium">{run.run_month}</td>
                    <td className="px-3 py-2 text-right">{run.employee_count ?? 0}</td>
                    <td className="px-3 py-2 text-right">₹{fmt(run.total_gross)}</td>
                    <td className="px-3 py-2 text-sm">
                      {run.payment_methods ? (
                        <span className="text-muted-foreground">
                          {Object.entries(run.payment_methods as Record<string, number>)
                            .map(([mode, count]) => `${mode}: ${count}`)
                            .join(" | ")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm">{fmtDate(run.updated_at)}</td>
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => {
                          setApprovalModal({ runId: run.id, runMonth: run.run_month });
                          setConfirmChecked(false);
                        }}
                      >
                        Review & Approve
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Approval Modal */}
      {approvalModal && (
        <Dialog open={!!approvalModal} onOpenChange={() => setApprovalModal(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Approve Run for Disbursement</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="rounded-lg bg-muted p-3 text-sm space-y-2">
                <div>
                  <span className="font-medium">Run Month:</span> {approvalModal.runMonth}
                </div>
              </div>
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="confirm-cb"
                  checked={confirmChecked}
                  onChange={(e) => setConfirmChecked(e.target.checked)}
                  className="mt-1"
                />
                <label htmlFor="confirm-cb" className="text-sm">
                  I have verified all disbursement details and payment methods are correct
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApprovalModal(null)}>
                Cancel
              </Button>
              <Button
                variant="default"
                disabled={!confirmChecked || approveMut.isPending}
                onClick={() => approveMut.mutate(approvalModal.runId)}
              >
                {approveMut.isPending ? "Approving..." : "Approve & Mark Disbursed"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
```

- [ ] **Step 3.5: Frontend build verification**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
npx vite build --mode development 2>&1 | tail -20
```

Expected: clean build, no errors.

- [ ] **Step 3.6: Commit**

```bash
git add src/pages/Payroll.tsx
git commit -m "feat(payroll): Finance Approval Queue tab — disbursement authorization surface"
```

---

## Task 4: Validation & Testing

**Files:**
- None (validation only)

**Interfaces:**
- Consumes: All previous tasks' deliverables

---

- [ ] **Step 4.1: Backend verification**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest\backend"
npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 errors.

- [ ] **Step 4.2: Frontend build full clean**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
npm run build 2>&1 | tail -30
```

Expected: build succeeds with no errors.

- [ ] **Step 4.3: Manual test checklist**

Test in browser (assume local dev server running):

**Advance Request Tab:**
- [ ] Employee navigates to `/payroll/ho-queues`, selects "Advance Requests" tab
- [ ] Request form visible (Amount, Purpose, Recovery Months)
- [ ] Submit button disabled when amount is 0 or empty
- [ ] Submit succeeds → toast shown, form cleared, request appears in table with `pending` badge
- [ ] HR/Finance login sees approval queue instead of request form
- [ ] HR clicks "Approve" on pending request → status updates to `approved`
- [ ] HR clicks "Reject" on pending request → reason prompt appears, status updates to `rejected`

**Finance Queue Tab:**
- [ ] Employee/HR cannot see Finance Queue tab (403 enforced)
- [ ] Finance role navigates to `/payroll`, selects "Finance Queue" tab
- [ ] Table shows all runs with `status = 'locked'`
- [ ] Columns show: Run Month, Employee Count, Total Gross, Payment Methods
- [ ] "Review & Approve" button opens modal
- [ ] Modal shows confirmation checkbox (disabled by default)
- [ ] Approve button disabled until checkbox checked
- [ ] Click Approve → POST to `/api/payroll/runs/:id/finance-approve` succeeds
- [ ] Run disappears from queue, toast confirms "Run approved and marked for disbursement"

- [ ] **Step 4.4: Git status**

```bash
cd "c:\Users\ADMIN\Desktop\HRMS2-latest"
git status
```

Expected: clean working tree (all changes committed).

- [ ] **Step 4.5: Final commit message summary**

```bash
git log --oneline -5
```

Expected output should show:
```
<latest> feat(payroll): Finance Approval Queue tab — disbursement authorization surface
<prev>   feat(payroll): Advance Requests tab — employee self-service + HR/Finance approval queue
<prev>   feat(payroll): Finance approval endpoint — approve runs for disbursement with audit
```
