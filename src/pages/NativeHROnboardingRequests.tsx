import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  Briefcase,
  Calculator,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Download,
  Eye,
  FileCheck,
  IndianRupee,
  Loader2,
  Search,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

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
  applied_for_process?: string;
  process_name?: string;
  offer_id?: string;
  offer_status?: string;
  offered_ctc?: number;
  documents_uploaded?: number;
  bank_verification_status?: string;
}

interface BgvCheckItem { check_type: string; status: string; result_summary?: string; }
interface BgvData { score?: number; checks?: BgvCheckItem[]; overall_status?: string; }
interface MasterItem { id: string; name: string; code?: string; }
interface SalaryBand { id: string; band_code: string; band_name: string; min_ctc: number; max_ctc: number; }
interface SalaryPreview {
  gross: number;
  basic: number;
  hra: number;
  conveyance?: number;
  special_allowance?: number;
  bonus?: number;
  pf_employee: number;
  pf_employer: number;
  esic_employee: number;
  esic_employer: number;
  professional_tax: number;
  net_in_hand: number;
  admin_charges?: number;
}

type ManagerItem = { id: string; employee_code: string; full_name: string; grade?: string };
type DocumentPreview = { id: string; title: string; mimeType?: string; downloadAllowed: boolean };

const SEL = 'w-full min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
const ERR = 'mt-1 text-xs font-medium text-red-600';

function rowsFrom(payload: unknown): OnboardingRequest[] {
  if (Array.isArray(payload)) return payload as OnboardingRequest[];
  const data = (payload as { data?: unknown })?.data;
  return Array.isArray(data) ? data as OnboardingRequest[] : [];
}

function masterFrom(payload: unknown, nameKey = 'name'): MasterItem[] {
  const arr = Array.isArray(payload) ? payload : (payload as any)?.data ?? [];
  return (Array.isArray(arr) ? arr : []).map((r: any) => ({
    id: String(r.id ?? ''),
    name: String(r[nameKey] || r.dept_name || r.department_name || r.designation_name || r.process_name || r.band_name || r.full_name || ''),
    code: String(r.dept_code || r.department_code || r.designation_code || r.band_code || r.employee_code || ''),
  })).filter((x: MasterItem) => x.id && x.name);
}

function maskMobile(v?: string): string {
  if (!v || v.length < 6) return v || '—';
  return `${v.slice(0, 3)}XXXXX${v.slice(-3)}`;
}
function maskEmail(v?: string): string {
  if (!v) return '—';
  const at = v.indexOf('@');
  if (at < 2) return v;
  return `${v[0]}*****${v.slice(at - 1)}`;
}
function maskId(v?: string): string {
  if (!v) return '—';
  return v.length > 6 ? `XXXXXX${v.slice(-4)}` : 'XXXXXX';
}
function fmt(v?: number | string | null): string {
  const n = Number(v ?? 0);
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}
function statusLabel(v?: string): string {
  return String(v || 'pending').replace(/_/g, ' ');
}
function canDownloadDocs(role: string): boolean {
  return ['admin', 'super_admin', 'hr', 'payroll_hr', 'payroll'].includes(role);
}

function ErrorBanner({ message, onRetry }: { message: string | null; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-3">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="font-semibold">{message}</p>
        {onRetry && <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-2 min-h-[44px] bg-white">Retry</Button>}
      </div>
    </div>
  );
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}{required && <span className="ml-1 text-red-500">*</span>}
      </span>
      {children}
      {error && <p className={ERR}>{error}</p>}
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-slate-50 py-2 last:border-0">
      <span className="w-36 shrink-0 text-xs font-medium text-slate-400">{label}</span>
      <span className="min-w-0 break-words text-xs font-semibold text-slate-800">{value || '—'}</span>
    </div>
  );
}

