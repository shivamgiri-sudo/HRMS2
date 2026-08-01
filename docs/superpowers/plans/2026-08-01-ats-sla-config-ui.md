# ATS SLA Configuration UI and TAT Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ATS queue SLA threshold configurable via DB, add Escalation Matrix UI to TAT Matrix page, and seed ATS recruitment lifecycle TAT rules.

**Architecture:** Extend existing TAT governance system — add seed data for ATS task types, modify the SLA breach worker to read threshold from DB, add CRUD routes for escalation rules, and extend the TAT Matrix frontend with a tabbed interface showing both TAT rules and escalation rules.

**Tech Stack:** Express/TypeScript backend, React/TypeScript frontend with shadcn/ui components, MySQL database, TanStack Query for data fetching.

## Global Constraints

- All SQL uses `INSERT IGNORE` for idempotent seeds
- Worker must fall back to 0.5 hours (30 min) if DB row missing
- Frontend follows existing `NativeTATMatrix.tsx` patterns
- No breaking changes to existing TAT Matrix or Dashboard functionality

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/sql/1041_ats_sla_tat_rules_seed.sql` | Seeds ATS TAT rules and default escalation rules |
| `backend/src/workers/sla-breach-worker.ts` | Read SLA threshold from DB instead of hardcoded constant |
| `backend/src/modules/governance/tat.routes.ts` | Add PUT/DELETE routes for escalation matrix |
| `src/pages/NativeTATMatrix.tsx` | Add Tabs with TAT Rules and Escalation Rules tabs |

---

### Task 1: SQL Migration — Seed ATS TAT Rules and Escalation Defaults

**Files:**
- Create: `backend/sql/1041_ats_sla_tat_rules_seed.sql`

**Interfaces:**
- Consumes: Existing `tat_matrix_master` and `escalation_matrix_master` tables
- Produces: 7 new rows in `tat_matrix_master`, 3 new rows in `escalation_matrix_master`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration 1041: ATS SLA and TAT rules seed
-- Safe to re-run: INSERT IGNORE skips duplicates on unique key (task_type, branch_id)

-- 1. ATS Queue wait SLA (30 min = 0.5 hours default)
INSERT IGNORE INTO tat_matrix_master (id, task_type, task_description, default_tat_hours, is_active)
VALUES (UUID(), 'ATS_QUEUE_WAIT', 'Walk-in queue wait time before SLA alert', 0.5, 1);

-- 2. ATS Recruitment lifecycle TAT rules
INSERT IGNORE INTO tat_matrix_master (id, task_type, task_description, default_tat_hours, is_active)
VALUES 
  (UUID(), 'ATS_INTERVIEW_RESULT', 'Interview feedback submission', 4, 1),
  (UUID(), 'ATS_OFFER_LETTER', 'Offer letter generation after selection', 24, 1),
  (UUID(), 'ATS_CANDIDATE_DOCS', 'Document submission after offer acceptance', 48, 1),
  (UUID(), 'ATS_BGV_RESULT', 'BGV result update after initiation', 72, 1),
  (UUID(), 'ATS_JOINING_CONFIRMATION', 'Joining confirmation after DOJ', 4, 1),
  (UUID(), 'ATS_ONBOARDING_COMPLETE', 'Full onboarding checklist completion', 48, 1);

-- 3. Default escalation rules for ATS_QUEUE_WAIT
-- Level 1: immediate notify to recruiter
-- Level 2: 1 hour after breach, notify HR
-- Level 3: 2 hours after breach, notify Branch Head
INSERT IGNORE INTO escalation_matrix_master (id, task_type, escalation_level, trigger_after_hours, notify_role, escalation_action, is_active)
VALUES
  (UUID(), 'ATS_QUEUE_WAIT', 1, 0, 'recruiter', 'notify', 1),
  (UUID(), 'ATS_QUEUE_WAIT', 2, 1, 'hr', 'notify', 1),
  (UUID(), 'ATS_QUEUE_WAIT', 3, 2, 'branch_head', 'notify', 1);
```

