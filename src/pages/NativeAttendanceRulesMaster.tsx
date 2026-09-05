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
type ScopeType =
  | 'designation' | 'process' | 'branch' | 'process_designation' | 'branch_process' | 'global'
  | 'cost_centre' | 'cost_centre_designation' | 'branch_cost_centre' | 'branch_cost_centre_designation';

interface AttendanceRule {
  id: string;
  rule_name: string;
  scope_type: ScopeType;
  designation_id: string | null;
  process_id: string | null;
  cost_centre_id: string | null;
  branch_id: string | null;
  designation_code?: string;
  process_name?: string;
  cost_centre_name?: string;
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
interface CostCentre { id: string; cost_centre_code: string; cost_centre_name: string; branch_id: string | null; }

const EMPTY_FORM = {
  rule_name: '', scope_type: 'designation' as ScopeType,
  designation_id: '', process_id: '', cost_centre_id: '', branch_id: '',
  attendance_source: 'biometric' as AttendanceSource,
  full_day_minutes: 540, half_day_minutes: 270, grace_minutes: 15,
  effective_from: new Date().toISOString().split('T')[0]!,
  effective_to: '', notes: '',
};

function minsToHM(m: number) {
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const SCOPE_COLORS: Record<ScopeType, string> = {
  designation:                     'bg-purple-100 text-purple-800',
  process:                         'bg-orange-100 text-orange-800',
  branch:                          'bg-yellow-100 text-yellow-800',
  process_designation:             'bg-pink-100 text-pink-800',
  branch_process:                  'bg-indigo-100 text-indigo-800',
  global:                          'bg-slate-100 text-slate-700',
  cost_centre:                     'bg-teal-100 text-teal-800',
  cost_centre_designation:         'bg-cyan-100 text-cyan-800',
  branch_cost_centre:              'bg-sky-100 text-sky-800',
  branch_cost_centre_designation:  'bg-emerald-100 text-emerald-800',
};

const ANY_VALUE = "__any__";

/**
 * Which feed decides a day's attendance for a process. This is the setting that actually
 * governs the engine — it writes apr_eligibility_config, not attendance_rule_config, because
 * processDay() overwrites attendance_rule_config's source in both branches.
 */
type AttendanceLogic = 'apr' | 'cosec' | 'apr_validated_by_cosec';

interface ProcessLogicRow {
  process_id: string;
  process_name: string;
  attendance_logic: AttendanceLogic;
  rule_count: number;
  employee_count: number;
}

const LOGIC_OPTIONS: Array<{ value: AttendanceLogic; label: string; help: string }> = [
  { value: 'cosec', label: 'COSEC (biometric)',
    help: 'Card punches decide the day. Nothing from the dialler is used.' },
  { value: 'apr', label: 'APR (dialler)',
    help: 'Dialler net login decides the day. A short login is the answer, not a gap to chase.' },
  { value: 'apr_validated_by_cosec', label: 'APR validated by COSEC',
    help: 'APR leads; when it falls short of a full day the biometric reading is compared and the better of the two is used. Can only raise a day, never lower it.' },
];

const LOGIC_SHORT: Record<AttendanceLogic, string> = {
  cosec: 'COSEC',
  apr: 'APR',
  apr_validated_by_cosec: 'APR + COSEC',
};

// One hue per instrument: cyan for the dialler (a machine reading), emerald for the
// biometric reader (a person at a door), violet where the two corroborate each other.
const LOGIC_HEX: Record<AttendanceLogic, string> = {
  apr: '#22D3EE',
  cosec: '#34D399',
  apr_validated_by_cosec: '#A78BFA',
};

/**
 * The signature element of this panel: two nodes, one per instrument.
 *
 * A lit node means the engine reads that feed for the process. Both lit, with the beam
 * between them, means the two readings are compared and the better one wins. This says
 * something a badge cannot — which sources are consulted, and whether they talk to each
 * other — and it is the same shape in every row, so the panel can be scanned down the
 * column rather than read row by row.
 *
 * Colour is never the only signal: each node carries its own text label, and the beam is a
 * distinct shape rather than a shade.
 */
function SignalRail({ logic }: { logic: AttendanceLogic }) {
  const aprLit = logic === 'apr' || logic === 'apr_validated_by_cosec';
  const bioLit = logic === 'cosec' || logic === 'apr_validated_by_cosec';
  const paired = logic === 'apr_validated_by_cosec';

  const node = (lit: boolean, hex: string, label: string) => (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full transition-all duration-300"
        style={{
          backgroundColor: lit ? hex : '#173A45',
          boxShadow: lit ? `0 0 0 3px ${hex}22` : 'none',
        }}
      />
      <span
        className="font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-300"
        style={{ color: lit ? hex : '#4E7581' }}
      >
        {label}
      </span>
    </div>
  );

  return (
    <div className="flex items-center gap-2.5" title={LOGIC_SHORT[logic]}>
      {node(aprLit, LOGIC_HEX.apr, 'dialler')}
      <span
        aria-hidden="true"
        className={`h-px w-6 transition-colors duration-300 ${paired ? 'animate-pulse motion-reduce:animate-none' : ''}`}
        style={{ backgroundColor: paired ? LOGIC_HEX.apr_validated_by_cosec : '#173A45' }}
      />
      {node(bioLit, LOGIC_HEX.cosec, 'biometric')}
    </div>
  );
}

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
  const [costCentres, setCostCentres] = useState<CostCentre[]>([]);

  // Attendance logic per process
  const [logicRows, setLogicRows] = useState<ProcessLogicRow[]>([]);
  const [logicLoading, setLogicLoading] = useState(true);
  const [logicFilter, setLogicFilter] = useState('');
  const [savingProcessId, setSavingProcessId] = useState<string | null>(null);

  // Simulator state
  const [simDesig, setSimDesig] = useState('');
  const [simProcess, setSimProcess] = useState('');
  const [simCostCentre, setSimCostCentre] = useState('');
  const [simBranch, setSimBranch] = useState('');
  const [simResult, setSimResult] = useState<AttendanceRule | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  // Cost centres narrow to the chosen branch, in both the create/edit dialog and the simulator —
  // same "clear the child when the parent changes" rule as every other cascading pair here.
  const formCostCentreOptions = form.branch_id
    ? costCentres.filter((c) => c.branch_id === form.branch_id)
    : costCentres;
  const simCostCentreOptions = simBranch
    ? costCentres.filter((c) => c.branch_id === simBranch)
    : costCentres;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [rulesRes, orgRes, procRes, ccRes] = await Promise.all([
          hrmsApi.get<{ success: boolean; data: AttendanceRule[] }>('/api/wfm/attendance/rules'),
          hrmsApi.get<{ success: boolean; data: { designations?: Designation[]; branches?: Branch[] } }>('/api/org'),
          hrmsApi.get<{ success: boolean; data: Process[] }>('/api/processes'),
          hrmsApi.get<{ success: boolean; data: CostCentre[] }>('/api/wfm/attendance/cost-centres'),
        ]);
        if (!cancelled) {
          setRules(rulesRes.data ?? []);
          setDesignations(orgRes.data?.designations ?? []);
          setBranches(orgRes.data?.branches ?? []);
          setProcesses(procRes.data ?? []);
          setCostCentres(ccRes.data ?? []);
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

  // Loaded separately from the rules list so a failure in one panel does not blank the other.
  const loadLogic = async () => {
    setLogicLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: ProcessLogicRow[] }>(
        '/api/wfm/attendance/attendance-logic');
      setLogicRows(res.data ?? []);
    } catch {
      toast({ title: 'Failed to load attendance logic', variant: 'destructive' });
    } finally {
      setLogicLoading(false);
    }
  };

