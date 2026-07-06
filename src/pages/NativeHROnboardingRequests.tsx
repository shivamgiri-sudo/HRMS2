/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkforceAccess } from '@/hooks/useUserRole';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Download,
  Eye,
  FileCheck,
  Loader2,
  Search,
  Send,
  X,
} from 'lucide-react';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface OnboardingRequest {
  id: string;
  status: string;
  candidate_id: string;
  candidate_code: string;
  full_name: string;
  mobile: string;
  email: string;
  profile_status: string;
  branch_id?: string;
  branch_name: string;
  applied_for_process?: string;
  process_name?: string;
  offer_id?: string;
  offer_status?: string;
  offered_ctc?: number;
  documents_uploaded?: number;
  bank_verification_status?: string;
  employee_id?: string;
  employee_code?: string;
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
type DocumentPreview = { id: string; title: string; fileName: string; mimeType?: string; downloadAllowed: boolean };

// ── Style constants ───────────────────────────────────────────────────────────

const SEL = 'w-full min-h-[44px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
const ERR = 'mt-1 text-xs font-medium text-red-600';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Small UI components ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
  const s = status || '';
  const map: Record<string, string> = {
    profile_submitted:  'bg-amber-50 text-amber-700',
    hr_approved:        'bg-blue-50 text-blue-700',
    onboarded:          'bg-emerald-50 text-emerald-700',
    rejected:           'bg-red-50 text-red-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${map[s] || 'bg-slate-50 text-slate-500'}`}>
      {statusLabel(s)}
    </span>
  );
}

