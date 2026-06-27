import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Loader2, Calculator, ChevronLeft, ShieldCheck, Users, Briefcase,
  IndianRupee, Building2, MapPin, FileCheck, AlertTriangle, CheckCircle2,
  Clock, UserPlus, Lock,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────
interface BgvCheckItem { check_type: string; status: string; result_summary?: string; }
interface BgvData { score: number; checks: BgvCheckItem[]; }
interface OnboardingRequest {
  id: string; status: string; candidate_id: string; candidate_code: string;
  full_name: string; mobile: string; email: string; profile_status: string;
  branch_name: string; process_name?: string; offer_id?: string; offer_status?: string; offered_ctc?: number;
}
interface SalaryPreview {
  gross: number; basic: number; hra: number; net_in_hand: number;
  pf_employee: number; pf_employer: number; esic_employee: number; esic_employer: number;
  professional_tax: number; bonus: number; conveyance: number; da: number;
  special_allowance: number; other_allowance: number; gratuity: number; admin_charges: number;
}
interface MasterItem { id: string; name: string; code?: string; }
interface SalaryBand { id: string; band_code: string; band_name: string; min_ctc: number; max_ctc: number; basic_pct: number; hra_pct: number; }

// ── Helpers ──────────────────────────────────────────────────────────────────
function rowsFrom(payload: unknown): OnboardingRequest[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const d = (payload as { data?: unknown }).data;
    if (Array.isArray(d)) return d;
  }
  return [];
}

function masterFrom(payload: unknown, nameKey = 'name'): MasterItem[] {
  const arr = Array.isArray(payload) ? payload : (payload as any)?.data ?? [];
  return (Array.isArray(arr) ? arr : []).map((r: any) => ({
    id: r.id,
    name: r[nameKey] || r.department_name || r.designation_name || r.process_name || r.cost_centre_name || r.branch_name || r.band_name || '',
    code: r.department_code || r.designation_code || r.process_code || r.cost_centre_code || r.branch_code || r.band_code || '',
  }));
}

const BGV_COLOR: Record<string, string> = {
  verified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  passed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  not_run: 'bg-slate-50 text-slate-500 border-slate-200',
};

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  profile_submitted: { label: 'Profile Submitted', variant: 'default' },
  onboarding_sent: { label: 'Link Sent', variant: 'outline' },
  employee_details_saved: { label: 'In Progress', variant: 'secondary' },
  offer_submitted: { label: 'Offer Sent', variant: 'default' },
  profile_in_progress: { label: 'In Progress', variant: 'secondary' },
};

const EMP_TYPES = ['OnRoll', 'OffRoll', 'MGMT. TRAINEE', 'CONTRACT'];

const fmt = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

