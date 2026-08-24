/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkforceAccess } from '@/hooks/useUserRole';
import { OnboardingTabBar } from "@/components/onboarding/OnboardingTabBar";
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Eye,
  FileCheck,
  Loader2,
  Maximize2,
  RotateCcw,
  RotateCw,
  Search,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface OnboardingRequest {
  id: string;
  status: string;
  created_at?: string;
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
  form_step?: string;
  current_step_idx?: number;
  form_last_activity?: string;
  candidate_status?: string | null;
  joining_document_status?: string | null;
  joining_document_completion_pct?: number | null;
}

interface BgvCheckItem {
  id: string;
  check_type: string;
  status: string;
  result_summary?: string;
  is_auto_approved?: number;
  match_score?: number;
  matched_name?: string;
  provider_key?: string;
  provider_reference_id?: string;
  review_remarks?: string;
  verified_at?: string;
  updated_at?: string;
}
interface BgvDetailData {
  checks: BgvCheckItem[];
  documents: { id: string; doc_type: string; doc_name: string; document_status: string; uploaded_at: string }[];
  bank_verifications: { verification_status: string; verification_method?: string; input_account_holder_name?: string; provider_account_holder_name?: string; name_match_score?: number; verified_at?: string }[];
  score: number;
  overall_status: string;
  missing_mandatory_checks: string[];
  consent: { consent_status: string; granted_at: string } | null;
}
interface BgvData { score?: number; checks?: BgvCheckItem[]; overall_status?: string; is_auto_approved?: number; }

interface BgvQueueItem {
  candidate_id: string;
  candidate_code: string;
  full_name: string;
  branch_name: string;
  process_name?: string;
  bgv_status?: string;
  bgv_score?: number;
  is_auto_approved?: number;
  // From listBgvQueueScoped
  issue_count?: number;
  verified_count?: number;
  last_check_at?: string;
  // Aliases for convenience
  checks_pending?: number;
  checks_failed?: number;
  checks_manual?: number;
  submitted_at?: string;
}

type BgvManualAction = 'verified' | 'mismatch' | 'failed' | 'manual_review';

interface BgvReviewState {
  candidateId: string;
  checkId?: string;
  status: BgvManualAction;
  remarks: string;
  uploading: boolean;
}
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
  if (v === 'initiated') return 'Initiated';
  if (v === 'not_joining') return 'Not Joining';
  if (v === 'joining_document_pending') return 'Joining Docs Pending';
  return String(v || 'pending').replace(/_/g, ' ');
}

const FORM_IN_PROGRESS_STEPS = new Set([
  'draft','employee_details_saved','bank_saved','statutory_saved',
  'qualifications_saved','experience_saved','family_saved',
  'nominee_saved','language_saved','final_saved',
]);