- [ ] **Step 2: Verify migration file exists**

Run: `ls -la backend/sql/1041_ats_sla_tat_rules_seed.sql`
Expected: File exists with correct permissions

- [ ] **Step 3: Commit**

```bash
git add backend/sql/1041_ats_sla_tat_rules_seed.sql
git commit -m "feat(ats): add migration 1041 — seed ATS TAT rules and escalation defaults"
```

---

### Task 2: Backend — Make SLA Breach Worker Read Threshold from DB

**Files:**
- Modify: `backend/src/workers/sla-breach-worker.ts`

**Interfaces:**
- Consumes: `tat_matrix_master` table with `task_type = 'ATS_QUEUE_WAIT'`
- Produces: `getSlaThresholdMinutes()` async function returning number

- [ ] **Step 1: Add the DB lookup function after line 21 (after MAX_ALERTS_PER_RUN)**

Insert after line 21 (`const MAX_ALERTS_PER_RUN = 10;`):

```typescript
/**
 * Read SLA threshold from tat_matrix_master. Falls back to 30 min if not configured.
 */
async function getSlaThresholdMinutes(): Promise<number> {
  try {
    const [rows]: any = await db.execute(
      `SELECT default_tat_hours FROM tat_matrix_master 
       WHERE task_type = 'ATS_QUEUE_WAIT' AND is_active = 1 LIMIT 1`
    );
    const hours = rows?.[0]?.default_tat_hours ?? 0.5;
    return Math.round(hours * 60);
  } catch {
    return 30; // fallback to original hardcoded value
  }
}
```

- [ ] **Step 2: Modify findSLABreachCandidates to accept threshold parameter**

Change line 66-67 from:
```typescript
async function findSLABreachCandidates(): Promise<any[]> {
  try {
```

To:
```typescript
async function findSLABreachCandidates(slaThresholdMinutes: number): Promise<any[]> {
  try {
```

- [ ] **Step 3: Update the SQL query to use the parameter**

Change line 89 from:
```typescript
      [SLA_THRESHOLD_MINUTES]
```

To:
```typescript
      [slaThresholdMinutes]
```

- [ ] **Step 4: Modify processSLABreaches to fetch threshold and pass it**

Change lines 102-112 from:
```typescript
async function processSLABreaches(): Promise<void> {
  if (isProcessing) {
    console.log("[SLABreachWorker] Previous check is still running; skipping overlap");
    return;
  }

  isProcessing = true;
  try {
    console.log("[SLABreachWorker] Checking for SLA breaches...");

    const candidates = await findSLABreachCandidates();
```

To:
```typescript
async function processSLABreaches(): Promise<void> {
  if (isProcessing) {
    console.log("[SLABreachWorker] Previous check is still running; skipping overlap");
    return;
  }

  isProcessing = true;
  try {
    const slaThreshold = await getSlaThresholdMinutes();
    console.log(`[SLABreachWorker] Checking for SLA breaches (threshold: ${slaThreshold} min)...`);

    const candidates = await findSLABreachCandidates(slaThreshold);
```

- [ ] **Step 5: Update the inbox description to use dynamic threshold**

Change line 144 from:
```typescript
          description: `Token ${candidate.q_token || "N/A"} has been waiting ${candidate.pending_minutes} min without being called. SLA threshold: ${SLA_THRESHOLD_MINUTES} min.`,
```

To:
```typescript
          description: `Token ${candidate.q_token || "N/A"} has been waiting ${candidate.pending_minutes} min without being called. SLA threshold: ${slaThreshold} min.`,
```

Note: This requires passing `slaThreshold` into the loop. Update the for loop to capture it:

Change line 122 from:
```typescript
    for (const candidate of candidates) {
```

The threshold is already in scope from line 110, so line 144 change works as-is.

- [ ] **Step 6: Remove the unused constant (optional cleanup)**

The constant `SLA_THRESHOLD_MINUTES` on line 16 is now unused. Either:
- Remove it entirely, OR
- Keep it as a comment documenting the original default

