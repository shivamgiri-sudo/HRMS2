import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Calculator, ChevronLeft, ShieldCheck, Users, Briefcase,
  IndianRupee, FileCheck, AlertTriangle, CheckCircle2,
  Clock, UserPlus, Lock, TrendingUp, Building2, Search,
  ChevronRight, Star, Zap,
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

// Grades H+ are above executive level — eligible as reporting managers
// Based on designation_master: G=EXECUTIVE/CCE/TRAINER, H+=QA/TL/AM/Manager/above
const MANAGER_ELIGIBLE_GRADES = ['H', 'I', 'J', 'K', 'L', 'M', 'N'];

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
  verified:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  passed:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed:    'bg-red-50    text-red-700    border-red-200',
  pending:   'bg-amber-50  text-amber-700  border-amber-200',
  not_run:   'bg-slate-50  text-slate-400  border-slate-200',
};

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  profile_submitted:      { label: 'Ready for Offer', color: 'bg-blue-100 text-blue-700' },
  onboarding_sent:        { label: 'Link Sent',        color: 'bg-slate-100 text-slate-600' },
  employee_details_saved: { label: 'In Progress',      color: 'bg-amber-100 text-amber-700' },
  offer_submitted:        { label: 'Offer Sent',       color: 'bg-indigo-100 text-indigo-700' },
  profile_in_progress:    { label: 'In Progress',      color: 'bg-amber-100 text-amber-700' },
  registered:             { label: 'Registered',       color: 'bg-slate-100 text-slate-500' },
  onboarded:              { label: 'Onboarded',        color: 'bg-emerald-100 text-emerald-700' },
};

const EMP_TYPES = ['OnRoll', 'OffRoll', 'MGMT. TRAINEE', 'CONTRACT'];
const fmt = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;

const SEL = 'w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ' +
  'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ' +
  'hover:border-slate-300 transition-colors';

