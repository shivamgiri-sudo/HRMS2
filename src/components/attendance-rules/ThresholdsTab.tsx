import { useState } from 'react';
import { Info, MoreHorizontal, Pencil, Plus, Power } from 'lucide-react';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  type AttendanceRule, type AttendanceSource, type Branch, type DayThresholdsInForce, type Designation,
  type Process, type ScopeType, minsToHM,
} from './types';

const SCOPE_LABEL: Record<ScopeType, string> = {
  designation: 'Designation',
  process: 'Process',
  branch: 'Branch',
  process_designation: 'Process + Designation',
  branch_process: 'Branch + Process',
  global: 'Everyone',
};

const SCOPE_OPTION: Record<ScopeType, string> = {
  designation: 'Designation only',
  process: 'Process only',
  branch: 'Branch only',
  process_designation: 'Process + Designation',
  branch_process: 'Branch + Process',
  global: 'Everyone (global)',
};

const today = () => new Date().toISOString().split('T')[0]!;

const EMPTY_FORM = {
  rule_name: '', scope_type: 'designation' as ScopeType,
  designation_id: '', process_id: '', branch_id: '',
  attendance_source: 'biometric' as AttendanceSource,
  full_day_minutes: 540, half_day_minutes: 270, grace_minutes: 0,
  effective_from: today(), effective_to: '', notes: '',
};

interface Props {
  rules: AttendanceRule[];
  loading: boolean;
  canEdit: boolean;
  inForce: DayThresholdsInForce | null;
  designations: Designation[];
  processes: Process[];
  branches: Branch[];
  reload: () => Promise<void>;
}