  useEffect(() => { void loadLogic(); }, []);

  const changeLogic = async (row: ProcessLogicRow, next: AttendanceLogic) => {
    if (next === row.attendance_logic) return;
    const previous = row.attendance_logic;
    // Optimistic: the select should not sit on the old value while the write is in flight.
    setLogicRows((rows) => rows.map((r) =>
      r.process_id === row.process_id ? { ...r, attendance_logic: next } : r));
    setSavingProcessId(row.process_id);
    try {
      await hrmsApi.put(`/api/wfm/attendance/attendance-logic/${row.process_id}`,
        { attendance_logic: next });
      toast({
        title: `${row.process_name} → ${LOGIC_SHORT[next]}`,
        description: 'Applies from the next attendance run. Rebuild a past month to restate it.',
      });
      await loadLogic();
    } catch {
      setLogicRows((rows) => rows.map((r) =>
        r.process_id === row.process_id ? { ...r, attendance_logic: previous } : r));
      toast({ title: 'Could not change attendance logic', variant: 'destructive' });
    } finally {
      setSavingProcessId(null);
    }
  };

  const visibleLogicRows = logicRows.filter((r) =>
    r.process_name.toLowerCase().includes(logicFilter.trim().toLowerCase()));

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
      cost_centre_id: rule.cost_centre_id ?? '',
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
        cost_centre_id: form.cost_centre_id || null,
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
      if (simDesig)       params.set('designationId', simDesig);
      if (simProcess)     params.set('processId',     simProcess);
      if (simCostCentre)  params.set('costCentreId',  simCostCentre);
      if (simBranch)      params.set('branchId',       simBranch);
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

