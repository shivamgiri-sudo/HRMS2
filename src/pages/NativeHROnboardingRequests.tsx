import { useState, useEffect, useCallback } from 'react';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Calculator, ChevronLeft, ShieldCheck } from 'lucide-react';

interface BgvCheckItem { check_type: string; status: string; result_summary?: string; }
interface BgvData { score: number; checks: BgvCheckItem[]; }

const BGV_STATUS_COLOR: Record<string, string> = {
  passed: 'text-green-700 bg-green-50',
  failed: 'text-red-700 bg-red-50',
  pending: 'text-amber-700 bg-amber-50',
  not_run: 'text-gray-500 bg-gray-50',
};

interface OnboardingRequest {
  id: string;
  status: string;
  candidate_id: string;
  candidate_code: string;
  full_name: string;
  mobile: string;
  email: string;
  profile_status: string;
  branch_name: string;
  process_name?: string;
  offer_id?: string;
  offer_status?: string;
  offered_ctc?: number;
}

interface SalaryPreview {
  gross: number; basic: number; hra: number; net_in_hand: number;
  pf_employee: number; esic_employee: number; professional_tax: number;
  bonus: number; conveyance: number;
}

interface DropdownItem { id: string; name: string; code?: string; }

const BANDS = ['D', 'C', 'B', 'A', 'M'];
const EMP_TYPES = ['OnRoll', 'OffRoll', 'MGMT. TRAINEE', 'CONTRACT'];
const WORK_STATUS = ['WFO', 'WFH', 'Hybrid'];
const PAY_MODES = ['Bank', 'Cash', 'Cheque'];
const SALARY_MODES = ['Monthly', 'Weekly', 'Fortnightly'];

function rowsFrom(payload: unknown): OnboardingRequest[] {
  if (Array.isArray(payload)) return payload as OnboardingRequest[];
  if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as OnboardingRequest[];
  }
  return [];
}

function dropdownFrom(payload: unknown, nameKey = 'name'): DropdownItem[] {
  const arr = Array.isArray(payload) ? payload
    : (payload && typeof payload === 'object' && Array.isArray((payload as any).data))
      ? (payload as any).data : [];
  return arr.map((r: any) => ({ id: r.id, name: r[nameKey] ?? r.department_name ?? r.designation_name ?? r.process_name ?? r.branch_name ?? '', code: r.department_code ?? r.designation_code ?? r.process_code ?? r.branch_code }));
}