function OfferBadge({ status }: { status?: string }) {
  if (!status) return null;
  const map: Record<string, string> = {
    draft:        'bg-slate-100 text-slate-500',
    submitted:    'bg-blue-50 text-blue-700',
    bh_approved:  'bg-emerald-50 text-emerald-700',
    bh_rejected:  'bg-red-50 text-red-700',
  };
  const label: Record<string, string> = {
    draft:        'Offer Draft',
    submitted:    'Offer Sent (Pending BH)',
    bh_approved:  'Offer Approved',
    bh_rejected:  'Offer Rejected',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${map[status] || 'bg-slate-50 text-slate-500'}`}>
      {label[status] || status}
    </span>
  );
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
      <span className="w-40 shrink-0 text-xs font-medium text-slate-400">{label}</span>
      <span className="min-w-0 break-words text-xs font-semibold text-slate-800">{value || '—'}</span>
    </div>
  );
}

function StepHeader({ n, label, complete, open, toggle }: { n: number; label: string; complete: boolean; open: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      onClick={toggle}
      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${complete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
        {n}
      </span>
      <span className="flex-1 text-sm font-semibold text-slate-800">{label}</span>
      {complete
        ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        : <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
      }
      {open ? <ChevronUp className="h-4 w-4 text-slate-400 shrink-0" /> : <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NativeHROnboardingRequests() {
  const { user } = useAuth();
  const { roleKeys } = useWorkforceAccess();
  const role = String((user as any)?.role ?? '').toLowerCase();
  const allowed = roleKeys.some(k => ['admin', 'super_admin', 'hr', 'manager', 'payroll_hr', 'payroll'].includes(k));
  const canChangePfEsi = roleKeys.some(k => ['payroll_hr', 'admin', 'super_admin', 'hr'].includes(k));

  // ── List state
  const [rows, setRows] = useState<OnboardingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterBranch, setFilterBranch] = useState('');

  // ── Resend link state
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

  // ── Detail / selected state
  const [selected, setSelected] = useState<OnboardingRequest | null>(null);
  const [detailData, setDetailData] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<number | null>(null);

  // ── Review state
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [pushbackRemarks, setPushbackRemarks] = useState('');

  // ── Document preview state
  const [documentPreview, setDocumentPreview] = useState<DocumentPreview | null>(null);
  const [documentPreviewUrl, setDocumentPreviewUrl] = useState<string | null>(null);
  const [documentPreviewLoading, setDocumentPreviewLoading] = useState(false);
  const [documentPreviewError, setDocumentPreviewError] = useState<string | null>(null);

  // ── Offer / masters state
  const [bgv, setBgv] = useState<BgvData | null>(null);
  const [departments, setDepartments] = useState<MasterItem[]>([]);
  const [designations, setDesignations] = useState<MasterItem[]>([]);
  const [allCostCentres, setAllCostCentres] = useState<any[]>([]);
  const [costCentres, setCostCentres] = useState<any[]>([]);
  const [allBranches, setAllBranches] = useState<any[]>([]);
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

  // ── Manager search state
  const [managerSearch, setManagerSearch] = useState('');
  const [managerDropOpen, setManagerDropOpen] = useState(false);
  const managerRef = useRef<HTMLDivElement>(null);

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

  // ── Re-filter cost centres when allCostCentres loads or selected changes
  useEffect(() => {
    if (!selected || !allCostCentres.length) return;
    // Prefer branch_id UUID directly; fall back to name lookup in allBranches
    const branchId = selected.branch_id
      ?? allBranches.find((b: any) =>
          String(b.branch_name ?? '').toLowerCase() === String(selected.branch_name ?? '').toLowerCase()
        )?.id;
    if (branchId) {
      setCostCentres(allCostCentres.filter((c: any) => c.branch_id === branchId && Number(c.active_status) === 1));
    } else {
      setCostCentres([]);
    }
  }, [allBranches, allCostCentres, selected]);

  // ── Click-outside for manager dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (managerRef.current && !managerRef.current.contains(e.target as Node)) {
        setManagerDropOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Blob URL cleanup
  useEffect(() => () => {
    if (documentPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(documentPreviewUrl);
  }, [documentPreviewUrl]);

  // ── Load list
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

  // ── Resend onboarding link
  const resendLink = useCallback(async (row: OnboardingRequest, e: React.MouseEvent) => {
    e.stopPropagation();
    setResendingId(row.candidate_id);
    setResendResult(null);
    try {
      await hrmsApi.post(`/api/ats/onboarding/send-token/${row.candidate_id}`, {});
      setResendResult({ id: row.candidate_id, ok: true, msg: `Link resent to ${maskEmail(row.email)} / ${maskMobile(row.mobile)}` });
      setTimeout(() => setResendResult(null), 6000);
    } catch (err: any) {
      setResendResult({ id: row.candidate_id, ok: false, msg: err?.message || 'Failed to resend link.' });
      setTimeout(() => setResendResult(null), 6000);
    } finally {
      setResendingId(null);
    }
  }, []);

  // ── Load master dropdowns once
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

  // ── Load branches + all cost centres once (for client-side branch filtering)
  useEffect(() => {
    hrmsApi.get<unknown>('/api/org/branches')
      .then((r: any) => setAllBranches(r?.data ?? []))
      .catch(() => setAllBranches([]));
    hrmsApi.get<unknown>('/api/org/cost-centres')
      .then((r: any) => setAllCostCentres(r?.data ?? []))
      .catch(() => setAllCostCentres([]));
  }, []);

  // ── Salary packages — load all once
  useEffect(() => {
    hrmsApi.get<unknown>('/api/payroll-masters/packages')
      .then((r: any) => setPackages(r?.data ?? []))
      .catch(() => setPackages([]));
  }, []);

  // ── Filtered list
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

  // ── Load all employees for the candidate's branch (reporting manager list)
  const loadManagersByBranch = useCallback(async (branchId: string) => {
    setManagers([]);
    if (!branchId) return;
    try {
      const r: any = await hrmsApi.get(`/api/org/employees-by-branch?branch_id=${encodeURIComponent(branchId)}`);
      const arr: any[] = Array.isArray(r?.data) ? r.data : [];
      setManagers(arr.map((e: any) => ({
        id: String(e.id ?? ''),
        employee_code: String(e.employee_code ?? ''),
        full_name: String(e.full_name ?? ''),
        grade: String(e.designation_name ?? ''),
      })));
    } catch { setManagers([]); }
  }, []);

  const filteredManagers = useMemo(() =>
    managerSearch.trim()
      ? managers.filter((m) =>
          m.full_name.toLowerCase().includes(managerSearch.toLowerCase()) ||
          m.employee_code.toLowerCase().includes(managerSearch.toLowerCase()))
      : managers,
  [managers, managerSearch]);

  // ── Reset offer form
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
    setManagerSearch('');
    setManagerDropOpen(false);
  };

  // ── Open detail (unified — replaces openProfile + openOffer)
  const openDetail = useCallback(async (row: OnboardingRequest) => {
    setSelected(row);
    setDetailData(null);
    setDetailError(null);
    setDetailLoading(true);
    setOpenStep(null);
    resetOffer();
    setBgv(null);
    setPushbackRemarks('');
    setReviewError(null);
    setCostCentres([]);  // cleared — useEffect will populate once selected + allBranches/allCostCentres are ready
    // Load all branch employees upfront for reporting manager dropdown
    void loadManagersByBranch(row.branch_id ?? '');
    Promise.allSettled([
      hrmsApi.get<any>(`/api/ats/onboarding-full/candidate/${row.candidate_id}`)
        .then((r: any) => setDetailData(r?.data ?? r))
        .catch((e: any) => setDetailError(e?.message || 'Unable to load candidate profile.')),
      hrmsApi.get<any>(`/api/ats/bgv/status/${row.candidate_id}`)
        .then((r: any) => setBgv(r?.data ?? r))
        .catch(() => setBgv({ overall_status: 'unavailable' })),
    ]).finally(() => setDetailLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadManagersByBranch]);

  // ── Salary calculation
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

  // ── Select package → populate CTC + preview
  const selectPackage = (id: string) => {
    const pkg = packages.find((p) => String(p.id) === id);
    setF('selected_package_id', id);
    if (!pkg) { setSalaryPreview(null); return; }
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

  // ── Validate offer
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

  // ── Submit offer
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

  // ── Submit review
  const submitReview = async (status: 'approved' | 'hr_review') => {
    if (!selected) return;
    setReviewError(null);
    if (status === 'hr_review' && !pushbackRemarks.trim()) {
      setReviewError('Push-back remarks are required.');
      return;
    }
    setReviewSaving(true);
    try {
      await hrmsApi.patch(`/api/ats/onboarding-full/candidate/${selected.candidate_id}/review`, {
        status,
        remarks: pushbackRemarks.trim() || undefined,
      });
      await load();
      setSelected(null);
    } catch (e: any) {
      setReviewError(e?.message || 'Failed to save review.');
    } finally {
      setReviewSaving(false);
    }
  };

  // ── Document preview
  const closeDocumentPreview = () => {
    if (documentPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(documentPreviewUrl);
    setDocumentPreview(null);
    setDocumentPreviewUrl(null);
    setDocumentPreviewLoading(false);
    setDocumentPreviewError(null);
  };

  const openDocumentPreview = async (preview: DocumentPreview) => {
    setDocumentPreview(preview);
    setDocumentPreviewError(null);
    setDocumentPreviewLoading(true);
    try {
      const blob = await hrmsApi.getBlob(`/api/ats/onboarding-full/documents/preview/${preview.id}`);
      if (documentPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(documentPreviewUrl);
      setDocumentPreviewUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      setDocumentPreviewUrl(null);
      setDocumentPreviewError(e?.message || 'Unable to preview this document.');
    } finally {
      setDocumentPreviewLoading(false);
    }
  };

  const downloadDocumentPreview = async () => {
    if (!documentPreview) return;
    setDocumentPreviewError(null);
    try {
      const blob = await hrmsApi.getBlob(`/api/ats/onboarding-full/documents/${documentPreview.id}/download`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = documentPreview.fileName || 'onboarding-document';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setDocumentPreviewError(e?.message || 'Unable to download this document.');
    }
  };

  // ── Access guard
  if (user && !allowed) {
    return <DashboardLayout><div className="p-8 text-center font-bold text-red-600">You do not have access to this page.</div></DashboardLayout>;
  }

  // ── Detail view data shortcuts
  const dp = detailData?.profile ?? {};
  const db = detailData?.bank ?? {};
  const docs: any[] = detailData?.documents ?? [];
  const quals: any[] = detailData?.qualifications ?? [];
  const fam: any = detailData?.family ?? {};
  const exp: any = detailData?.experience ?? {};
  const digi: any = detailData?.digilocker ?? {};
  const esign: any = detailData?.esign ?? {};

  // Completeness checks for each step
  const stepComplete = [
    !!(dp.dpdp_consent && dp.otp_verified),           // 1 Welcome
    !!(dp.date_of_birth && dp.gender),                // 2 Personal
    !!(dp.permanent_address && dp.permanent_state),   // 3 Address
    docs.length > 0,                                   // 4 Documents
    !!dp.bgv_consent,                                  // 5 BGV
    !!db.ifsc_code,                                    // 6 Bank
    quals.length > 0,                                  // 7 Education
    !!exp.working_experience,                          // 8 Experience
    fam.count_of_dependents != null,                   // 9 Family
    !!dp.statutory_declaration_accepted,               // 10 Statutory
  ];

  const STEP_LABELS = [
    'Welcome & Consent',
    'Personal Details',
    'Address & KYC',
    'Documents',
    'BGV & Verification',
    'Bank Details',
    'Education',
    'Experience',
    'Family & Language',
    'Statutory Declaration',
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50/60 p-4 sm:p-6">

        {/* ── LIST VIEW ─────────────────────────────────────────────────── */}
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

            <div className="flex flex-wrap gap-2">
              <select className={`${SEL} w-auto min-w-[160px]`} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All Statuses</option>
                <option value="pending_offer">Pending Offer</option>
                <option value="offered">Offered</option>
                <option value="onboarded">Onboarded</option>
              </select>
              <select className={`${SEL} w-auto min-w-[160px]`} value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}>
                <option value="">All Branches</option>
                {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            <ErrorBanner message={loadError} onRetry={() => void load()} />

            {/* Resend result toast */}
            {resendResult && (
              <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${resendResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {resendResult.ok
                  ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />
                  : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />}
                {resendResult.msg}
              </div>
            )}

            {loading ? (
              <div className="flex h-64 items-center justify-center rounded-xl border bg-white">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : !filtered.length && !loadError ? (
              <div className="rounded-xl border bg-white py-16 text-center text-slate-500">No onboarding requests found.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead className="border-b bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">#</th>
                      <th className="px-4 py-3 text-left">Name / Code</th>
                      <th className="px-4 py-3 text-left">Branch</th>
                      <th className="px-4 py-3 text-left">Process</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">Offer</th>
                      <th className="px-4 py-3 text-left">Docs</th>
                      <th className="px-4 py-3 text-left">Bank</th>
                      <th className="px-4 py-3 text-left">Resend Link</th>
                      <th className="px-4 py-3 text-left">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((r, i) => (
                      <tr
                        key={r.id}
                        className="cursor-pointer hover:bg-slate-50 transition-colors"
                        onClick={() => void openDetail(r)}
                      >
                        <td className="px-4 py-3 text-slate-400">{i + 1}</td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">{r.full_name}</p>
                          <p className="font-mono text-[11px] text-slate-400">{r.candidate_code}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{r.branch_name || '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{r.process_name || r.applied_for_process || '—'}</td>
                        <td className="px-4 py-3"><StatusBadge status={r.profile_status} /></td>
                        <td className="px-4 py-3"><OfferBadge status={r.offer_status} /></td>
                        <td className="px-4 py-3 text-slate-600">{r.documents_uploaded ?? 0}</td>
                        <td className="px-4 py-3 text-slate-600 capitalize">{statusLabel(r.bank_verification_status)}</td>
                        <td className="px-4 py-3">
                          {['onboarding_sent', 'profile_in_progress', 'profile_submitted'].includes(r.profile_status) ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={resendingId === r.candidate_id}
                              onClick={(e) => void resendLink(r, e)}
                              className="min-h-[36px] gap-1 text-blue-700 border-blue-200 hover:bg-blue-50"
                            >
                              {resendingId === r.candidate_id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Send className="h-3.5 w-3.5" />}
                              Resend
                            </Button>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); void openDetail(r); }}
                            className="min-h-[36px]"
                          >
                            Open
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── DETAIL VIEW ───────────────────────────────────────────────── */}
        {selected && (
          <div className="space-y-5">
            {/* Back button */}
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-blue-600 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" /> Back to onboarding requests
            </button>

            {/* A — Candidate header bar */}
            <div className="rounded-xl border bg-white p-4 shadow-sm flex flex-wrap gap-4 items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{selected.full_name}</h2>
                <p className="font-mono text-xs text-slate-400">{selected.candidate_code}</p>
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                <span><span className="text-slate-400">Branch: </span>{selected.branch_name || '—'}</span>
                <span><span className="text-slate-400">Process: </span>{selected.process_name || selected.applied_for_process || '—'}</span>
                <span><span className="text-slate-400">Mobile: </span>{maskMobile(selected.mobile)}</span>
                <span><span className="text-slate-400">Email: </span>{maskEmail(selected.email)}</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <StatusBadge status={selected.profile_status} />
                {selected.employee_id && selected.employee_code && (
                  <Link
                    to={`/employees/${selected.employee_id}/joining-documents`}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors shadow-sm"
                  >
                    <FileCheck className="h-4 w-4" />
                    Post-Onboarding Documents ({selected.employee_code})
                  </Link>
                )}
                {['onboarding_sent', 'profile_in_progress', 'profile_submitted'].includes(selected.profile_status) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={resendingId === selected.candidate_id}
                    onClick={(e) => void resendLink(selected, e)}
                    className="gap-1 min-h-[36px] text-blue-700 border-blue-200 hover:bg-blue-50"
                  >
                    {resendingId === selected.candidate_id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Send className="h-3.5 w-3.5" />}
                    Resend Onboarding Link
                  </Button>
                )}
              </div>
            </div>

            {/* Resend result toast (detail view) */}
            {resendResult && resendResult.id === selected.candidate_id && (
              <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${resendResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {resendResult.ok
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  : <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />}
                {resendResult.msg}
              </div>
            )}

            {/* B — 10-step review panel */}
            <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
              <div className="border-b px-5 py-4 flex items-center justify-between">
                <h3 className="font-bold text-slate-900">Onboarding Profile Review</h3>
                {detailLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              </div>

              {detailError && (
                <div className="p-4">
                  <ErrorBanner message={detailError} onRetry={() => void openDetail(selected)} />
                </div>
              )}

              {!detailLoading && !detailError && (
                <div className="divide-y divide-slate-100">
                  {/* Step 1 — Welcome */}
                  <div>
                    <StepHeader n={1} label={STEP_LABELS[0]} complete={stepComplete[0]} open={openStep === 0} toggle={() => setOpenStep(s => s === 0 ? null : 0)} />
                    {openStep === 0 && (
                      <div className="px-5 pb-4 pt-1 bg-slate-50/50">
                        <InfoRow label="DPDP Consent" value={dp.dpdp_consent ? 'Yes' : 'No'} />
                        <InfoRow label="OTP Verified" value={dp.otp_verified ? 'Yes' : 'No'} />
                        <InfoRow label="BGV Consent" value={dp.bgv_consent ? 'Yes' : 'No'} />
                        <InfoRow label="OTP Mobile" value={dp.otp_mobile} />
                        <InfoRow label="OTP Verified At" value={dp.otp_verified_at} />
                      </div>
                    )}
                  </div>

                  {/* Step 2 — Personal */}
                  <div>
                    <StepHeader n={2} label={STEP_LABELS[1]} complete={stepComplete[1]} open={openStep === 1} toggle={() => setOpenStep(s => s === 1 ? null : 1)} />
                    {openStep === 1 && (
                      <div className="px-5 pb-4 pt-1 bg-slate-50/50">
                        <InfoRow label="Full Name (Aadhaar)" value={dp.full_name_aadhaar || dp.employee_name} />
                        <InfoRow label="Title" value={dp.title} />
                        <InfoRow label="Date of Birth" value={dp.date_of_birth} />
                        <InfoRow label="Gender" value={dp.gender} />
                        <InfoRow label="Marital Status" value={dp.marital_status} />
                        <InfoRow label="Blood Group" value={dp.blood_group} />
                        <InfoRow label="Mother Name" value={dp.mother_name} />
                        <InfoRow label="Father / Husband" value={dp.father_husband_name} />
                        <InfoRow label="PAN" value={maskId(dp.pan_number_masked || dp.pan_number)} />
                        <InfoRow label="Aadhaar" value={maskId(dp.aadhaar_number_masked || dp.aadhar_number)} />
                        <InfoRow label="Nationality" value={dp.nationality} />
                        <InfoRow label="Religion" value={dp.religion} />
                        <InfoRow label="Category" value={dp.category} />
                        <InfoRow label="Nominee 1" value={dp.nominee_name ? `${dp.nominee_name} (${dp.nominee_relation})` : undefined} />
                        <InfoRow label="Nominee 2" value={dp.nominee2_name ? `${dp.nominee2_name} (${dp.nominee2_relation})` : undefined} />
                        <InfoRow label="Emergency Contact" value={dp.emergency_contact_name ? `${dp.emergency_contact_name} · ${dp.emergency_contact_mobile}` : undefined} />
                      </div>
                    )}
                  </div>

                  {/* Step 3 — Address & KYC */}
                  <div>
                    <StepHeader n={3} label={STEP_LABELS[2]} complete={stepComplete[2]} open={openStep === 2} toggle={() => setOpenStep(s => s === 2 ? null : 2)} />
                    {openStep === 2 && (
                      <div className="px-5 pb-4 pt-1 bg-slate-50/50">
                        <p className="mt-2 mb-1 text-xs font-bold uppercase text-slate-400">Permanent Address</p>
                        <InfoRow label="Address" value={dp.permanent_address} />
                        <InfoRow label="City" value={dp.permanent_city} />
                        <InfoRow label="State" value={dp.permanent_state} />
                        <InfoRow label="Pincode" value={dp.permanent_pincode} />
                        <p className="mt-3 mb-1 text-xs font-bold uppercase text-slate-400">Present Address</p>
                        <InfoRow label="Address" value={dp.present_address} />
                        <InfoRow label="City" value={dp.present_city} />
                        <InfoRow label="State" value={dp.present_state} />
                        <InfoRow label="Pincode" value={dp.present_pincode} />
                        <p className="mt-3 mb-1 text-xs font-bold uppercase text-slate-400">ID Documents</p>
                        <InfoRow label="Passport" value={dp.passport_no} />
                        <InfoRow label="Driving License" value={dp.driving_license_no} />
                        <InfoRow label="Address Proof Type" value={dp.address_proof_type} />
                      </div>
                    )}
                  </div>

                  {/* Step 4 — Documents */}
                  <div>
                    <StepHeader n={4} label={STEP_LABELS[3]} complete={stepComplete[3]} open={openStep === 3} toggle={() => setOpenStep(s => s === 3 ? null : 3)} />
                    {openStep === 3 && (
                      <div className="px-5 pb-4 pt-1 bg-slate-50/50">
                        {docs.length === 0 ? (
                          <p className="py-3 text-sm text-slate-400">No documents uploaded.</p>
                        ) : docs.map((d) => (
                          <div key={d.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-700">{d.document_type || d.doc_type || d.doc_name || 'Document'}</p>
                              <p className="text-xs text-slate-400">{d.file_original_name} {d.file_size_bytes ? `· ${Math.round(d.file_size_bytes / 1024)} KB` : ''}</p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void openDocumentPreview({
                                id: d.id,
                                title: d.document_type || d.doc_type || d.doc_name || d.file_original_name || 'Document',
                                fileName: d.file_original_name || 'document',
                                mimeType: d.mime_type,
                                downloadAllowed: canDownloadDocs(role),
                              })}
                              className="min-h-[36px] gap-1 shrink-0"
                            >
                              <Eye className="h-3.5 w-3.5" /> Preview
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Step 5 — BGV */}
                  <div>
                    <StepHeader n={5} label={STEP_LABELS[4]} complete={stepComplete[4]} open={openStep === 4} toggle={() => setOpenStep(s => s === 4 ? null : 4)} />
                    {openStep === 4 && (
                      <div className="px-5 pb-4 pt-1 bg-slate-50/50">
                        <InfoRow label="BGV Consent" value={dp.bgv_consent ? 'Given' : 'Not given'} />
                        <InfoRow label="DigiLocker Status" value={digi.status} />
                        <InfoRow label="DigiLocker Provider" value={digi.provider} />
                        <InfoRow label="eSign Status" value={esign.status} />
                        <InfoRow label="eSign Provider" value={esign.provider} />
                        {bgv && (
                          <>
                            <p className="mt-3 mb-1 text-xs font-bold uppercase text-slate-400">BGV Result</p>
                            <InfoRow label="Overall Status" value={bgv.overall_status} />
                            <InfoRow label="Score" value={bgv.score != null ? String(bgv.score) : undefined} />
                            {(bgv.checks ?? []).map((c, idx) => (
                              <InfoRow key={idx} label={c.check_type} value={`${c.status}${c.result_summary ? ' · ' + c.result_summary : ''}`} />
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Step 6 — Bank */}
                  <div>
                    <StepHeader n={6} label={STEP_LABELS[5]} complete={stepComplete[5]} open={openStep === 5} toggle={() => setOpenStep(s => s === 5 ? null : 5)} />
                    {openStep === 5 && (
                      <div className="px-5 pb-4 pt-1 bg-slate-50/50">
                        <InfoRow label="Bank Name" value={db.bank_name} />
                        <InfoRow label="Branch" value={db.branch_name} />
                        <InfoRow label="Account Holder" value={db.account_holder_name} />
                        <InfoRow label="Account No." value={maskId(db.account_no_masked || db.account_number)} />
                        <InfoRow label="IFSC" value={db.ifsc_code} />
                        <InfoRow label="Account Type" value={db.account_type} />
                        <InfoRow label="Verification Status" value={db.verification_status} />
                        <InfoRow label="Name Match" value={db.name_validation_status} />
                      </div>
                    )}
                  </div>

                  {/* Step 7 — Education */}
                  <div>
                    <StepHeader n={7} label={STEP_LABELS[6]} complete={stepComplete[6]} open={openStep === 6} toggle={() => setOpenStep(s => s === 6 ? null : 6)} />
                    {openStep === 6 && (
                      <div className="px-5 pb-4 pt-1 bg-slate-50/50">
                        {quals.length === 0 ? (
                          <p className="py-3 text-sm text-slate-400">No education records.</p>
                        ) : quals.map((q, i) => (
                          <div key={q.id || i} className="mb-3 rounded-lg border bg-white p-3">
                            <InfoRow label="Qualification" value={q.qualification} />
                            <InfoRow label="Specialization" value={q.specialization_course_name} />
                            <InfoRow label="Year" value={q.passed_out_year} />
                            <InfoRow label="Percentage" value={q.passed_out_percentage ? `${q.passed_out_percentage}%` : undefined} />
                            <InfoRow label="State" value={q.passed_out_state} />
                            <InfoRow label="City" value={q.passed_out_city} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Step 8 — Experience */}
                  <div>
                    <StepHeader n={8} label={STEP_LABELS[7]} complete={stepComplete[7]} open={openStep === 7} toggle={() => setOpenStep(s => s === 7 ? null : 7)} />
                    {openStep === 7 && (
                      <div className="px-5 pb-4 pt-1 bg-slate-50/50">
                        <InfoRow label="Experience Type" value={exp.working_experience} />
                        <InfoRow label="Years" value={exp.experience_year} />
                        <InfoRow label="Employer" value={exp.employer_name} />
                        <InfoRow label="Last Designation" value={exp.last_designation} />
                        <InfoRow label="Last CTC" value={exp.last_ctc ? fmt(exp.last_ctc) : undefined} />
                        <InfoRow label="Doc Type" value={exp.experience_doc_type} />
                      </div>
                    )}
                  </div>

                  {/* Step 9 — Family */}
                  <div>
                    <StepHeader n={9} label={STEP_LABELS[8]} complete={stepComplete[8]} open={openStep === 8} toggle={() => setOpenStep(s => s === 8 ? null : 8)} />
                    {openStep === 8 && (
                      <div className="px-5 pb-4 pt-1 bg-slate-50/50">
                        <InfoRow label="Annual Income" value={fam.annual_income != null ? fmt(fam.annual_income) : undefined} />
                        <InfoRow label="Dependents" value={fam.count_of_dependents != null ? String(fam.count_of_dependents) : undefined} />
                      </div>
                    )}
                  </div>

                  {/* Step 10 — Statutory */}
                  <div>
                    <StepHeader n={10} label={STEP_LABELS[9]} complete={stepComplete[9]} open={openStep === 9} toggle={() => setOpenStep(s => s === 9 ? null : 9)} />
                    {openStep === 9 && (
                      <div className="px-5 pb-4 pt-1 bg-slate-50/50">
                        <InfoRow label="EPS Member" value={dp.eps_member != null ? (dp.eps_member ? 'Yes' : 'No') : undefined} />
                        <InfoRow label="Previous PF Member" value={dp.previous_pf_member != null ? (dp.previous_pf_member ? 'Yes' : 'No') : undefined} />
                        <InfoRow label="International Worker" value={dp.international_worker != null ? (dp.international_worker ? 'Yes' : 'No') : undefined} />
                        <InfoRow label="UAN Number" value={dp.uan_number} />
                        <InfoRow label="EPF Number" value={dp.epf_number} />
                        <InfoRow label="ESIC Number" value={dp.esic_number} />
                        <InfoRow label="Declaration Accepted" value={dp.statutory_declaration_accepted ? 'Yes' : 'No'} />
                        <InfoRow label="Declaration At" value={dp.statutory_declaration_at} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* C — Approve / Push-back */}
            {selected.profile_status !== 'onboarded' && (
              <div className="rounded-xl border bg-white p-5 shadow-sm space-y-3">
                <h3 className="font-bold text-slate-800">HR Review Decision</h3>
                <ErrorBanner message={reviewError} />
                <textarea
                  value={pushbackRemarks}
                  onChange={(e) => setPushbackRemarks(e.target.value)}
                  rows={2}
                  placeholder="Push-back remarks (required only when pushing back)…"
                  className={`${SEL} py-2`}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={reviewSaving}
                    onClick={() => void submitReview('hr_review')}
                    className="min-h-[44px] flex-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                  >
                    {reviewSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Push Back
                  </Button>
                  <Button
                    type="button"
                    disabled={reviewSaving}
                    onClick={() => void submitReview('approved')}
                    className="min-h-[44px] flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {reviewSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />} Approve Profile
                  </Button>
                </div>
              </div>
            )}

            {/* D — Employment Offer form: hide when offer submitted/approved, show pending BH rejection or no offer yet */}
            {(selected.profile_status === 'profile_submitted' || selected.profile_status === 'hr_approved') && (() => {
              const offerBlocked = selected.offer_status === 'submitted' || selected.offer_status === 'bh_approved';
              if (offerBlocked) return (
                <div className="rounded-xl border bg-white shadow-sm px-5 py-5">
                  <div className="flex items-center gap-3">
                    <OfferBadge status={selected.offer_status} />
                    <p className="text-sm text-slate-600">
                      {selected.offer_status === 'submitted'
                        ? 'Offer has been submitted and is pending Branch Head approval. You cannot edit until it is rejected.'
                        : 'Offer has been approved by Branch Head. No further changes allowed.'}
                    </p>
                  </div>
                </div>
              );
              return null;
            })()}
            {(selected.profile_status === 'profile_submitted' || selected.profile_status === 'hr_approved') &&
             !['submitted', 'bh_approved'].includes(selected.offer_status ?? '') && (
              <div className="rounded-xl border bg-white shadow-sm">
                <div className="border-b px-5 py-4 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">Employment Offer
                    {selected.offer_status === 'bh_rejected' && (
                      <span className="ml-2 text-xs font-semibold text-red-600 bg-red-50 rounded-full px-2 py-0.5">Rejected — Revise & Resubmit</span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Branch: {selected.branch_name}</p>
                </div>
                <div className="space-y-5 p-5">
                  <ErrorBanner message={formError} />

                  {/* Tabs */}
                  <div className="flex gap-2">
                    <Button type="button" variant={offerTab === 'standard' ? 'default' : 'outline'} onClick={() => setOfferTab('standard')} className="min-h-[44px]">Standard Package</Button>
                    <Button type="button" variant={offerTab === 'proposed' ? 'default' : 'outline'} onClick={() => setOfferTab('proposed')} className="min-h-[44px]">Exception Package</Button>
                  </div>

                  {/* Core fields */}
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <Field label="Date of Joining" required error={formFieldErrors.date_of_joining}>
                      <input type="date" className={SEL} value={offer.date_of_joining} onChange={(e) => setF('date_of_joining', e.target.value)} />
                    </Field>
                    <Field label="Salary Start Date">
                      <input type="date" className={SEL} value={offer.date_of_salary} onChange={(e) => setF('date_of_salary', e.target.value)} />
                    </Field>
                    <Field label="Employment Type">
                      <select className={SEL} value={offer.emp_type} onChange={(e) => setF('emp_type', e.target.value)}>
                        <option>OnRoll</option><option>OffRoll</option><option>CONTRACT</option><option>MGMT. TRAINEE</option>
                      </select>
                    </Field>
                    <Field label="Role Type">
                      <select className={SEL} value={offer.role_type} onChange={(e) => setF('role_type', e.target.value)}>
                        <option>Analyst</option><option>SupportStaff</option>
                      </select>
                    </Field>

                    <Field label="Department" required error={formFieldErrors.department_id}>
                      <select className={SEL} value={offer.department_id} onChange={(e) => setF('department_id', e.target.value)}>
                        <option value="">Select</option>
                        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Designation" required error={formFieldErrors.designation_id}>
                      <select className={SEL} value={offer.designation_id} onChange={(e) => setF('designation_id', e.target.value)}>
                        <option value="">Select</option>
                        {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </Field>
                    <Field label="Cost Centre" required error={formFieldErrors.cost_centre}>
                      <select
                        className={SEL}
                        value={offer.cost_centre}
                        onChange={(e) => {
                          setF('cost_centre', e.target.value);
                          setF('reporting_manager_id', '');
                          setManagerSearch('');
                        }}
                      >
                        <option value="">Select</option>
                        {costCentres.map((c) => <option key={c.id} value={c.id}>{c.cost_centre_name || c.cost_centre_code}{c.process_name ? ` (${c.process_name})` : ''}</option>)}
                      </select>
                    </Field>

                    {/* Reporting Manager — all employees from candidate's branch */}
                    <Field label="Reporting Manager" required error={formFieldErrors.reporting_manager_id}>
                      <div ref={managerRef} style={{ position: 'relative' }}>
                        <input
                          type="text"
                          placeholder="Search by name or code…"
                          value={managerSearch}
                          autoComplete="off"
                          className={SEL}
                          onChange={(e) => {
                            setManagerSearch(e.target.value);
                            setManagerDropOpen(true);
                            setF('reporting_manager_id', '');
                          }}
                          onFocus={() => setManagerDropOpen(true)}
                        />
                        {managerDropOpen && (
                          <div style={{
                            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
                            background: '#fff', border: '1px solid #d1d5db', borderRadius: 8,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto',
                          }}>
                            {filteredManagers.length === 0 ? (
                              <div style={{ padding: '8px 12px', color: '#9ca3af', fontSize: 13 }}>
                                {managers.length === 0 ? 'No employees found for this cost centre' : 'No match'}
                              </div>
                            ) : filteredManagers.map((m) => (
                              <div
                                key={m.id}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setF('reporting_manager_id', m.id);
                                  setManagerSearch(`${m.full_name} · ${m.employee_code}`);
                                  setManagerDropOpen(false);
                                }}
                                style={{
                                  padding: '8px 12px', cursor: 'pointer', fontSize: 14,
                                  background: offer.reporting_manager_id === m.id ? '#dbeafe' : undefined,
                                  borderBottom: '1px solid #f3f4f6',
                                }}
                              >
                                <span className="font-medium text-slate-800">{m.full_name}</span>
                                <span className="ml-2 text-xs text-slate-400">{m.employee_code}</span>
                                {m.grade && <span className="ml-2 text-[11px] text-slate-400">{m.grade}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </Field>

                    <Field label="Salary Band" required error={formFieldErrors.salary_band}>
                      <select className={SEL} value={offer.salary_band} onChange={(e) => setF('salary_band', e.target.value)}>
                        <option value="">Select</option>
                        {salaryBands.map((b) => <option key={b.band_code} value={b.band_code}>{b.band_name || b.band_code} · {fmt(b.min_ctc)}–{fmt(b.max_ctc)}</option>)}
                      </select>
                    </Field>

                    {/* PF / ESI toggles */}
                    <div className="md:col-span-2 xl:col-span-3 flex flex-wrap gap-6 rounded-xl border bg-slate-50 px-4 py-3 items-center">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={offer.pf_eligible}
                          disabled={!canChangePfEsi}
                          onChange={(e) => setF('pf_eligible', e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                        <span className="text-sm font-semibold text-slate-700">PF Eligible</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={offer.esi_eligible}
                          disabled={!canChangePfEsi}
                          onChange={(e) => setF('esi_eligible', e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                        <span className="text-sm font-semibold text-slate-700">ESI Eligible</span>
                      </label>
                      {(!offer.pf_eligible || !offer.esi_eligible) && (
                        <p className="w-full text-xs font-medium text-amber-600">
                          ⚠ Opting out of PF/ESI requires statutory justification.
                        </p>
                      )}
                    </div>

                    {/* Standard: package + CTC */}
                    {offerTab === 'standard' ? (
                      <>
                        <Field label="Salary Package">
                          <select className={SEL} value={offer.selected_package_id} onChange={(e) => selectPackage(e.target.value)}>
                            <option value="">Select a package</option>
                            {packages.map((p) => <option key={p.id} value={p.id}>{fmt(p.package_amount)} / month · In-hand {fmt(p.net_in_hand)}</option>)}
                          </select>
                        </Field>
                        <Field label="Monthly CTC" required error={formFieldErrors.offered_ctc}>
                          {offer.selected_package_id ? (
                            <div className="flex items-center gap-2">
                              <span className={`${SEL} flex items-center bg-slate-50 text-slate-700 font-semibold`}>{fmt(Number(offer.offered_ctc))}</span>
                              <button
                                type="button"
                                className="text-xs text-blue-600 underline whitespace-nowrap"
                                onClick={() => { setF('selected_package_id', ''); setSalaryPreview(null); }}
                              >
                                Change
                              </button>
                            </div>
                          ) : (
                            <input
                              inputMode="numeric"
                              className={SEL}
                              value={offer.offered_ctc}
                              onChange={(e) => setF('offered_ctc', e.target.value)}
                              placeholder="e.g. 18000"
                            />
                          )}
                        </Field>
                      </>
                    ) : (
                      <>
                        <Field label="Proposed Monthly CTC" required error={formFieldErrors.proposed_ctc}>
                          <input inputMode="numeric" className={SEL} value={proposedCtc} onChange={(e) => setProposedCtc(e.target.value)} placeholder="e.g. 18000" />
                        </Field>
                        <Field label="Exception Reason" required error={formFieldErrors.proposed_reason}>
                          <input className={SEL} value={proposedReason} onChange={(e) => setProposedReason(e.target.value)} placeholder="Skill premium / approval reason" />
                        </Field>
                      </>
                    )}
                  </div>

                  {/* Calculate salary button (standard only, no package selected) */}
                  {offerTab === 'standard' && !offer.selected_package_id && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void calcSalaryManual()}
                      disabled={calcLoading || !offer.offered_ctc || !offer.salary_band}
                      className="min-h-[44px] gap-2"
                    >
                      {calcLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />} Calculate Salary
                    </Button>
                  )}

                  {/* Full salary breakdown — 13 components */}
                  {salaryPreview && (
                    <div className="rounded-xl border bg-slate-50 p-4">
                      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Salary Breakdown (Monthly)</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                        {([
                          ['Gross', salaryPreview.gross],
                          ['Basic', salaryPreview.basic],
                          ['HRA', salaryPreview.hra],
                          ['Conveyance', salaryPreview.conveyance],
                          ['Special Allow.', salaryPreview.special_allowance],
                          ['Bonus', salaryPreview.bonus],
                          ['PF (Emp)', salaryPreview.pf_employee],
                          ['PF (Emplr)', salaryPreview.pf_employer],
                          ['ESIC (Emp)', salaryPreview.esic_employee],
                          ['ESIC (Emplr)', salaryPreview.esic_employer],
                          ['Prof. Tax', salaryPreview.professional_tax],
                          ['Admin Chrg', salaryPreview.admin_charges],
                        ] as [string, number | undefined][]).map(([label, value]) => (
                          <div key={label} className="rounded-lg bg-white p-3 text-center shadow-sm">
                            <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
                            <p className="text-sm font-bold text-slate-700">{fmt(value)}</p>
                          </div>
                        ))}
                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-center shadow-sm lg:col-span-2">
                          <p className="text-[10px] font-bold uppercase text-emerald-600">Net In-hand</p>
                          <p className="text-base font-bold text-emerald-700">{fmt(salaryPreview.net_in_hand)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-white p-4 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" onClick={() => void submitOffer(false)} disabled={saving} className="min-h-[44px] gap-2">
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Draft
                  </Button>
                  <Button type="button" onClick={() => void submitOffer(true)} disabled={saving} className="min-h-[44px] gap-2 bg-blue-600 text-white hover:bg-blue-700">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit to Branch Head
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── DOCUMENT PREVIEW MODAL ────────────────────────────────────── */}
        {documentPreview && (
          <div className="fixed inset-0 z-[60] flex bg-black/60 p-0 sm:p-6">
            <div className="flex h-full w-full flex-col rounded-none bg-white shadow-2xl sm:rounded-2xl">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div>
                  <p className="font-bold text-slate-900">{documentPreview.title}</p>
                  <p className="text-xs text-slate-400">Secure preview</p>
                </div>
                <div className="flex gap-2">
                  {documentPreview.downloadAllowed && (
                    <button
                      type="button"
                      onClick={() => void downloadDocumentPreview()}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-3 text-sm font-semibold text-slate-700"
                    >
                      <Download className="h-4 w-4" /> Download
                    </button>
                  )}
                  <button type="button" onClick={closeDocumentPreview} className="min-h-[44px] rounded-lg border px-3">
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 bg-slate-100 p-2">
                {documentPreviewError ? (
                  <ErrorBanner message={documentPreviewError} onRetry={() => void openDocumentPreview(documentPreview)} />
                ) : documentPreviewLoading ? (
                  <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
                ) : documentPreviewUrl && documentPreview.mimeType?.startsWith('image/') ? (
                  <img src={documentPreviewUrl} alt={documentPreview.title} className="mx-auto h-full max-h-full object-contain" />
                ) : (
                  <iframe src={documentPreviewUrl ?? undefined} title={documentPreview.title} className="h-full w-full rounded-lg bg-white" />
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