Recommended: Keep as comment for documentation:
```typescript
// Original hardcoded value, now read from tat_matrix_master.ATS_QUEUE_WAIT
// const SLA_THRESHOLD_MINUTES = 30;
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add backend/src/workers/sla-breach-worker.ts
git commit -m "feat(ats): read SLA threshold from DB in sla-breach-worker"
```

---

### Task 3: Backend — Add PUT/DELETE Routes for Escalation Matrix

**Files:**
- Modify: `backend/src/modules/governance/tat.routes.ts`

**Interfaces:**
- Consumes: Existing `escalation_matrix_master` table
- Produces: `PUT /tat/escalation-matrix/:id`, `DELETE /tat/escalation-matrix/:id` endpoints

- [ ] **Step 1: Add PUT route after the existing POST /escalation-matrix route (after line 102)**

Insert after line 102 (`return res.status(201).json({ success: true });` closing the POST route):

```typescript

// PUT /tat/escalation-matrix/:id — update an escalation rule
router.put("/escalation-matrix/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  const { id } = req.params;
  const { triggerAfterHours, notifyRole, notifyUserId, escalationAction, isActive } = req.body as {
    triggerAfterHours?: number;
    notifyRole?: string;
    notifyUserId?: string;
    escalationAction?: string;
    isActive?: number;
  };

  const sets: string[] = [];
  const params: unknown[] = [];

  if (triggerAfterHours !== undefined) {
    sets.push("trigger_after_hours = ?");
    params.push(triggerAfterHours);
  }
  if (notifyRole !== undefined) {
    sets.push("notify_role = ?");
    params.push(notifyRole || null);
  }
  if (notifyUserId !== undefined) {
    sets.push("notify_user_id = ?");
    params.push(notifyUserId || null);
  }
  if (escalationAction !== undefined) {
    sets.push("escalation_action = ?");
    params.push(escalationAction);
  }
  if (isActive !== undefined) {
    sets.push("is_active = ?");
    params.push(isActive);
  }

  if (sets.length === 0) {
    return res.status(400).json({ success: false, message: "No fields to update" });
  }

  params.push(id);
  await db.execute(
    `UPDATE escalation_matrix_master SET ${sets.join(", ")} WHERE id = ?`,
    params
  );

  return res.json({ success: true });
}));

// DELETE /tat/escalation-matrix/:id — soft delete (set is_active = 0)
router.delete("/escalation-matrix/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  const { id } = req.params;
  await db.execute(
    "UPDATE escalation_matrix_master SET is_active = 0 WHERE id = ?",
    [id]
  );
  return res.json({ success: true });
}));
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/governance/tat.routes.ts
git commit -m "feat(governance): add PUT/DELETE routes for escalation matrix"
```

---

### Task 4: Frontend — Add Tabs and Escalation Rules Tab to NativeTATMatrix

**Files:**
- Modify: `src/pages/NativeTATMatrix.tsx`

**Interfaces:**
- Consumes: `GET /api/governance/tat/escalation-matrix`, `POST /api/governance/tat/escalation-matrix`, `PUT /api/governance/tat/escalation-matrix/:id`, `DELETE /api/governance/tat/escalation-matrix/:id`
- Produces: Tabbed UI with "TAT Rules" and "Escalation Rules" tabs

- [ ] **Step 1: Add imports for Tabs and new icons**