// ── Component ────────────────────────────────────────────────────────────────
export default function NativeHROnboardingRequests() {
  const [rows, setRows] = useState<OnboardingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OnboardingRequest | null>(null);
  const [salaryPreview, setSalaryPreview] = useState<SalaryPreview | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bgv, setBgv] = useState<BgvData | null>(null);
  const [offerTab, setOfferTab] = useState<'standard' | 'proposed'>('standard');

  // Master data from DB
  const [departments, setDepartments] = useState<MasterItem[]>([]);
  const [designations, setDesignations] = useState<MasterItem[]>([]);
  const [managers, setManagers] = useState<MasterItem[]>([]);

  // Cascading salary package system
  const [salaryBands, setSalaryBands] = useState<SalaryBand[]>([]);
  const [costCentres, setCostCentres] = useState<Array<{ id: string; cost_centre_code: string; display_name: string; category: string; client_name: string; process_name: string }>>([]);
  const [packages, setPackages] = useState<Array<{ id: string; package_amount: number; basic: number; hra: number; conveyance: number; gross: number; epf_employee: number; esic_employee: number; net_in_hand: number; ctc: number; bonus: number; special_allowance: number; other_allowance: number; epf_employer: number; esic_employer: number; admin_charges: number; professional_tax: number; pli: number; portfolio: number; medical: number }>>([]);
  const [selectedPackage, setSelectedPackage] = useState<typeof packages[0] | null>(null);

  // Offer form
  const [offer, setOffer] = useState({
    emp_type: 'OnRoll', date_of_joining: '', date_of_salary: '',
    cost_centre: '', role_type: 'Analyst', salary_band: '',
    offered_ctc: '', department_id: '', designation_id: '', reporting_manager_id: '',
    pf_eligible: true, esi_eligible: true, selected_package_id: '',
  });
  // Proposed (exception) offer — different amount from band
  const [proposedCtc, setProposedCtc] = useState('');
  const [proposedReason, setProposedReason] = useState('');

  const setF = (key: keyof typeof offer, value: unknown) => setOffer(p => ({ ...p, [key]: value }));

  // ── Load data ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await hrmsApi.get<unknown>('/api/ats/onboarding/requests');
      setRows(rowsFrom(r));
    } catch (e: any) { console.error('Failed to load', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Load master data (one-time) ──────────────────────────────────────────
  useEffect(() => {
    hrmsApi.get<unknown>('/api/org/departments?active=1').then(r => setDepartments(masterFrom(r, 'department_name'))).catch(() =>
      hrmsApi.get<unknown>('/api/departments?active_status=1').then(r => setDepartments(masterFrom(r, 'department_name'))).catch(() => {})
    );
    hrmsApi.get<unknown>('/api/org/designations?active=1').then(r => setDesignations(masterFrom(r, 'designation_name'))).catch(() =>
      hrmsApi.get<unknown>('/api/designations?active_status=1').then(r => setDesignations(masterFrom(r, 'designation_name'))).catch(() => {})
    );
    // Salary bands from new payroll-masters API
    hrmsApi.get<unknown>('/api/payroll-masters/bands').then((r: any) => {
      const arr = r?.data ?? (Array.isArray(r) ? r : []);
      setSalaryBands(arr.map((b: any) => ({ ...b, min_ctc: b.slab_from, max_ctc: b.slab_to })));
    }).catch(() => {
      setSalaryBands([
        { id: '1', band_code: 'A', band_name: 'Band A', min_ctc: 0, max_ctc: 4000, basic_pct: 40, hra_pct: 40 },
        { id: '2', band_code: 'B', band_name: 'Band B', min_ctc: 4001, max_ctc: 6000, basic_pct: 40, hra_pct: 40 },
        { id: '3', band_code: 'C', band_name: 'Band C', min_ctc: 6001, max_ctc: 7500, basic_pct: 40, hra_pct: 40 },
        { id: '4', band_code: 'D', band_name: 'Band D', min_ctc: 7501, max_ctc: 9000, basic_pct: 40, hra_pct: 40 },
        { id: '5', band_code: 'E', band_name: 'Band E', min_ctc: 9001, max_ctc: 11000, basic_pct: 40, hra_pct: 40 },
        { id: '6', band_code: 'F', band_name: 'Band F', min_ctc: 11001, max_ctc: 15000, basic_pct: 40, hra_pct: 40 },
        { id: '7', band_code: 'G', band_name: 'Band G', min_ctc: 15001, max_ctc: 18000, basic_pct: 40, hra_pct: 40 },
        { id: '8', band_code: 'H', band_name: 'Band H', min_ctc: 18001, max_ctc: 25000, basic_pct: 40, hra_pct: 40 },
        { id: '9', band_code: 'I', band_name: 'Band I', min_ctc: 25001, max_ctc: 35000, basic_pct: 40, hra_pct: 40 },
        { id: '10', band_code: 'J', band_name: 'Band J', min_ctc: 35001, max_ctc: 50000, basic_pct: 40, hra_pct: 40 },
        { id: '11', band_code: 'K', band_name: 'Band K', min_ctc: 50001, max_ctc: 75000, basic_pct: 45, hra_pct: 40 },
        { id: '12', band_code: 'L', band_name: 'Band L', min_ctc: 75001, max_ctc: 100000, basic_pct: 45, hra_pct: 40 },
        { id: '13', band_code: 'M', band_name: 'Band M', min_ctc: 100001, max_ctc: 125000, basic_pct: 50, hra_pct: 50 },
        { id: '14', band_code: 'N', band_name: 'Band N', min_ctc: 125001, max_ctc: 500000, basic_pct: 50, hra_pct: 50 },
      ]);
    });
    // Managers
    hrmsApi.get<unknown>('/api/employees?active_status=1&limit=500').then((r: any) => {
      const emps = Array.isArray(r) ? r : r?.data ?? [];
      setManagers((Array.isArray(emps) ? emps : [])
        .filter((e: any) => e.first_name || e.last_name)
        .map((e: any) => ({ id: e.id, name: [e.first_name, e.last_name].filter(Boolean).join(' '), code: e.employee_code || '' })));
    }).catch(() => {});
  }, []);

  // ── Cascading: Load cost centres when candidate selected (branch-based) ────
  useEffect(() => {
    if (!selected?.branch_name) { setCostCentres([]); return; }
    hrmsApi.get<unknown>(`/api/payroll-masters/cost-centres?branch=${encodeURIComponent(selected.branch_name)}`).then((r: any) => {
      setCostCentres(r?.data ?? []);
    }).catch(() => setCostCentres([]));
  }, [selected?.branch_name]);

  // ── Cascading: Load packages when branch + cost centre + band all selected ─
  useEffect(() => {
    if (!selected?.branch_name || !offer.salary_band) { setPackages([]); setSelectedPackage(null); return; }
    const params = new URLSearchParams({ branch: selected.branch_name, band: offer.salary_band });
    if (offer.cost_centre) params.set('costCentre', offer.cost_centre);
    hrmsApi.get<unknown>(`/api/payroll-masters/packages?${params}`).then((r: any) => {
      setPackages(r?.data ?? []);
      setSelectedPackage(null);
      setSalaryPreview(null);
    }).catch(() => setPackages([]));
  }, [selected?.branch_name, offer.cost_centre, offer.salary_band]);

  // ── When a package is selected, auto-fill salary preview (locked) ────────
  const selectedBand = salaryBands.find(b => b.band_code === offer.salary_band);

  const selectPackage = (pkgId: string) => {
    const pkg = packages.find(p => p.id === pkgId);
    if (!pkg) { setSelectedPackage(null); setSalaryPreview(null); return; }
    setSelectedPackage(pkg);
    setOffer(p => ({ ...p, offered_ctc: String(pkg.package_amount), selected_package_id: pkgId }));
    setSalaryPreview({
      gross: pkg.gross, basic: pkg.basic, hra: pkg.hra, net_in_hand: pkg.net_in_hand,
      pf_employee: pkg.epf_employee, pf_employer: pkg.epf_employer,
      esic_employee: pkg.esic_employee, esic_employer: pkg.esic_employer,
      professional_tax: pkg.professional_tax, bonus: pkg.bonus, conveyance: pkg.conveyance,
      da: 0, special_allowance: pkg.special_allowance, other_allowance: pkg.other_allowance,
      gratuity: 0, admin_charges: pkg.admin_charges,
    });
  };

  // Fallback: calculate manually if no packages exist in DB for this combination
  const calcSalaryManual = async () => {
    if (!offer.offered_ctc || !offer.salary_band) return;
    setCalcLoading(true);
    try {
      const r = await hrmsApi.post<{ components?: SalaryPreview }>('/api/ats/onboarding/calculate-salary', {
        ctc: Number(offer.offered_ctc) * 12, bandCode: offer.salary_band,
      });
      setSalaryPreview(r.components ?? null);
    } catch { /* non-fatal */ }
    finally { setCalcLoading(false); }
  };

  // ── Open candidate ─────────────────────────────────────────────────────────
  const openCandidate = (row: OnboardingRequest) => {
    setSelected(row);
    setBgv(null);
    setOfferTab('standard');
    setProposedCtc('');
    setProposedReason('');
    setSalaryPreview(null);
    hrmsApi.get<unknown>(`/api/ats/bgv/status?candidateId=${row.candidate_id}`).then((r: any) => {
      const d = r?.data ?? r;
      if (d && typeof d === 'object') setBgv(d as BgvData);
    }).catch(() => {});
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submitOffer = async (submit: boolean) => {
    if (!selected) return;
    const isProposed = offerTab === 'proposed' && proposedCtc;
    const ctcToUse = isProposed ? Number(proposedCtc) : Number(offer.offered_ctc);
    if (!ctcToUse || !offer.date_of_joining) {
      alert('Date of Joining and CTC are required');
      return;
    }
    setSaving(true);
    try {
      await hrmsApi.post(`/api/ats/onboarding/requests/${selected.id}/offer`, {
        ...offer,
        offered_ctc: ctcToUse * 12,
        submit,
        is_proposed_exception: Boolean(isProposed),
        proposed_reason: isProposed ? proposedReason : null,
      });
      await load();
      setSelected(null);
      setSalaryPreview(null);
    } catch (e: any) { alert(e?.message ?? 'Failed to save offer'); }
    finally { setSaving(false); }
  };

  // ── Render: List View ──────────────────────────────────────────────────────
  if (!selected) return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">ATS Onboarding</p>
            <h1 className="text-2xl font-black text-slate-900">Onboarding Requests</h1>
            <p className="text-sm text-slate-500 mt-1">Candidates who completed their onboarding form — create and submit employment offers</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="h-8 px-3 text-sm">
              <Users className="h-3.5 w-3.5 mr-1.5" />
              {rows.filter(r => r.profile_status === 'profile_submitted').length} ready for offer
            </Badge>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin h-8 w-8 text-blue-500" />
          </div>
        ) : (
          <Card className="border-0 shadow-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200">
                    {['Code', 'Candidate', 'Mobile', 'Branch', 'Process', 'Status', 'Offer', 'Action'].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(r => {
                    const statusInfo = STATUS_BADGE[r.profile_status] ?? { label: r.profile_status, variant: 'outline' as const };
                    return (
                      <tr key={r.id} className="hover:bg-blue-50/40 transition-colors">
                        <td className="px-4 py-3.5 font-mono text-xs text-slate-500">{r.candidate_code}</td>
                        <td className="px-4 py-3.5">
                          <p className="font-semibold text-slate-900">{r.full_name}</p>
                          <p className="text-xs text-slate-400">{r.email}</p>
                        </td>
                        <td className="px-4 py-3.5 text-slate-600">{r.mobile}</td>
                        <td className="px-4 py-3.5 text-slate-600 font-medium">{r.branch_name || '—'}</td>
                        <td className="px-4 py-3.5 text-slate-600">{r.process_name || '—'}</td>
                        <td className="px-4 py-3.5">
                          <Badge variant={statusInfo.variant} className="text-xs">{statusInfo.label}</Badge>
                        </td>
                        <td className="px-4 py-3.5">
                          {r.offer_status
                            ? <Badge variant="secondary" className="text-xs capitalize">{r.offer_status}</Badge>
                            : <span className="text-slate-300">—</span>
                          }
                        </td>
                        <td className="px-4 py-3.5">
                          {r.profile_status === 'profile_submitted' && !r.offer_status && (
                            <Button size="sm" onClick={() => openCandidate(r)} className="gap-1.5 font-semibold">
                              <UserPlus className="h-3.5 w-3.5" /> Create Offer
                            </Button>
                          )}
                          {r.offer_status === 'draft' && (
                            <Button size="sm" variant="outline" onClick={() => openCandidate(r)} className="gap-1.5">
                              Edit Offer
                            </Button>
                          )}
                          {r.offer_status === 'submitted' && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">
                              <Clock className="h-3 w-3 mr-1" /> Pending Approval
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!rows.length && (
                <div className="text-center py-16 text-slate-400">
                  <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="font-semibold">No onboarding requests yet</p>
                  <p className="text-xs mt-1">Candidates will appear here once they submit their onboarding form</p>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );

  // ── Render: Offer Creation View ────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Back + Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => { setSelected(null); setSalaryPreview(null); setBgv(null); }} className="gap-1.5">
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-black text-slate-900">Employment Offer</h1>
            <p className="text-sm text-slate-500">{selected.full_name} · {selected.candidate_code} · {selected.branch_name}</p>
          </div>
        </div>

        {/* Candidate Info Bar */}
        <Card className="border-blue-100 bg-blue-50/50">
          <CardContent className="py-4 px-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div><p className="text-xs text-blue-600 font-semibold">Name</p><p className="font-bold text-slate-900">{selected.full_name}</p></div>
              <div><p className="text-xs text-blue-600 font-semibold">Mobile</p><p className="text-slate-700">{selected.mobile}</p></div>
              <div><p className="text-xs text-blue-600 font-semibold">Branch</p><p className="text-slate-700 font-medium">{selected.branch_name || '—'}</p></div>
              <div><p className="text-xs text-blue-600 font-semibold">Process</p><p className="text-slate-700 font-medium">{selected.process_name || '—'}</p></div>
              <div><p className="text-xs text-blue-600 font-semibold">Email</p><p className="text-slate-700 text-xs">{selected.email}</p></div>
            </div>
          </CardContent>
        </Card>

        {/* BGV Score */}
        {bgv && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 text-slate-700">
                <ShieldCheck className="h-4 w-4 text-blue-500" /> Background Verification
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-3">
                <div className={`text-lg font-black px-3 py-1 rounded-lg ${bgv.score >= 70 ? 'bg-emerald-100 text-emerald-700' : bgv.score >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                  {bgv.score}/100
                </div>
                <p className="text-sm text-slate-500">
                  {bgv.score >= 70 ? 'Verification complete — good to proceed' : bgv.score >= 40 ? 'Partial verification — review recommended' : 'Low score — manual review required'}
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {(bgv.checks ?? []).map(c => (
                  <div key={c.check_type} className={`rounded-lg border px-3 py-2.5 text-xs flex items-center justify-between gap-2 ${BGV_COLOR[c.status] ?? BGV_COLOR.not_run}`}>
                    <span className="capitalize font-medium">{c.check_type.replace(/_/g, ' ')}</span>
                    <span className="font-bold uppercase text-[10px]">{c.status}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Offer Form Tabs: Standard vs Proposed */}
        <Card className="border-0 shadow-md">
          <CardHeader className="border-b bg-slate-50/50">
            <Tabs value={offerTab} onValueChange={v => setOfferTab(v as 'standard' | 'proposed')}>
              <TabsList className="grid w-full max-w-md grid-cols-2">
                <TabsTrigger value="standard" className="gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Standard Offer
                </TabsTrigger>
                <TabsTrigger value="proposed" className="gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" /> Proposed Exception
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <CardDescription className="mt-2">
              {offerTab === 'standard'
                ? 'Salary auto-calculated from selected band — amounts are locked.'
                : 'Propose a different CTC amount. Requires Branch Head + Payroll Head approval before activation.'}
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6 space-y-8">
            {/* ── Section: Employment Details ── */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Briefcase className="h-4 w-4 text-slate-400" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Employment Details</h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label className="text-xs font-semibold text-slate-600">Employment Type *</Label>
                  <select className="mt-1 flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400" value={offer.emp_type} onChange={e => setF('emp_type', e.target.value)}>
                    {EMP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-600">Date of Joining *</Label>
                  <Input type="date" className="mt-1 h-10" value={offer.date_of_joining} onChange={e => setF('date_of_joining', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-600">Salary Start Date</Label>
                  <Input type="date" className="mt-1 h-10" value={offer.date_of_salary} onChange={e => setF('date_of_salary', e.target.value)} />
                  <p className="text-[10px] text-slate-400 mt-1">Leave blank = same as joining date</p>
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-600">Department *</Label>
                  <select className="mt-1 flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400" value={offer.department_id} onChange={e => setF('department_id', e.target.value)}>
                    <option value="">Select Department</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-600">Designation *</Label>
                  <select className="mt-1 flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400" value={offer.designation_id} onChange={e => setF('designation_id', e.target.value)}>
                    <option value="">Select Designation</option>
                    {designations.map(d => <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-600">Cost Centre *</Label>
                  <select className="mt-1 flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400" value={offer.cost_centre} onChange={e => { setF('cost_centre', e.target.value); setSelectedPackage(null); setSalaryPreview(null); }}>
                    <option value="">Select Cost Centre</option>
                    {costCentres.map(c => (
                      <option key={c.cost_centre_code} value={c.cost_centre_code}>
                        {c.cost_centre_code}{c.display_name ? ` (${c.display_name})` : c.process_name ? ` (${c.process_name})` : c.category ? ` (${c.category})` : ''}
                      </option>
                    ))}
                  </select>
                  {!costCentres.length && selected?.branch_name && <p className="text-[10px] text-amber-500 mt-1">No cost centres found for {selected.branch_name}. Contact Payroll Head to add.</p>}
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-600">Process / LOB</Label>
                  <Input className="mt-1 h-10 bg-slate-50 font-medium" value={selected?.process_name || '—'} readOnly />
                  <p className="text-[10px] text-slate-400 mt-0.5">From candidate profile (read-only)</p>
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-600">Reporting Manager</Label>
                  <select className="mt-1 flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400" value={offer.reporting_manager_id} onChange={e => setF('reporting_manager_id', e.target.value)}>
                    <option value="">Select Manager</option>
                    {managers.map(m => <option key={m.id} value={m.id}>{m.name}{m.code ? ` (${m.code})` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-600">Role Type</Label>
                  <select className="mt-1 flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400" value={offer.role_type} onChange={e => setF('role_type', e.target.value)}>
                    <option value="Analyst">Analyst</option>
                    <option value="SupportStaff">Support Staff</option>
                  </select>
                </div>
              </div>
            </section>

            {/* ── Section: Salary ── */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <IndianRupee className="h-4 w-4 text-slate-400" />
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Compensation</h3>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label className="text-xs font-semibold text-slate-600">Salary Band *</Label>
                  <select className="mt-1 flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400" value={offer.salary_band} onChange={e => { setF('salary_band', e.target.value); setSelectedPackage(null); setSalaryPreview(null); }}>
                    <option value="">Select Band</option>
                    {salaryBands.map(b => (
                      <option key={b.band_code} value={b.band_code}>
                        Band {b.band_code} ({fmt(b.min_ctc)} – {fmt(b.max_ctc)}/mo)
                      </option>
                    ))}
                  </select>
                  {selectedBand && (
                    <p className="text-[10px] text-slate-400 mt-1">
                      Monthly range: {fmt(selectedBand.min_ctc)} – {fmt(selectedBand.max_ctc)}
                    </p>
                  )}
                </div>

                {offerTab === 'standard' ? (
                  <div>
                    <Label className="text-xs font-semibold text-slate-600">Select Package *</Label>
                    {packages.length > 0 ? (
                      <select className="mt-1 flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400" value={offer.selected_package_id} onChange={e => selectPackage(e.target.value)}>
                        <option value="">Choose a package</option>
                        {packages.map(p => (
                          <option key={p.id} value={p.id}>
                            {fmt(p.package_amount)}/mo | Gross {fmt(p.gross)} | Net {fmt(p.net_in_hand)}
                          </option>
                        ))}
                      </select>
                    ) : offer.salary_band ? (
                      <div className="mt-1">
                        <Input type="number" className="h-10" value={offer.offered_ctc} onChange={e => setF('offered_ctc', e.target.value)} placeholder="Enter monthly CTC" />
                        <p className="text-[10px] text-amber-500 mt-1">No pre-defined packages for this combination. Enter CTC manually.</p>
                        <Button variant="outline" size="sm" onClick={calcSalaryManual} disabled={calcLoading || !offer.offered_ctc} className="mt-2 gap-1.5 text-xs">
                          {calcLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />}
                          Calculate Breakdown
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">Select a band first</p>
                    )}
                    {selectedPackage && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 text-emerald-500" />
                        <p className="text-[10px] text-emerald-600 font-semibold">Package locked: {fmt(selectedPackage.package_amount)}/mo — all components auto-filled</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <Label className="text-xs font-semibold text-amber-600">Proposed Monthly CTC (₹) *</Label>
                    <Input type="number" className="mt-1 h-10 border-amber-300 focus:ring-amber-400 text-slate-900" value={proposedCtc} onChange={e => setProposedCtc(e.target.value)} placeholder="Enter proposed amount" />
                    <p className="text-[10px] text-amber-600 mt-1">Different from pre-defined packages. Requires Branch Head + Payroll Head approval.</p>
                  </div>
                )}

                <div className="flex flex-col justify-end gap-3">
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={offer.pf_eligible} onChange={e => setF('pf_eligible', e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
                      PF Eligible
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={offer.esi_eligible} onChange={e => setF('esi_eligible', e.target.checked)} className="h-4 w-4 rounded accent-blue-600" />
                      ESI Eligible
                    </label>
                  </div>
                </div>
              </div>

              {offerTab === 'proposed' && (
                <div className="mt-4">
                  <Label className="text-xs font-semibold text-amber-600">Reason for Exception *</Label>
                  <Input className="mt-1 h-10 border-amber-200" value={proposedReason} onChange={e => setProposedReason(e.target.value)} placeholder="e.g. Experienced candidate negotiated higher, skill premium for Java developers" />
                </div>
              )}

              {/* Salary Breakdown */}
              {calcLoading && (
                <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Calculating salary components...
                </div>
              )}
              {salaryPreview && !calcLoading && (
                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/50 p-5">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                    <Calculator className="h-3.5 w-3.5" /> Salary Breakdown (Monthly)
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'Gross', value: salaryPreview.gross, highlight: true },
                      { label: 'Basic', value: salaryPreview.basic },
                      { label: 'HRA', value: salaryPreview.hra },
                      { label: 'Conveyance', value: salaryPreview.conveyance },
                      { label: 'Special Allowance', value: salaryPreview.special_allowance },
                      { label: 'PF (Employee)', value: salaryPreview.pf_employee },
                      { label: 'PF (Employer)', value: salaryPreview.pf_employer },
                      { label: 'ESIC (Employee)', value: salaryPreview.esic_employee },
                      { label: 'ESIC (Employer)', value: salaryPreview.esic_employer },
                      { label: 'Prof. Tax', value: salaryPreview.professional_tax },
                      { label: 'Gratuity', value: salaryPreview.gratuity },
                      { label: 'Net In-Hand', value: salaryPreview.net_in_hand, highlight: true },
                    ].map(item => (
                      <div key={item.label} className={`rounded-lg p-3 ${item.highlight ? 'bg-blue-50 border border-blue-200' : 'bg-white border border-slate-100'}`}>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider">{item.label}</p>
                        <p className={`font-bold text-sm ${item.highlight ? 'text-blue-700' : 'text-slate-800'}`}>{fmt(item.value ?? 0)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* ── Actions ── */}
            <div className="flex items-center gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => submitOffer(false)} disabled={saving} className="h-11 px-6">
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                Save as Draft
              </Button>
              <Button
                onClick={() => submitOffer(true)}
                disabled={saving || !offer.date_of_joining || !offer.salary_band || (offerTab === 'proposed' && (!proposedCtc || !proposedReason))}
                className="h-11 px-8 font-bold bg-blue-600 hover:bg-blue-700 shadow-sm"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                Submit to Branch Head
              </Button>
              {offerTab === 'proposed' && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Exception offers require dual approval (Branch Head + Payroll Head)
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Employee Code Notice */}
        <Card className="bg-slate-50 border-dashed border-slate-300">
          <CardContent className="py-4 px-5 flex items-start gap-3">
            <FileCheck className="h-5 w-5 text-slate-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-slate-600">
              <p className="font-semibold">Employee Code & Activation</p>
              <p className="text-xs mt-0.5">Employee code is generated automatically when the Branch Head approves this offer. Process & Branch are carried from the candidate profile.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