  const showDesig      = form.scope_type.includes('designation');
  const showProcess    = form.scope_type === 'process' || form.scope_type === 'process_designation' || form.scope_type === 'branch_process';
  const showCostCentre = form.scope_type.includes('cost_centre');
  const showBranch     = form.scope_type.includes('branch');

  // Branch renders first in the dialog now (Branch -> Cost Centre -> Designation), so picking a
  // new branch must drop a previously chosen cost centre that no longer belongs to it — the same
  // "clear the child when the parent changes" rule the finance-year/month pair already follows.
  const setFormBranch = (branchId: string) => {
    setForm((f) => {
      const stillValid = f.cost_centre_id
        && costCentres.some((c) => c.id === f.cost_centre_id && c.branch_id === branchId);
      return { ...f, branch_id: branchId, cost_centre_id: stillValid ? f.cost_centre_id : '' };
    });
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="hrms-page-header">
          <div>
            <h1 className="hrms-page-title">Attendance Rules Master</h1>
            <p className="hrms-page-subtitle">Configure attendance source and thresholds by branch, cost centre (call centre) and designation</p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" /> New Rule
          </Button>
        </div>

        {/* Attendance Logic by Process — the setting the engine actually reads.
            Deliberately inverted against the light rules table below: this is the only
            control on the page that changes how a day is decided, and it should not look
            like the threshold rows it sits above. It reads as an instrument panel because
            that is what it is — a choice of which sensor is trusted to say someone worked. */}
        <section className="overflow-hidden rounded-2xl bg-[#071A22] shadow-lg ring-1 ring-cyan-400/20">
          <div className="flex flex-col gap-4 border-b border-cyan-400/15 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-300/70">
                Source of truth
              </p>
              <h2 className="mt-1 text-xl font-semibold leading-tight text-[#E2F4F7]">
                Attendance logic by process
              </h2>
              <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[#7FA3AC]">
                Which instrument decides whether an Operations executive worked that day.
                Changes apply from the next attendance run.
              </p>
            </div>
            {/* Channel tally — mono numerals so the three counts read as instrument readout */}
            <div className="flex gap-5">
              {LOGIC_OPTIONS.map((opt) => (
                <div key={opt.value}>
                  <p className="font-mono text-2xl font-semibold leading-none" style={{ color: LOGIC_HEX[opt.value] }}>
                    {logicLoading ? '—' : logicRows.filter((r) => r.attendance_logic === opt.value).length}
                  </p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#7FA3AC]">
                    {LOGIC_SHORT[opt.value]}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="border-b border-cyan-400/10 px-4 py-3 sm:px-6">
            <label htmlFor="logic-filter" className="sr-only">Filter processes</label>
            <Input
              id="logic-filter"
              value={logicFilter}
              onChange={(e) => setLogicFilter(e.target.value)}
              placeholder="Filter processes"
              className="h-11 max-w-sm rounded-xl border-cyan-400/20 bg-[#0C2731] text-sm text-[#E2F4F7] placeholder:text-[#5C8590] focus-visible:ring-cyan-400/60 sm:h-10"
            />
          </div>

          {logicLoading ? (
            <div className="space-y-3 p-5 sm:px-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-[#0C2731]" />
              ))}
            </div>
          ) : visibleLogicRows.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm font-semibold text-[#E2F4F7]">No process matches that filter</p>
              <p className="mt-1 text-[13px] text-[#7FA3AC]">Clear the filter to see every process.</p>
            </div>
          ) : (
            <ul className="divide-y divide-cyan-400/10">
              {visibleLogicRows.map((row) => (
                <li
                  key={row.process_id}
                  className="grid grid-cols-1 gap-3 px-4 py-4 transition-colors duration-200 hover:bg-[#0C2731]/70 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6 sm:px-6"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#E2F4F7]">{row.process_name}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-[#7FA3AC]">
                      {row.employee_count} active {row.employee_count === 1 ? 'employee' : 'employees'}
                    </p>
                  </div>

                  {/* Signal rail — the signature element. Two nodes, one per instrument.
                      A lit node means that feed is read for this process; both lit with the
                      beam between them means the two are compared. It encodes which sources
                      the engine actually consults, which no badge or colour alone conveys. */}
                  <SignalRail logic={row.attendance_logic} />

                  <Select
                    value={row.attendance_logic}
                    disabled={savingProcessId === row.process_id}
                    onValueChange={(v) => void changeLogic(row, v as AttendanceLogic)}
                  >
                    <SelectTrigger
                      className="h-11 w-full cursor-pointer rounded-xl border-cyan-400/25 bg-[#0C2731] text-sm text-[#E2F4F7] focus:ring-cyan-400/60 disabled:opacity-50 sm:h-10 sm:w-[248px]"
                      aria-label={`Attendance logic for ${row.process_name}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOGIC_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="cursor-pointer">
                          <span className="font-medium">{opt.label}</span>
                          <span className="mt-0.5 block max-w-xs text-xs leading-snug text-slate-500">
                            {opt.help}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          )}
        </section>

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
                      {r.branch_name && <span>Branch: {r.branch_name}</span>}
                      {r.cost_centre_name && <span>{r.branch_name ? ' · ' : ''}Cost Centre: {r.cost_centre_name}</span>}
                      {r.designation_code && <span>{(r.branch_name || r.cost_centre_name) ? ' · ' : ''}Desig: {r.designation_code}</span>}
                      {r.process_name && <span>Process: {r.process_name}</span>}
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
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Branch</Label>
              <Select
                value={simBranch || ANY_VALUE}
                onValueChange={(value) => {
                  const nextBranch = value === ANY_VALUE ? '' : value;
                  setSimBranch(nextBranch);
                  // Clear the child when the parent changes — a chosen cost centre outside the
                  // newly picked branch would otherwise sit there silently no longer matching it.
                  if (simCostCentre && !costCentres.some(c => c.id === simCostCentre && c.branch_id === nextBranch)) {
                    setSimCostCentre('');
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>Any</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cost Centre</Label>
              <Select value={simCostCentre || ANY_VALUE} onValueChange={(value) => setSimCostCentre(value === ANY_VALUE ? '' : value)}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>Any</SelectItem>
                  {simCostCentreOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.cost_centre_code} — {c.cost_centre_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
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
              <Label className="text-xs">Process (legacy)</Label>
              <Select value={simProcess || ANY_VALUE} onValueChange={(value) => setSimProcess(value === ANY_VALUE ? '' : value)}>
                <SelectTrigger><SelectValue placeholder="Any" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_VALUE}>Any</SelectItem>
                  {processes.map(p => <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>)}
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
                    <SelectItem value="cost_centre">Cost Centre only</SelectItem>
                    <SelectItem value="branch">Branch only</SelectItem>
                    <SelectItem value="cost_centre_designation">Cost Centre + Designation</SelectItem>
                    <SelectItem value="branch_cost_centre">Branch + Cost Centre</SelectItem>
                    <SelectItem value="branch_cost_centre_designation">Branch + Cost Centre + Designation</SelectItem>
                    <SelectItem value="process">Process only (legacy)</SelectItem>
                    <SelectItem value="process_designation">Process + Designation (legacy)</SelectItem>
                    <SelectItem value="branch_process">Branch + Process (legacy)</SelectItem>
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
            {showBranch && (
              <div className="space-y-1">
                <Label>Branch</Label>
                <Select value={form.branch_id} onValueChange={setFormBranch}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {showCostCentre && (
              <div className="space-y-1">
                <Label>Cost Centre (Call Centre)</Label>
                <Select value={form.cost_centre_id} onValueChange={v => setForm(f => ({...f, cost_centre_id: v}))}>
                  <SelectTrigger><SelectValue placeholder={form.branch_id ? "Select cost centre" : "Select cost centre (all branches)"} /></SelectTrigger>
                  <SelectContent>
                    {formCostCentreOptions.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-slate-400">No cost centres for this branch</div>
                    ) : (
                      formCostCentreOptions.map(c => <SelectItem key={c.id} value={c.id}>{c.cost_centre_code} — {c.cost_centre_name}</SelectItem>)
                    )}
                  </SelectContent>
                </Select>
                {form.branch_id && (
                  <p className="text-xs text-slate-400">Showing only cost centres in the selected branch.</p>
                )}
              </div>
            )}
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