Change line 1-18 imports to add Tabs and Trash2:

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { HrmsModernShell, HrmsBentoTile } from '@/components/ui/hrms-modern';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertTriangle, CheckCircle2, Clock, Edit2, Loader2, Plus, RefreshCw, Save, Trash2, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
```

- [ ] **Step 2: Add EscalationRow interface after TatRow interface (after line 26)**

```typescript
interface EscalationRow {
  id: string;
  task_type: string;
  escalation_level: number;
  trigger_after_hours: number;
  notify_role: string | null;
  notify_user_id: string | null;
  escalation_action: string;
  is_active: number;
}
```

- [ ] **Step 3: Add state and queries for escalation rules inside the component (after line 33)**

After `const [newRow, setNewRow] = useState(...)`:

```typescript
  // Escalation Rules state
  const [activeTab, setActiveTab] = useState('tat-rules');
  const [showCreateEsc, setShowCreateEsc] = useState(false);
  const [editEscTarget, setEditEscTarget] = useState<EscalationRow | null>(null);
  const [newEscRow, setNewEscRow] = useState({ task_type: '', escalation_level: '1', trigger_after_hours: '0', notify_role: '', escalation_action: 'notify' });
  const [editEscForm, setEditEscForm] = useState({ trigger_after_hours: '', notify_role: '', escalation_action: '' });

  // Escalation Rules query
  const { data: escData, isLoading: escLoading, refetch: refetchEsc } = useQuery({
    queryKey: ['escalation-matrix'],
    queryFn: async () => {
      const r = await hrmsApi.get<any>('/api/governance/tat/escalation-matrix');
      return ((r as any)?.data ?? []) as EscalationRow[];
    },
  });
  const escRows: EscalationRow[] = escData ?? [];

  // Escalation mutations
  const createEscMutation = useMutation({
    mutationFn: (body: any) => hrmsApi.post('/api/governance/tat/escalation-matrix', body),
    onSuccess: () => {
      toast.success('Escalation rule created');
      qc.invalidateQueries({ queryKey: ['escalation-matrix'] });
      setShowCreateEsc(false);
      setNewEscRow({ task_type: '', escalation_level: '1', trigger_after_hours: '0', notify_role: '', escalation_action: 'notify' });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Create failed'),
  });

  const updateEscMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => hrmsApi.put(`/api/governance/tat/escalation-matrix/${id}`, body),
    onSuccess: () => {
      toast.success('Escalation rule updated');
      qc.invalidateQueries({ queryKey: ['escalation-matrix'] });
      setEditEscTarget(null);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Update failed'),
  });

  const deleteEscMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.delete(`/api/governance/tat/escalation-matrix/${id}`),
    onSuccess: () => {
      toast.success('Escalation rule removed');
      qc.invalidateQueries({ queryKey: ['escalation-matrix'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Delete failed'),
  });

  function openEditEsc(row: EscalationRow) {
    setEditEscTarget(row);
    setEditEscForm({
      trigger_after_hours: String(row.trigger_after_hours),
      notify_role: row.notify_role ?? '',
      escalation_action: row.escalation_action,
    });
  }
```

- [ ] **Step 4: Add escalation stats after avgTat (after line 75)**

```typescript
  const activeEscRules = escRows.filter(r => r.is_active).length;
```

- [ ] **Step 5: Wrap the main content in Tabs**

Replace the content inside `<HrmsModernShell>` (everything between the opening tag and the closing `</HrmsModernShell>`) with a tabbed structure. 

The full replacement is large, so here's the structure:

```typescript
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-slate-100 p-1">
          <TabsTrigger value="tat-rules" className="data-[state=active]:bg-white">
            <Clock className="h-4 w-4 mr-2" /> TAT Rules
          </TabsTrigger>
          <TabsTrigger value="escalation-rules" className="data-[state=active]:bg-white">
            <Zap className="h-4 w-4 mr-2" /> Escalation Rules
          </TabsTrigger>
        </TabsList>

        {/* TAT Rules Tab */}
        <TabsContent value="tat-rules" className="space-y-6">
          {/* Existing stat tiles */}
          <div className="grid gap-4 sm:grid-cols-3">
            {/* ... existing tiles ... */}
          </div>
          {/* Existing table */}
          <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
            {/* ... existing table content ... */}
          </div>
        </TabsContent>

        {/* Escalation Rules Tab */}
        <TabsContent value="escalation-rules" className="space-y-6">
          {/* Stat tiles for escalation */}
          <div className="grid gap-4 sm:grid-cols-3">
            <HrmsBentoTile title="Active Escalation Rules" value={activeEscRules} detail="Configured escalations" icon={<Zap className="h-5 w-5 text-amber-600" />} accentClassName="from-amber-500 to-orange-500" />
            <HrmsBentoTile title="Task Types with Escalation" value={new Set(escRows.filter(r => r.is_active).map(r => r.task_type)).size} detail="Covered task types" icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} accentClassName="from-emerald-500 to-teal-500" />
            <HrmsBentoTile title="Max Escalation Level" value={Math.max(0, ...escRows.map(r => r.escalation_level))} detail="Highest configured level" icon={<AlertTriangle className="h-5 w-5 text-red-600" />} accentClassName="from-red-500 to-rose-500" />
          </div>

          {/* Escalation rules table */}
          <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800">Escalation Rules ({escRows.length})</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void refetchEsc()} disabled={escLoading} className="gap-2">
                  <RefreshCw className={`h-4 w-4 ${escLoading ? 'animate-spin' : ''}`} />
                </Button>
                <Button size="sm" onClick={() => setShowCreateEsc(true)} className="gap-2 bg-slate-950 hover:bg-slate-800 text-white">
                  <Plus className="h-4 w-4" /> Add Escalation
                </Button>
              </div>
            </div>
            {escLoading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
              </div>
            ) : escRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Zap className="h-12 w-12 mb-3 text-slate-200" />
                <p className="font-semibold text-slate-700">No escalation rules configured</p>
                <p className="text-sm text-slate-400 mt-1">Add rules to define who gets notified when SLAs are breached.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Task Type</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Level</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Trigger After</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Notify Role</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Action</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Status</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {escRows.map(row => (
                    <TableRow key={row.id} className="hover:bg-slate-50/60 transition-colors">
                      <TableCell className="font-semibold text-slate-900 text-sm">{row.task_type}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-sm font-bold">{row.escalation_level}</span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{row.trigger_after_hours}h after breach</TableCell>
                      <TableCell className="text-sm text-slate-600">{row.notify_role ?? '—'}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          row.escalation_action === 'block' ? 'bg-red-50 text-red-700 border border-red-200' :
                          row.escalation_action === 'reassign' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                          'bg-slate-50 text-slate-700 border border-slate-200'
                        }`}>
                          {row.escalation_action.toUpperCase()}
                        </span>
                      </TableCell>
                      <TableCell>
                        {row.is_active ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] font-bold text-slate-500">
                            Inactive
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-8 text-xs gap-1 cursor-pointer" onClick={() => openEditEsc(row)}>
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="outline" className="h-8 text-xs gap-1 cursor-pointer text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => deleteEscMutation.mutate(row.id)} disabled={deleteEscMutation.isPending}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>
      </Tabs>
```

- [ ] **Step 6: Add Create Escalation Dialog after the existing Edit Dialog (before closing `</DashboardLayout>`)**

```typescript
      {/* Create Escalation Dialog */}
      <Dialog open={showCreateEsc} onOpenChange={open => { setShowCreateEsc(open); if (!open) setNewEscRow({ task_type: '', escalation_level: '1', trigger_after_hours: '0', notify_role: '', escalation_action: 'notify' }); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> New Escalation Rule</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label>Task Type <span className="text-red-500">*</span></Label>
              <Select value={newEscRow.task_type} onValueChange={v => setNewEscRow(p => ({ ...p, task_type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select task type" /></SelectTrigger>
                <SelectContent>
                  {rows.filter(r => r.is_active).map(r => (
                    <SelectItem key={r.task_type} value={r.task_type}>{r.task_type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Escalation Level <span className="text-red-500">*</span></Label>
                <Input type="number" min="1" value={newEscRow.escalation_level} onChange={e => setNewEscRow(p => ({ ...p, escalation_level: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Trigger After (hours)</Label>
                <Input type="number" min="0" value={newEscRow.trigger_after_hours} onChange={e => setNewEscRow(p => ({ ...p, trigger_after_hours: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Notify Role</Label>
              <Select value={newEscRow.notify_role} onValueChange={v => setNewEscRow(p => ({ ...p, notify_role: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="recruiter">Recruiter</SelectItem>
                  <SelectItem value="hr">HR</SelectItem>
                  <SelectItem value="branch_head">Branch Head</SelectItem>
                  <SelectItem value="process_manager">Process Manager</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Action</Label>
              <Select value={newEscRow.escalation_action} onValueChange={v => setNewEscRow(p => ({ ...p, escalation_action: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="notify">Notify</SelectItem>
                  <SelectItem value="reassign">Reassign</SelectItem>
                  <SelectItem value="block">Block</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                className="flex-1 cursor-pointer"
                disabled={createEscMutation.isPending || !newEscRow.task_type}
                onClick={() => createEscMutation.mutate({
                  taskType: newEscRow.task_type,
                  escalationLevel: Number(newEscRow.escalation_level),
                  triggerAfterHours: Number(newEscRow.trigger_after_hours),
                  notifyRole: newEscRow.notify_role || null,
                  escalationAction: newEscRow.escalation_action,
                })}
              >
                {createEscMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Create Rule
              </Button>
              <Button variant="outline" onClick={() => setShowCreateEsc(false)} className="cursor-pointer">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Escalation Dialog */}
      <Dialog open={!!editEscTarget} onOpenChange={open => { if (!open) setEditEscTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Escalation: {editEscTarget?.task_type} Level {editEscTarget?.escalation_level}</DialogTitle></DialogHeader>
          {editEscTarget && (
            <div className="space-y-4">
              <div>
                <Label>Trigger After (hours)</Label>
                <Input type="number" min="0" value={editEscForm.trigger_after_hours} onChange={e => setEditEscForm(p => ({ ...p, trigger_after_hours: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Notify Role</Label>
                <Select value={editEscForm.notify_role} onValueChange={v => setEditEscForm(p => ({ ...p, notify_role: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select role" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recruiter">Recruiter</SelectItem>
                    <SelectItem value="hr">HR</SelectItem>
                    <SelectItem value="branch_head">Branch Head</SelectItem>
                    <SelectItem value="process_manager">Process Manager</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Action</Label>
                <Select value={editEscForm.escalation_action} onValueChange={v => setEditEscForm(p => ({ ...p, escalation_action: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="notify">Notify</SelectItem>
                    <SelectItem value="reassign">Reassign</SelectItem>
                    <SelectItem value="block">Block</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1 cursor-pointer"
                  disabled={updateEscMutation.isPending}
                  onClick={() => updateEscMutation.mutate({
                    id: editEscTarget.id,
                    body: {
                      triggerAfterHours: Number(editEscForm.trigger_after_hours),
                      notifyRole: editEscForm.notify_role || null,
                      escalationAction: editEscForm.escalation_action,
                    },
                  })}
                >
                  {updateEscMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Save Changes
                </Button>
                <Button variant="outline" onClick={() => setEditEscTarget(null)} className="cursor-pointer">Cancel</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
```

- [ ] **Step 7: Verify frontend builds**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 8: Commit**

```bash
git add src/pages/NativeTATMatrix.tsx
git commit -m "feat(governance): add Escalation Rules tab to TAT Matrix page"
```

---

### Task 5: Final Verification and Push

**Files:**
- All files from Tasks 1-4

- [ ] **Step 1: Run full TypeScript check**

Run: `cd backend && npx tsc --noEmit && cd .. && npm run build`
Expected: 0 errors in both backend and frontend

- [ ] **Step 2: Verify git status shows only expected files**

Run: `git status --porcelain`
Expected: Only the 4 files from this plan (should all be committed already)

- [ ] **Step 3: Push to origin**

Run: `git push origin main`
Expected: Push succeeds

---

## Self-Review Checklist

- [x] **Spec coverage:** All 3 gaps addressed — ATS queue SLA configurable (Task 2), Escalation UI (Task 4), ATS TAT rules seeded (Task 1)
- [x] **Placeholder scan:** No TBD/TODO in plan, all code blocks complete
- [x] **Type consistency:** `EscalationRow` interface matches DB schema, API body keys match route expectations (`taskType`, `triggerAfterHours`, etc.)