export default function NativeHROnboardingRequests() {
  const { user } = useAuth();
  const role = String((user as any)?.role ?? '').toLowerCase();
  const allowed = ['admin', 'super_admin', 'hr', 'manager', 'payroll_hr', 'payroll'].includes(role);

  const [rows, setRows] = useState<OnboardingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterBranch, setFilterBranch] = useState('');

  const [selected, setSelected] = useState<OnboardingRequest | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [pushbackRemarks, setPushbackRemarks] = useState('');
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null);

  const [bgv, setBgv] = useState<BgvData | null>(null);
  const [departments, setDepartments] = useState<MasterItem[]>([]);
  const [designations, setDesignations] = useState<MasterItem[]>([]);
  const [costCentres, setCostCentres] = useState<any[]>([]);
  const [managers, setManagers] = useState<ManagerItem[]>([]);
  const [salaryBands, setSalaryBands] = useState<SalaryBand[]>([]);
  const [packages, setPackages] = useState<any[]>([]);
  const [salaryPreview, setSalaryPreview] = useState<SalaryPreview | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [offerTab, setOfferTab] = useState<'standard' | 'proposed'>('standard');
  const [formError, setFormError] = useState<string | null>(null);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string>>({});
  const [proposedCtc, setProposedCtc] = useState('');
  const [proposedReason, setProposedReason] = useState('');
  const [offer, setOffer] = useState({
    emp_type: 'OnRoll',
    date_of_joining: '',
    date_of_salary: '',
    cost_centre: '',
    role_type: 'Analyst',
    salary_band: '',
    offered_ctc: '',
    department_id: '',
    designation_id: '',
    reporting_manager_id: '',
    pf_eligible: true,
    esi_eligible: true,
    selected_package_id: '',
  });

  const setF = (key: keyof typeof offer, value: unknown) => setOffer((p) => ({ ...p, [key]: value }));

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await hrmsApi.get<unknown>('/api/ats/onboarding/requests');
      setRows(rowsFrom(r));
    } catch (e: any) {
      setLoadError(e?.message || 'Unable to load onboarding requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    hrmsApi.get<unknown>('/api/org/departments?active=1').then((r) => setDepartments(masterFrom(r, 'department_name'))).catch(() => setDepartments([]));
    hrmsApi.get<unknown>('/api/org/designations?active=1').then((r) => setDesignations(masterFrom(r, 'designation_name'))).catch(() => setDesignations([]));
    hrmsApi.get<unknown>('/api/payroll-masters/bands').then((r: any) => {
      const arr = r?.data ?? (Array.isArray(r) ? r : []);
      setSalaryBands((Array.isArray(arr) ? arr : []).map((b: any) => ({
        id: String(b.id ?? b.band_code),
        band_code: String(b.band_code ?? ''),
        band_name: String(b.band_name ?? b.band_code ?? ''),
        min_ctc: Number(b.slab_from ?? b.min_ctc ?? 0),
        max_ctc: Number(b.slab_to ?? b.max_ctc ?? 0),
      })));
    }).catch(() => setSalaryBands([]));
  }, []);

  useEffect(() => {
    if (!selected?.branch_name) { setCostCentres([]); setManagers([]); return; }
    hrmsApi.get<unknown>(`/api/payroll-masters/cost-centres?branch=${encodeURIComponent(selected.branch_name)}`)
      .then((r: any) => setCostCentres(r?.data ?? []))
      .catch(() => setCostCentres([]));
    hrmsApi.get<unknown>(`/api/employees/managers?branch=${encodeURIComponent(selected.branch_name)}`)
      .then((r: any) => setManagers(r?.data ?? []))
      .catch(() => setManagers([]));
  }, [selected?.branch_name]);

  useEffect(() => {
    if (!selected?.branch_name || !offer.salary_band) { setPackages([]); return; }
    const params = new URLSearchParams({ branch: selected.branch_name, band: offer.salary_band });
    if (offer.cost_centre) params.set('costCentre', offer.cost_centre);
    hrmsApi.get<unknown>(`/api/payroll-masters/packages?${params}`)
      .then((r: any) => setPackages(r?.data ?? []))
      .catch(() => setPackages([]));
  }, [selected?.branch_name, offer.salary_band, offer.cost_centre]);

  const filtered = useMemo(() => {
    let list = rows;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        r.full_name?.toLowerCase().includes(q) ||
        r.candidate_code?.toLowerCase().includes(q) ||
        r.email?.toLowerCase().includes(q) ||
        r.mobile?.includes(q) ||
        r.branch_name?.toLowerCase().includes(q)
      );
    }
    if (filterStatus === 'pending_offer') list = list.filter((r) => r.profile_status === 'profile_submitted' && !r.offer_status);
    if (filterStatus === 'offered') list = list.filter((r) => !!r.offer_status);
    if (filterStatus === 'onboarded') list = list.filter((r) => r.status === 'onboarded');
    if (filterBranch) list = list.filter((r) => r.branch_name === filterBranch);
    return list;
  }, [rows, search, filterStatus, filterBranch]);

  const branchOptions = useMemo(() => [...new Set(rows.map((r) => r.branch_name).filter(Boolean))].sort(), [rows]);

  const resetOffer = () => {
    setOffer({
      emp_type: 'OnRoll', date_of_joining: '', date_of_salary: '', cost_centre: '', role_type: 'Analyst', salary_band: '',
      offered_ctc: '', department_id: '', designation_id: '', reporting_manager_id: '', pf_eligible: true, esi_eligible: true, selected_package_id: '',
    });
    setOfferTab('standard');
    setProposedCtc('');
    setProposedReason('');
    setSalaryPreview(null);
    setFormError(null);
    setFormFieldErrors({});
  };

  const openOffer = (row: OnboardingRequest) => {
    setSelected(row);
    setProfile(null);
    setBgv(null);
    resetOffer();
    hrmsApi.get<unknown>(`/api/ats/bgv/status/${row.candidate_id}`).then((r: any) => setBgv(r?.data ?? r)).catch(() => setBgv({ overall_status: 'unavailable' }));
  };

  const openProfile = async (row: OnboardingRequest) => {
    setSelected(null);
    setProfile(null);
    setProfileError(null);
    setReviewError(null);
    setPushbackRemarks('');
    setProfileLoading(true);
    try {
      const r = await hrmsApi.get<any>(`/api/ats/onboarding-full/candidate/${row.candidate_id}`);
      setProfile({ row, data: r?.data ?? r });
    } catch (e: any) {
      setProfileError(e?.message || 'Unable to load candidate profile.');
      setProfile({ row, data: null });
    } finally {
      setProfileLoading(false);
    }
  };

  const calcSalaryManual = async () => {
    setFormError(null);
    if (!offer.offered_ctc || !offer.salary_band) {
      setFormError('Enter CTC and salary band before calculating salary.');
      return;
    }
    setCalcLoading(true);
    try {
      const r = await hrmsApi.post<{ components?: SalaryPreview }>('/api/ats/onboarding/calculate-salary', {
        ctc: Number(offer.offered_ctc) * 12,
        bandCode: offer.salary_band,
      });
      setSalaryPreview(r.components ?? null);
    } catch (e: any) {
      setFormError(e?.message || 'Salary calculation failed.');
    } finally {
      setCalcLoading(false);
    }
  };

  const selectPackage = (id: string) => {
    const pkg = packages.find((p) => String(p.id) === id);
    setF('selected_package_id', id);
    if (!pkg) return;
    setF('offered_ctc', String(pkg.package_amount ?? pkg.gross ?? ''));
    setSalaryPreview({
      gross: Number(pkg.gross ?? pkg.package_amount ?? 0),
      basic: Number(pkg.basic ?? 0),
      hra: Number(pkg.hra ?? 0),
      conveyance: Number(pkg.conveyance ?? 0),
      special_allowance: Number(pkg.special_allowance ?? 0),
      bonus: Number(pkg.bonus ?? 0),
      pf_employee: Number(pkg.epf_employee ?? pkg.pf_employee ?? 0),
      pf_employer: Number(pkg.epf_employer ?? pkg.pf_employer ?? 0),
      esic_employee: Number(pkg.esic_employee ?? 0),
      esic_employer: Number(pkg.esic_employer ?? 0),
      professional_tax: Number(pkg.professional_tax ?? 0),
      net_in_hand: Number(pkg.net_in_hand ?? 0),
      admin_charges: Number(pkg.admin_charges ?? 0),
    });
  };

  const validateOffer = () => {
    const errors: Record<string, string> = {};
    const isProposed = offerTab === 'proposed';
    if (!offer.date_of_joining) errors.date_of_joining = 'Date of joining is required.';
    if (!offer.department_id) errors.department_id = 'Department is required.';
    if (!offer.designation_id) errors.designation_id = 'Designation is required.';
    if (!offer.cost_centre) errors.cost_centre = 'Cost centre is required.';
    if (!offer.reporting_manager_id) errors.reporting_manager_id = 'Reporting manager is required.';
    if (!offer.salary_band) errors.salary_band = 'Salary band is required.';
    if (isProposed) {
      if (!proposedCtc) errors.proposed_ctc = 'Proposed CTC is required.';
      if (!proposedReason.trim()) errors.proposed_reason = 'Exception reason is required.';
    } else if (!offer.offered_ctc) {
      errors.offered_ctc = 'Package or monthly CTC is required.';
    }
    setFormFieldErrors(errors);
    if (Object.keys(errors).length) {
      setFormError('Please fix the highlighted fields before submitting the offer.');
      return false;
    }
    return true;
  };

  const submitOffer = async (submit: boolean) => {
    if (!selected || !validateOffer()) return;
    setSaving(true);
    setFormError(null);
    try {
      const isProposed = offerTab === 'proposed';
      const monthlyCtc = isProposed ? Number(proposedCtc) : Number(offer.offered_ctc);
      await hrmsApi.post(`/api/ats/onboarding/requests/${selected.id}/offer`, {
        ...offer,
        offered_ctc: monthlyCtc * 12,
        submit,
        is_proposed_exception: isProposed,
        proposed_reason: isProposed ? proposedReason.trim() : null,
      });
      await load();
      setSelected(null);
    } catch (e: any) {
      setFormError(e?.message || 'Failed to save offer.');
    } finally {
      setSaving(false);
    }
  };

  const submitReview = async (status: 'approved' | 'hr_review') => {
    if (!profile?.row) return;
    setReviewError(null);
    if (status === 'hr_review' && !pushbackRemarks.trim()) {
      setReviewError('Push-back remarks are required.');
      return;
    }
    setReviewSaving(true);
    try {
      await hrmsApi.patch(`/api/ats/onboarding-full/candidate/${profile.row.candidate_id}/review`, {
        status,
        remarks: pushbackRemarks.trim() || undefined,
      });
      setProfile(null);
      await load();
    } catch (e: any) {
      setReviewError(e?.message || 'Failed to save review.');
    } finally {
      setReviewSaving(false);
    }
  };

  if (user && !allowed) {
    return <DashboardLayout><div className="p-8 text-center font-bold text-red-600">You do not have access to this page.</div></DashboardLayout>;
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50/60 p-4 sm:p-6">
        {!selected && (
          <div className="space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-blue-600">HR · ATS Onboarding</p>
                <h1 className="text-2xl font-bold text-slate-900">Onboarding Requests</h1>
                <p className="text-sm text-slate-500">Review candidate profiles, push back corrections, and create offers.</p>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search candidates…" className={`${SEL} pl-9`} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {[
                ['Total', rows.length, Users],
                ['Pending Offer', rows.filter((r) => r.profile_status === 'profile_submitted' && !r.offer_status).length, Clock],
                ['Offered', rows.filter((r) => !!r.offer_status).length, Send],
                ['Onboarded', rows.filter((r) => r.status === 'onboarded').length, CheckCircle2],
              ].map(([label, value, Icon]: any) => (
                <div key={label} className="rounded-xl border bg-white p-4 shadow-sm">
                  <Icon className="mb-2 h-4 w-4 text-blue-600" />
                  <p className="text-xl font-bold text-slate-900">{value}</p>
                  <p className="text-xs font-semibold text-slate-500">{label}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <select className={SEL} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All Statuses</option>
                <option value="pending_offer">Pending Offer</option>
                <option value="offered">Offered</option>
                <option value="onboarded">Onboarded</option>
              </select>
              <select className={SEL} value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}>
                <option value="">All Branches</option>
                {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            <ErrorBanner message={loadError} onRetry={() => void load()} />

            {loading ? (
              <div className="flex h-64 items-center justify-center rounded-xl border bg-white"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : !filtered.length && !loadError ? (
              <div className="rounded-xl border bg-white py-16 text-center text-slate-500">No onboarding requests found.</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((r) => (
                  <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">{r.full_name}</p>
                        <p className="font-mono text-[11px] text-slate-400">{r.candidate_code}</p>
                      </div>
                      <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold capitalize text-blue-700">{statusLabel(r.profile_status)}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <p><span className="text-slate-400">Branch:</span> {r.branch_name || '—'}</p>
                      <p><span className="text-slate-400">Process:</span> {r.process_name || r.applied_for_process || '—'}</p>
                      <p><span className="text-slate-400">Mobile:</span> {maskMobile(r.mobile)}</p>
                      <p><span className="text-slate-400">Email:</span> {maskEmail(r.email)}</p>
                      <p><span className="text-slate-400">Docs:</span> {r.documents_uploaded ?? 0}</p>
                      <p><span className="text-slate-400">Bank:</span> {statusLabel(r.bank_verification_status)}</p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
                      <Button type="button" variant="outline" size="sm" onClick={() => void openProfile(r)} className="min-h-[44px] flex-1 gap-1.5">
                        <FileCheck className="h-3.5 w-3.5" /> Review
                      </Button>
                      {r.profile_status === 'profile_submitted' && !r.offer_status && (
                        <Button type="button" size="sm" onClick={() => openOffer(r)} className="min-h-[44px] flex-1 gap-1.5 bg-blue-600 text-white hover:bg-blue-700">
                          <UserPlus className="h-3.5 w-3.5" /> Offer
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {selected && (
          <div className="space-y-5">
            <button type="button" onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-blue-600">
              <ChevronLeft className="h-4 w-4" /> Back to onboarding requests
            </button>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border bg-white p-5 shadow-sm lg:col-span-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{selected.full_name}</h2>
                    <p className="font-mono text-xs text-slate-400">{selected.candidate_code}</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Profile Submitted</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm text-slate-600 sm:grid-cols-4">
                  <p><span className="block text-xs text-slate-400">Mobile</span>{maskMobile(selected.mobile)}</p>
                  <p><span className="block text-xs text-slate-400">Email</span>{maskEmail(selected.email)}</p>
                  <p><span className="block text-xs text-slate-400">Branch</span>{selected.branch_name || '—'}</p>
                  <p><span className="block text-xs text-slate-400">Process</span>{selected.process_name || selected.applied_for_process || '—'}</p>
                </div>
              </div>

              <div className="rounded-xl border bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-blue-600" /><p className="font-bold text-slate-800">BGV Status</p></div>
                {!bgv ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <p className="text-sm font-semibold capitalize text-slate-600">{statusLabel(bgv.overall_status || 'status loaded')}</p>}
              </div>
            </div>

            <div className="rounded-xl border bg-white shadow-sm">
              <div className="border-b px-5 py-4"><h3 className="font-bold text-slate-900">Employment Offer</h3></div>
              <div className="space-y-5 p-5">
                <ErrorBanner message={formError} />
                <div className="flex gap-2">
                  <Button type="button" variant={offerTab === 'standard' ? 'default' : 'outline'} onClick={() => setOfferTab('standard')} className="min-h-[44px]">Standard Package</Button>
                  <Button type="button" variant={offerTab === 'proposed' ? 'default' : 'outline'} onClick={() => setOfferTab('proposed')} className="min-h-[44px]">Exception Package</Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Date of Joining" required error={formFieldErrors.date_of_joining}><input type="date" className={SEL} value={offer.date_of_joining} onChange={(e) => setF('date_of_joining', e.target.value)} /></Field>
                  <Field label="Salary Start Date"><input type="date" className={SEL} value={offer.date_of_salary} onChange={(e) => setF('date_of_salary', e.target.value)} /></Field>
                  <Field label="Employment Type"><select className={SEL} value={offer.emp_type} onChange={(e) => setF('emp_type', e.target.value)}><option>OnRoll</option><option>OffRoll</option><option>CONTRACT</option><option>MGMT. TRAINEE</option></select></Field>
                  <Field label="Role Type"><select className={SEL} value={offer.role_type} onChange={(e) => setF('role_type', e.target.value)}><option>Analyst</option><option>SupportStaff</option></select></Field>
                  <Field label="Department" required error={formFieldErrors.department_id}><select className={SEL} value={offer.department_id} onChange={(e) => setF('department_id', e.target.value)}><option value="">Select</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
                  <Field label="Designation" required error={formFieldErrors.designation_id}><select className={SEL} value={offer.designation_id} onChange={(e) => setF('designation_id', e.target.value)}><option value="">Select</option>{designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
                  <Field label="Cost Centre" required error={formFieldErrors.cost_centre}><select className={SEL} value={offer.cost_centre} onChange={(e) => setF('cost_centre', e.target.value)}><option value="">Select</option>{costCentres.map((c) => <option key={c.id || c.cost_centre_code} value={c.id || c.cost_centre_code}>{c.display_name || c.cost_centre_code}</option>)}</select></Field>
                  <Field label="Reporting Manager" required error={formFieldErrors.reporting_manager_id}><select className={SEL} value={offer.reporting_manager_id} onChange={(e) => setF('reporting_manager_id', e.target.value)}><option value="">Select</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.full_name} · {m.employee_code}</option>)}</select></Field>
                  <Field label="Salary Band" required error={formFieldErrors.salary_band}><select className={SEL} value={offer.salary_band} onChange={(e) => setF('salary_band', e.target.value)}><option value="">Select</option>{salaryBands.map((b) => <option key={b.band_code} value={b.band_code}>{b.band_name || b.band_code} · {fmt(b.min_ctc)}–{fmt(b.max_ctc)}</option>)}</select></Field>
                  {offerTab === 'standard' ? (
                    <>
                      <Field label="Salary Package"><select className={SEL} value={offer.selected_package_id} onChange={(e) => selectPackage(e.target.value)}><option value="">Manual / Select</option>{packages.map((p) => <option key={p.id} value={p.id}>{fmt(p.package_amount)} / month · In-hand {fmt(p.net_in_hand)}</option>)}</select></Field>
                      <Field label="Monthly CTC" required error={formFieldErrors.offered_ctc}><input inputMode="numeric" className={SEL} value={offer.offered_ctc} onChange={(e) => setF('offered_ctc', e.target.value)} placeholder="e.g. 18000" /></Field>
                    </>
                  ) : (
                    <>
                      <Field label="Proposed Monthly CTC" required error={formFieldErrors.proposed_ctc}><input inputMode="numeric" className={SEL} value={proposedCtc} onChange={(e) => setProposedCtc(e.target.value)} placeholder="e.g. 18000" /></Field>
                      <Field label="Exception Reason" required error={formFieldErrors.proposed_reason}><input className={SEL} value={proposedReason} onChange={(e) => setProposedReason(e.target.value)} placeholder="Skill premium / approval reason" /></Field>
                    </>
                  )}
                </div>

                <Button type="button" variant="outline" onClick={() => void calcSalaryManual()} disabled={calcLoading || !offer.offered_ctc || !offer.salary_band} className="min-h-[44px] gap-2">
                  {calcLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />} Calculate Salary
                </Button>

                {salaryPreview && (
                  <div className="grid gap-2 rounded-xl border bg-slate-50 p-4 sm:grid-cols-3 lg:grid-cols-6">
                    {[
                      ['Gross', salaryPreview.gross], ['Basic', salaryPreview.basic], ['HRA', salaryPreview.hra], ['PF Emp.', salaryPreview.pf_employee], ['ESIC Emp.', salaryPreview.esic_employee], ['Net In-hand', salaryPreview.net_in_hand],
                    ].map(([label, value]) => <div key={label as string} className="rounded-lg bg-white p-3 text-center"><p className="text-[10px] font-bold uppercase text-slate-400">{label}</p><p className="text-sm font-bold text-slate-900">{fmt(value as number)}</p></div>)}
                  </div>
                )}
              </div>
              <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-white p-4 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => void submitOffer(false)} disabled={saving} className="min-h-[44px] gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Draft</Button>
                <Button type="button" onClick={() => void submitOffer(true)} disabled={saving} className="min-h-[44px] gap-2 bg-blue-600 text-white hover:bg-blue-700">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit to Branch Head</Button>
              </div>
            </div>
          </div>
        )}

        {profile && (
          <div className="fixed inset-0 z-50 flex bg-black/40">
            <div className="ml-auto flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4">
                <div><h2 className="font-bold text-slate-900">Profile Review</h2><p className="text-xs text-slate-400">{profile.row.full_name} · {profile.row.candidate_code}</p></div>
                <button type="button" onClick={() => setProfile(null)} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {profileLoading ? <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : profileError ? <ErrorBanner message={profileError} onRetry={() => void openProfile(profile.row)} /> : (
                  <div className="space-y-4">
                    <section className="rounded-xl border p-4"><p className="mb-2 font-bold text-slate-800">Personal</p><InfoRow label="Full Name" value={profile.data?.profile?.full_name_aadhaar || profile.data?.profile?.full_name} /><InfoRow label="Mobile" value={maskMobile(profile.data?.profile?.mobile)} /><InfoRow label="Email" value={maskEmail(profile.data?.profile?.personal_email_id)} /><InfoRow label="PAN" value={maskId(profile.data?.profile?.pan_number)} /><InfoRow label="Aadhaar" value={maskId(profile.data?.profile?.aadhar_number || profile.data?.profile?.aadhaar_number)} /></section>
                    <section className="rounded-xl border p-4"><p className="mb-2 font-bold text-slate-800">Bank</p><InfoRow label="Bank" value={profile.data?.bank?.bank_name} /><InfoRow label="Account" value={maskId(profile.data?.bank?.account_number)} /><InfoRow label="IFSC" value={profile.data?.bank?.ifsc_code} /></section>
                    <section className="rounded-xl border p-4"><p className="mb-2 font-bold text-slate-800">Documents</p>{(profile.data?.documents ?? []).length ? (profile.data.documents as any[]).map((d) => <div key={d.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-0"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-700">{d.document_type || d.doc_type || d.doc_name || 'Document'}</p><p className="text-xs text-slate-400">{d.file_original_name}</p></div><Button type="button" variant="outline" size="sm" onClick={() => setDocumentPreview({ id: d.id, title: d.document_type || d.doc_type || d.file_original_name || 'Document', mimeType: d.mime_type, downloadAllowed: canDownloadDocs(role) })} className="min-h-[44px] gap-1"><Eye className="h-3.5 w-3.5" /> Preview</Button></div>) : <p className="text-sm text-slate-400">No uploaded documents.</p>}</section>
                  </div>
                )}
              </div>
              <div className="sticky bottom-0 space-y-3 border-t bg-white p-4">
                <ErrorBanner message={reviewError} />
                <textarea value={pushbackRemarks} onChange={(e) => setPushbackRemarks(e.target.value)} rows={2} placeholder="Push-back remarks if correction is required…" className={`${SEL} py-2`} />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" disabled={reviewSaving} onClick={() => void submitReview('hr_review')} className="min-h-[44px] flex-1 border-amber-300 text-amber-700">Push Back</Button>
                  <Button type="button" disabled={reviewSaving} onClick={() => void submitReview('approved')} className="min-h-[44px] flex-1 bg-emerald-600 text-white hover:bg-emerald-700">Approve</Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {documentPreview && (
          <div className="fixed inset-0 z-[60] flex bg-black/60 p-0 sm:p-6">
            <div className="flex h-full w-full flex-col rounded-none bg-white shadow-2xl sm:rounded-2xl">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div><p className="font-bold text-slate-900">{documentPreview.title}</p><p className="text-xs text-slate-400">Secure preview</p></div>
                <div className="flex gap-2">
                  {documentPreview.downloadAllowed && <a href={`/api/ats/onboarding-full/documents/${documentPreview.id}/download`} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-3 text-sm font-semibold text-slate-700"><Download className="h-4 w-4" /> Download</a>}
                  <button type="button" onClick={() => setDocumentPreview(null)} className="min-h-[44px] rounded-lg border px-3"><X className="h-5 w-5" /></button>
                </div>
              </div>
              <div className="flex-1 bg-slate-100 p-2">
                {documentPreview.mimeType?.startsWith('image/') ? (
                  <img src={`/api/ats/onboarding-full/documents/preview/${documentPreview.id}`} alt={documentPreview.title} className="mx-auto h-full max-h-full object-contain" />
                ) : (
                  <iframe src={`/api/ats/onboarding-full/documents/preview/${documentPreview.id}`} title={documentPreview.title} className="h-full w-full rounded-lg bg-white" />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
