// src/pages/NativeAttendanceRulesMaster.tsx
import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Edit2, Trash2, Play, Clock, Plus } from "lucide-react";

type AttendanceSource = 'dialler' | 'biometric';
type ScopeType = 'designation' | 'process' | 'branch' | 'process_designation' | 'branch_process' | 'global';

interface AttendanceRule {
  id: string;
  rule_name: string;
  scope_type: ScopeType;
  designation_id: string | null;
  process_id: string | null;
  branch_id: string | null;
  designation_code?: string;
  process_name?: string;
  branch_name?: string;
  attendance_source: AttendanceSource;
  full_day_minutes: number;
  half_day_minutes: number;
  grace_minutes: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
  active_status: number;
}

interface Designation { id: string; designation_code: string; designation_name: string; }
interface Process { id: string; process_code: string; process_name: string; }
interface Branch { id: string; branch_code: string; branch_name: string; }

const EMPTY_FORM = {
  rule_name: '', scope_type: 'designation' as ScopeType,
  designation_id: '', process_id: '', branch_id: '',
  attendance_source: 'biometric' as AttendanceSource,
  full_day_minutes: 540, half_day_minutes: 270, grace_minutes: 15,
  effective_from: new Date().toISOString().split('T')[0]!,
  effective_to: '', notes: '',
};