export function ThresholdsTab({ rules, loading, canEdit, inForce, designations, processes, branches, reload }: Props) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState<AttendanceRule | null>(null);

  const showDesig = form.scope_type.includes('designation');
  const showProcess = form.scope_type.includes('process');
  const showBranch = form.scope_type.includes('branch');

  const openCreate = () => { setForm({ ...EMPTY_FORM, effective_from: today() }); setEditingId(null); setDialogOpen(true); };
  const openEdit = (r: AttendanceRule) => {
    setForm({
      rule_name: r.rule_name, scope_type: r.scope_type,
      designation_id: r.designation_id ?? '', process_id: r.process_id ?? '', branch_id: r.branch_id ?? '',
      attendance_source: r.attendance_source, full_day_minutes: r.full_day_minutes,
      half_day_minutes: r.half_day_minutes, grace_minutes: r.grace_minutes,
      effective_from: r.effective_from, effective_to: r.effective_to ?? '', notes: r.notes ?? '',
    });
    setEditingId(r.id);
    setDialogOpen(true);
  };

  const scopeComplete =
    (!showDesig || !!form.designation_id) && (!showProcess || !!form.process_id) && (!showBranch || !!form.branch_id);
  const valid = !!form.rule_name.trim() && !!form.effective_from && scopeComplete
    && form.half_day_minutes <= form.full_day_minutes;

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        rule_name: form.rule_name.trim(),
        scope_type: form.scope_type,
        designation_id: showDesig ? form.designation_id || null : null,
        process_id: showProcess ? form.process_id || null : null,
        branch_id: showBranch ? form.branch_id || null : null,
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

  const deactivate = async () => {
    if (!deactivating) return;
    const id = deactivating.id;
    setDeactivating(null);
    try {
      await hrmsApi.delete(`/api/wfm/attendance/rules/${id}`);
      toast({ title: 'Rule deactivated' });
      await reload();
    } catch (e: any) {
      toast({ title: 'Could not deactivate', description: e.message, variant: 'destructive' });
    }
  };

  const appliesTo = (r: AttendanceRule): string[] => {
    const parts: string[] = [];
    if (r.designation_code) parts.push(r.designation_code);
    if (r.process_name) parts.push(r.process_name);
    if (r.branch_name) parts.push(r.branch_name);
    return parts.length ? parts : ['All employees'];
  };

  return (
    <div className="space-y-5">
      {inForce && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">APR days</p>
              <Badge variant="outline" className="border-cyan-200 bg-cyan-50 text-cyan-800">In force</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-700">
              Present at <strong>{minsToHM(inForce.apr.full_day_minutes)}</strong> net login, half day from{' '}
              <strong>{minsToHM(inForce.apr.half_day_floor_minutes)}</strong>.
            </p>
            <p className="mt-1 text-xs text-slate-500">Full day is fixed in the engine for APR; the half-day floor is a system setting.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">COSEC days</p>
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">In force</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-700">
              Present at <strong>{minsToHM(inForce.cosec.full_day_minutes)}</strong> in the building, half day from{' '}
              <strong>{minsToHM(inForce.cosec.half_day_floor_minutes)}</strong>.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {inForce.cosec.per_employee_overrides > 0
                ? `${inForce.cosec.per_employee_overrides} employee(s) have a personal full-day exception.`
                : 'No employee has a personal full-day exception.'}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <p>
          The rules below set <strong>late-mark grace</strong> for biometric days. Their full-day and half-day minutes do
          not decide a day's status: the thresholds shown above do. A rule marked “Treated as APR” overrides the
          Source tab for the employees it covers.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Threshold rules</h2>
        {canEdit && <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> New rule</Button>}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="space-y-3 p-5">{[1, 2, 3].map((i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />)}</div>
        ) : rules.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-semibold text-slate-800">No threshold rules yet</p>
            <p className="mt-1 text-xs text-slate-500">Without one, the engine uses its defaults.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Rule</th>
                  <th scope="col" className="px-4 py-3">Applies to</th>
                  <th scope="col" className="px-4 py-3">Late-mark grace</th>
                  <th scope="col" className="px-4 py-3">Effective</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rules.map((r) => (
                  <tr key={r.id} className={r.active_status ? 'hover:bg-slate-50/70' : 'bg-slate-50/60 text-slate-400'}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{r.rule_name}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="text-[11px]">{SCOPE_LABEL[r.scope_type]}</Badge>
                        {!r.active_status && <Badge variant="outline" className="text-[11px]">Inactive</Badge>}
                        {r.attendance_source === 'dialler' && !!r.active_status && (
                          <Badge variant="outline" className="border-cyan-200 bg-cyan-50 text-[11px] text-cyan-800">Treated as APR</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {appliesTo(r).map((a) => (
                          <span key={a} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{a}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{r.grace_minutes} min</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {r.effective_from}{r.effective_to ? ` to ${r.effective_to}` : ' onwards'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canEdit && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" aria-label={`Actions for ${r.rule_name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(r)} className="gap-2 cursor-pointer">
                              <Pencil className="h-3.5 w-3.5" /> Edit
                            </DropdownMenuItem>
                            {!!r.active_status && (
                              <DropdownMenuItem onClick={() => setDeactivating(r)} className="gap-2 cursor-pointer text-red-600">
                                <Power className="h-3.5 w-3.5" /> Deactivate
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AlertDialog open={!!deactivating} onOpenChange={(o) => { if (!o) setDeactivating(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate “{deactivating?.rule_name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The employees it covers fall back to the next most specific rule. You can create it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep rule</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deactivate()}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? 'Edit threshold rule' : 'New threshold rule'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1">
              <Label htmlFor="rule-name">Rule name *</Label>
              <Input id="rule-name" value={form.rule_name} placeholder="e.g. Inbound agents, HQ"
                onChange={(e) => setForm((f) => ({ ...f, rule_name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Applies to *</Label>
              <Select value={form.scope_type} onValueChange={(v) => setForm((f) => ({ ...f, scope_type: v as ScopeType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(SCOPE_LABEL) as ScopeType[]).map((s) => (
                    <SelectItem key={s} value={s}>{SCOPE_OPTION[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {showDesig && (
              <div className="space-y-1">
                <Label>Designation *</Label>
                <Select value={form.designation_id} onValueChange={(v) => setForm((f) => ({ ...f, designation_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
                  <SelectContent>{designations.map((d) => <SelectItem key={d.id} value={d.id}>{d.designation_code} — {d.designation_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {showProcess && (
              <div className="space-y-1">
                <Label>Process *</Label>
                <Select value={form.process_id} onValueChange={(v) => setForm((f) => ({ ...f, process_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select process" /></SelectTrigger>
                  <SelectContent>{processes.map((p) => <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {showBranch && (
              <div className="space-y-1">
                <Label>Branch *</Label>
                <Select value={form.branch_id} onValueChange={(v) => setForm((f) => ({ ...f, branch_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="grace">Late-mark grace (minutes)</Label>
                <Input id="grace" type="number" min={0} max={120} value={form.grace_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, grace_minutes: Number(e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label>Source for this scope</Label>
                <Select value={form.attendance_source} onValueChange={(v) => setForm((f) => ({ ...f, attendance_source: v as AttendanceSource }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="biometric">Follow the Source tab (recommended)</SelectItem>
                    <SelectItem value="dialler">Treat as APR (overrides the Source tab)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="from">Effective from *</Label>
                <Input id="from" type="date" value={form.effective_from} onChange={(e) => setForm((f) => ({ ...f, effective_from: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="to">Effective to</Label>
                <Input id="to" type="date" value={form.effective_to} onChange={(e) => setForm((f) => ({ ...f, effective_to: e.target.value }))} />
              </div>
            </div>
            <details className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <summary className="cursor-pointer text-slate-600">Legacy day length (not used for day status)</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="full">Full day (minutes)</Label>
                  <Input id="full" type="number" min={1} max={1440} value={form.full_day_minutes}
                    onChange={(e) => setForm((f) => ({ ...f, full_day_minutes: Number(e.target.value) }))} />
                  <p className="text-xs text-slate-400">{minsToHM(form.full_day_minutes)}</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="half">Half day (minutes)</Label>
                  <Input id="half" type="number" min={1} max={1440} value={form.half_day_minutes}
                    onChange={(e) => setForm((f) => ({ ...f, half_day_minutes: Number(e.target.value) }))} />
                  <p className={`text-xs ${form.half_day_minutes > form.full_day_minutes ? 'text-red-600' : 'text-slate-400'}`}>
                    {form.half_day_minutes > form.full_day_minutes ? 'Must not exceed full day' : minsToHM(form.half_day_minutes)}
                  </p>
                </div>
              </div>
            </details>
            <div className="space-y-1">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-3 pt-1">
              <Button className="flex-1" onClick={() => void save()} disabled={saving || !valid}>
                {saving ? 'Saving…' : editingId ? 'Update rule' : 'Create rule'}
              </Button>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