function resolveDisplayStatus(r: {
  profile_status: string;
  form_step?: string;
  candidate_status?: string | null;
  employee_id?: string;
  joining_document_status?: string | null;
}): string {
  // Highest priority — once set, nothing else about the candidate's progress
  // matters for what HR needs to see at a glance.
  if (r.candidate_status === 'not_joining') return 'not_joining';
  if (r.employee_id && r.joining_document_status && r.joining_document_status !== 'completed') {
    return 'joining_document_pending';
  }
  if (r.profile_status === 'onboarding_sent' && r.form_step && FORM_IN_PROGRESS_STEPS.has(r.form_step)) {
    return 'initiated';
  }
  return r.profile_status;
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
    initiated:          'bg-orange-50 text-orange-700',
    not_joining:        'bg-slate-200 text-slate-600',
    joining_document_pending: 'bg-purple-50 text-purple-700',
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

function SectionCard({ n, label, complete, children }: { n: number; label: string; complete: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 border-b bg-slate-50/70 px-4 py-3">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${complete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {n}
        </span>
        <span className="flex-1 text-sm font-semibold text-slate-800">{label}</span>
        {complete ? <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" /> : <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NativeHROnboardingRequests() {
  const { user } = useAuth();
  const { roleKeys, isLoading: roleLoading } = useWorkforceAccess();
  const role = String((user as any)?.role ?? '').toLowerCase();
  const allowed = roleKeys.some(k => ['admin', 'super_admin', 'hr', 'manager', 'payroll_hr', 'payroll'].includes(k));
  const canChangePfEsi = roleKeys.some(k => ['payroll_hr', 'admin', 'super_admin', 'hr'].includes(k));
  // Narrower than the general page grant, matching the backend route gate on
  // PATCH .../not-joining — this is a decisive, terminal state change, not
  // an ordinary edit.
  const canMarkNotJoining = roleKeys.some(k => ['admin', 'super_admin', 'hr'].includes(k));

  // ── Main view tab
  const [mainTab, setMainTab] = useState<'onboarding' | 'bgv_review'>('onboarding');

  // ── BGV Review queue state
  const [bgvQueue, setBgvQueue] = useState<BgvQueueItem[]>([]);
  const [bgvQueueLoading, setBgvQueueLoading] = useState(false);
  const [bgvQueueError, setBgvQueueError] = useState<string | null>(null);
  const [bgvReviewState, setBgvReviewState] = useState<BgvReviewState | null>(null);
  const [bgvReviewSaving, setBgvReviewSaving] = useState(false);
  const [bgvReviewError, setBgvReviewError] = useState<string | null>(null);
  const [bgvDetailCandidate, setBgvDetailCandidate] = useState<string | null>(null);
  const [bgvDetail, setBgvDetail] = useState<BgvDetailData | null>(null);

  // ── List state
  const [rows, setRows] = useState<OnboardingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterBranch, setFilterBranch] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // ── Resend link state
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

  // ── Send progress reminder state
  const [reminderSendingId, setReminderSendingId] = useState<string | null>(null);
  const [reminderResult, setReminderResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

  // ── Send appointment letter state
  const [sendLetterLoading, setSendLetterLoading] = useState(false);
  const [sendLetterResult, setSendLetterResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [notJoiningId, setNotJoiningId] = useState<string | null>(null);
  const [notJoiningResult, setNotJoiningResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

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
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewGroup, setPreviewGroup] = useState<DocumentPreview[]>([]);
  const [previewGroupIndex, setPreviewGroupIndex] = useState(0);
  const [previewRotation, setPreviewRotation] = useState(0);
  const [previewBlurred, setPreviewBlurred] = useState(false);
  const [screenshotWarning, setScreenshotWarning] = useState(false);

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

  // ── Keyboard shortcuts for document viewer
  useEffect(() => {
    if (!documentPreview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeDocumentPreview(); return; }
      if (e.key === 'ArrowRight') { navigatePreview(1); return; }
      if (e.key === 'ArrowLeft') { navigatePreview(-1); return; }
      if (e.key === '+' || e.key === '=') { setPreviewZoom(z => Math.min(z + 0.25, 4)); return; }
      if (e.key === '-') { setPreviewZoom(z => Math.max(z - 0.25, 0.25)); return; }
      if (e.key === '0') { setPreviewZoom(1); setPreviewRotation(0); return; }
      if (e.key === 'r' || e.key === 'R') { setPreviewRotation(r => (r + (e.shiftKey ? -90 : 90)) % 360); return; }
      if (e.key === 'f' || e.key === 'F') { setPreviewZoom(1); return; } // fit to screen
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentPreview, previewGroup, previewGroupIndex]);

  // ── Blur document when window loses focus (anti-screenshot measure)
  useEffect(() => {
    if (!documentPreview) return;
    const onBlur = () => setPreviewBlurred(true);
    const onFocus = () => setPreviewBlurred(false);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('blur', onBlur); window.removeEventListener('focus', onFocus); };
  }, [documentPreview]);

  // ── Detect PrintScreen key and show warning (can't prevent, but can deter + log)
  useEffect(() => {
    if (!documentPreview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        setScreenshotWarning(true);
        setPreviewBlurred(true);
        setTimeout(() => { setScreenshotWarning(false); setPreviewBlurred(false); }, 3000);
        // Log the attempt (could be sent to backend for audit)
        console.warn('[SECURITY] PrintScreen attempt detected:', user?.email, new Date().toISOString());
      }
    };
    window.addEventListener('keyup', handler);
    return () => window.removeEventListener('keyup', handler);
  }, [documentPreview, user?.email]);

  // ── Block printing via Ctrl+P
  useEffect(() => {
    if (!documentPreview) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setScreenshotWarning(true);
        setTimeout(() => setScreenshotWarning(false), 2000);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [documentPreview]);

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

  // ── Load BGV review queue
  const loadBgvQueue = useCallback(async () => {
    setBgvQueueLoading(true);
    setBgvQueueError(null);
    try {
      const r = await hrmsApi.get<any>('/api/ats/bgv/queue?status=manual_review,failed,pending');
      const items = Array.isArray(r) ? r : (r?.data ?? []);
      setBgvQueue(items as BgvQueueItem[]);
    } catch (e: any) {
      setBgvQueueError(e?.message || 'Unable to load BGV review queue.');
    } finally {
      setBgvQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mainTab === 'bgv_review') void loadBgvQueue();
  }, [mainTab, loadBgvQueue]);

  // ── Load full BGV detail for a candidate
  const loadBgvDetail = useCallback(async (candidateId: string) => {
    if (bgvDetailCandidate === candidateId) {
      setBgvDetailCandidate(null);
      setBgvDetail(null);
      return;
    }
    setBgvDetailCandidate(candidateId);
    setBgvDetail(null);
    try {
      const r = await hrmsApi.get<any>(`/api/ats/bgv/status/${candidateId}`);
      setBgvDetail((r as BgvDetailData) ?? null);
    } catch {
      setBgvDetail(null);
    }
  }, [bgvDetailCandidate]);

  // ── Submit BGV manual review action
  const submitBgvManualAction = useCallback(async (state: BgvReviewState) => {
    setBgvReviewSaving(true);
    setBgvReviewError(null);
    try {
      await hrmsApi.post(`/api/ats/bgv/candidates/${state.candidateId}/manual-review`, {
        checkId: state.checkId,
        status: state.status,
        remarks: state.remarks,
      });
      setBgvReviewState(null);
      void loadBgvQueue();
      if (bgvDetailCandidate === state.candidateId) void loadBgvDetail(state.candidateId);
    } catch (e: any) {
      setBgvReviewError(e?.message || 'Failed to save review decision.');
    } finally {
      setBgvReviewSaving(false);
    }
  }, [loadBgvQueue, bgvDetailCandidate, loadBgvDetail]);

  // ── Send progress reminder to initiated candidate
  const sendReminder = useCallback(async (row: OnboardingRequest, e: React.MouseEvent) => {
    e.stopPropagation();
    setReminderSendingId(row.candidate_id);
    setReminderResult(null);
    try {
      await hrmsApi.post(`/api/ats/onboarding/candidates/${row.candidate_id}/send-reminder`, {});
      setReminderResult({ id: row.candidate_id, ok: true, msg: `Reminder sent to ${maskEmail(row.email)} / ${maskMobile(row.mobile)}` });
      setTimeout(() => setReminderResult(null), 6000);
    } catch (err: any) {
      setReminderResult({ id: row.candidate_id, ok: false, msg: err?.message || 'Failed to send reminder.' });
      setTimeout(() => setReminderResult(null), 6000);
    } finally {
      setReminderSendingId(null);
    }
  }, []);

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

  // ── Mark candidate as dropped out / not joining — stops every automated
  // (nightly cron) and manual (Resend Link / Send Reminder) follow-up.
  const markNotJoining = useCallback(async (row: OnboardingRequest, e: React.MouseEvent) => {
    e.stopPropagation();
    const reason = window.prompt(
      `Mark ${row.full_name} as dropped out / not joining?\n\nThis stops every further email, SMS and manual follow-up for this candidate. State the reason:`,
    );
    if (reason === null) return; // cancelled
    if (!reason.trim()) { window.alert('A reason is required.'); return; }
    setNotJoiningId(row.candidate_id);
    setNotJoiningResult(null);
    try {
      await hrmsApi.patch(`/api/ats/onboarding/candidates/${row.candidate_id}/not-joining`, { reason: reason.trim() });
      setRows((prev) => prev.map((x) => x.candidate_id === row.candidate_id ? { ...x, candidate_status: 'not_joining' } : x));
      setSelected((prev) => prev && prev.candidate_id === row.candidate_id ? { ...prev, candidate_status: 'not_joining' } : prev);
      setNotJoiningResult({ id: row.candidate_id, ok: true, msg: `${row.full_name} marked as not joining — follow-ups stopped.` });
      setTimeout(() => setNotJoiningResult(null), 6000);
    } catch (err: any) {
      setNotJoiningResult({ id: row.candidate_id, ok: false, msg: err?.message || 'Failed to update status.' });
      setTimeout(() => setNotJoiningResult(null), 6000);
    } finally {
      setNotJoiningId(null);
    }
  }, []);

  const clearNotJoining = useCallback(async (row: OnboardingRequest, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Reactivate follow-ups for ${row.full_name}?`)) return;
    setNotJoiningId(row.candidate_id);
    try {
      await hrmsApi.patch(`/api/ats/onboarding/candidates/${row.candidate_id}/not-joining/clear`, {});
      setRows((prev) => prev.map((x) => x.candidate_id === row.candidate_id ? { ...x, candidate_status: 'selected' } : x));
      setSelected((prev) => prev && prev.candidate_id === row.candidate_id ? { ...prev, candidate_status: 'selected' } : prev);
      setNotJoiningResult({ id: row.candidate_id, ok: true, msg: `${row.full_name} re-activated.` });
      setTimeout(() => setNotJoiningResult(null), 6000);
    } catch (err: any) {
      setNotJoiningResult({ id: row.candidate_id, ok: false, msg: err?.message || 'Failed to update status.' });
      setTimeout(() => setNotJoiningResult(null), 6000);
    } finally {
      setNotJoiningId(null);
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

  // ── Salary packages — refiltered whenever the picked band/cost-centre changes,
  // so the dropdown only offers packages actually assigned under that band
  // (salary_package_master is keyed by branch + cost centre + band).
  useEffect(() => {
    const cc = costCentres.find((c: any) => c.id === offer.cost_centre);
    const params = new URLSearchParams();
    if (selected?.branch_name) params.set('branch', selected.branch_name);
    if (offer.salary_band) params.set('band', offer.salary_band);
    if (cc?.cost_centre_code) params.set('costCentre', cc.cost_centre_code);
    hrmsApi.get<unknown>(`/api/payroll-masters/packages?${params.toString()}`)
      .then((r: any) => setPackages(r?.data ?? []))
      .catch(() => setPackages([]));
  }, [offer.salary_band, offer.cost_centre, selected?.branch_name, costCentres]);

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
    if (filterStatus === 'onboarded') list = list.filter((r) => r.profile_status === 'onboarded' || !!r.employee_id);
    if (filterStatus === 'initiated') list = list.filter((r) => resolveDisplayStatus(r) === 'initiated');
    if (filterStatus === 'profile_submitted') list = list.filter((r) => r.profile_status === 'profile_submitted');
    if (filterStatus === 'not_filled') list = list.filter((r) => r.profile_status === 'onboarding_sent' && (!r.form_step || !FORM_IN_PROGRESS_STEPS.has(r.form_step)));
    if (filterStatus === 'joining_document_pending') list = list.filter((r) => resolveDisplayStatus(r) === 'joining_document_pending');
    if (filterStatus === 'not_joining') list = list.filter((r) => r.candidate_status === 'not_joining');
    if (filterBranch) list = list.filter((r) => r.branch_name === filterBranch);
    if (filterDateFrom) list = list.filter((r) => r.created_at && r.created_at >= filterDateFrom);
    if (filterDateTo) list = list.filter((r) => r.created_at && r.created_at <= filterDateTo + 'T23:59:59');
    return list;
  }, [rows, search, filterStatus, filterBranch, filterDateFrom, filterDateTo]);

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
    setPreviewZoom(1);
    setPreviewRotation(0);
    setPreviewBlurred(false);
    setPreviewGroup([]);
    setPreviewGroupIndex(0);
  };

  const openDocumentPreview = async (preview: DocumentPreview, group: DocumentPreview[] = [], index = 0) => {
    setDocumentPreview(preview);
    setDocumentPreviewError(null);
    setDocumentPreviewLoading(true);
    setPreviewZoom(1);
    setPreviewRotation(0);
    setPreviewBlurred(false);
    setPreviewGroup(group.length > 0 ? group : [preview]);
    setPreviewGroupIndex(index);
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

  const navigatePreview = (direction: -1 | 1) => {
    const newIndex = previewGroupIndex + direction;
    if (newIndex < 0 || newIndex >= previewGroup.length) return;
    const next = previewGroup[newIndex];
    setPreviewGroupIndex(newIndex);
    void openDocumentPreview(next, previewGroup, newIndex);
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

  // ── Access guard — wait for roleKeys to load before evaluating
  if (roleLoading) return null;
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
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-600 text-white p-6 mb-5 shadow-lg">
              <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
              <div className="absolute right-24 bottom-0 h-16 w-16 rounded-full bg-purple-300/20 blur-xl" />
              <p className="text-xs font-bold uppercase tracking-widest text-purple-200">HR · ATS</p>
              <h1 className="mt-1 text-2xl font-bold text-white">Onboarding Requests</h1>
              <p className="mt-1 text-sm text-purple-100">Review candidate profiles, push back corrections, and create offers.</p>
            </div>
            <OnboardingTabBar />
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
              {mainTab === 'onboarding' && (
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search candidates…" className={`${SEL} pl-9`} />
                </div>
              )}
            </div>

            {/* ── Main tabs ── */}
            <div className="flex gap-2 border-b border-slate-200 pb-0">
              <button
                type="button"
                onClick={() => setMainTab('onboarding')}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${mainTab === 'onboarding' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              >
                <FileCheck className="h-4 w-4" /> Onboarding Requests
              </button>
              <button
                type="button"
                onClick={() => setMainTab('bgv_review')}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${mainTab === 'bgv_review' ? 'border-amber-600 text-amber-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              >
                <ShieldAlert className="h-4 w-4" /> BGV Review
                {bgvQueue.filter(q => (q.issue_count ?? 0) > 0).length > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                    {bgvQueue.filter(q => (q.issue_count ?? 0) > 0).length}
                  </span>
                )}
              </button>
            </div>

            {mainTab === 'onboarding' && (
            <div className="flex flex-wrap gap-2 items-center">
              {/* Quick-filter tabs */}
              {([
                { value: '',                 label: 'All',              color: 'slate' },
                { value: 'initiated',        label: 'Initiated',        color: 'blue' },
                { value: 'not_filled',       label: 'Not Filled Yet',   color: 'orange' },
                { value: 'profile_submitted',label: 'Profile Submitted',color: 'amber' },
                { value: 'not_joining',      label: 'Will Not Join',    color: 'red' },
              ] as const).map(({ value, label, color }) => {
                const count = value === ''
                  ? rows.length
                  : value === 'initiated'       ? rows.filter(r => resolveDisplayStatus(r) === 'initiated').length
                  : value === 'not_filled'      ? rows.filter(r => r.profile_status === 'onboarding_sent' && (!r.form_step || !FORM_IN_PROGRESS_STEPS.has(r.form_step))).length
                  : value === 'profile_submitted'? rows.filter(r => r.profile_status === 'profile_submitted').length
                  : value === 'not_joining'     ? rows.filter(r => r.candidate_status === 'not_joining').length
                  : 0;
                const active = filterStatus === value;
                const base = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer select-none';
                const styles: Record<string, string> = {
                  slate:  active ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400',
                  blue:   active ? 'bg-blue-600 text-white border-blue-600'   : 'bg-white text-blue-600 border-blue-200 hover:border-blue-400',
                  orange: active ? 'bg-orange-500 text-white border-orange-500': 'bg-white text-orange-600 border-orange-200 hover:border-orange-400',
                  amber:  active ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-amber-600 border-amber-200 hover:border-amber-400',
                  red:    active ? 'bg-red-600 text-white border-red-600'     : 'bg-white text-red-600 border-red-200 hover:border-red-400',
                };
                return (
                  <button key={value} type="button" className={`${base} ${styles[color]}`} onClick={() => setFilterStatus(value)}>
                    {label}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
                  </button>
                );
              })}
              <select className={`${SEL} w-auto min-w-[160px]`} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">All Statuses</option>
                <option value="initiated">Initiated</option>
                <option value="not_filled">Not Filled Yet</option>
                <option value="profile_submitted">Submitted Profile</option>
                <option value="not_joining">Will Not Join</option>
                <option value="pending_offer">Pending Offer</option>
                <option value="offered">Offered</option>
                <option value="onboarded">Onboarded</option>
                <option value="joining_document_pending">Joining Documents Pending</option>
              </select>
              <select className={`${SEL} w-auto min-w-[160px]`} value={filterBranch} onChange={(e) => setFilterBranch(e.target.value)}>
                <option value="">All Branches</option>
                {branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500 shrink-0">From</span>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className={`${SEL} w-auto`}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500 shrink-0">To</span>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className={`${SEL} w-auto`}
                />
              </div>
              {(filterDateFrom || filterDateTo) && (
                <button
                  type="button"
                  onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); }}
                  className="text-xs text-slate-400 hover:text-slate-600 underline"
                >
                  Clear dates
                </button>
              )}
            </div>
            )}

            {/* ── BGV REVIEW TAB ──────────────────────────────────────── */}
            {mainTab === 'bgv_review' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">BGV Review Queue</h2>
                    <p className="text-sm text-slate-500">Candidates with failed, pending, or auto-approved BGV checks requiring HR action.</p>
                  </div>
                  <Button variant="outline" onClick={() => void loadBgvQueue()} className="min-h-[44px]">
                    {bgvQueueLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
                  </Button>
                </div>

                {bgvQueueLoading && (
                  <div className="flex h-40 items-center justify-center rounded-xl border bg-white">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                  </div>
                )}
                {bgvQueueError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{bgvQueueError}</div>}
                {!bgvQueueLoading && bgvQueue.length === 0 && !bgvQueueError && (
                  <div className="flex flex-col items-center justify-center rounded-xl border bg-white py-16 text-center">
                    <ShieldCheck className="h-12 w-12 text-emerald-400 mb-3" />
                    <p className="font-semibold text-slate-700">All BGV checks are clear</p>
                    <p className="text-sm text-slate-400 mt-1">No candidates require BGV review at this time.</p>
                  </div>
                )}

                {bgvQueue.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3 text-left">Candidate</th>
                          <th className="px-4 py-3 text-left">Branch</th>
                          <th className="px-4 py-3 text-left">BGV Status</th>
                          <th className="px-4 py-3 text-left">Score</th>
                          <th className="px-4 py-3 text-left">Issues</th>
                          <th className="px-4 py-3 text-left">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {bgvQueue.map((q) => (
                          <tr key={q.candidate_id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-3">
                              <p className="font-semibold text-slate-800">{q.full_name}</p>
                              <p className="text-xs text-slate-400">{q.candidate_code}</p>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{q.branch_name}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                (q.issue_count ?? 0) === 0 && (q.verified_count ?? 0) > 0 ? 'bg-emerald-50 text-emerald-700'
                                : (q.issue_count ?? 0) > 0 ? 'bg-red-50 text-red-700'
                                : 'bg-slate-100 text-slate-500'
                              }`}>
                                {(q.issue_count ?? 0) === 0 ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                                {(q.issue_count ?? 0) > 0 ? `${q.issue_count} issue${(q.issue_count ?? 0) > 1 ? 's' : ''}` : (q.verified_count ?? 0) > 0 ? 'checks passed' : 'pending'}
                                {q.is_auto_approved ? ' · Auto-Approved' : ''}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {(q.verified_count ?? 0) > 0 || (q.issue_count ?? 0) > 0 ? (
                                <span className={`font-bold text-sm ${(q.issue_count ?? 0) === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {q.verified_count ?? 0}/{((q.verified_count ?? 0) + (q.issue_count ?? 0))} checks
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {(q.issue_count ?? 0) > 0 && (
                                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">{q.issue_count} issue{(q.issue_count ?? 0) > 1 ? 's' : ''}</span>
                                )}
                                {(q.verified_count ?? 0) > 0 && (
                                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{q.verified_count} verified</span>
                                )}
                                {q.is_auto_approved ? (
                                  <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700">Auto-approved</span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className={`min-h-[36px] text-xs ${bgvDetailCandidate === q.candidate_id ? 'border-slate-400 bg-slate-100' : ''}`}
                                  onClick={() => void loadBgvDetail(q.candidate_id)}
                                >
                                  <Eye className="h-3 w-3 mr-1" />
                                  {bgvDetailCandidate === q.candidate_id ? 'Hide Checks' : 'View Checks'}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="min-h-[36px] text-xs bg-amber-600 hover:bg-amber-700 text-white"
                                  onClick={() => setBgvReviewState({
                                    candidateId: q.candidate_id,
                                    status: 'verified',
                                    remarks: '',
                                    uploading: false,
                                  })}
                                >
                                  <Shield className="h-3 w-3 mr-1" /> Review
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* BGV Full Detail Report Panel */}
                {bgvDetailCandidate && bgvDetail && (() => {
                  const CHECK_LABELS: Record<string, string> = {
                    aadhaar: 'Aadhaar', aadhaar_offline: 'Aadhaar (Offline)', pan: 'PAN',
                    bank: 'Bank Account', name_match: 'Name Match', photo_match: 'Photo Match',
                    education: 'Education', education_doc: 'Education Doc',
                    employment: 'Employment', address: 'Address', address_doc: 'Address Doc',
                    court: 'Court/Criminal', criminal: 'Criminal', digilocker: 'DigiLocker',
                    uan: 'UAN/Employment', aml: 'AML',
                  };
                  const statusCls = (s: string) => {
                    if (s === 'verified') return 'bg-emerald-50 text-emerald-700';
                    if (s === 'failed' || s === 'mismatch') return 'bg-red-50 text-red-700';
                    if (s === 'manual_review') return 'bg-amber-50 text-amber-700';
                    if (s === 'waived') return 'bg-purple-50 text-purple-700';
                    return 'bg-slate-100 text-slate-500';
                  };
                  const overallCls = bgvDetail.overall_status === 'clear' ? 'bg-emerald-100 text-emerald-800'
                    : bgvDetail.overall_status === 'hold' ? 'bg-red-100 text-red-800'
                    : bgvDetail.overall_status === 'conditional' ? 'bg-amber-100 text-amber-800'
                    : 'bg-slate-100 text-slate-600';
                  const score = bgvDetail.score ?? 0;
                  const scoreBarCls = score >= 80 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-400' : 'bg-red-500';
                  const queueItem = bgvQueue.find(q => q.candidate_id === bgvDetailCandidate);
                  return (
                    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
                      {/* Header */}
                      <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-slate-800">{queueItem?.full_name ?? 'BGV Report'}</span>
                          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${overallCls}`}>
                            {bgvDetail.overall_status}
                          </span>
                          {bgvDetail.consent ? (
                            <span className="text-[11px] text-emerald-600 font-medium">✓ Consent granted</span>
                          ) : (
                            <span className="text-[11px] text-amber-600 font-medium">⚠ No consent</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500">BGV Score</span>
                            <div className="w-24 h-2 rounded-full bg-slate-200">
                              <div className={`h-2 rounded-full ${scoreBarCls}`} style={{ width: `${score}%` }} />
                            </div>
                            <span className={`text-xs font-bold ${score >= 80 ? 'text-emerald-700' : score >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{score}/100</span>
                          </div>
                          <button type="button" onClick={() => { setBgvDetailCandidate(null); setBgvDetail(null); }} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
                        </div>
                      </div>

                      {/* Missing mandatory checks */}
                      {bgvDetail.missing_mandatory_checks.length > 0 && (
                        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800 font-medium">
                          ⚠ Missing mandatory checks: {bgvDetail.missing_mandatory_checks.join(', ')}
                        </div>
                      )}

                      <div className="p-4 space-y-4">
                        {/* Checks table */}
                        {bgvDetail.checks.length > 0 ? (
                          <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Verification Checks</p>
                            <div className="overflow-x-auto rounded-lg border">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wide">
                                  <tr>
                                    <th className="px-3 py-2 text-left">Check</th>
                                    <th className="px-3 py-2 text-left">Status</th>
                                    <th className="px-3 py-2 text-left">Match Score</th>
                                    <th className="px-3 py-2 text-left">Matched Name</th>
                                    <th className="px-3 py-2 text-left">Provider</th>
                                    <th className="px-3 py-2 text-left">Verified At</th>
                                    <th className="px-3 py-2 text-left">Notes</th>
                                    <th className="px-3 py-2 text-left">Action</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y">
                                  {bgvDetail.checks.map((c) => (
                                    <tr key={c.id} className="hover:bg-slate-50/50">
                                      <td className="px-3 py-2 font-semibold text-slate-700">{CHECK_LABELS[c.check_type] ?? c.check_type.replace(/_/g, ' ')}</td>
                                      <td className="px-3 py-2">
                                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusCls(c.status)}`}>{c.status}</span>
                                        {c.is_auto_approved ? <span className="ml-1 rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-600">Auto</span> : null}
                                      </td>
                                      <td className="px-3 py-2 text-slate-600">{c.match_score != null ? `${c.match_score}%` : '—'}</td>
                                      <td className="px-3 py-2 text-slate-600 max-w-[120px] truncate">{c.matched_name || '—'}</td>
                                      <td className="px-3 py-2 text-slate-500">{c.provider_key || '—'}</td>
                                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{c.verified_at ? new Date(c.verified_at).toLocaleDateString('en-IN') : '—'}</td>
                                      <td className="px-3 py-2 text-slate-500 max-w-[140px]">
                                        {c.result_summary && <span className="block truncate" title={c.result_summary}>{c.result_summary}</span>}
                                        {c.review_remarks && <span className="block truncate text-amber-700" title={c.review_remarks}>{c.review_remarks}</span>}
                                      </td>
                                      <td className="px-3 py-2">
                                        {c.status !== 'verified' && (
                                          <Button type="button" size="sm" variant="outline" className="min-h-[28px] text-[11px] px-2"
                                            onClick={() => setBgvReviewState({ candidateId: bgvDetailCandidate, checkId: c.id, status: 'verified', remarks: '', uploading: false })}
                                          >Override</Button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-slate-400 text-center py-4">No verification checks recorded yet.</p>
                        )}

                        {/* Bank verifications */}
                        {bgvDetail.bank_verifications.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Bank Verifications</p>
                            <div className="space-y-1">
                              {bgvDetail.bank_verifications.map((b, i) => (
                                <div key={i} className="flex items-center gap-3 rounded-lg border bg-slate-50 px-3 py-2 text-xs">
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusCls(b.verification_status)}`}>{b.verification_status}</span>
                                  <span className="text-slate-500">{b.verification_method ?? '—'}</span>
                                  <span className="text-slate-700 font-medium">{b.input_account_holder_name ?? '—'}</span>
                                  {b.provider_account_holder_name && b.provider_account_holder_name !== b.input_account_holder_name && (
                                    <span className="text-amber-600">Provider: {b.provider_account_holder_name}</span>
                                  )}
                                  {b.name_match_score != null && <span className="text-slate-500">Match: {b.name_match_score}%</span>}
                                  {b.verified_at && <span className="text-slate-400">{new Date(b.verified_at).toLocaleDateString('en-IN')}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Documents */}
                        {bgvDetail.documents.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Uploaded Documents</p>
                            <div className="flex flex-wrap gap-2">
                              {bgvDetail.documents.map((d) => (
                                <div key={d.id} className="flex items-center gap-1.5 rounded-lg border bg-slate-50 px-2.5 py-1.5 text-xs">
                                  <span className="font-medium text-slate-700">{d.doc_type.replace(/_/g, ' ')}</span>
                                  {d.doc_name && <span className="text-slate-400">— {d.doc_name}</span>}
                                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                                    d.document_status === 'verified' ? 'bg-emerald-50 text-emerald-700'
                                    : d.document_status === 'rejected' ? 'bg-red-50 text-red-700'
                                    : 'bg-slate-100 text-slate-500'
                                  }`}>{d.document_status}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* BGV Manual Review Modal */}
                {bgvReviewState && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
                      <div className="flex items-center justify-between border-b px-5 py-4">
                        <h3 className="font-bold text-slate-800">BGV Manual Review Decision</h3>
                        <button type="button" onClick={() => { setBgvReviewState(null); setBgvReviewError(null); }}><X className="h-4 w-4 text-slate-400" /></button>
                      </div>
                      <div className="p-5 space-y-4">
                        {bgvReviewError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{bgvReviewError}</div>}

                        <div>
                          <label className="block text-xs font-bold text-slate-600 mb-1.5">Decision</label>
                          <div className="flex flex-wrap gap-2">
                            {(['verified', 'manual_review', 'mismatch', 'failed'] as BgvManualAction[]).map(s => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => setBgvReviewState(p => p ? { ...p, status: s } : p)}
                                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${bgvReviewState.status === s
                                  ? s === 'verified' ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                    : s === 'failed' ? 'border-red-500 bg-red-50 text-red-700'
                                    : 'border-amber-500 bg-amber-50 text-amber-700'
                                  : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}
                              >
                                {s === 'verified' ? '✓ Verified (Manual)' : s === 'failed' ? '✗ Failed' : s === 'mismatch' ? '⚠ Mismatch' : '⏳ Manual Review'}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-600 mb-1.5">Remarks / Evidence Reference <span className="text-red-500">*</span></label>
                          <textarea
                            rows={3}
                            value={bgvReviewState.remarks}
                            onChange={e => setBgvReviewState(p => p ? { ...p, remarks: e.target.value } : p)}
                            placeholder="Document reference, manual verification notes, or waiver reason…"
                            className={`${SEL} resize-none`}
                          />
                        </div>

                        <div className="flex gap-3 pt-2">
                          <Button
                            type="button"
                            className="flex-1 min-h-[44px]"
                            disabled={bgvReviewSaving || !bgvReviewState.remarks.trim()}
                            onClick={() => void submitBgvManualAction(bgvReviewState)}
                          >
                            {bgvReviewSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Save Decision
                          </Button>
                          <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => { setBgvReviewState(null); setBgvReviewError(null); }}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── ONBOARDING TAB content guard ── */}
            {mainTab === 'onboarding' && <>

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

            {/* Not Joining / Reactivate result toast */}
            {notJoiningResult && (
              <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${notJoiningResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {notJoiningResult.ok
                  ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-500" />
                  : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />}
                {notJoiningResult.msg}
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
                      <th className="px-4 py-3 text-left">Date</th>
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
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                          {r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{r.branch_name || '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{r.process_name || r.applied_for_process || '—'}</td>
                        <td className="px-4 py-3"><StatusBadge status={resolveDisplayStatus(r)} /></td>
                        <td className="px-4 py-3"><OfferBadge status={r.offer_status} /></td>
                        <td className="px-4 py-3 text-slate-600">{r.documents_uploaded ?? 0}</td>
                        <td className="px-4 py-3 text-slate-600 capitalize">{statusLabel(r.bank_verification_status)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {r.candidate_status === 'not_joining' ? (
                              canMarkNotJoining && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={notJoiningId === r.candidate_id}
                                  onClick={(e) => void clearNotJoining(r, e)}
                                  className="min-h-[32px] gap-1 text-slate-600 border-slate-200 hover:bg-slate-50"
                                >
                                  {notJoiningId === r.candidate_id
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : null}
                                  Reactivate
                                </Button>
                              )
                            ) : (
                              <>
                                {['onboarding_sent', 'profile_in_progress', 'profile_submitted'].includes(r.profile_status) ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={resendingId === r.candidate_id}
                                    onClick={(e) => void resendLink(r, e)}
                                    className="min-h-[32px] gap-1 text-blue-700 border-blue-200 hover:bg-blue-50"
                                  >
                                    {resendingId === r.candidate_id
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : <Send className="h-3.5 w-3.5" />}
                                    Resend
                                  </Button>
                                ) : (
                                  <span className="text-xs text-slate-300">—</span>
                                )}
                                {r.form_step && FORM_IN_PROGRESS_STEPS.has(r.form_step) && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={reminderSendingId === r.candidate_id}
                                    onClick={(e) => void sendReminder(r, e)}
                                    className="min-h-[32px] gap-1 text-orange-700 border-orange-200 hover:bg-orange-50"
                                  >
                                    {reminderSendingId === r.candidate_id
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : <Send className="h-3.5 w-3.5" />}
                                    Remind
                                  </Button>
                                )}
                                {canMarkNotJoining && !r.employee_id && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={notJoiningId === r.candidate_id}
                                    onClick={(e) => void markNotJoining(r, e)}
                                    className="min-h-[32px] gap-1 text-slate-500 border-slate-200 hover:bg-slate-50"
                                  >
                                    {notJoiningId === r.candidate_id
                                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      : <X className="h-3.5 w-3.5" />}
                                    Not Joining
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
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
            </> /* end onboarding tab */}
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
                <StatusBadge status={resolveDisplayStatus(selected)} />
                {selected.employee_id && selected.employee_code && (
                  <Link
                    to={`/employees/${selected.employee_id}/joining-documents`}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors shadow-sm"
                  >
                    <FileCheck className="h-4 w-4" />
                    Post-Onboarding Documents ({selected.employee_code})
                  </Link>
                )}
                {selected.candidate_status !== 'not_joining' && ['onboarding_sent', 'profile_in_progress', 'profile_submitted'].includes(selected.profile_status) && (
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
                {selected.candidate_status !== 'not_joining' && selected.form_step && FORM_IN_PROGRESS_STEPS.has(selected.form_step) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={reminderSendingId === selected.candidate_id}
                    onClick={(e) => void sendReminder(selected, e)}
                    className="gap-1 min-h-[36px] text-orange-700 border-orange-200 hover:bg-orange-50"
                  >
                    {reminderSendingId === selected.candidate_id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Send className="h-3.5 w-3.5" />}
                    Send Reminder
                  </Button>
                )}
                {canMarkNotJoining && !selected.employee_id && (
                  selected.candidate_status === 'not_joining' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={notJoiningId === selected.candidate_id}
                      onClick={(e) => void clearNotJoining(selected, e)}
                      className="gap-1 min-h-[36px] text-slate-600 border-slate-200 hover:bg-slate-50"
                    >
                      {notJoiningId === selected.candidate_id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Reactivate Candidate
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={notJoiningId === selected.candidate_id}
                      onClick={(e) => void markNotJoining(selected, e)}
                      className="gap-1 min-h-[36px] text-slate-500 border-slate-200 hover:bg-slate-50"
                    >
                      {notJoiningId === selected.candidate_id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <X className="h-3.5 w-3.5" />}
                      Mark as Not Joining
                    </Button>
                  )
                )}
              </div>
            </div>

            {selected.candidate_status === 'not_joining' && (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600">
                <X className="h-4 w-4 shrink-0" />
                This candidate is marked as not joining — all automated and manual follow-ups are stopped.
              </div>
            )}

            {/* Action result toasts (detail view) */}
            {notJoiningResult && notJoiningResult.id === selected.candidate_id && (
              <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${notJoiningResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {notJoiningResult.ok
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  : <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />}
                {notJoiningResult.msg}
              </div>
            )}
            {resendResult && resendResult.id === selected.candidate_id && (
              <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${resendResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {resendResult.ok
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  : <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />}
                {resendResult.msg}
              </div>
            )}
            {reminderResult && reminderResult.id === selected.candidate_id && (
              <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium ${reminderResult.ok ? 'border-orange-200 bg-orange-50 text-orange-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {reminderResult.ok
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-orange-500" />
                  : <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />}
                {reminderResult.msg}
              </div>
            )}

            {/* B — Profile review: completeness strip + always-visible section grid */}
            <div className="space-y-4">
              {/* Completeness strip */}
              <div className="rounded-xl border bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    Onboarding Profile Review
                    {detailLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                  </h3>
                  <span className="text-xs font-semibold text-slate-500">
                    {stepComplete.filter(Boolean).length}/{stepComplete.length} sections complete
                  </span>
                </div>

                {/* In-progress banner — shown when candidate started the form but hasn't submitted */}
                {selected.form_step && FORM_IN_PROGRESS_STEPS.has(selected.form_step) && (
                  <div className="mb-3 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 flex flex-wrap items-center gap-3">
                    <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-bold text-orange-700">Form in progress — not yet submitted</span>
                      <span className="mx-2 text-orange-300">·</span>
                      <span className="text-xs text-orange-600">
                        Last active step: <strong>{STEP_LABELS[selected.current_step_idx ?? 0] ?? `Step ${(selected.current_step_idx ?? 0) + 1}`}</strong>
                        {' '}(step {(selected.current_step_idx ?? 0) + 1} of {STEP_LABELS.length})
                      </span>
                    </div>
                    {selected.form_last_activity && (
                      <span className="text-[11px] text-orange-500 whitespace-nowrap">
                        Last saved: {new Date(selected.form_last_activity).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {STEP_LABELS.map((label, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${stepComplete[i] ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                    >
                      {stepComplete[i] ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              {detailError && <ErrorBanner message={detailError} onRetry={() => void openDetail(selected)} />}

              {!detailLoading && !detailError && (
                <div className="grid gap-4 md:grid-cols-2">

                  {/* 1 — Welcome & Consent */}
                  <SectionCard n={1} label={STEP_LABELS[0]} complete={stepComplete[0]}>
                    <InfoRow label="DPDP Consent" value={dp.dpdp_consent ? 'Yes' : 'No'} />
                    <InfoRow label="OTP Verified" value={dp.otp_verified ? 'Yes' : 'No'} />
                    <InfoRow label="BGV Consent" value={dp.bgv_consent ? 'Yes' : 'No'} />
                    <InfoRow label="OTP Mobile" value={dp.otp_mobile} />
                    <InfoRow label="OTP Verified At" value={dp.otp_verified_at} />
                  </SectionCard>

                  {/* 2 — Personal Details */}
                  <SectionCard n={2} label={STEP_LABELS[1]} complete={stepComplete[1]}>
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
                  </SectionCard>

                  {/* 3 — Address & KYC */}
                  <SectionCard n={3} label={STEP_LABELS[2]} complete={stepComplete[2]}>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Permanent Address</p>
                    <InfoRow label="Address" value={dp.permanent_address} />
                    <InfoRow label="City" value={dp.permanent_city} />
                    <InfoRow label="State" value={dp.permanent_state} />
                    <InfoRow label="Pincode" value={dp.permanent_pincode} />
                    <p className="mt-3 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Present Address</p>
                    <InfoRow label="Address" value={dp.present_address} />
                    <InfoRow label="City" value={dp.present_city} />
                    <InfoRow label="State" value={dp.present_state} />
                    <InfoRow label="Pincode" value={dp.present_pincode} />
                    <p className="mt-3 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">ID Documents</p>
                    <InfoRow label="Passport" value={dp.passport_no} />
                    <InfoRow label="Driving License" value={dp.driving_license_no} />
                    <InfoRow label="Address Proof Type" value={dp.address_proof_type} />
                  </SectionCard>

                  {/* 4 — Documents */}
                  <SectionCard n={4} label={STEP_LABELS[3]} complete={stepComplete[3]}>
                    {docs.length === 0 ? (
                      <p className="py-2 text-sm text-slate-400">No documents uploaded.</p>
                    ) : (() => {
                      // group docs by document_type so multi-page docs (e.g. Aadhaar front+back) are shown together
                      const groups: Record<string, any[]> = {};
                      docs.forEach((d) => {
                        const key = d.document_type || d.doc_type || d.doc_name || 'Document';
                        if (!groups[key]) groups[key] = [];
                        groups[key].push(d);
                      });
                      return Object.entries(groups).map(([groupType, groupDocs]) => {
                        const previewItems: DocumentPreview[] = groupDocs.map((d) => ({
                          id: d.id,
                          title: `${groupType}${groupDocs.length > 1 ? ` (${groupDocs.indexOf(d) + 1}/${groupDocs.length})` : ''}`,
                          fileName: d.file_original_name || 'document',
                          mimeType: d.mime_type,
                          downloadAllowed: canDownloadDocs(role),
                        }));
                        return (
                          <div key={groupType} className="border-b border-slate-100 py-2 last:border-0">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-700">{groupType}</p>
                                <p className="text-xs text-slate-400">{groupDocs.length} file{groupDocs.length > 1 ? 's' : ''}</p>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void openDocumentPreview(previewItems[0], previewItems, 0)}
                                className="min-h-[36px] gap-1 shrink-0"
                              >
                                <Eye className="h-3.5 w-3.5" /> Preview{groupDocs.length > 1 ? ` (${groupDocs.length})` : ''}
                              </Button>
                            </div>
                            {groupDocs.length > 1 && (
                              <div className="mt-1.5 space-y-1 pl-2">
                                {groupDocs.map((d, idx) => (
                                  <div key={d.id} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1">
                                    <p className="truncate text-xs text-slate-500">{d.file_original_name}{d.file_size_bytes ? ` · ${Math.round(d.file_size_bytes / 1024)} KB` : ''}</p>
                                    <button
                                      type="button"
                                      onClick={() => void openDocumentPreview(previewItems[idx], previewItems, idx)}
                                      className="shrink-0 text-xs text-blue-600 hover:underline"
                                    >
                                      View
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </SectionCard>

                  {/* 5 — BGV & Verification */}
                  <SectionCard n={5} label={STEP_LABELS[4]} complete={stepComplete[4]}>
                    <InfoRow label="BGV Consent" value={dp.bgv_consent ? 'Given' : 'Not given'} />
                    <InfoRow label="DigiLocker Status" value={digi.status} />
                    <InfoRow label="DigiLocker Provider" value={digi.provider} />
                    {/* eSign status + download */}
                    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                      <span className="text-xs text-slate-500 shrink-0">eSign Status</span>
                      <div className="flex items-center gap-2">
                        {esign.status === 'signed' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 border border-green-200">
                            ✓ Signed
                          </span>
                        ) : esign.status === 'override' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 border border-purple-200">
                            Override
                          </span>
                        ) : esign.status === 'pending' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">
                            Pending
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">{esign.status ?? '—'}</span>
                        )}
                        {esign.status === 'signed' && (
                          <div className="flex items-center gap-1.5">
                            <a
                              href={`/api/letters/appointment/by-candidate/${selected.candidate_id}/download`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                            >
                              ↓ Download
                            </a>
                            <button
                              type="button"
                              disabled={sendLetterLoading}
                              onClick={async () => {
                                setSendLetterLoading(true);
                                setSendLetterResult(null);
                                try {
                                  await hrmsApi.post(`/api/letters/appointment/by-candidate/${selected.candidate_id}/hr-send`, {});
                                  setSendLetterResult({ ok: true, msg: 'Appointment letter sent to employee email.' });
                                  setTimeout(() => setSendLetterResult(null), 6000);
                                } catch (e: any) {
                                  setSendLetterResult({ ok: false, msg: e?.message ?? 'Failed to send' });
                                } finally {
                                  setSendLetterLoading(false);
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 disabled:opacity-50 transition-colors"
                            >
                              {sendLetterLoading ? '…' : '✉ Resend Email'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {sendLetterResult && (
                      <p className={`text-xs mt-1 ${sendLetterResult.ok ? 'text-green-600' : 'text-red-500'}`}>{sendLetterResult.msg}</p>
                    )}
                    <InfoRow label="eSign Provider" value={esign.provider} />
                    {bgv && (
                      <>
                        <p className="mt-3 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">BGV Result</p>
                        <InfoRow label="Overall Status" value={bgv.overall_status} />
                        <InfoRow label="Score" value={bgv.score != null ? String(bgv.score) : undefined} />
                        {(bgv.checks ?? []).map((c, idx) => (
                          <InfoRow key={idx} label={c.check_type} value={`${c.status}${c.result_summary ? ' · ' + c.result_summary : ''}`} />
                        ))}
                      </>
                    )}
                  </SectionCard>

                  {/* 6 — Bank Details */}
                  <SectionCard n={6} label={STEP_LABELS[5]} complete={stepComplete[5]}>
                    <InfoRow label="Bank Name" value={db.bank_name} />
                    <InfoRow label="Branch" value={db.branch_name} />
                    <InfoRow label="Account Holder" value={db.account_holder_name} />
                    <InfoRow label="Account No." value={maskId(db.account_no_masked || db.account_number)} />
                    <InfoRow label="IFSC" value={db.ifsc_code} />
                    <InfoRow label="Account Type" value={db.account_type} />
                    <InfoRow label="Verification Status" value={db.verification_status} />
                    <InfoRow label="Name Match" value={db.name_validation_status} />
                  </SectionCard>

                  {/* 7 — Education */}
                  <SectionCard n={7} label={STEP_LABELS[6]} complete={stepComplete[6]}>
                    {quals.length === 0 ? (
                      <p className="py-2 text-sm text-slate-400">No education records.</p>
                    ) : quals.map((q, i) => (
                      <div key={q.id || i} className={i > 0 ? 'mt-3 pt-3 border-t border-slate-100' : ''}>
                        <InfoRow label="Qualification" value={q.qualification} />
                        <InfoRow label="Specialization" value={q.specialization_course_name} />
                        <InfoRow label="Year" value={q.passed_out_year} />
                        <InfoRow label="Percentage" value={q.passed_out_percentage ? `${q.passed_out_percentage}%` : undefined} />
                        <InfoRow label="State" value={q.passed_out_state} />
                        <InfoRow label="City" value={q.passed_out_city} />
                      </div>
                    ))}
                  </SectionCard>

                  {/* 8 — Experience */}
                  <SectionCard n={8} label={STEP_LABELS[7]} complete={stepComplete[7]}>
                    <InfoRow label="Experience Type" value={exp.working_experience} />
                    <InfoRow label="Years" value={exp.experience_year} />
                    <InfoRow label="Employer" value={exp.employer_name} />
                    <InfoRow label="Last Designation" value={exp.last_designation} />
                    <InfoRow label="Last CTC" value={exp.last_ctc ? fmt(exp.last_ctc) : undefined} />
                    <InfoRow label="Doc Type" value={exp.experience_doc_type} />
                  </SectionCard>

                  {/* 9 — Family & Language */}
                  <SectionCard n={9} label={STEP_LABELS[8]} complete={stepComplete[8]}>
                    <InfoRow label="Annual Income" value={fam.annual_income != null ? fmt(fam.annual_income) : undefined} />
                    <InfoRow label="Dependents" value={fam.count_of_dependents != null ? String(fam.count_of_dependents) : undefined} />
                  </SectionCard>

                  {/* 10 — Statutory Declaration */}
                  <SectionCard n={10} label={STEP_LABELS[9]} complete={stepComplete[9]}>
                    <InfoRow label="EPS Member" value={dp.eps_member != null ? (dp.eps_member ? 'Yes' : 'No') : undefined} />
                    <InfoRow label="Previous PF Member" value={dp.previous_pf_member != null ? (dp.previous_pf_member ? 'Yes' : 'No') : undefined} />
                    <InfoRow label="International Worker" value={dp.international_worker != null ? (dp.international_worker ? 'Yes' : 'No') : undefined} />
                    <InfoRow label="UAN Number" value={dp.uan_number} />
                    <InfoRow label="EPF Number" value={dp.epf_number} />
                    <InfoRow label="ESIC Number" value={dp.esic_number} />
                    <InfoRow label="Declaration Accepted" value={dp.statutory_declaration_accepted ? 'Yes' : 'No'} />
                    <InfoRow label="Declaration At" value={dp.statutory_declaration_at} />
                  </SectionCard>

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

        {/* ── SECURE DOCUMENT VIEWER ──────────────────────────────────────── */}
        {/* Print blocking style */}
        <style>{`@media print { .secure-doc-viewer, .secure-doc-viewer * { display: none !important; visibility: hidden !important; } }`}</style>

        {documentPreview && (
          <div
            className="secure-doc-viewer fixed inset-0 z-[60] flex flex-col bg-[#0f1117] print:hidden"
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* Top toolbar */}
            <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#1a1d27] px-4">
              {/* Left — doc info */}
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600/20">
                  <FileCheck className="h-4 w-4 text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white leading-tight">{documentPreview.title}</p>
                  <p className="text-[11px] text-slate-400 leading-tight flex items-center gap-1">
                    <Shield className="h-3 w-3 text-emerald-400" />
                    Secure Preview
                    {!documentPreview.downloadAllowed && (
                      <span className="ml-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-400 uppercase tracking-wide">Protected</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Center — zoom + navigation controls */}
              <div className="flex items-center gap-1">
                {/* Zoom controls */}
                <button
                  type="button"
                  onClick={() => setPreviewZoom(z => Math.max(z - 0.25, 0.25))}
                  disabled={previewZoom <= 0.25}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 disabled:opacity-30 transition-colors"
                  title="Zoom out (−)"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewZoom(1)}
                  className="min-w-[52px] rounded-lg px-2 py-1 text-xs font-mono font-semibold text-slate-300 hover:bg-white/10 transition-colors"
                  title="Reset zoom (0)"
                >
                  {Math.round(previewZoom * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewZoom(z => Math.min(z + 0.25, 4))}
                  disabled={previewZoom >= 4}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 disabled:opacity-30 transition-colors"
                  title="Zoom in (+)"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>

                {/* Separator */}
                <div className="mx-2 h-5 w-px bg-white/10" />

                {/* Rotation controls */}
                <button
                  type="button"
                  onClick={() => setPreviewRotation(r => (r - 90 + 360) % 360)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
                  title="Rotate left (Shift+R)"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewRotation(r => (r + 90) % 360)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
                  title="Rotate right (R)"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                {previewRotation !== 0 && (
                  <span className="text-[10px] font-mono text-slate-500">{previewRotation}°</span>
                )}

                {/* Separator */}
                <div className="mx-2 h-5 w-px bg-white/10" />

                {/* Fit to screen */}
                <button
                  type="button"
                  onClick={() => { setPreviewZoom(1); setPreviewRotation(0); }}
                  className="flex h-8 items-center gap-1 rounded-lg px-2 text-slate-300 hover:bg-white/10 transition-colors text-xs"
                  title="Reset view (0)"
                >
                  <Maximize2 className="h-3.5 w-3.5" /> Fit
                </button>

                {/* Separator */}
                <div className="mx-2 h-5 w-px bg-white/10" />

                {/* Group navigation */}
                {previewGroup.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => navigatePreview(-1)}
                      disabled={previewGroupIndex === 0}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 disabled:opacity-30 transition-colors"
                      title="Previous (←)"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="min-w-[48px] text-center text-xs font-medium text-slate-400">
                      {previewGroupIndex + 1} / {previewGroup.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigatePreview(1)}
                      disabled={previewGroupIndex === previewGroup.length - 1}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 disabled:opacity-30 transition-colors"
                      title="Next (→)"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <div className="mx-2 h-5 w-px bg-white/10" />
                  </>
                )}
              </div>

              {/* Right — download + close */}
              <div className="flex items-center gap-2">
                {documentPreview.downloadAllowed ? (
                  <button
                    type="button"
                    onClick={() => void downloadDocumentPreview()}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </button>
                ) : (
                  <div className="flex h-8 items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-xs font-semibold text-red-400">
                    <Shield className="h-3.5 w-3.5" /> Download Restricted
                  </div>
                )}
                <button
                  type="button"
                  onClick={closeDocumentPreview}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                  title="Close (Esc)"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Viewer area */}
            <div className="relative flex-1 overflow-auto bg-[#0f1117]">
              {documentPreviewError ? (
                <div className="flex h-full items-center justify-center">
                  <ErrorBanner message={documentPreviewError} onRetry={() => void openDocumentPreview(documentPreview, previewGroup, previewGroupIndex)} />
                </div>
              ) : documentPreviewLoading ? (
                <div className="flex h-full flex-col items-center justify-center gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                  <p className="text-sm text-slate-400">Loading document…</p>
                </div>
              ) : documentPreviewUrl && documentPreview.mimeType?.startsWith('image/') ? (
                /* IMAGE viewer */
                <div
                  className={`flex min-h-full min-w-full items-center justify-center p-6 transition-all duration-300 ${previewBlurred ? 'blur-xl' : ''}`}
                  style={{ cursor: previewZoom > 1 ? 'grab' : 'default' }}
                >
                  <div
                    className="relative"
                    style={{
                      transform: `scale(${previewZoom}) rotate(${previewRotation}deg)`,
                      transformOrigin: 'center center',
                      transition: 'transform 0.2s ease',
                    }}
                  >
                    <img
                      src={documentPreviewUrl}
                      alt={documentPreview.title}
                      draggable={false}
                      onContextMenu={(e) => e.preventDefault()}
                      onDragStart={(e) => e.preventDefault()}
                      className="max-w-none rounded-lg shadow-2xl select-none"
                      style={{ WebkitUserDrag: 'none' } as React.CSSProperties}
                    />
                    {/* Watermark overlay with viewer identity — makes screenshots traceable */}
                    <div
                      className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg overflow-hidden select-none"
                      style={{ background: 'repeating-linear-gradient(45deg, transparent, transparent 80px, rgba(255,255,255,0.02) 80px, rgba(255,255,255,0.02) 81px)' }}
                    >
                      {/* Tiled identity watermarks */}
                      <div className="absolute inset-0 flex flex-wrap content-center justify-center gap-x-24 gap-y-20 p-8 opacity-[0.09]">
                        {Array.from({ length: 9 }).map((_, i) => (
                          <div key={i} className="rotate-[-32deg] text-center">
                            <div className="whitespace-nowrap text-base font-black text-white tracking-wide">MAS CALLNET · CONFIDENTIAL</div>
                            <div className="whitespace-nowrap text-[11px] font-semibold text-white/80 mt-0.5">{user?.email ?? 'Unknown'}</div>
                            <div className="whitespace-nowrap text-[10px] font-medium text-white/60">{new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                          </div>
                        ))}
                      </div>
                      {/* Corner identity stamp — always visible */}
                      <div className="absolute bottom-3 right-3 rounded bg-black/40 px-2 py-1 text-[9px] font-mono text-white/50 backdrop-blur-sm">
                        Viewed by {user?.email ?? '—'} · {new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* PDF / other — use iframe with blocking overlay */
                <div className={`relative h-full w-full transition-all duration-300 ${previewBlurred ? 'blur-xl' : ''}`}>
                  <iframe
                    src={documentPreviewUrl ?? undefined}
                    title={documentPreview.title}
                    className="h-full w-full border-0"
                    sandbox="allow-scripts allow-same-origin"
                    style={{ transform: `scale(${previewZoom})`, transformOrigin: 'top left', width: `${100 / previewZoom}%`, height: `${100 / previewZoom}%` }}
                  />
                  {/* Identity watermark + right-click blocker overlay */}
                  <div
                    className="pointer-events-none absolute inset-0 z-10 select-none"
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    {/* Corner identity stamp — always visible on PDFs */}
                    <div className="absolute bottom-3 right-3 rounded bg-black/50 px-2 py-1 text-[9px] font-mono text-white/60 backdrop-blur-sm pointer-events-none">
                      Viewed by {user?.email ?? '—'} · {new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom strip — thumbnails for multi-doc group */}
            {previewGroup.length > 1 && (
              <div className="flex h-16 shrink-0 items-center gap-2 overflow-x-auto border-t border-white/10 bg-[#1a1d27] px-4">
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Pages</span>
                {previewGroup.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void openDocumentPreview(item, previewGroup, idx)}
                    className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      idx === previewGroupIndex
                        ? 'border-blue-500 bg-blue-600/20 text-blue-300'
                        : 'border-white/10 text-slate-400 hover:border-white/30 hover:text-white'
                    }`}
                  >
                    {idx + 1}
                  </button>
                ))}
                <span className="ml-auto shrink-0 text-[11px] text-slate-500">
                  {previewGroupIndex + 1} of {previewGroup.length}
                </span>
              </div>
            )}

            {/* Keyboard hint */}
            <div className="flex h-7 shrink-0 items-center justify-center gap-4 border-t border-white/5 bg-[#13151f]">
              <span className="text-[10px] text-slate-600">ESC close</span>
              <span className="text-[10px] text-slate-600">← → navigate</span>
              <span className="text-[10px] text-slate-600">+ − zoom</span>
              <span className="text-[10px] text-slate-600">R rotate</span>
              <span className="text-[10px] text-slate-600">0 reset</span>
            </div>

            {/* Blur overlay when window loses focus */}
            {previewBlurred && !screenshotWarning && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                <div className="text-center">
                  <Shield className="h-12 w-12 text-amber-400 mx-auto mb-3" />
                  <p className="text-lg font-semibold text-white">Document Protected</p>
                  <p className="text-sm text-slate-400 mt-1">Click here to view</p>
                </div>
              </div>
            )}

            {/* Screenshot attempt warning */}
            {screenshotWarning && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-red-950/95 backdrop-blur-md">
                <div className="text-center max-w-md px-6">
                  <AlertTriangle className="h-16 w-16 text-red-400 mx-auto mb-4 animate-pulse" />
                  <p className="text-xl font-bold text-white">Screenshot Detected</p>
                  <p className="text-sm text-red-200 mt-2">
                    This action has been logged. Unauthorized capture of confidential documents is prohibited.
                  </p>
                  <div className="mt-4 rounded-lg bg-red-900/50 px-4 py-2 text-xs font-mono text-red-300">
                    User: {user?.email ?? '—'}<br />
                    Time: {new Date().toLocaleString('en-IN')}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
