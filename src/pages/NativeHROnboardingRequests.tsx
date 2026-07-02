import React, { useState, useEffect, useCallback } from 'react';
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
  branch_name: string; applied_for_process?: string; process_name?: string; offer_id?: string; offer_status?: string; offered_ctc?: number;
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
    name: r[nameKey] || r.dept_name || r.department_name || r.designation_name || r.process_name || r.band_name || '',
    code: r.dept_code || r.department_code || r.designation_code || r.band_code || '',
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

  // Candidate profile review panel
  const [profilePanel, setProfilePanel] = useState<{ candidateId: string; data: any } | null>(null);
  const [profilePanelLoading, setProfilePanelLoading] = useState(false);
  const [pushbackRemarks, setPushbackRemarks] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  // PF opt-out consent status for the currently open candidate
  const [candidateOnboardingProfile, setCandidateOnboardingProfile] = useState<any>(null);

  const [departments, setDepartments]   = useState<MasterItem[]>([]);
  const [designations, setDesignations] = useState<MasterItem[]>([]);
  type ManagerItem = { id: string; employee_code: string; full_name: string; branch_name?: string; cost_centre_code?: string; grade?: string };
  const [managers, setManagers]         = useState<ManagerItem[]>([]);
  const [managerSearch, setManagerSearch] = useState('');
  const [managerOpen, setManagerOpen]   = useState(false);
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

  }, []);

  // Cascading: cost centres by branch
  useEffect(() => {
    if (!selected?.branch_name) {
      setCostCentres([]);
      setManagers([]);
      return;
    }
    hrmsApi.get<unknown>(`/api/payroll-masters/cost-centres?branch=${encodeURIComponent(selected.branch_name)}`)
      .then((r: any) => setCostCentres((r?.data ?? []).map((c: any) => ({ ...c, branch_name: selected.branch_name }))))
      .catch(() => setCostCentres([]));
  }, [selected?.branch_name]);

  // Fetch managers from dedicated endpoint whenever branch or cost centre changes
  useEffect(() => {
    if (!selected?.branch_name) { setManagers([]); return; }
    const params = new URLSearchParams({ branch: selected.branch_name });
    if (offer.cost_centre) params.set('costCentre', offer.cost_centre);
    hrmsApi.get<unknown>(`/api/employees/managers?${params}`)
      .then((r: any) => setManagers(r?.data ?? []))
      .catch(() => setManagers([]));
  }, [selected?.branch_name, offer.cost_centre]);

  // Cascading: packages by branch + cost centre + band
  useEffect(() => {
    if (!selected?.branch_name || !offer.salary_band) { setPackages([]); setSelectedPackage(null); return; }
    const params = new URLSearchParams({ branch: selected.branch_name, band: offer.salary_band });
    if (offer.cost_centre) params.set('costCentre', offer.cost_centre);
    hrmsApi.get<unknown>(`/api/payroll-masters/packages?${params}`)
      .then((r: any) => { setPackages(r?.data ?? []); setSelectedPackage(null); setSalaryPreview(null); })
      .catch(() => setPackages([]));
  }, [selected?.branch_name, offer.cost_centre, offer.salary_band]);

  // Close manager dropdown on outside click
  useEffect(() => {
    if (!managerOpen) return;
    const handler = () => setManagerOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [managerOpen]);

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
    setCandidateOnboardingProfile(null);
    setOfferTab('standard');
    setProposedCtc('');
    setProposedReason('');
    setSalaryPreview(null);
    setSelectedPackage(null);
    setManagerOpen(false);
    setManagerSearch('');
    setOffer({
      emp_type: 'OnRoll', date_of_joining: '', date_of_salary: '',
      cost_centre: '', role_type: 'Analyst', salary_band: '',
      offered_ctc: '', department_id: '', designation_id: '', reporting_manager_id: '',
      pf_eligible: true, esi_eligible: true, selected_package_id: '',
    });
    hrmsApi.get<unknown>(`/api/ats/bgv/status?candidateId=${row.candidate_id}`)
      .then((r: any) => { const d = r?.data ?? r; if (d && typeof d === 'object') setBgv(d as BgvData); })
      .catch(() => {});
    // Fetch onboarding profile to display PF opt-out consent status (non-blocking)
    hrmsApi.get<unknown>(`/api/ats/onboarding-full/candidate/${row.candidate_id}`)
      .then((r: any) => { const prof = r?.data?.profile ?? r?.profile ?? null; if (prof) setCandidateOnboardingProfile(prof); })
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

  const openProfilePanel = async (candidateId: string) => {
    setProfilePanelLoading(true);
    setPushbackRemarks('');
    setProfilePanel({ candidateId, data: null });
    try {
      const r = await hrmsApi.get<any>(`/api/ats/onboarding-full/candidate/${candidateId}`);
      setProfilePanel({ candidateId, data: r?.data ?? r });
    } catch { setProfilePanel(null); }
    finally { setProfilePanelLoading(false); }
  };

  const submitReview = async (status: 'approved' | 'hr_review') => {
    if (!profilePanel) return;
    if (status === 'hr_review' && !pushbackRemarks.trim()) {
      alert('Please enter remarks explaining what needs to be corrected.');
      return;
    }
    setReviewSaving(true);
    try {
      await hrmsApi.patch(`/api/ats/onboarding-full/candidate/${profilePanel.candidateId}/review`, {
        status,
        remarks: pushbackRemarks.trim() || undefined,
      });
      setProfilePanel(null);
      await load();
    } catch (e: any) { alert(e?.message ?? 'Failed to save review'); }
    finally { setReviewSaving(false); }
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
                            <p className="text-slate-400 text-[11px]">{r.applied_for_process || r.process_name || '—'}</p>
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
                            <div className="flex items-center gap-2">
                              <Button size="sm" variant="outline" onClick={() => openProfilePanel(r.candidate_id)}
                                className="h-8 gap-1 border-slate-200 text-slate-600 text-xs px-2.5">
                                <FileCheck className="h-3.5 w-3.5" /> View
                              </Button>
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
                            </div>
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

      {/* Candidate Profile Review Panel */}
      {profilePanel !== null && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setProfilePanel(null)} />
          <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
              <h2 className="font-bold text-slate-900 text-base">Candidate Profile Review</h2>
              <button onClick={() => setProfilePanel(null)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
            </div>
            {profilePanelLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : profilePanel.data ? (() => {
              const p = profilePanel.data.profile ?? {};
              const bank = profilePanel.data.bank ?? {};
              const docs: any[] = profilePanel.data.documents ?? [];
              const quals: any[] = profilePanel.data.qualifications ?? [];
              const exp = profilePanel.data.experience ?? {};
              const fmtBool = (v: any) => v ? 'Yes' : v === 0 ? 'No' : '—';
              const Row = ({ label, value }: { label: string; value: any }) => (
                <div className="flex py-1.5 border-b border-slate-50 last:border-0">
                  <span className="text-xs text-slate-400 w-40 shrink-0">{label}</span>
                  <span className="text-xs text-slate-800 font-medium break-all">{value ?? '—'}</span>
                </div>
              );
              const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
                <div className="px-5 py-4 border-b border-slate-100">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">{title}</p>
                  {children}
                </div>
              );
              return (
                <>
                  <Section title="Personal Details">
                    <Row label="Full Name" value={p.full_name_aadhaar || p.full_name} />
                    <Row label="Date of Birth" value={p.date_of_birth} />
                    <Row label="Gender" value={p.gender} />
                    <Row label="Marital Status" value={p.marital_status} />
                    <Row label="Blood Group" value={p.blood_group} />
                    <Row label="Father's Name" value={p.father_name} />
                    <Row label="Mother's Name" value={p.mother_name} />
                    <Row label="Mobile" value={p.mobile} />
                    <Row label="Alternate Mobile" value={p.alt_mobile_number || p.alternate_mobile} />
                    <Row label="Personal Email" value={p.personal_email_id} />
                  </Section>
                  <Section title="Address">
                    <Row label="Current Address" value={p.present_address || p.current_address} />
                    <Row label="Permanent Address" value={p.permanent_address} />
                    <Row label="City / State" value={[p.city, p.state].filter(Boolean).join(', ')} />
                    <Row label="PIN Code" value={p.pin_code} />
                  </Section>
                  <Section title="Identity Documents">
                    <Row label="Aadhaar" value={p.aadhar_number || p.aadhaar_number} />
                    <Row label="PAN" value={p.pan_number} />
                    <Row label="Voter ID" value={p.voter_id} />
                    <Row label="Driving Licence" value={p.driving_license} />
                    <Row label="Passport" value={p.passport_number} />
                    <Row label="UAN" value={p.uan_number} />
                    <Row label="ESIC" value={p.esic_number} />
                  </Section>
                  <Section title="Bank Details">
                    <Row label="Bank Name" value={bank.bank_name} />
                    <Row label="Account Number" value={bank.account_number} />
                    <Row label="IFSC" value={bank.ifsc_code} />
                    <Row label="Account Type" value={bank.account_type} />
                  </Section>
                  {quals.length > 0 && (
                    <Section title="Qualifications">
                      {quals.map((q: any, i: number) => (
                        <div key={i} className="mb-2 pb-2 border-b border-slate-50 last:border-0">
                          <Row label="Degree" value={q.degree_name || q.qualification} />
                          <Row label="Institute" value={q.institute_name || q.institution} />
                          <Row label="Year" value={q.passing_year} />
                          <Row label="Score" value={q.percentage_cgpa} />
                        </div>
                      ))}
                    </Section>
                  )}
                  {(exp.company_name || exp.previous_employer) && (
                    <Section title="Work Experience">
                      <Row label="Previous Employer" value={exp.company_name || exp.previous_employer} />
                      <Row label="Designation" value={exp.designation || exp.previous_designation} />
                      <Row label="Duration" value={exp.duration_months ? `${exp.duration_months} months` : exp.duration} />
                      <Row label="Last CTC" value={exp.last_ctc} />
                    </Section>
                  )}
                  <Section title="Emergency Contact">
                    <Row label="Name" value={p.emergency_contact_name} />
                    <Row label="Relation" value={p.emergency_contact_relation} />
                    <Row label="Mobile" value={p.emergency_contact_number || p.emergency_contact_mobile} />
                  </Section>
                  <Section title="Statutory">
                    <Row label="PF Member (prev)" value={fmtBool(p.previous_pf_member)} />
                    <Row label="EPS Member" value={fmtBool(p.eps_member)} />
                    <Row label="Int'l Worker" value={fmtBool(p.international_worker)} />
                    <div className="mt-2">
                      {Number(p.pf_opt_out_elected) === 1 ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
                          ✓ PF Opt-Out Elected (Form 11)
                          {p.pf_opt_out_consented_at && <span className="font-normal opacity-70">· {new Date(p.pf_opt_out_consented_at).toLocaleDateString('en-IN')}</span>}
                        </span>
                      ) : p.pf_opt_out_elected === 0 ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                          PF Deductions Apply (candidate chose standard)
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                          ⏳ Awaiting Form 11 declaration from candidate
                        </span>
                      )}
                    </div>
                  </Section>
                  {docs.length > 0 && (
                    <Section title={`Uploaded Documents (${docs.length})`}>
                      {docs.map((d: any, i: number) => (
                        <div key={i} className="flex items-center justify-between py-1">
                          <span className="text-xs text-slate-700">{d.document_type || d.doc_type || `Document ${i + 1}`}</span>
                          {d.file_url && (
                            <a href={d.file_url} target="_blank" rel="noreferrer"
                              className="text-xs text-blue-600 hover:underline">View</a>
                          )}
                        </div>
                      ))}
                    </Section>
                  )}

                  {/* Pushback / Approve actions */}
                  <div className="px-5 py-4 sticky bottom-0 bg-white border-t border-slate-200 space-y-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-600 block mb-1.5">
                        Push-back Remarks <span className="text-slate-400 font-normal">(required if pushing back)</span>
                      </label>
                      <textarea
                        rows={2}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                        placeholder="e.g. Address proof missing, DOB mismatch with Aadhaar…"
                        value={pushbackRemarks}
                        onChange={e => setPushbackRemarks(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-3">
                      <Button variant="outline" size="sm" disabled={reviewSaving}
                        onClick={() => submitReview('hr_review')}
                        className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50 gap-1.5">
                        {reviewSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                        Push Back for Edit
                      </Button>
                      <Button size="sm" disabled={reviewSaving}
                        onClick={() => submitReview('approved')}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
                        {reviewSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Approve Profile
                      </Button>
                    </div>
                  </div>
                </>
              );
            })() : (
              <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
                Could not load profile data.
              </div>
            )}
          </div>
        </div>
      )}
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
                <InfoCell label="Process/LOB" value={selected.applied_for_process || selected.process_name || '—'} />
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
                    <span className="truncate text-xs">{selected?.applied_for_process || selected?.process_name || '—'}</span>
                  </div>
                </FL>

                <FL label={`Reporting Manager${managers.length > 0 ? ` (${managers.length})` : ''}`}>
                  {(() => {
                    const selectedMgr = managers.find(m => m.id === offer.reporting_manager_id);
                    const filteredMgrs = managerSearch.trim()
                      ? managers.filter(m =>
                          m.full_name.toLowerCase().includes(managerSearch.toLowerCase()) ||
                          m.employee_code.toLowerCase().includes(managerSearch.toLowerCase())
                        )
                      : managers;
                    return (
                      <div className="relative">
                        <div
                          className={SEL + ' flex items-center justify-between cursor-pointer'}
                          style={{ backgroundColor: 'white', color: '#1e293b' }}
                          onClick={() => setManagerOpen(o => !o)}
                        >
                          <span className={selectedMgr ? 'text-slate-900' : 'text-slate-400'}>
                            {selectedMgr
                              ? `${selectedMgr.full_name} · ${selectedMgr.employee_code}`
                              : '— Select —'}
                          </span>
                          <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        </div>
                        {managerOpen && (
                          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg">
                            <div className="p-2 border-b border-slate-100">
                              <input
                                autoFocus
                                type="text"
                                placeholder="Search by name or code…"
                                value={managerSearch}
                                onChange={e => setManagerSearch(e.target.value)}
                                className="w-full h-8 px-3 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                onClick={e => e.stopPropagation()}
                              />
                            </div>
                            <div className="max-h-52 overflow-y-auto">
                              <div
                                className="px-3 py-2 text-sm text-slate-400 hover:bg-slate-50 cursor-pointer"
                                onClick={() => { setF('reporting_manager_id', ''); setManagerOpen(false); setManagerSearch(''); }}
                              >
                                — None —
                              </div>
                              {filteredMgrs.length === 0 && (
                                <div className="px-3 py-2 text-xs text-slate-400">No results</div>
                              )}
                              {filteredMgrs.map(m => (
                                <div
                                  key={m.id}
                                  className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 ${offer.reporting_manager_id === m.id ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-800'}`}
                                  onClick={() => { setF('reporting_manager_id', m.id); setManagerOpen(false); setManagerSearch(''); }}
                                >
                                  <span className="font-medium">{m.full_name}</span>
                                  <span className="ml-2 text-xs text-slate-400">{m.employee_code}</span>
                                  {m.grade && <span className="ml-2 text-xs text-blue-500">Grade {m.grade}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
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

                <FL label="PF Status">
                  {(() => {
                    const prof = candidateOnboardingProfile ?? {};
                    const elected = Number(prof.pf_opt_out_elected) === 1;
                    const consentAt = prof.pf_opt_out_consented_at;
                    const notStarted = prof.pf_opt_out_elected == null;
                    return (
                      <div className="h-10 flex items-center">
                        {elected ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
                            ✓ PF Opt-Out Elected (Form 11)
                            {consentAt && <span className="font-normal opacity-70">· {new Date(consentAt).toLocaleDateString('en-IN')}</span>}
                          </span>
                        ) : notStarted ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                            ⏳ Awaiting candidate Form 11 declaration
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                            PF Deductions Apply
                          </span>
                        )}
                      </div>
                    );
                  })()}
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