export default function NativeHROnboardingRequests() {
  const [rows, setRows] = useState<OnboardingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OnboardingRequest | null>(null);
  const [salaryPreview, setSalaryPreview] = useState<SalaryPreview | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bgv, setBgv] = useState<BgvData | null>(null);

  const [departments, setDepartments] = useState<DropdownItem[]>([]);
  const [designations, setDesignations] = useState<DropdownItem[]>([]);

  const [offer, setOffer] = useState({
    emp_type: 'OnRoll',
    date_of_joining: '',
    date_of_salary: '',
    profile: '',
    cost_centre: '',
    role_type: 'Analyst',
    salary_band: 'D',
    offered_ctc: '',
    department_id: '',
    designation_id: '',
    reporting_manager_id: '',
    // New HR fields
    kpi: '',
    work_status: 'WFO',
    home_branch: '',
    emp_location_type: 'Onsite',
    pf_eligible: true,
    esi_eligible: true,
    pli: '',
    pay_mode: 'Bank',
    salary_payment_mode: 'Monthly',
    dispensary: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await hrmsApi.get<unknown>('/api/ats/onboarding/requests');
      setRows(rowsFrom(r));
    } catch (error: any) {
      alert(error?.message ?? 'Failed to load onboarding requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    hrmsApi.get<unknown>('/api/departments').then(r => setDepartments(dropdownFrom(r, 'department_name'))).catch(() => {});
    hrmsApi.get<unknown>('/api/designations').then(r => setDesignations(dropdownFrom(r, 'designation_name'))).catch(() => {});
  }, []);

  const setF = (key: keyof typeof offer, value: unknown) => setOffer(p => ({ ...p, [key]: value }));

  const openCandidate = (row: OnboardingRequest) => {
    setSelected(row);
    setBgv(null);
    hrmsApi.get<{ data?: BgvData; score?: number; checks?: BgvCheckItem[] }>(
      `/api/ats/bgv/status?candidateId=${row.candidate_id}`
    ).then(r => {
      const d = (r as any).data ?? r;
      if (d && typeof d === 'object') setBgv(d as BgvData);
    }).catch(() => {});
  };

  const calcSalary = async () => {
    if (!offer.offered_ctc || !offer.salary_band) return;
    setCalcLoading(true);
    try {
      const r = await hrmsApi.post<{ components?: SalaryPreview }>('/api/ats/onboarding/calculate-salary', {
        ctc: Number(offer.offered_ctc) * 12,
        bandCode: offer.salary_band,
      });
      setSalaryPreview(r.components ?? null);
    } catch (error: any) {
      alert(error?.message ?? 'Failed to calculate salary');
    } finally {
      setCalcLoading(false);
    }
  };

  const submitOffer = async (submit: boolean) => {
    if (!selected) return;
    setSaving(true);
    try {
      await hrmsApi.post(`/api/ats/onboarding/requests/${selected.id}/offer`, {
        ...offer,
        offered_ctc: Number(offer.offered_ctc) * 12,
        pli: offer.pli ? Number(offer.pli) * 12 : null,
        dispensary: offer.dispensary ? Number(offer.dispensary) * 12 : null,
        submit,
      });
      await load();
      setSelected(null);
      setSalaryPreview(null);
    } catch (e: any) {
      alert(e?.message ?? 'Failed to save offer');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin" /></div>;

  if (selected) return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <Button variant="outline" onClick={() => { setSelected(null); setSalaryPreview(null); setBgv(null); }}>
        <ChevronLeft className="w-4 h-4 mr-1" /> Back to Requests
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Employment Offer — {selected.full_name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {selected.candidate_code} &nbsp;|&nbsp; {selected.mobile} &nbsp;|&nbsp; {selected.email}
            {selected.branch_name && <> &nbsp;|&nbsp; {selected.branch_name}</>}
            {selected.process_name && <> &nbsp;|&nbsp; Process: <strong>{selected.process_name}</strong></>}
          </p>
          <p className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1 inline-block mt-1">
            Process & Branch are auto-resolved from candidate profile and cannot be changed here.
            Employee Code is assigned automatically on approval.
          </p>
        </CardHeader>

        <CardContent className="space-y-6">

          {/* ── BGV Score Panel ── */}
          {bgv && (
            <section>
              <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-1.5">
                <ShieldCheck size={13} /> Background Verification
              </p>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm text-slate-600">BGV Score:</span>
                <span className={`font-bold text-base px-2 py-0.5 rounded ${bgv.score >= 70 ? 'bg-green-100 text-green-800' : bgv.score >= 40 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
                  {bgv.score}/100
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {(bgv.checks ?? []).map(c => (
                  <div key={c.check_type} className={`rounded-lg px-3 py-2 text-xs flex items-center justify-between gap-2 ${BGV_STATUS_COLOR[c.status] ?? BGV_STATUS_COLOR.not_run}`}>
                    <span className="capitalize">{c.check_type.replace(/_/g, ' ')}</span>
                    <span className="font-semibold uppercase">{c.status}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Employment Info ── */}
          <section>
            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Employment Details</p>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label>Employment Type *</Label>
                <select className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background" value={offer.emp_type} onChange={e => setF('emp_type', e.target.value)}>
                  {EMP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <Label>Date of Joining *</Label>
                <Input type="date" value={offer.date_of_joining} onChange={e => setF('date_of_joining', e.target.value)} />
              </div>
              <div>
                <Label>Date of Salary Start</Label>
                <Input type="date" value={offer.date_of_salary} onChange={e => setF('date_of_salary', e.target.value)} />
                <p className="text-xs text-slate-400 mt-1">Leave blank to use Date of Joining. Set a later date for processes with unpaid training period.</p>
              </div>
              <div>
                <Label>Department</Label>
                <select className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background" value={offer.department_id} onChange={e => setF('department_id', e.target.value)}>
                  <option value="">— Select Department —</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Designation</Label>
                <select className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background" value={offer.designation_id} onChange={e => setF('designation_id', e.target.value)}>
                  <option value="">— Select Designation —</option>
                  {designations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Profile / Role Title</Label>
                <Input value={offer.profile} onChange={e => setF('profile', e.target.value)} placeholder="e.g. Customer Care Executive" />
              </div>
              <div>
                <Label>Role Type</Label>
                <select className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background" value={offer.role_type} onChange={e => setF('role_type', e.target.value)}>
                  <option value="Analyst">Analyst</option>
                  <option value="SupportStaff">Support Staff</option>
                </select>
              </div>
              <div>
                <Label>KPI Framework</Label>
                <Input value={offer.kpi} onChange={e => setF('kpi', e.target.value)} placeholder="e.g. CSAT, AHT" />
              </div>
              <div>
                <Label>Cost Centre</Label>
                <Input value={offer.cost_centre} onChange={e => setF('cost_centre', e.target.value)} />
              </div>
            </div>
          </section>

          {/* ── Work Location ── */}
          <section>
            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Work Location</p>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label>Work Status</Label>
                <select className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background" value={offer.work_status} onChange={e => setF('work_status', e.target.value)}>
                  {WORK_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <Label>Location Type</Label>
                <select className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background" value={offer.emp_location_type} onChange={e => setF('emp_location_type', e.target.value)}>
                  <option value="Onsite">Onsite</option>
                  <option value="Remote">Remote</option>
                  <option value="Field">Field</option>
                </select>
              </div>
              <div>
                <Label>Home Branch (if different)</Label>
                <Input value={offer.home_branch} onChange={e => setF('home_branch', e.target.value)} />
              </div>
            </div>
          </section>

          {/* ── Salary ── */}
          <section>
            <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Salary</p>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label>Salary Band *</Label>
                <select className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background" value={offer.salary_band} onChange={e => setF('salary_band', e.target.value)}>
                  {BANDS.map(b => <option key={b} value={b}>Band {b}</option>)}
                </select>
              </div>
              <div>
                <Label>Monthly CTC (₹) *</Label>
                <Input type="number" min={0} value={offer.offered_ctc} onChange={e => setF('offered_ctc', e.target.value)} placeholder="e.g. 15000" />
              </div>
              <div>
                <Label>PLI / Incentive (₹/month)</Label>
                <Input type="number" min={0} value={offer.pli} onChange={e => setF('pli', e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label>Medical / Dispensary (₹/month)</Label>
                <Input type="number" min={0} value={offer.dispensary} onChange={e => setF('dispensary', e.target.value)} placeholder="0" />
              </div>
              <div>
                <Label>Pay Mode</Label>
                <select className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background" value={offer.pay_mode} onChange={e => setF('pay_mode', e.target.value)}>
                  {PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <Label>Salary Payment Cycle</Label>
                <select className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background" value={offer.salary_payment_mode} onChange={e => setF('salary_payment_mode', e.target.value)}>
                  {SALARY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            {/* PF / ESI eligibility toggles */}
            <div className="flex gap-6 mt-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <input type="checkbox" checked={offer.pf_eligible} onChange={e => setF('pf_eligible', e.target.checked)} className="w-4 h-4" />
                PF Eligible
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
                <input type="checkbox" checked={offer.esi_eligible} onChange={e => setF('esi_eligible', e.target.checked)} className="w-4 h-4" />
                ESI Eligible
              </label>
            </div>

            <Button variant="outline" onClick={calcSalary} disabled={calcLoading || !offer.offered_ctc} className="mt-4 gap-2">
              {calcLoading ? <Loader2 className="animate-spin w-4 h-4" /> : <Calculator className="w-4 h-4" />}
              Calculate Salary Components
            </Button>

            {salaryPreview && (
              <div className="bg-slate-50 rounded-xl p-4 mt-3 text-sm border grid grid-cols-2 md:grid-cols-4 gap-3">
                {(Object.entries(salaryPreview) as [string, number][]).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-white border p-2">
                    <p className="text-xs text-slate-500 capitalize">{k.replace(/_/g, ' ')}</p>
                    <p className="font-bold text-slate-900">₹{v.toLocaleString('en-IN')}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => submitOffer(false)} disabled={saving}>Save Draft</Button>
            <Button onClick={() => submitOffer(true)} disabled={saving || !offer.date_of_joining || !offer.offered_ctc}>
              {saving && <Loader2 className="animate-spin w-4 h-4 mr-1" />}
              Submit to Branch Head
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Onboarding Requests</h1>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b">
              {['Code', 'Name', 'Mobile', 'Branch', 'Process', 'Profile Status', 'Offer', 'Action'].map(h => (
                <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{r.candidate_code}</td>
                <td className="px-3 py-2 font-medium">{r.full_name}</td>
                <td className="px-3 py-2 text-slate-500">{r.mobile}</td>
                <td className="px-3 py-2 text-slate-600">{r.branch_name || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{r.process_name || '—'}</td>
                <td className="px-3 py-2"><Badge variant="outline">{r.profile_status}</Badge></td>
                <td className="px-3 py-2">
                  {r.offer_status ? <Badge variant="secondary">{r.offer_status}</Badge> : <span className="text-muted-foreground text-xs">—</span>}
                </td>
                <td className="px-3 py-2">
                  {r.profile_status === 'profile_submitted' && (
                    <Button size="sm" onClick={() => openCandidate(r)}>Create Offer</Button>
                  )}
                  {r.offer_status === 'draft' && (
                    <Button size="sm" variant="outline" onClick={() => openCandidate(r)}>Edit Offer</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="text-center text-muted-foreground py-8">No onboarding requests yet.</p>}
      </div>
    </div>
  );
}
