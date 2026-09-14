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

interface TatRow {
  id: string; task_type: string; entity_type: string;
  default_tat_hours: number; escalation_hours?: number | null;
  branch_id?: string | null; branch_name?: string | null; is_active: number;
}

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

export default function NativeTATMatrix() {
  const qc = useQueryClient();
  const [editTarget, setEditTarget] = useState<TatRow | null>(null);
  const [editHours, setEditHours]   = useState('');
  const [editEsc, setEditEsc]       = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newRow, setNewRow] = useState({ task_type: '', entity_type: '', default_tat_hours: '', escalation_hours: '' });

  // Escalation Rules state
  const [activeTab, setActiveTab] = useState('tat-rules');
  const [showCreateEsc, setShowCreateEsc] = useState(false);
  const [editEscTarget, setEditEscTarget] = useState<EscalationRow | null>(null);
  const [newEscRow, setNewEscRow] = useState({ task_type: '', escalation_level: '1', trigger_after_hours: '0', notify_role: '', escalation_action: 'notify' });
  const [editEscForm, setEditEscForm] = useState({ trigger_after_hours: '', notify_role: '', escalation_action: '' });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tat-matrix'],
    queryFn: async () => {
      const r = await hrmsApi.get<any>('/api/governance/tat/matrix');
      return ((r as any)?.data ?? []) as TatRow[];
    },
  });
  const rows: TatRow[] = data ?? [];

  // Escalation Rules query
  const { data: escData, isLoading: escLoading, refetch: refetchEsc } = useQuery({
    queryKey: ['escalation-matrix'],
    queryFn: async () => {
      const r = await hrmsApi.get<any>('/api/governance/tat/escalation-matrix');
      return ((r as any)?.data ?? []) as EscalationRow[];
    },
  });
  const escRows: EscalationRow[] = escData ?? [];

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => hrmsApi.put(`/api/governance/tat/matrix/${id}`, body),
    onSuccess: () => { toast.success('TAT rule updated'); qc.invalidateQueries({ queryKey: ['tat-matrix'] }); setEditTarget(null); },
    onError: (e: any) => toast.error(e?.message ?? 'Update failed'),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => hrmsApi.post('/api/governance/tat/matrix', body),
    onSuccess: () => {
      toast.success('TAT rule created');
      qc.invalidateQueries({ queryKey: ['tat-matrix'] });
      setShowCreate(false);
      setNewRow({ task_type: '', entity_type: '', default_tat_hours: '', escalation_hours: '' });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Create failed'),
  });

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

  function openEdit(row: TatRow) {
    setEditTarget(row);
    setEditHours(String(row.default_tat_hours));
    setEditEsc(String(row.escalation_hours ?? ''));
  }

  function openEditEsc(row: EscalationRow) {
    setEditEscTarget(row);
    setEditEscForm({
      trigger_after_hours: String(row.trigger_after_hours),
      notify_role: row.notify_role ?? '',
      escalation_action: row.escalation_action,
    });
  }

  const activeEscRules = escRows.filter(r => r.is_active).length;

  function urgencyColor(hours: number) {
    if (hours <= 4)  return 'text-red-600';
    if (hours <= 24) return 'text-amber-600';
    return 'text-emerald-600';
  }

  const activeRules   = rows.filter(r => r.is_active).length;
  const criticalRules = rows.filter(r => r.default_tat_hours <= 4).length;
  const avgTat        = rows.length ? Math.round(rows.reduce((s, r) => s + r.default_tat_hours, 0) / rows.length) : 0;

  return (
    <DashboardLayout>
      <HrmsModernShell
        eyebrow="Governance"
        title="TAT Matrix"
        description="Configure turnaround time rules and escalation thresholds for each task type."
        icon={<Clock className="h-6 w-6" />}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void (activeTab === 'tat-rules' ? refetch() : refetchEsc())} disabled={isLoading || escLoading} className="gap-2 min-h-[40px]">
              <RefreshCw className={`h-4 w-4 ${(isLoading || escLoading) ? 'animate-spin' : ''}`} />
            </Button>
            {activeTab === 'tat-rules' ? (
              <Button size="sm" onClick={() => setShowCreate(true)} className="gap-2 min-h-[40px] bg-slate-950 hover:bg-slate-800 text-white">
                <Plus className="h-4 w-4" /> Add Rule
              </Button>
            ) : (
              <Button size="sm" onClick={() => setShowCreateEsc(true)} className="gap-2 min-h-[40px] bg-slate-950 hover:bg-slate-800 text-white">
                <Zap className="h-4 w-4" /> Add Escalation
              </Button>
            )}
          </div>
        }
      >
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="tat-rules">TAT Rules</TabsTrigger>
            <TabsTrigger value="escalation-rules">Escalation Rules</TabsTrigger>
          </TabsList>

          <TabsContent value="tat-rules" className="space-y-6">
            {/* Stat tiles */}
            <div className="grid gap-4 sm:grid-cols-3">
              <HrmsBentoTile title="Active Rules" value={activeRules} detail="Configured TAT rules" icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} accentClassName="from-emerald-500 to-teal-500" />
              <HrmsBentoTile title="Critical Rules" value={criticalRules} detail="TAT ≤ 4 hours" icon={<AlertTriangle className="h-5 w-5 text-red-600" />} accentClassName="from-red-500 to-rose-500" />
              <HrmsBentoTile title="Avg TAT" value={`${avgTat}h`} detail="Average across all rules" icon={<Clock className="h-5 w-5 text-blue-600" />} accentClassName="from-blue-500 to-cyan-500" />
            </div>

            {/* Table */}
            <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">All TAT Rules ({rows.length})</p>
              </div>
              {isLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
                </div>
              ) : rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Clock className="h-12 w-12 mb-3 text-slate-200" />
                  <p className="font-semibold text-slate-700">No TAT rules configured</p>
                  <p className="text-sm text-slate-400 mt-1">Add rules to define turnaround time expectations per task type.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Task Type</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Entity</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide">TAT Hours</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Escalation</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Scope</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Status</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(row => (
                      <TableRow key={row.id} className="hover:bg-slate-50/60 transition-colors">
                        <TableCell className="font-semibold text-slate-900 text-sm">{row.task_type}</TableCell>
                        <TableCell className="text-sm text-slate-600">{row.entity_type}</TableCell>
                        <TableCell>
                          <span className={`text-lg font-black ${urgencyColor(row.default_tat_hours)}`}>{row.default_tat_hours}h</span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">{row.escalation_hours ? `${row.escalation_hours}h` : '—'}</TableCell>
                        <TableCell className="text-sm text-slate-500">{row.branch_name ?? 'Global'}</TableCell>
                        <TableCell>
                          {row.is_active ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] font-bold text-slate-500">
                              <AlertTriangle className="h-3 w-3" /> Inactive
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" className="h-8 text-xs gap-1 cursor-pointer" onClick={() => openEdit(row)}>
                            <Edit2 className="h-3 w-3" /> Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          <TabsContent value="escalation-rules" className="space-y-6">
            {/* Escalation Stat tiles */}
            <div className="grid gap-4 sm:grid-cols-3">
              <HrmsBentoTile
                title="Active Escalation Rules"
                value={activeEscRules}
                detail="Configured escalations"
                icon={<Zap className="h-5 w-5 text-amber-600" />}
                accentClassName="from-amber-500 to-orange-500"
              />
              <HrmsBentoTile
                title="Task Types with Escalation"
                value={new Set(escRows.filter(r => r.is_active).map(r => r.task_type)).size}
                detail="Unique task types"
                icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                accentClassName="from-emerald-500 to-teal-500"
              />
              <HrmsBentoTile
                title="Max Escalation Level"
                value={escRows.length ? Math.max(...escRows.map(r => r.escalation_level)) : 0}
                detail="Highest configured level"
                icon={<AlertTriangle className="h-5 w-5 text-red-600" />}
                accentClassName="from-red-500 to-rose-500"
              />
            </div>

            {/* Escalation Table */}
            <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">All Escalation Rules ({escRows.length})</p>
              </div>
              {escLoading ? (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
                </div>
              ) : escRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Zap className="h-12 w-12 mb-3 text-slate-200" />
                  <p className="font-semibold text-slate-700">No escalation rules configured</p>
                  <p className="text-sm text-slate-400 mt-1">Add escalation rules to define automatic notifications and actions when TAT limits are breached.</p>
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
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-xs font-bold text-amber-700">
                            L{row.escalation_level}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">{row.trigger_after_hours}h</TableCell>
                        <TableCell className="text-sm text-slate-600">{row.notify_role ?? '—'}</TableCell>
                        <TableCell>
                          <span className={`text-xs font-semibold ${
                            row.escalation_action === 'block' ? 'text-red-600' :
                            row.escalation_action === 'reassign' ? 'text-amber-600' :
                            'text-blue-600'
                          }`}>
                            {row.escalation_action}
                          </span>
                        </TableCell>
                        <TableCell>
                          {row.is_active ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] font-bold text-slate-500">
                              <AlertTriangle className="h-3 w-3" /> Inactive
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" className="h-8 text-xs gap-1 cursor-pointer" onClick={() => openEditEsc(row)}>
                              <Edit2 className="h-3 w-3" /> Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs gap-1 cursor-pointer text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => {
                                if (confirm(`Delete escalation rule for ${row.task_type} L${row.escalation_level}?`)) {
                                  deleteEscMutation.mutate(row.id);
                                }
                              }}
                            >
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
      </HrmsModernShell>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={open => { setShowCreate(open); if (!open) setNewRow({ task_type: '', entity_type: '', default_tat_hours: '', escalation_hours: '' }); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> New TAT Rule</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="task_type">Task Type <span className="text-red-500">*</span></Label>
              <Input id="task_type" value={newRow.task_type} onChange={e => setNewRow(p => ({ ...p, task_type: e.target.value }))} placeholder="e.g. bgv_review" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="entity_type">Entity Type <span className="text-red-500">*</span></Label>
              <Input id="entity_type" value={newRow.entity_type} onChange={e => setNewRow(p => ({ ...p, entity_type: e.target.value }))} placeholder="e.g. candidate" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="tat_hours">TAT Hours <span className="text-red-500">*</span></Label>
              <Input id="tat_hours" type="number" min="1" value={newRow.default_tat_hours} onChange={e => setNewRow(p => ({ ...p, default_tat_hours: e.target.value }))} placeholder="24" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="esc_hours">Escalation Hours</Label>
              <Input id="esc_hours" type="number" min="1" value={newRow.escalation_hours} onChange={e => setNewRow(p => ({ ...p, escalation_hours: e.target.value }))} placeholder="48" className="mt-1" />
            </div>
            <div className="sm:col-span-2 flex gap-2 pt-2">
              <Button
                className="flex-1 cursor-pointer"
                disabled={createMutation.isPending || !newRow.task_type.trim() || !newRow.default_tat_hours}
                onClick={() => createMutation.mutate({ task_type: newRow.task_type, entity_type: newRow.entity_type, default_tat_hours: Number(newRow.default_tat_hours), escalation_hours: newRow.escalation_hours ? Number(newRow.escalation_hours) : null })}
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Create Rule
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)} className="cursor-pointer">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit: {editTarget?.task_type}</DialogTitle></DialogHeader>
          {editTarget && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-tat">TAT Hours</Label>
                <Input id="edit-tat" type="number" min="1" value={editHours} onChange={e => setEditHours(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="edit-esc">Escalation Hours</Label>
                <Input id="edit-esc" type="number" min="1" value={editEsc} onChange={e => setEditEsc(e.target.value)} placeholder="Leave blank to remove" className="mt-1" />
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1 cursor-pointer"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate({ id: editTarget.id, body: { default_tat_hours: Number(editHours), escalation_hours: editEsc ? Number(editEsc) : null } })}
                >
                  {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Save Changes
                </Button>
                <Button variant="outline" onClick={() => setEditTarget(null)} className="cursor-pointer">Cancel</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Escalation Dialog */}
      <Dialog open={showCreateEsc} onOpenChange={open => { setShowCreateEsc(open); if (!open) setNewEscRow({ task_type: '', escalation_level: '1', trigger_after_hours: '0', notify_role: '', escalation_action: 'notify' }); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Zap className="h-5 w-5" /> New Escalation Rule</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div>
              <Label htmlFor="esc-task-type">Task Type <span className="text-red-500">*</span></Label>
              <Select value={newEscRow.task_type} onValueChange={v => setNewEscRow(p => ({ ...p, task_type: v }))}>
                <SelectTrigger id="esc-task-type" className="mt-1">
                  <SelectValue placeholder="Select task type" />
                </SelectTrigger>
                <SelectContent>
                  {rows.filter(r => r.is_active).map(r => (
                    <SelectItem key={r.task_type} value={r.task_type}>{r.task_type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="esc-level">Escalation Level <span className="text-red-500">*</span></Label>
                <Select value={newEscRow.escalation_level} onValueChange={v => setNewEscRow(p => ({ ...p, escalation_level: v }))}>
                  <SelectTrigger id="esc-level" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Level 1</SelectItem>
                    <SelectItem value="2">Level 2</SelectItem>
                    <SelectItem value="3">Level 3</SelectItem>
                    <SelectItem value="4">Level 4</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="esc-trigger">Trigger After (hours) <span className="text-red-500">*</span></Label>
                <Input id="esc-trigger" type="number" min="0" value={newEscRow.trigger_after_hours} onChange={e => setNewEscRow(p => ({ ...p, trigger_after_hours: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <Label htmlFor="esc-notify-role">Notify Role</Label>
              <Select value={newEscRow.notify_role} onValueChange={v => setNewEscRow(p => ({ ...p, notify_role: v }))}>
                <SelectTrigger id="esc-notify-role" className="mt-1">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
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
              <Label htmlFor="esc-action">Escalation Action <span className="text-red-500">*</span></Label>
              <Select value={newEscRow.escalation_action} onValueChange={v => setNewEscRow(p => ({ ...p, escalation_action: v }))}>
                <SelectTrigger id="esc-action" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
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
                disabled={createEscMutation.isPending || !newEscRow.task_type || !newEscRow.trigger_after_hours}
                onClick={() => createEscMutation.mutate({
                  task_type: newEscRow.task_type,
                  escalation_level: Number(newEscRow.escalation_level),
                  trigger_after_hours: Number(newEscRow.trigger_after_hours),
                  notify_role: newEscRow.notify_role || null,
                  escalation_action: newEscRow.escalation_action,
                })}
              >
                {createEscMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Create Escalation
              </Button>
              <Button variant="outline" onClick={() => setShowCreateEsc(false)} className="cursor-pointer">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Escalation Dialog */}
      <Dialog open={!!editEscTarget} onOpenChange={open => { if (!open) setEditEscTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Escalation: {editEscTarget?.task_type} L{editEscTarget?.escalation_level}</DialogTitle></DialogHeader>
          {editEscTarget && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-esc-trigger">Trigger After (hours)</Label>
                <Input id="edit-esc-trigger" type="number" min="0" value={editEscForm.trigger_after_hours} onChange={e => setEditEscForm(p => ({ ...p, trigger_after_hours: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="edit-esc-notify-role">Notify Role</Label>
                <Select value={editEscForm.notify_role} onValueChange={v => setEditEscForm(p => ({ ...p, notify_role: v }))}>
                  <SelectTrigger id="edit-esc-notify-role" className="mt-1">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
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
                <Label htmlFor="edit-esc-action">Escalation Action</Label>
                <Select value={editEscForm.escalation_action} onValueChange={v => setEditEscForm(p => ({ ...p, escalation_action: v }))}>
                  <SelectTrigger id="edit-esc-action" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
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
                      trigger_after_hours: Number(editEscForm.trigger_after_hours),
                      notify_role: editEscForm.notify_role || null,
                      escalation_action: editEscForm.escalation_action,
                    }
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
    </DashboardLayout>
  );
}
