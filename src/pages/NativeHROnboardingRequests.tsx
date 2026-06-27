import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Calculator, ChevronLeft, ShieldCheck, Users, Briefcase,
  IndianRupee, FileCheck, AlertTriangle, CheckCircle2,
  Clock, UserPlus, Lock, TrendingUp, Building2,
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
interface SalaryBand { id: string; band_code: string; band_name: string; min_ctc: number; max_ctc: number; }

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
    name: r[nameKey] || r.department_name || r.designation_name || r.process_name || r.band_name || '',
    code: r.department_code || r.designation_code || r.band_code || '',
  }));
}

const BGV_COLOR: Record<string, string> = {
  verified: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  passed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  not_run: 'bg-slate-50 text-slate-500 border-slate-200',
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  profile_submitted:      { label: 'Ready for Offer',  cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  onboarding_sent:        { label: 'Link Sent',         cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  employee_details_saved: { label: 'In Progress',       cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  offer_submitted:        { label: 'Offer Sent',        cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  profile_in_progress:    { label: 'In Progress',       cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

const EMP_TYPES = ['OnRoll', 'OffRoll', 'MGMT. TRAINEE', 'CONTRACT'];
const fmt = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

// Shared select style — white bg, slate-900 text, ensures readable on all browsers
const SELECT_CLS =
  'mt-1 flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed appearance-none cursor-pointer ' +
  'shadow-sm transition-colors hover:border-slate-400';

const SECTION_LABEL = 'flex items-center gap-2 mb-5 pb-2 border-b border-slate-100';

export default function NativeHROnboardingRequests() {
  const [rows, setRows] = useState<OnboardingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OnboardingRequest | null>(null);
  const [salaryPreview, setSalaryPreview] = useState<SalaryPreview | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bgv, setBgv] = useState<BgvData | null>(null);
  const [offerTab, setOfferTab] = useState<'standard' | 'proposed'>('standard');

  const [departments, setDepartments] = useState<MasterItem[]>([]);
  const [designations, setDesignations] = useState<MasterItem[]>([]);
  const [managers, setManagers] = useState<MasterItem[]>([]);
  const [salaryBands, setSalaryBands] = useState<SalaryBand[]>([]);
  const [costCentres, setCostCentres] = useState<Array<{
    id: string; cost_centre_code: string; display_name: string;
    category: string; client_name: string; process_name: string;
  }>>([]);
  const [packages, setPackages] = useState<Array<{
    id: string; package_amount: number; basic: number; hra: number; conveyance: number;
    gross: number; epf_employee: number; esic_employee: number; net_in_hand: number; ctc: number;
    bonus: number; special_allowance: number; other_allowance: number;
    epf_employer: number; esic_employer: number; admin_charges: number; professional_tax: number;
    pli: number; portfolio: number; medical: number;
  }>>([]);
  const [selectedPackage, setSelectedPackage] = useState<typeof packages[0] | null>(null);

  const [offer, setOffer] = useState({
    emp_type: 'OnRoll', date_of_joining: '', date_of_salary: '',
    cost_centre: '', role_type: 'Analyst', salary_band: '',
    offered_ctc: '', department_id: '', designation_id: '', reporting_manager_id: '',
    pf_eligible: true, esi_eligible: true, selected_package_id: '',
  });
  const [proposedCtc, setProposedCtc] = useState('');
  const [proposedReason, setProposedReason] = useState('');

  const setF = (key: keyof typeof offer, value: unknown) =>
    setOffer(p => ({ ...p, [key]: value }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await hrmsApi.get<unknown>('/api/ats/onboarding/requests');
      setRows(rowsFrom(r));
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    hrmsApi.get<unknown>('/api/org/departments?active=1')
      .then(r => setDepartments(masterFrom(r, 'department_name')))
      .catch(() => hrmsApi.get<unknown>('/api/departments?active_status=1')
        .then(r => setDepartments(masterFrom(r, 'department_name'))).catch(() => {}));

    hrmsApi.get<unknown>('/api/org/designations?active=1')
      .then(r => setDesignations(masterFrom(r, 'designation_name')))
      .catch(() => hrmsApi.get<unknown>('/api/designations?active_status=1')
        .then(r => setDesignations(masterFrom(r, 'designation_name'))).catch(() => {}));

    hrmsApi.get<unknown>('/api/payroll-masters/bands').then((r: any) => {
      const arr = r?.data ?? (Array.isArray(r) ? r : []);
      setSalaryBands(arr.map((b: any) => ({
        id: b.id, band_code: b.band_code, band_name: b.band_name,
        min_ctc: Number(b.slab_from ?? b.min_ctc ?? 0),
        max_ctc: Number(b.slab_to ?? b.max_ctc ?? 0),
      })));
    }).catch(() => {
      setSalaryBands([
        { id: '1',  band_code: 'A', band_name: 'Band A', min_ctc: 0,      max_ctc: 4000 },
        { id: '2',  band_code: 'B', band_name: 'Band B', min_ctc: 4001,   max_ctc: 6000 },
        { id: '3',  band_code: 'C', band_name: 'Band C', min_ctc: 6001,   max_ctc: 7500 },
        { id: '4',  band_code: 'D', band_name: 'Band D', min_ctc: 7501,   max_ctc: 9000 },
        { id: '5',  band_code: 'E', band_name: 'Band E', min_ctc: 9001,   max_ctc: 11000 },
        { id: '6',  band_code: 'F', band_name: 'Band F', min_ctc: 11001,  max_ctc: 15000 },
        { id: '7',  band_code: 'G', band_name: 'Band G', min_ctc: 15001,  max_ctc: 18000 },
        { id: '8',  band_code: 'H', band_name: 'Band H', min_ctc: 18001,  max_ctc: 25000 },
        { id: '9',  band_code: 'I', band_name: 'Band I', min_ctc: 25001,  max_ctc: 35000 },
        { id: '10', band_code: 'J', band_name: 'Band J', min_ctc: 35001,  max_ctc: 50000 },
        { id: '11', band_code: 'K', band_name: 'Band K', min_ctc: 50001,  max_ctc: 75000 },
        { id: '12', band_code: 'L', band_name: 'Band L', min_ctc: 75001,  max_ctc: 100000 },
        { id: '13', band_code: 'M', band_name: 'Band M', min_ctc: 100001, max_ctc: 125000 },
        { id: '14', band_code: 'N', band_name: 'Band N', min_ctc: 125001, max_ctc: 500000 },
      ]);
    });

    hrmsApi.get<unknown>('/api/employees?active_status=1&limit=500').then((r: any) => {
      const emps = Array.isArray(r) ? r : r?.data ?? [];
      setManagers((Array.isArray(emps) ? emps : [])
        .filter((e: any) => e.first_name || e.last_name)
        .map((e: any) => ({
          id: e.id,
          name: [e.first_name, e.last_name].filter(Boolean).join(' '),
          code: e.employee_code || '',
        })));
    }).catch(() => {});
  }, []);

  // Cascading: cost centres by branch
  useEffect(() => {
    if (!selected?.branch_name) { setCostCentres([]); return; }
    hrmsApi.get<unknown>(`/api/payroll-masters/cost-centres?branch=${encodeURIComponent(selected.branch_name)}`)
      .then((r: any) => setCostCentres(r?.data ?? []))
      .catch(() => setCostCentres([]));
  }, [selected?.branch_name]);

  // Cascading: packages by branch + cost centre + band
  useEffect(() => {
    if (!selected?.branch_name || !offer.salary_band) { setPackages([]); setSelectedPackage(null); return; }
    const params = new URLSearchParams({ branch: selected.branch_name, band: offer.salary_band });
    if (offer.cost_centre) params.set('costCentre', offer.cost_centre);
    hrmsApi.get<unknown>(`/api/payroll-masters/packages?${params}`)
      .then((r: any) => { setPackages(r?.data ?? []); setSelectedPackage(null); setSalaryPreview(null); })
      .catch(() => setPackages([]));
  }, [selected?.branch_name, offer.cost_centre, offer.salary_band]);

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

  const openCandidate = (row: OnboardingRequest) => {
    setSelected(row);
    setBgv(null);
    setOfferTab('standard');
    setProposedCtc('');
    setProposedReason('');
    setSalaryPreview(null);
    setSelectedPackage(null);
    setOffer({
      emp_type: 'OnRoll', date_of_joining: '', date_of_salary: '',
      cost_centre: '', role_type: 'Analyst', salary_band: '',
      offered_ctc: '', department_id: '', designation_id: '', reporting_manager_id: '',
      pf_eligible: true, esi_eligible: true, selected_package_id: '',
    });
    hrmsApi.get<unknown>(`/api/ats/bgv/status?candidateId=${row.candidate_id}`)
      .then((r: any) => { const d = r?.data ?? r; if (d && typeof d === 'object') setBgv(d as BgvData); })
      .catch(() => {});
  };

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

  // ── List View ──────────────────────────────────────────────────────────────
  if (!selected) return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 mb-1">HR · ATS Onboarding</p>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Onboarding Requests</h1>
            <p className="text-sm text-slate-500 mt-0.5">Candidates who completed their profile — create employment offers below</p>
          </div>
          <div className="flex items-center gap-2 mt-3 sm:mt-0">
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 border border-blue-100">
              <Users className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-semibold text-blue-700">
                {rows.filter(r => r.profile_status === 'profile_submitted').length} pending offer
              </span>
            </div>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="animate-spin h-8 w-8 text-blue-500" />
              <p className="text-sm text-slate-400">Loading requests…</p>
            </div>
          </div>
        ) : (
          <Card className="border border-slate-200 shadow-sm overflow-hidden rounded-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['Code', 'Candidate', 'Mobile', 'Branch / Process', 'Profile Status', 'Offer Status', 'Action'].map(h => (
                      <th key={h} className="text-left px-5 py-3.5 font-semibold text-slate-500 text-xs uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(r => {
                    const si = STATUS_BADGE[r.profile_status] ?? { label: r.profile_status, cls: 'bg-slate-50 text-slate-600 border-slate-200' };
                    return (
                      <tr key={r.id} className="hover:bg-blue-50/30 transition-colors group">
                        <td className="px-5 py-4 font-mono text-xs text-slate-400 whitespace-nowrap">{r.candidate_code}</td>
                        <td className="px-5 py-4">
                          <p className="font-semibold text-slate-900">{r.full_name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{r.email}</p>
                        </td>
                        <td className="px-5 py-4 text-slate-600 whitespace-nowrap">{r.mobile}</td>
                        <td className="px-5 py-4">
                          <p className="text-slate-700 font-medium">{r.branch_name || '—'}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{r.process_name || '—'}</p>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium border ${si.cls}`}>
                            {si.label}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          {r.offer_status
                            ? <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 capitalize">{r.offer_status}</span>
                            : <span className="text-slate-300 text-xs">—</span>}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          {r.profile_status === 'profile_submitted' && !r.offer_status && (
                            <Button size="sm" onClick={() => openCandidate(r)} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm">
                              <UserPlus className="h-3.5 w-3.5" /> Create Offer
                            </Button>
                          )}
                          {r.offer_status === 'draft' && (
                            <Button size="sm" variant="outline" onClick={() => openCandidate(r)} className="gap-1.5 border-slate-300 text-slate-700">
                              Edit Offer
                            </Button>
                          )}
                          {r.offer_status === 'submitted' && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600">
                              <Clock className="h-3.5 w-3.5" /> Pending Approval
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!rows.length && (
                <div className="text-center py-20 text-slate-400">
                  <Users className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p className="font-semibold text-slate-500">No onboarding requests</p>
                  <p className="text-xs mt-1">Candidates appear here after submitting their onboarding form</p>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );

  // ── Offer Creation View ────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-5">

        {/* Breadcrumb + Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setSelected(null); setSalaryPreview(null); setBgv(null); }}
            className="gap-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 -ml-2">
            <ChevronLeft className="h-4 w-4" /> Back to List
          </Button>
          <span className="text-slate-300">/</span>
          <span className="text-sm font-semibold text-slate-700">Create Employment Offer</span>
        </div>

        {/* Candidate Summary Card */}
        <Card className="border border-blue-100 bg-gradient-to-br from-blue-50 to-white rounded-xl shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-9 w-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {selected.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 text-base leading-tight">{selected.full_name}</p>
                    <p className="text-xs text-slate-500 font-mono">{selected.candidate_code}</p>
                  </div>
                </div>
              </div>
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200 shrink-0">
                Profile Submitted
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-blue-100">
              <InfoCell label="Mobile" value={selected.mobile} />
              <InfoCell label="Email" value={selected.email} small />
              <InfoCell label="Branch" value={selected.branch_name || '—'} />
              <InfoCell label="Process / LOB" value={selected.process_name || '—'} />
            </div>
          </CardContent>
        </Card>

        {/* BGV Score */}
        {bgv && (
          <Card className="border border-slate-200 shadow-sm rounded-xl">
            <CardHeader className="pb-3 px-5 pt-4">
              <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-blue-500" /> Background Verification
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              <div className="flex items-center gap-4 mb-4">
                <div className={`text-xl font-black px-4 py-2 rounded-lg tabular-nums ${bgv.score >= 70 ? 'bg-emerald-100 text-emerald-700' : bgv.score >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                  {bgv.score}<span className="text-sm font-semibold">/100</span>
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

        {/* Offer Type Toggle */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
          <button
            onClick={() => setOfferTab('standard')}
            className={`flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              offerTab === 'standard'
                ? 'bg-white text-blue-700 shadow-sm border border-blue-100'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <CheckCircle2 className="h-4 w-4" /> Standard Offer
          </button>
          <button
            onClick={() => setOfferTab('proposed')}
            className={`flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              offerTab === 'proposed'
                ? 'bg-white text-amber-700 shadow-sm border border-amber-100'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <AlertTriangle className="h-4 w-4" /> Exception Offer
          </button>
        </div>
        {offerTab === 'proposed' && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2.5 rounded-lg flex items-center gap-2 -mt-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Exception offers propose a custom CTC outside the defined package. Requires Branch Head + Payroll Head dual approval.
          </p>
        )}

        {/* Main Form */}
        <Card className="border border-slate-200 shadow-sm rounded-xl">

          {/* ── Section: Employment Details ── */}
          <CardContent className="p-6 space-y-6">
            <div>
              <div className={SECTION_LABEL}>
                <Briefcase className="h-4 w-4 text-blue-500" />
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Employment Details</h3>
              </div>
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">

                <FormField label="Employment Type" required>
                  <select className={SELECT_CLS} value={offer.emp_type} onChange={e => setF('emp_type', e.target.value)}>
                    {EMP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </FormField>

                <FormField label="Date of Joining" required>
                  <Input
                    type="date"
                    className="mt-1 h-10 text-slate-900 border-slate-300 focus:ring-blue-500 bg-white"
                    value={offer.date_of_joining}
                    onChange={e => setF('date_of_joining', e.target.value)}
                  />
                </FormField>

                <FormField label="Salary Start Date" hint="Leave blank = same as joining">
                  <Input
                    type="date"
                    className="mt-1 h-10 text-slate-900 border-slate-300 focus:ring-blue-500 bg-white"
                    value={offer.date_of_salary}
                    onChange={e => setF('date_of_salary', e.target.value)}
                  />
                </FormField>

                <FormField label="Department" required>
                  <select className={SELECT_CLS} value={offer.department_id} onChange={e => setF('department_id', e.target.value)}>
                    <option value="">— Select Department —</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ''}</option>)}
                  </select>
                </FormField>

                <FormField label="Designation" required>
                  <select className={SELECT_CLS} value={offer.designation_id} onChange={e => setF('designation_id', e.target.value)}>
                    <option value="">— Select Designation —</option>
                    {designations.map(d => <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ''}</option>)}
                  </select>
                </FormField>

                <FormField label="Cost Centre" required hint={!costCentres.length && selected?.branch_name ? `No cost centres for ${selected.branch_name}` : undefined}>
                  <select
                    className={SELECT_CLS}
                    value={offer.cost_centre}
                    onChange={e => { setF('cost_centre', e.target.value); setSelectedPackage(null); setSalaryPreview(null); }}
                  >
                    <option value="">— Select Cost Centre —</option>
                    {costCentres.map(c => (
                      <option key={c.cost_centre_code} value={c.cost_centre_code}>
                        {c.cost_centre_code}{c.display_name ? ` (${c.display_name})` : c.process_name ? ` (${c.process_name})` : c.category ? ` (${c.category})` : ''}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Process / LOB" hint="From candidate profile">
                  <Input
                    className="mt-1 h-10 bg-slate-50 text-slate-600 border-slate-200 cursor-not-allowed"
                    value={selected?.process_name || '—'}
                    readOnly
                  />
                </FormField>

                <FormField label="Reporting Manager">
                  <select className={SELECT_CLS} value={offer.reporting_manager_id} onChange={e => setF('reporting_manager_id', e.target.value)}>
                    <option value="">— Select Manager —</option>
                    {managers.map(m => <option key={m.id} value={m.id}>{m.name}{m.code ? ` · ${m.code}` : ''}</option>)}
                  </select>
                </FormField>

                <FormField label="Role Type">
                  <select className={SELECT_CLS} value={offer.role_type} onChange={e => setF('role_type', e.target.value)}>
                    <option value="Analyst">Analyst</option>
                    <option value="SupportStaff">Support Staff</option>
                  </select>
                </FormField>
              </div>
            </div>

            {/* ── Section: Compensation ── */}
            <div>
              <div className={SECTION_LABEL}>
                <IndianRupee className="h-4 w-4 text-blue-500" />
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Compensation Structure</h3>
              </div>

              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                <FormField label="Salary Band" required hint={selectedBand ? `Monthly: ${fmt(selectedBand.min_ctc)} – ${fmt(selectedBand.max_ctc)}` : undefined}>
                  <select
                    className={SELECT_CLS}
                    value={offer.salary_band}
                    onChange={e => { setF('salary_band', e.target.value); setSelectedPackage(null); setSalaryPreview(null); }}
                  >
                    <option value="">— Select Band —</option>
                    {salaryBands.map(b => (
                      <option key={b.band_code} value={b.band_code}>
                        Band {b.band_code} — {fmt(b.min_ctc)} to {fmt(b.max_ctc)}/mo
                      </option>
                    ))}
                  </select>
                </FormField>

                {offerTab === 'standard' ? (
                  <FormField label="Salary Package" required>
                    {packages.length > 0 ? (
                      <>
                        <select
                          className={SELECT_CLS}
                          value={offer.selected_package_id}
                          onChange={e => selectPackage(e.target.value)}
                        >
                          <option value="">— Choose a package —</option>
                          {packages.map(p => (
                            <option key={p.id} value={p.id}>
                              {fmt(p.package_amount)}/mo · Gross {fmt(p.gross)} · In-Hand {fmt(p.net_in_hand)}
                            </option>
                          ))}
                        </select>
                        {selectedPackage && (
                          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 font-semibold">
                            <Lock className="h-3.5 w-3.5" />
                            Package locked: {fmt(selectedPackage.package_amount)}/mo
                          </div>
                        )}
                      </>
                    ) : offer.salary_band ? (
                      <div className="space-y-2">
                        <Input
                          type="number"
                          className="h-10 text-slate-900 border-slate-300"
                          value={offer.offered_ctc}
                          onChange={e => setF('offered_ctc', e.target.value)}
                          placeholder="Enter monthly CTC"
                        />
                        <p className="text-xs text-amber-600">No pre-defined packages for this combination. Enter manually.</p>
                        <Button variant="outline" size="sm" onClick={calcSalaryManual} disabled={calcLoading || !offer.offered_ctc} className="gap-1.5 text-xs h-8">
                          {calcLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />}
                          Calculate Breakdown
                        </Button>
                      </div>
                    ) : (
                      <div className="mt-1 h-10 flex items-center px-3 rounded-md border border-dashed border-slate-200 text-xs text-slate-400 bg-slate-50">
                        Select a salary band first
                      </div>
                    )}
                  </FormField>
                ) : (
                  <FormField label="Proposed Monthly CTC (₹)" required>
                    <Input
                      type="number"
                      className="mt-1 h-10 border-amber-300 focus:ring-amber-400 text-slate-900"
                      value={proposedCtc}
                      onChange={e => setProposedCtc(e.target.value)}
                      placeholder="e.g. 18000"
                    />
                  </FormField>
                )}

                <div className="flex flex-col justify-end pb-1">
                  <Label className="text-xs font-semibold text-slate-600 mb-2">Statutory Eligibility</Label>
                  <div className="flex gap-5">
                    <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                      <input type="checkbox" checked={offer.pf_eligible} onChange={e => setF('pf_eligible', e.target.checked)} className="h-4 w-4 accent-blue-600 rounded cursor-pointer" />
                      PF Eligible
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                      <input type="checkbox" checked={offer.esi_eligible} onChange={e => setF('esi_eligible', e.target.checked)} className="h-4 w-4 accent-blue-600 rounded cursor-pointer" />
                      ESI Eligible
                    </label>
                  </div>
                </div>
              </div>

              {offerTab === 'proposed' && (
                <div className="mt-5">
                  <FormField label="Reason for Exception" required>
                    <Input
                      className="mt-1 h-10 border-amber-300 focus:ring-amber-400 text-slate-900"
                      value={proposedReason}
                      onChange={e => setProposedReason(e.target.value)}
                      placeholder="e.g. Experienced candidate negotiated higher — skill premium for Java stack"
                    />
                  </FormField>
                </div>
              )}

              {/* Salary Breakdown */}
              {calcLoading && (
                <div className="mt-5 flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Calculating salary components…
                </div>
              )}
              {salaryPreview && !calcLoading && (
                <div className="mt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="h-4 w-4 text-slate-400" />
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Salary Breakdown (Monthly)</p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {[
                      { label: 'CTC / Gross', value: salaryPreview.gross, highlight: 'blue' },
                      { label: 'Basic',         value: salaryPreview.basic },
                      { label: 'HRA',           value: salaryPreview.hra },
                      { label: 'Conveyance',    value: salaryPreview.conveyance },
                      { label: 'Special Allow.', value: salaryPreview.special_allowance },
                      { label: 'Bonus',         value: salaryPreview.bonus },
                      { label: 'PF Employee',   value: salaryPreview.pf_employee,   deduction: true },
                      { label: 'PF Employer',   value: salaryPreview.pf_employer },
                      { label: 'ESIC Employee', value: salaryPreview.esic_employee, deduction: true },
                      { label: 'ESIC Employer', value: salaryPreview.esic_employer },
                      { label: 'Prof. Tax',     value: salaryPreview.professional_tax, deduction: true },
                      { label: 'Admin Charges', value: salaryPreview.admin_charges },
                      { label: 'Net In-Hand',   value: salaryPreview.net_in_hand,   highlight: 'emerald' },
                    ].map(item => (
                      <div key={item.label} className={`rounded-lg p-3 border ${
                        item.highlight === 'blue'    ? 'bg-blue-50 border-blue-200' :
                        item.highlight === 'emerald' ? 'bg-emerald-50 border-emerald-200' :
                        item.deduction              ? 'bg-red-50 border-red-100' :
                        'bg-white border-slate-100'
                      }`}>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider leading-none mb-1">{item.label}</p>
                        <p className={`font-bold text-sm tabular-nums ${
                          item.highlight === 'blue'    ? 'text-blue-700' :
                          item.highlight === 'emerald' ? 'text-emerald-700' :
                          item.deduction              ? 'text-red-600' :
                          'text-slate-800'
                        }`}>{fmt(item.value ?? 0)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Actions ── */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 pt-5 border-t border-slate-100">
              <Button
                variant="outline"
                onClick={() => submitOffer(false)}
                disabled={saving}
                className="h-11 px-6 border-slate-300 text-slate-700 font-semibold"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Save as Draft
              </Button>
              <Button
                onClick={() => submitOffer(true)}
                disabled={saving || !offer.date_of_joining || !offer.salary_band || (offerTab === 'proposed' && (!proposedCtc || !proposedReason))}
                className="h-11 px-8 bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-sm disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Submit to Branch Head
              </Button>
              {offerTab === 'proposed' && (
                <p className="text-xs text-amber-700 flex items-center gap-1.5 sm:ml-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Dual approval required: Branch Head + Payroll Head
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Info Notice */}
        <div className="flex items-start gap-3 px-5 py-4 rounded-xl border border-dashed border-slate-200 bg-slate-50">
          <FileCheck className="h-5 w-5 text-slate-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-slate-600">Employee Code &amp; Activation</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Employee code is auto-generated when the Branch Head approves this offer.
              Branch and Process are carried forward from the candidate profile.
            </p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function InfoCell({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-500 mb-0.5">{label}</p>
      <p className={`font-semibold text-slate-800 leading-tight ${small ? 'text-xs' : 'text-sm'}`}>{value}</p>
    </div>
  );
}

function FormField({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs font-semibold text-slate-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[10px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}