export default function NativeHROnboardingRequests() {
  const [rows, setRows]           = useState<OnboardingRequest[]>([]);
  const [filtered, setFiltered]   = useState<OnboardingRequest[]>([]);
  const [search, setSearch]       = useState('');
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState<OnboardingRequest | null>(null);
  const [salaryPreview, setSalaryPreview] = useState<SalaryPreview | null>(null);
  const [calcLoading, setCalcLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [bgv, setBgv]             = useState<BgvData | null>(null);
  const [offerTab, setOfferTab]   = useState<'standard' | 'proposed'>('standard');

  const [departments, setDepartments]   = useState<MasterItem[]>([]);
  const [designations, setDesignations] = useState<MasterItem[]>([]);
  const [managers, setManagers]         = useState<Array<{ id: string; name: string; code?: string; branch_name?: string; cost_center_code?: string; grade?: string }>>([]);
  const [allManagers, setAllManagers]   = useState<typeof managers>([]);
  const [salaryBands, setSalaryBands]   = useState<SalaryBand[]>([]);
  const [costCentres, setCostCentres]   = useState<Array<{
    id: string; cost_centre_code: string; display_name: string;
    category: string; client_name: string; process_name: string; branch_name?: string;
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
  const [proposedCtc, setProposedCtc]       = useState('');
  const [proposedReason, setProposedReason] = useState('');

  const setF = (key: keyof typeof offer, value: unknown) =>
    setOffer(p => ({ ...p, [key]: value }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await hrmsApi.get<unknown>('/api/ats/onboarding/requests');
      const data = rowsFrom(r);
      setRows(data);
      setFiltered(data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Search filter
  useEffect(() => {
    if (!search.trim()) { setFiltered(rows); return; }
    const q = search.toLowerCase();
    setFiltered(rows.filter(r =>
      r.full_name?.toLowerCase().includes(q) ||
      r.email?.toLowerCase().includes(q) ||
      r.mobile?.includes(q) ||
      r.candidate_code?.toLowerCase().includes(q) ||
      r.branch_name?.toLowerCase().includes(q),
    ));
  }, [search, rows]);

  // Load masters
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
        max_ctc: Number(b.slab_to   ?? b.max_ctc ?? 0),
      })));
    }).catch(() => {
      setSalaryBands([
        { id:'1',  band_code:'A', band_name:'Band A', min_ctc:0,      max_ctc:4000 },
        { id:'2',  band_code:'B', band_name:'Band B', min_ctc:4001,   max_ctc:6000 },
        { id:'3',  band_code:'C', band_name:'Band C', min_ctc:6001,   max_ctc:7500 },
        { id:'4',  band_code:'D', band_name:'Band D', min_ctc:7501,   max_ctc:9000 },
        { id:'5',  band_code:'E', band_name:'Band E', min_ctc:9001,   max_ctc:11000 },
        { id:'6',  band_code:'F', band_name:'Band F', min_ctc:11001,  max_ctc:15000 },
        { id:'7',  band_code:'G', band_name:'Band G', min_ctc:15001,  max_ctc:18000 },
        { id:'8',  band_code:'H', band_name:'Band H', min_ctc:18001,  max_ctc:25000 },
        { id:'9',  band_code:'I', band_name:'Band I', min_ctc:25001,  max_ctc:35000 },
        { id:'10', band_code:'J', band_name:'Band J', min_ctc:35001,  max_ctc:50000 },
        { id:'11', band_code:'K', band_name:'Band K', min_ctc:50001,  max_ctc:75000 },
        { id:'12', band_code:'L', band_name:'Band L', min_ctc:75001,  max_ctc:100000 },
        { id:'13', band_code:'M', band_name:'Band M', min_ctc:100001, max_ctc:125000 },
        { id:'14', band_code:'N', band_name:'Band N', min_ctc:125001, max_ctc:500000 },
      ]);
    });

    hrmsApi.get<unknown>('/api/employees?active_status=1&limit=2000').then((r: any) => {
      const emps = Array.isArray(r) ? r : r?.data ?? [];
      const mgrs = (Array.isArray(emps) ? emps : [])
        .filter((e: any) => e.first_name || e.last_name || e.full_name)
        .map((e: any) => ({
          id: e.id,
          name: e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' '),
          code: e.employee_code || '',
          branch_name:      e.branch_name      || '',
          cost_center_code: e.cost_center_code || '',
          grade:            e.grade            || '',
        }));
      setAllManagers(mgrs);
      setManagers(mgrs.filter(m => !m.grade || MANAGER_ELIGIBLE_GRADES.includes(m.grade)));
    }).catch(() => {});
  }, []);

  // Cascading: cost centres + manager filter by branch
  useEffect(() => {
    if (!selected?.branch_name) {
      setCostCentres([]);
      setManagers(allManagers.filter(m => !m.grade || MANAGER_ELIGIBLE_GRADES.includes(m.grade)));
      return;
    }
    hrmsApi.get<unknown>(`/api/payroll-masters/cost-centres?branch=${encodeURIComponent(selected.branch_name)}`)
      .then((r: any) => setCostCentres((r?.data ?? []).map((c: any) => ({ ...c, branch_name: selected.branch_name }))))
      .catch(() => setCostCentres([]));
    applyManagerFilter(allManagers, selected.branch_name, offer.cost_centre);
  }, [selected?.branch_name, allManagers]);

  // Re-filter managers when cost centre changes
  useEffect(() => {
    if (!allManagers.length) return;
    applyManagerFilter(allManagers, selected?.branch_name ?? '', offer.cost_centre);
  }, [offer.cost_centre, allManagers]);

  function applyManagerFilter(all: typeof allManagers, branchName: string, costCentre: string) {
    let filtered = all.filter(m => !m.grade || MANAGER_ELIGIBLE_GRADES.includes(m.grade));
    if (branchName) {
      filtered = filtered.filter(m =>
        !m.branch_name || m.branch_name.toLowerCase() === branchName.toLowerCase()
      );
    }
    if (costCentre) {
      const sameCc = filtered.filter(m => m.cost_center_code && m.cost_center_code === costCentre);
      if (sameCc.length > 0) filtered = sameCc;
    }
    setManagers(filtered);
  }

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
    const ctcToUse   = isProposed ? Number(proposedCtc) : Number(offer.offered_ctc);
    if (!ctcToUse || !offer.date_of_joining) {
      alert('Date of Joining and CTC are required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...offer,
        reporting_manager_id: offer.reporting_manager_id || null,
        department_id:        offer.department_id        || null,
        designation_id:       offer.designation_id       || null,
        offered_ctc: ctcToUse * 12,
        submit,
        is_proposed_exception: Boolean(isProposed),
        proposed_reason: isProposed ? proposedReason : null,
      };
      await hrmsApi.post(`/api/ats/onboarding/requests/${selected.id}/offer`, payload);
      await load();
      setSelected(null);
      setSalaryPreview(null);
    } catch (e: any) { alert(e?.message ?? 'Failed to save offer'); }
    finally { setSaving(false); }
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const pendingOfferCount  = rows.filter(r => r.profile_status === 'profile_submitted' && !r.offer_status).length;
  const submittedCount     = rows.filter(r => r.offer_status === 'submitted').length;
  const draftCount         = rows.filter(r => r.offer_status === 'draft').length;

  // ── List View ──────────────────────────────────────────────────────────────
  if (!selected) return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50/50">
        <div className="max-w-full px-6 py-6 space-y-5">

          {/* Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-blue-600 mb-1">
                <Building2 className="h-3.5 w-3.5" />
                <span>HR · ATS Onboarding</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Onboarding Requests</h1>
              <p className="text-sm text-slate-400 mt-0.5">Candidates ready for employment offer creation</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search candidates…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="h-9 pl-9 pr-4 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
                />
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Pending Offer',    value: pendingOfferCount, color: 'text-blue-600',   bg: 'bg-blue-50',   icon: <UserPlus className="h-4 w-4" /> },
              { label: 'Submitted',        value: submittedCount,    color: 'text-amber-600',  bg: 'bg-amber-50',  icon: <Clock className="h-4 w-4" /> },
              { label: 'Draft',            value: draftCount,        color: 'text-slate-600',  bg: 'bg-slate-100', icon: <FileCheck className="h-4 w-4" /> },
            ].map(s => (
              <div key={s.label} className={`rounded-xl border border-slate-200 bg-white p-4 flex items-center gap-3`}>
                <div className={`h-9 w-9 rounded-lg ${s.bg} flex items-center justify-center ${s.color}`}>{s.icon}</div>
                <div>
                  <p className="text-xl font-bold text-slate-900 tabular-nums">{s.value}</p>
                  <p className="text-xs text-slate-500 font-medium">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center h-64 bg-white rounded-xl border border-slate-200">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-slate-400">Loading requests…</p>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      {['Code', 'Candidate', 'Mobile', 'Branch / Process', 'Profile', 'Offer', 'Action'].map(h => (
                        <th key={h} className="text-left px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map(r => {
                      const si = STATUS_CFG[r.profile_status] ?? { label: r.profile_status, color: 'bg-slate-100 text-slate-600' };
                      return (
                        <tr key={r.id} className="hover:bg-blue-50/20 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">{r.candidate_code}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                {r.full_name?.charAt(0)?.toUpperCase()}
                              </div>
                              <div>
                                <p className="font-semibold text-slate-900 text-sm">{r.full_name}</p>
                                <p className="text-xs text-slate-400">{r.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600 whitespace-nowrap text-xs">{r.mobile}</td>
                          <td className="px-4 py-3">
                            <p className="text-slate-700 font-medium text-xs">{r.branch_name || '—'}</p>
                            <p className="text-slate-400 text-[11px]">{r.process_name || '—'}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${si.color}`}>
                              {si.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {r.offer_status
                              ? <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-100 text-indigo-700 capitalize">{r.offer_status}</span>
                              : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {r.profile_status === 'profile_submitted' && !r.offer_status && (
                              <Button size="sm" onClick={() => openCandidate(r)}
                                className="h-8 gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm px-3">
                                <UserPlus className="h-3.5 w-3.5" /> Create Offer
                              </Button>
                            )}
                            {r.offer_status === 'draft' && (
                              <Button size="sm" variant="outline" onClick={() => openCandidate(r)}
                                className="h-8 gap-1.5 border-slate-200 text-slate-600 text-xs px-3">
                                Edit Draft
                              </Button>
                            )}
                            {r.offer_status === 'submitted' && (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                                <Clock className="h-3 w-3" /> Pending
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="text-center py-20 text-slate-400">
                    <Users className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p className="font-semibold text-slate-500 text-sm">
                      {search ? 'No candidates match your search' : 'No onboarding requests'}
                    </p>
                    <p className="text-xs mt-1 text-slate-400">
                      {search ? 'Try different keywords' : 'Candidates appear here after submitting their onboarding form'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );

  // ── Offer Creation View ────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50/50">
        <div className="max-w-full px-6 py-5 space-y-4">

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <button onClick={() => { setSelected(null); setSalaryPreview(null); setBgv(null); }}
              className="flex items-center gap-1 hover:text-blue-600 transition-colors font-medium">
              <ChevronLeft className="h-4 w-4" /> Onboarding Requests
            </button>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
            <span className="text-slate-700 font-semibold">Create Employment Offer</span>
          </div>

          {/* Top Row: Candidate card + BGV side by side on large screens */}
          <div className="grid gap-4 lg:grid-cols-3">

            {/* Candidate Summary */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-lg shrink-0">
                    {selected.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 text-lg leading-tight">{selected.full_name}</p>
                    <p className="text-xs text-slate-400 font-mono">{selected.candidate_code}</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200 shrink-0">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Profile Submitted
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-100">
                <InfoCell label="Mobile"      value={selected.mobile} />
                <InfoCell label="Email"       value={selected.email} small />
                <InfoCell label="Branch"      value={selected.branch_name || '—'} />
                <InfoCell label="Process/LOB" value={selected.process_name || '—'} />
              </div>
            </div>

            {/* BGV Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck className="h-4 w-4 text-blue-500" />
                <p className="text-sm font-bold text-slate-700">Background Verification</p>
              </div>
              {bgv ? (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`text-2xl font-black px-4 py-2 rounded-xl tabular-nums ${
                      bgv.score >= 70 ? 'bg-emerald-100 text-emerald-700' :
                      bgv.score >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                      {bgv.score}<span className="text-sm font-semibold">/100</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {bgv.score >= 70 ? 'Verified — good to proceed' :
                       bgv.score >= 40 ? 'Partial — review recommended' : 'Low — manual review needed'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(bgv.checks ?? []).map(c => (
                      <div key={c.check_type} className={`rounded-lg border px-2 py-1.5 text-[11px] flex items-center justify-between gap-1 ${BGV_COLOR[c.status] ?? BGV_COLOR.not_run}`}>
                        <span className="capitalize font-medium truncate">{c.check_type.replace(/_/g, ' ')}</span>
                        <span className="font-bold uppercase text-[10px] shrink-0">{c.status}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center h-24 text-slate-400">
                  <ShieldCheck className="h-8 w-8 mb-2 opacity-20" />
                  <p className="text-xs">No BGV data available</p>
                </div>
              )}
            </div>
          </div>

          {/* Offer Type Toggle */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
            <button onClick={() => setOfferTab('standard')}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                offerTab === 'standard' ? 'bg-white text-blue-700 shadow-sm border border-blue-100' : 'text-slate-500 hover:text-slate-700'}`}>
              <Zap className="h-3.5 w-3.5" /> Standard Offer
            </button>
            <button onClick={() => setOfferTab('proposed')}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                offerTab === 'proposed' ? 'bg-white text-amber-700 shadow-sm border border-amber-100' : 'text-slate-500 hover:text-slate-700'}`}>
              <AlertTriangle className="h-3.5 w-3.5" /> Exception Offer
            </button>
          </div>
          {offerTab === 'proposed' && (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-4 py-2.5 rounded-lg">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Exception offers require a custom CTC outside defined packages. Requires Branch Head + Payroll Head dual approval.
            </div>
          )}

          {/* Main Form */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">

            {/* Employment Details */}
            <div className="p-5 border-b border-slate-100">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-7 w-7 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Briefcase className="h-3.5 w-3.5 text-blue-600" />
                </div>
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Employment Details</h3>
              </div>

              <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">

                <FL label="Employment Type" required>
                  <select className={SEL} style={{ backgroundColor: 'white', color: '#1e293b' }} value={offer.emp_type} onChange={e => setF('emp_type', e.target.value)}>
                    {EMP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </FL>

                <FL label="Date of Joining" required>
                  <input type="date" className={SEL + ' px-2'} style={{ backgroundColor: 'white', color: '#1e293b' }}
                    value={offer.date_of_joining} onChange={e => setF('date_of_joining', e.target.value)} />
                </FL>

                <FL label="Salary Start Date" hint="Blank = same as joining">
                  <input type="date" className={SEL + ' px-2'} style={{ backgroundColor: 'white', color: '#1e293b' }}
                    value={offer.date_of_salary} onChange={e => setF('date_of_salary', e.target.value)} />
                </FL>

                <FL label="Department" required>
                  <select className={SEL} style={{ backgroundColor: 'white', color: '#1e293b' }} value={offer.department_id} onChange={e => setF('department_id', e.target.value)}>
                    <option value="">— Select —</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </FL>

                <FL label="Designation" required>
                  <select className={SEL} style={{ backgroundColor: 'white', color: '#1e293b' }} value={offer.designation_id} onChange={e => setF('designation_id', e.target.value)}>
                    <option value="">— Select —</option>
                    {designations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </FL>

                <FL label="Cost Centre" required hint={!costCentres.length && selected?.branch_name ? 'None for branch' : undefined}>
                  <select className={SEL} style={{ backgroundColor: 'white', color: '#1e293b' }}
                    value={offer.cost_centre}
                    onChange={e => { setF('cost_centre', e.target.value); setSelectedPackage(null); setSalaryPreview(null); }}>
                    <option value="">— Select —</option>
                    {costCentres.map(c => (
                      <option key={c.cost_centre_code} value={c.cost_centre_code}>
                        {c.cost_centre_code}{c.display_name ? ` · ${c.display_name}` : c.process_name ? ` · ${c.process_name}` : ''}
                      </option>
                    ))}
                  </select>
                </FL>

                <FL label="Process / LOB">
                  <div className={SEL + ' flex items-center bg-slate-50 text-slate-500 cursor-default border-dashed'}>
                    <span className="truncate text-xs">{selected?.process_name || '—'}</span>
                  </div>
                </FL>

                <FL label={`Reporting Manager${managers.length > 0 ? ` (${managers.length})` : ''}`}>
                  <select className={SEL} style={{ backgroundColor: 'white', color: '#1e293b' }}
                    value={offer.reporting_manager_id} onChange={e => setF('reporting_manager_id', e.target.value)}>
                    <option value="">— Select —</option>
                    {managers.map(m => <option key={m.id} value={m.id}>{m.name}{m.code ? ` · ${m.code}` : ''}</option>)}
                  </select>
                  {managers.length === 0 && selected?.branch_name && (
                    <p className="text-[10px] text-amber-600 mt-1">No managers found for this branch/cost centre</p>
                  )}
                </FL>

                <FL label="Role Type">
                  <select className={SEL} style={{ backgroundColor: 'white', color: '#1e293b' }} value={offer.role_type} onChange={e => setF('role_type', e.target.value)}>
                    <option value="Analyst">Analyst</option>
                    <option value="SupportStaff">Support Staff</option>
                  </select>
                </FL>

              </div>
            </div>

            {/* Compensation */}
            <div className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-7 w-7 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <IndianRupee className="h-3.5 w-3.5 text-emerald-600" />
                </div>
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Compensation Structure</h3>
              </div>

              <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">

                <FL label="Salary Band" required hint={selectedBand ? `${fmt(selectedBand.min_ctc)} – ${fmt(selectedBand.max_ctc)}/mo` : undefined}>
                  <select className={SEL} style={{ backgroundColor: 'white', color: '#1e293b' }}
                    value={offer.salary_band}
                    onChange={e => { setF('salary_band', e.target.value); setSelectedPackage(null); setSalaryPreview(null); }}>
                    <option value="">— Select Band —</option>
                    {salaryBands.map(b => (
                      <option key={b.band_code} value={b.band_code}>
                        Band {b.band_code} · {fmt(b.min_ctc)}–{fmt(b.max_ctc)}
                      </option>
                    ))}
                  </select>
                </FL>

                {offerTab === 'standard' ? (
                  <div className="lg:col-span-2">
                    <FL label="Salary Package" required>
                      {packages.length > 0 ? (
                        <div className="space-y-1.5">
                          <select className={SEL} style={{ backgroundColor: 'white', color: '#1e293b' }}
                            value={offer.selected_package_id} onChange={e => selectPackage(e.target.value)}>
                            <option value="">— Choose package —</option>
                            {packages.map(p => (
                              <option key={p.id} value={p.id}>
                                {fmt(p.package_amount)}/mo · Gross {fmt(p.gross)} · In-Hand {fmt(p.net_in_hand)}
                              </option>
                            ))}
                          </select>
                          {selectedPackage && (
                            <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-semibold">
                              <Lock className="h-3 w-3" /> Locked: {fmt(selectedPackage.package_amount)}/mo
                            </div>
                          )}
                        </div>
                      ) : offer.salary_band ? (
                        <div className="space-y-1.5">
                          <input type="number" className={SEL}
                            style={{ backgroundColor: 'white', color: '#1e293b' }}
                            value={offer.offered_ctc} onChange={e => setF('offered_ctc', e.target.value)}
                            placeholder="Enter monthly CTC" />
                          <p className="text-[10px] text-amber-600">No packages found. Enter manually.</p>
                          <Button variant="outline" size="sm" onClick={calcSalaryManual}
                            disabled={calcLoading || !offer.offered_ctc}
                            className="h-7 text-xs gap-1">
                            {calcLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Calculator className="h-3 w-3" />}
                            Calculate
                          </Button>
                        </div>
                      ) : (
                        <div className={SEL + ' flex items-center bg-slate-50 text-slate-400 text-xs border-dashed cursor-default'}>
                          Select a band first
                        </div>
                      )}
                    </FL>
                  </div>
                ) : (
                  <FL label="Proposed Monthly CTC (₹)" required>
                    <input type="number" className={SEL} style={{ backgroundColor: 'white', color: '#1e293b', borderColor: '#fbbf24' }}
                      value={proposedCtc} onChange={e => setProposedCtc(e.target.value)} placeholder="e.g. 18000" />
                  </FL>
                )}

                <FL label="Statutory Eligibility">
                  <div className="flex gap-4 h-10 items-center">
                    <label className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
                      <input type="checkbox" checked={offer.pf_eligible} onChange={e => setF('pf_eligible', e.target.checked)}
                        className="h-4 w-4 accent-blue-600 rounded cursor-pointer" />
                      PF
                    </label>
                    <label className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer">
                      <input type="checkbox" checked={offer.esi_eligible} onChange={e => setF('esi_eligible', e.target.checked)}
                        className="h-4 w-4 accent-blue-600 rounded cursor-pointer" />
                      ESI
                    </label>
                  </div>
                </FL>

              </div>

              {offerTab === 'proposed' && (
                <div className="mt-4">
                  <FL label="Reason for Exception" required>
                    <input className={SEL} style={{ backgroundColor: 'white', color: '#1e293b', borderColor: '#fbbf24' }}
                      value={proposedReason} onChange={e => setProposedReason(e.target.value)}
                      placeholder="e.g. Experienced candidate — skill premium negotiated" />
                  </FL>
                </div>
              )}

              {/* Salary Breakdown */}
              {calcLoading && (
                <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Calculating…
                </div>
              )}
              {salaryPreview && !calcLoading && (
                <div className="mt-5 pt-5 border-t border-slate-100">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="h-4 w-4 text-slate-400" />
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Monthly Salary Breakdown</p>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                    {[
                      { label: 'CTC / Gross',    value: salaryPreview.gross,            hl: 'blue' },
                      { label: 'Basic',           value: salaryPreview.basic },
                      { label: 'HRA',             value: salaryPreview.hra },
                      { label: 'Conveyance',      value: salaryPreview.conveyance },
                      { label: 'Special Allow.',  value: salaryPreview.special_allowance },
                      { label: 'Bonus',           value: salaryPreview.bonus },
                      { label: 'PF Employee',     value: salaryPreview.pf_employee,      ded: true },
                      { label: 'PF Employer',     value: salaryPreview.pf_employer },
                      { label: 'ESIC Employee',   value: salaryPreview.esic_employee,    ded: true },
                      { label: 'ESIC Employer',   value: salaryPreview.esic_employer },
                      { label: 'Prof. Tax',       value: salaryPreview.professional_tax, ded: true },
                      { label: 'Admin Charges',   value: salaryPreview.admin_charges },
                      { label: 'Net In-Hand',     value: salaryPreview.net_in_hand,      hl: 'emerald' },
                    ].map(item => (
                      <div key={item.label} className={`rounded-lg p-2.5 border text-center ${
                        item.hl === 'blue'    ? 'bg-blue-50 border-blue-100' :
                        item.hl === 'emerald' ? 'bg-emerald-50 border-emerald-100' :
                        item.ded             ? 'bg-red-50 border-red-100' :
                        'bg-slate-50 border-slate-100'
                      }`}>
                        <p className="text-[10px] text-slate-500 leading-none mb-1 truncate">{item.label}</p>
                        <p className={`font-bold text-xs tabular-nums ${
                          item.hl === 'blue'    ? 'text-blue-700' :
                          item.hl === 'emerald' ? 'text-emerald-700' :
                          item.ded             ? 'text-red-600' :
                          'text-slate-800'
                        }`}>{fmt(item.value ?? 0)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 px-5 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-xl">
              <Button variant="outline" onClick={() => submitOffer(false)} disabled={saving}
                className="h-10 px-6 border-slate-200 text-slate-700 font-semibold bg-white hover:bg-slate-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Save as Draft
              </Button>
              <Button onClick={() => submitOffer(true)}
                disabled={saving || !offer.date_of_joining || !offer.salary_band ||
                  (offerTab === 'proposed' && (!proposedCtc || !proposedReason))}
                className="h-10 px-8 bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-sm disabled:opacity-50">
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Submit to Branch Head
              </Button>
              {offerTab === 'proposed' && (
                <p className="text-xs text-amber-700 flex items-center gap-1.5 sm:ml-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Dual approval: Branch Head + Payroll Head
                </p>
              )}
            </div>
          </div>

          {/* Info Notice */}
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-dashed border-slate-200 bg-white text-sm">
            <FileCheck className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-500">
              <span className="font-semibold text-slate-600">Employee Code &amp; Activation — </span>
              Auto-generated when Branch Head approves. Branch and Process are carried forward from candidate profile.
            </p>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function InfoCell({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500 mb-0.5">{label}</p>
      <p className={`font-semibold text-slate-800 leading-tight ${small ? 'text-xs' : 'text-sm'}`}>{value}</p>
    </div>
  );
}

function FL({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs font-semibold text-slate-600 mb-1 block">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}