function minsToHM(m: number) {
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const SCOPE_COLORS: Record<ScopeType, string> = {
  designation:        'bg-purple-100 text-purple-800',
  process:            'bg-orange-100 text-orange-800',
  branch:             'bg-yellow-100 text-yellow-800',
  process_designation:'bg-pink-100 text-pink-800',
  branch_process:     'bg-indigo-100 text-indigo-800',
  global:             'bg-slate-100 text-slate-700',
};

const ANY_VALUE = "__any__";

export default function NativeAttendanceRulesMaster() {
  const { toast } = useToast();
  const [rules, setRules] = useState<AttendanceRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // Master data for dropdowns
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);

  // Simulator state
  const [simDesig, setSimDesig] = useState('');
  const [simProcess, setSimProcess] = useState('');
  const [simBranch, setSimBranch] = useState('');
  const [simResult, setSimResult] = useState<AttendanceRule | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [rulesRes, orgRes, procRes] = await Promise.all([
          hrmsApi.get<{ success: boolean; data: AttendanceRule[] }>('/api/wfm/attendance/rules'),
          hrmsApi.get<{ success: boolean; data: { designations?: Designation[]; branches?: Branch[] } }>('/api/org'),
          hrmsApi.get<{ success: boolean; data: Process[] }>('/api/processes'),
        ]);
        if (!cancelled) {
          setRules(rulesRes.data ?? []);
          setDesignations(orgRes.data?.designations ?? []);
          setBranches(orgRes.data?.branches ?? []);
          setProcesses(procRes.data ?? []);
        }
      } catch {
        toast({ title: 'Failed to load rules', variant: 'destructive' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const reload = async () => {
    const res = await hrmsApi.get<{ success: boolean; data: AttendanceRule[] }>('/api/wfm/attendance/rules');
    setRules(res.data ?? []);
  };

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (rule: AttendanceRule) => {
    setForm({
      rule_name: rule.rule_name,
      scope_type: rule.scope_type,
      designation_id: rule.designation_id ?? '',
      process_id: rule.process_id ?? '',
      branch_id: rule.branch_id ?? '',
      attendance_source: rule.attendance_source,
      full_day_minutes: rule.full_day_minutes,
      half_day_minutes: rule.half_day_minutes,
      grace_minutes: rule.grace_minutes,
      effective_from: rule.effective_from,
      effective_to: rule.effective_to ?? '',
      notes: rule.notes ?? '',
    });
    setEditingId(rule.id);
    setDialogOpen(true);
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate this rule?')) return;
    try {
      await hrmsApi.delete(`/api/wfm/attendance/rules/${id}`);
      toast({ title: 'Rule deactivated' });
      await reload();
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        rule_name: form.rule_name,
        scope_type: form.scope_type,
        designation_id: form.designation_id || null,
        process_id: form.process_id || null,
        branch_id: form.branch_id || null,
        attendance_source: form.attendance_source,
        full_day_minutes: Number(form.full_day_minutes),
        half_day_minutes: Number(form.half_day_minutes),
        grace_minutes: Number(form.grace_minutes),
        effective_from: form.effective_from,
        effective_to: form.effective_to || null,
        notes: form.notes || null,
      };
      if (editingId) {
        await hrmsApi.patch(`/api/wfm/attendance/rules/${editingId}`, payload);
        toast({ title: 'Rule updated' });
      } else {
        await hrmsApi.post('/api/wfm/attendance/rules', payload);
        toast({ title: 'Rule created' });
      }
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSimulate = async () => {
    setSimLoading(true);
    setSimResult(null);
    try {
      const params = new URLSearchParams();
      if (simDesig)   params.set('designationId', simDesig);
      if (simProcess) params.set('processId',     simProcess);
      if (simBranch)  params.set('branchId',       simBranch);
      const res = await hrmsApi.get<{ success: boolean; data: AttendanceRule }>(
        `/api/wfm/attendance/rules/resolve?${params.toString()}`
      );
      setSimResult(res.data);
    } catch (e: any) {
      toast({ title: 'Simulation failed', description: e.message, variant: 'destructive' });
    } finally {
      setSimLoading(false);
    }
  };

  const showDesig   = form.scope_type.includes('designation');
  const showProcess = form.scope_type.includes('process');
  const showBranch  = form.scope_type.includes('branch');

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="hrms-page-header">
          <div>
            <h1 className="hrms-page-title">Attendance Rules Master</h1>
            <p className="hrms-page-subtitle">Configure attendance source and thresholds by designation, process, or branch</p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" /> New Rule
          </Button>
        </div>

        {/* Rules Table */}
        <div className="hrms-table-wrapper">
          {loading ? (
            <div className="p-6 space-y-3">
              {[1,2,3].map(i => <div key={i} className="hrms-skeleton h-10 rounded" />)}
            </div>
          ) : rules.length === 0 ? (
            <div className="hrms-empty-state">
              <Clock className="hrms-empty-icon" />
              <p className="hrms-empty-title">No attendance rules configured</p>
              <p className="hrms-empty-body">Click "New Rule" to add the first rule</p>
            </div>
          ) : (
            <table className="hrms-table w-full">
              <thead>
                <tr>
                  <th>Rule Name</th><th>Scope</th><th>Applies To</th>
                  <th>Source</th><th>Full Day</th><th>Half Day</th><th>Grace</th>
                  <th>Effective</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <tr key={r.id}>
                    <td className="font-medium text-slate-900">{r.rule_name}</td>
                    <td>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${SCOPE_COLORS[r.scope_type]}`}>
                        {r.scope_type.replace('_',' ')}
                      </span>
                    </td>
                    <td className="text-xs text-slate-500">
                      {r.designation_code && <span>Desig: {r.designation_code}</span>}
                      {r.process_name && <span>Process: {r.process_name}</span>}
                      {r.branch_name && <span>Branch: {r.branch_name}</span>}
                      {r.scope_type === 'global' && <span className="italic">All employees</span>}
                    </td>
                    <td>
                      <span className={`hrms-badge-${r.attendance_source === 'dialler' ? 'approved' : 'active'}`}>
                        {r.attendance_source}
                      </span>
                    </td>
                    <td className="tabular-nums">{minsToHM(r.full_day_minutes)}</td>
                    <td className="tabular-nums">{minsToHM(r.half_day_minutes)}</td>
                    <td className="tabular-nums">{r.grace_minutes}m</td>
                    <td className="text-xs text-slate-500">
                      {r.effective_from}{r.effective_to ? ` → ${r.effective_to}` : ' →'}
                    </td>
                    <td>
                      <span className={r.active_status ? 'hrms-badge-active' : 'hrms-badge-inactive'}>
                        {r.active_status ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                        {!!r.active_status && (
                          <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => handleDeactivate(r.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Rule Simulator */}
        <div className="hrms-card hrms-card-body space-y-4">
          <h2 className="font-bold text-slate-900 flex items-center gap-2">
            <Play className="h-4 w-4 text-blue-600" /> Rule Simulator
          </h2>
          <p className="text-sm text-slate-500">Check which attendance rule would apply for a given combination before saving changes.</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Designation</Label>
              <Select value={simDesig || ANY_VALUE} onValueChange={(value) => setSimDesig(value === ANY_VALUE ? '' : value)}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>Any</SelectItem>
                  {designations.map(d => <SelectItem key={d.id} value={d.id}>{d.designation_code} — {d.designation_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Process</Label>
              <Select value={simProcess || ANY_VALUE} onValueChange={(value) => setSimProcess(value === ANY_VALUE ? '' : value)}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>Any</SelectItem>
                  {processes.map(p => <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Branch</Label>
              <Select value={simBranch || ANY_VALUE} onValueChange={(value) => setSimBranch(value === ANY_VALUE ? '' : value)}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>Any</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleSimulate} disabled={simLoading} className="gap-2">
            <Play className="h-4 w-4" />{simLoading ? 'Simulating...' : 'Simulate'}
          </Button>
          {simResult && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-2">
              <p className="font-semibold text-blue-900">Matched Rule: {simResult.rule_name}</p>
              <div className="grid grid-cols-4 gap-3 text-sm text-blue-800">
                <div><span className="font-medium">Source:</span> {simResult.attendance_source}</div>
                <div><span className="font-medium">Full Day:</span> {minsToHM(simResult.full_day_minutes)}</div>
                <div><span className="font-medium">Half Day:</span> {minsToHM(simResult.half_day_minutes)}</div>
                <div><span className="font-medium">Grace:</span> {simResult.grace_minutes}m</div>
              </div>
              <p className="text-xs text-blue-600">Scope: {simResult.scope_type}</p>
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Rule' : 'Create Attendance Rule'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Rule Name *</Label>
              <Input value={form.rule_name} onChange={e => setForm(f => ({...f, rule_name: e.target.value}))} placeholder="e.g. Inbound Agents HQ" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Scope Type *</Label>
                <Select value={form.scope_type} onValueChange={v => setForm(f => ({...f, scope_type: v as ScopeType}))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="designation">Designation only</SelectItem>
                    <SelectItem value="process">Process only</SelectItem>
                    <SelectItem value="branch">Branch only</SelectItem>
                    <SelectItem value="process_designation">Process + Designation</SelectItem>
                    <SelectItem value="branch_process">Branch + Process</SelectItem>
                    <SelectItem value="global">Global (all employees)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Attendance Source *</Label>
                <div className="flex gap-4 pt-2">
                  {(['dialler','biometric'] as AttendanceSource[]).map(s => (
                    <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="radio" checked={form.attendance_source === s}
                        onChange={() => setForm(f => ({...f, attendance_source: s}))} />
                      <span className="capitalize font-medium">{s}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            {showDesig && (
              <div className="space-y-1">
                <Label>Designation</Label>
                <Select value={form.designation_id} onValueChange={v => setForm(f => ({...f, designation_id: v}))}>
                  <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                  <SelectContent>
                    {designations.map(d => <SelectItem key={d.id} value={d.id}>{d.designation_code} — {d.designation_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {showProcess && (
              <div className="space-y-1">
                <Label>Process</Label>
                <Select value={form.process_id} onValueChange={v => setForm(f => ({...f, process_id: v}))}>
                  <SelectTrigger><SelectValue placeholder="Select process" /></SelectTrigger>
                  <SelectContent>
                    {processes.map(p => <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {showBranch && (
              <div className="space-y-1">
                <Label>Branch</Label>
                <Select value={form.branch_id} onValueChange={v => setForm(f => ({...f, branch_id: v}))}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Full Day (minutes) *</Label>
                <Input type="number" min={1} max={1440} value={form.full_day_minutes}
                  onChange={e => setForm(f => ({...f, full_day_minutes: Number(e.target.value)}))} />
                <p className="text-xs text-slate-400">= {minsToHM(form.full_day_minutes)}</p>
              </div>
              <div className="space-y-1">
                <Label>Half Day (minutes) *</Label>
                <Input type="number" min={1} max={1440} value={form.half_day_minutes}
                  onChange={e => setForm(f => ({...f, half_day_minutes: Number(e.target.value)}))} />
                <p className="text-xs text-slate-400">{minsToHM(form.half_day_minutes)}–{minsToHM(form.full_day_minutes - 1)}</p>
              </div>
              <div className="space-y-1">
                <Label>Grace Period (minutes)</Label>
                <Input type="number" min={0} max={120} value={form.grace_minutes}
                  onChange={e => setForm(f => ({...f, grace_minutes: Number(e.target.value)}))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Effective From *</Label>
                <Input type="date" value={form.effective_from}
                  onChange={e => setForm(f => ({...f, effective_from: e.target.value}))} />
              </div>
              <div className="space-y-1">
                <Label>Effective To (optional)</Label>
                <Input type="date" value={form.effective_to}
                  onChange={e => setForm(f => ({...f, effective_to: e.target.value}))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={form.notes}
                onChange={e => setForm(f => ({...f, notes: e.target.value}))}
                placeholder="e.g. Applies to all inbound agents at HQ branch" />
            </div>
            <div className="flex gap-3 pt-2">
              <Button className="flex-1" onClick={handleSave} disabled={saving || !form.rule_name || !form.effective_from}>
                {saving ? 'Saving...' : editingId ? 'Update Rule' : 'Create Rule'}
              </Button>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
