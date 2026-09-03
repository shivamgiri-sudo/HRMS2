import React, { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { HeadcountShortagePanel } from '@/components/workforce/HeadcountShortagePanel';
import { hrmsApi } from '@/lib/hrmsApi';
import { formatISTDate } from '@/lib/utils';
import {
  Users, Target, Clock, CheckCircle, AlertCircle,
  Plus, Search, Briefcase, Calendar,
  ChevronRight, Eye, Edit, Send, ThumbsUp, ThumbsDown,
  GraduationCap, FileText, TrendingUp, X,
  Trash2, Download, Mail, Bell, UserPlus, Phone, ArrowUpDown,
  UserCheck
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

type ApprovalStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'cancelled' | 'on_hold' | 'closed';
type RequisitionPriority = 'low' | 'normal' | 'high' | 'urgent';
type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern' | 'trainee';
type SortKey = 'deadline_asc' | 'deadline_desc' | 'priority' | 'aging_desc' | 'created_desc' | 'fill_rate';

interface JobRequisition {
  id: string;
  requisition_code: string;
  designation_name: string;
  department_name: string | null;
  branch_name: string;
  process_name: string | null;
  requested_headcount: number;
  fulfilled_headcount: number;
  open_positions: number;
  employment_type: EmploymentType;
  salary_min: number | null;
  salary_max: number | null;
  priority: RequisitionPriority;
  requisition_type: string;
  approval_status: ApprovalStatus;
  target_joining_date: string | null;
  requisition_validity: string | null;
  handover_status?: 'not_ready' | 'ready' | 'handed_over';
  handover_at?: string | null;
  requested_by_name: string | null;
  requester_name: string | null;
  requester_designation: string | null;
  requester_role: string | null;
  approver_name: string | null;
  approver_designation: string | null;
  approver_role: string | null;
  owner_recruiter_name: string | null;
  aging_days: number;
  derived_status: string;
  total_candidates: number;
  selected_candidates: number;
  pipeline_candidates: number;
  interviewed_candidates?: number;
  rejected_candidates?: number;
  created_at: string;
  business_justification: string | null;
  process_id?: string | null;
  planned_batch_no?: string | null;
  training_start_date?: string | null;
}

interface DashboardMetrics {
  total_requisitions: number;
  open_requisitions: number;
  pending_approval: number;
  approved_active: number;
  total_open_positions: number;
  total_fulfilled: number;
  fill_rate_percent: number;
  avg_time_to_fill_days: number;
  by_priority: Record<RequisitionPriority, number>;
  by_branch: Array<{ branch_name: string; count: number; open_positions: number }>;
  by_status: Record<ApprovalStatus, number>;
}

interface FunnelMetrics {
  total_linked: number;
  walkin_count: number;
  screened_count: number;
  selected_count: number;
  offered_count: number;
  onboarding_count: number;
  joined_count: number;
  lms_enrolled_count: number;
}

interface RequisitionFunnel {
  requisition_id: string;
  requisition_code: string;
  designation_name: string;
  branch_name: string;
  process_name: string | null;
  requested_headcount: number;
  fulfilled_headcount: number;
  planned_batch_no: string | null;
  planned_batch_name: string | null;
  training_start_date: string | null;
  approval_status: ApprovalStatus;
  demand_raised_date: string;
  demand_approved_date: string | null;
  business_justification: string | null;
  funnel: FunnelMetrics;
}

interface SelectedCandidate {
  id: string;
  candidate_id: string;
  candidate_name: string;
  mobile: string;
  email: string;
  alternate_mobile?: string;
  current_address?: string;
  outcome: string;
  date_of_selection: string | null;
  linked_at: string;
  recruiter_name: string | null;
  remarks: string | null;
  current_stage?: string;
}

interface Branch { id: string; branch_name: string; }
interface Process { id: string; process_name: string; }
interface Designation { id: string; designation_name: string; }
interface Department { id: string; dept_name: string; }

interface JoinedEmployee {
  employee_id: string; full_name: string; employee_code: string | null;
  date_of_joining: string | null; bridge_status: string; lms_enrolled: boolean;
  candidate_id: string; candidate_name: string;
}

interface HandoverRecipient {
  user_id: string; email: string; role_key: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-200 text-gray-600',
  on_hold: 'bg-orange-100 text-orange-800',
  closed: 'bg-blue-100 text-blue-800',
  active: 'bg-emerald-100 text-emerald-800',
  filled: 'bg-purple-100 text-purple-800',
  pending: 'bg-amber-100 text-amber-800',
};

const PRIORITY_COLORS: Record<RequisitionPriority, string> = {
  urgent: 'bg-red-500 text-white',
  high: 'bg-orange-500 text-white',
  normal: 'bg-blue-500 text-white',
  low: 'bg-gray-400 text-white',
};

const PRIORITY_ORDER: Record<RequisitionPriority, number> = { urgent: 1, high: 2, normal: 3, low: 4 };

const emptyForm = {
  designation_name: '',
  department_name: '',
  branch_name: '',
  process_name: '',
  process_id: '',
  requested_headcount: 1,
  employment_type: 'full_time' as EmploymentType,
  salary_min: '',
  salary_max: '',
  experience_min_years: '',
  experience_max_years: '',
  priority: 'normal' as RequisitionPriority,
  requisition_type: 'new_position',
  business_justification: '',
  skills_required: '',
  job_description: '',
  planned_batch_no: '',
  training_start_date: '',
  target_joining_date: '',
  requisition_validity: '',
};

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeJobRequisition() {
  // Which half of this page is showing. Headcount & Shortage answers "how many do I need";
  // the requisition list answers "what have I raised". Deep-linked as ?tab=headcount from the
  // dashboard tile and from the HIRING_SHORTAGE work item.
  const [pageTab, setPageTab] = useState<'requisitions' | 'headcount'>(
    new URLSearchParams(window.location.search).get('tab') === 'headcount' ? 'headcount' : 'requisitions',
  );
  const [requisitions, setRequisitions] = useState<JobRequisition[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [branchFilter, setBranchFilter] = useState<string>('');
  const [processFilter, setProcessFilter] = useState<string>('');
  const [quickFilter, setQuickFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortKey>('deadline_asc');

  // Masters
  const [branches, setBranches] = useState<Branch[]>([]);
  const [allProcesses, setAllProcesses] = useState<Process[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [formProcesses, setFormProcesses] = useState<Process[]>([]);
  const [loadingFormProcesses, setLoadingFormProcesses] = useState(false);

  // Create/Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editingRequisition, setEditingRequisition] = useState<JobRequisition | null>(null);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Inline confirmation state
  const [confirmAction, setConfirmAction] = useState<{
    type: 'submit' | 'approve' | 'reject' | 'handover' | 'delete';
    id: string;
    code: string;
  } | null>(null);
  const [confirmInput, setConfirmInput] = useState('');

  // View detail and funnel
  const [selectedRequisition, setSelectedRequisition] = useState<JobRequisition | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [funnelData, setFunnelData] = useState<RequisitionFunnel | null>(null);
  const [funnelLoading, setFunnelLoading] = useState(false);

  // Detail drawer tabs
  const [detailTab, setDetailTab] = useState<'funnel' | 'selected' | 'joined'>('funnel');
  const [joinedEmployees, setJoinedEmployees] = useState<JoinedEmployee[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<SelectedCandidate[]>([]);
  const [selectedCandidatesLoading, setSelectedCandidatesLoading] = useState(false);

  // Handover modal state
  const [showHandoverModal, setShowHandoverModal] = useState(false);
  const [handoverTargetReq, setHandoverTargetReq] = useState<JobRequisition | null>(null);
  const [handoverNotes, setHandoverNotes] = useState('');
  const [handoverRecipients, setHandoverRecipients] = useState<HandoverRecipient[]>([]);
  const [handoverSelectedUserIds, setHandoverSelectedUserIds] = useState<string[]>([]);
  const [handoverManualCc, setHandoverManualCc] = useState('');
  const [handoverSubmitting, setHandoverSubmitting] = useState(false);
  const [handoverPackLoading, setHandoverPackLoading] = useState(false);

  // Current user role
  const [currentUserRole, setCurrentUserRole] = useState<string>('');

  // ── Load Data ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    loadRequisitions();
    loadMetrics({ status: statusFilter, priority: priorityFilter, branch: branchFilter });
  }, [searchTerm, statusFilter, priorityFilter, branchFilter]);

  useEffect(() => {
    const branch = formData.branch_name;
    if (!branch) {
      setFormProcesses(allProcesses);
      return;
    }
    setLoadingFormProcesses(true);
    hrmsApi.get<{ success: boolean; data: Process[] }>(
      `/api/job-requisition/processes-for-branch/${encodeURIComponent(branch)}`
    )
      .then(res => setFormProcesses(res.data || []))
      .catch(() => setFormProcesses(allProcesses))
      .finally(() => setLoadingFormProcesses(false));
    setFormData(prev => ({ ...prev, process_name: '' }));
  }, [formData.branch_name]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hrms_access_token');
      if (token) {
        const b64 = token.split('.')[1];
        const payload = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/')));
        setCurrentUserRole(payload.role ?? '');
      }
    } catch { /* ignore */ }
    try {
      await Promise.all([loadRequisitions(), loadMetrics(), loadMasters()]);
    } finally {
      setLoading(false);
    }
  };

  const loadRequisitions = async () => {
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      if (statusFilter) params.append('approval_status', statusFilter);
      if (priorityFilter) params.append('priority', priorityFilter);
      if (branchFilter) params.append('branch_name', branchFilter);
      params.append('include_closed', 'true');
      params.append('limit', '200');

      const res = await hrmsApi.get<{ success: boolean; data: JobRequisition[] }>(
        `/api/job-requisition?${params.toString()}`
      );
      setRequisitions(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Failed to load requisitions:', err);
    }
  };

  const loadMetrics = async (opts?: { status?: string; priority?: string; branch?: string }) => {
    try {
      const p = new URLSearchParams();
      if (opts?.status) p.append('approval_status', opts.status);
      if (opts?.priority) p.append('priority', opts.priority);
      if (opts?.branch) p.append('branch_name', opts.branch);
      const qs = p.toString() ? `?${p.toString()}` : '';
      const res = await hrmsApi.get<{ success: boolean; data: DashboardMetrics }>(
        `/api/job-requisition/dashboard${qs}`
      );
      if (res.data) {
        const m = res.data as any;
        setMetrics({
          ...m,
          total_requisitions: Number(m.total_requisitions ?? 0),
          open_requisitions: Number(m.open_requisitions ?? 0),
          pending_approval: Number(m.pending_approval ?? 0),
          approved_active: Number(m.approved_active ?? 0),
          total_open_positions: Number(m.total_open_positions ?? 0),
          total_fulfilled: Number(m.total_fulfilled ?? 0),
          fill_rate_percent: Number(m.fill_rate_percent ?? 0),
          avg_time_to_fill_days: Number(m.avg_time_to_fill_days ?? 0),
        });
      }
    } catch (err) {
      console.error('Failed to load metrics:', err);
    }
  };

  const loadMasters = async () => {
    try {
      const [branchRes, processRes, designationRes, deptRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: Branch[] }>('/api/org/branches'),
        hrmsApi.get<{ success: boolean; data: Process[] }>('/api/org/processes'),
        hrmsApi.get<{ success: boolean; data: Designation[] }>('/api/org/designations'),
        hrmsApi.get<{ success: boolean; data: Department[] }>('/api/org/departments'),
      ]);
      setBranches(branchRes.data || []);
      setAllProcesses(processRes.data || []);
      setFormProcesses(processRes.data || []);
      setDesignations(designationRes.data || []);
      setDepartments(deptRes.data || []);
    } catch (err) {
      console.error('Failed to load masters:', err);
    }
  };

  // ── Actions ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setFormError('');
    if (!formData.designation_name) { setFormError('Designation is required'); return; }
    if (!formData.branch_name) { setFormError('Branch is required'); return; }
    if (formData.requested_headcount < 1) { setFormError('Headcount must be at least 1'); return; }

    setSaving(true);
    try {
      const payload = {
        ...formData,
        salary_min: formData.salary_min ? Number(formData.salary_min) : null,
        salary_max: formData.salary_max ? Number(formData.salary_max) : null,
        experience_min_years: formData.experience_min_years ? Number(formData.experience_min_years) : null,
        experience_max_years: formData.experience_max_years ? Number(formData.experience_max_years) : null,
        planned_batch_no: formData.planned_batch_no || null,
        training_start_date: formData.training_start_date || null,
        target_joining_date: formData.target_joining_date || null,
        requisition_validity: formData.requisition_validity || null,
        process_id: formData.process_id || null,
      };

      if (editingRequisition) {
        await hrmsApi.patch(`/api/job-requisition/${editingRequisition.id}`, payload);
      } else {
        await hrmsApi.post('/api/job-requisition', payload);
      }

      setShowModal(false);
      resetForm();
      loadRequisitions();
      loadMetrics();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save requisition');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { type, id } = confirmAction;

    try {
      if (type === 'submit') {
        await hrmsApi.post(`/api/job-requisition/${id}/submit`);
      } else if (type === 'approve') {
        await hrmsApi.post(`/api/job-requisition/${id}/approve`, { remarks: confirmInput || null });
      } else if (type === 'reject') {
        if (!confirmInput || confirmInput.trim().length < 5) {
          alert('Rejection reason must be at least 5 characters');
          return;
        }
        await hrmsApi.post(`/api/job-requisition/${id}/reject`, { reason: confirmInput.trim() });
      } else if (type === 'delete') {
        await hrmsApi.delete(`/api/job-requisition/${id}`);
      }
      setConfirmAction(null);
      setConfirmInput('');
      loadRequisitions();
      loadMetrics();
    } catch (err: any) {
      alert(err.message || `Failed to ${type}`);
    }
  };

  const openHandoverModal = async (req: JobRequisition) => {
    setHandoverTargetReq(req);
    setHandoverNotes('');
    setHandoverManualCc('');
    setHandoverSelectedUserIds([]);
    setShowHandoverModal(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: HandoverRecipient[] }>(
        '/api/job-requisition/handover-recipients'
      );
      const recipients = res.data || [];
      setHandoverRecipients(recipients);
      setHandoverSelectedUserIds(recipients.map(r => r.user_id));
    } catch { /* non-critical */ }
  };

  const handleHandoverSubmit = async () => {
    if (!handoverTargetReq) return;
    setHandoverSubmitting(true);
    try {
      const manualEmails = handoverManualCc
        .split(',')
        .map(e => e.trim())
        .filter(e => e.includes('@'));
      await hrmsApi.post(`/api/job-requisition/${handoverTargetReq.id}/handover`, {
        notes: handoverNotes || null,
        emailRecipientUserIds: handoverSelectedUserIds,
        manualCcEmails: manualEmails,
      });
      setShowHandoverModal(false);
      loadRequisitions();
      loadMetrics();
    } catch (err: any) {
      alert(err.message || 'Handover failed');
    } finally {
      setHandoverSubmitting(false);
    }
  };

  const downloadHandoverPack = async (requisitionId: string, requisitionCode: string) => {
    setHandoverPackLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: any }>(
        `/api/job-requisition/${requisitionId}/handover-pack`
      );
      const pack = res.data;
      if (!pack) return;

      const XLSX = await import('xlsx');

      const summary = [
        ['Field', 'Value'],
        ['Requisition Code', pack.summary.requisition_code],
        ['Designation', pack.summary.designation_name],
        ['Branch', pack.summary.branch_name],
        ['Process', pack.summary.process_name ?? '—'],
        ['Batch No', pack.summary.planned_batch_no ?? '—'],
        ['Batch Name', pack.summary.planned_batch_name ?? '—'],
        ['Training Start', pack.summary.training_start_date ?? '—'],
        ['Hiring Deadline', pack.summary.requisition_validity ?? '—'],
        ['Requested Headcount', pack.summary.requested_headcount],
        ['Fulfilled Headcount', pack.summary.fulfilled_headcount],
        ['Handover Date', pack.summary.handover_at ?? '—'],
        ['Notes', pack.summary.handover_notes ?? '—'],
        [],
        ['Funnel Step', 'Count'],
        ['Linked Candidates', pack.funnel.linked],
        ['Walk-ins', pack.funnel.walkin],
        ['Screened', pack.funnel.screened],
        ['Selected', pack.funnel.selected],
        ['Offered', pack.funnel.offered],
        ['Onboarding', pack.funnel.onboarding],
        ['Joined', pack.funnel.joined],
        ['LMS Enrolled', pack.funnel.lms],
      ];

      const joinedHeaders = ['#', 'Full Name', 'Employee Code', 'Date of Joining', 'Bridge Status', 'LMS Enrolled'];
      const joinedRows = (pack.joined_employees as any[]).map((e: any, i: number) => [
        i + 1, e.full_name, e.employee_code ?? '—',
        e.date_of_joining ? e.date_of_joining.slice(0, 10) : '—',
        e.bridge_status, e.lms_enrolled ? 'Yes' : 'No',
      ]);

      const pipelineHeaders = ['#', 'Name', 'Mobile', 'Email', 'Outcome', 'Recruiter', 'Date of Selection', 'Linked At'];
      const pipelineRows = (pack.candidate_pipeline as any[]).map((c: any, i: number) => [
        i + 1, c.full_name, c.mobile ?? '—', c.email ?? '—', c.outcome,
        c.recruiter_name ?? '—',
        c.date_of_selection ? c.date_of_selection.slice(0, 10) : '—',
        c.linked_at ? c.linked_at.slice(0, 10) : '—',
      ]);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([joinedHeaders, ...joinedRows]), 'Joined Employees');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([pipelineHeaders, ...pipelineRows]), 'Candidate Pipeline');
      XLSX.writeFile(wb, `Handover_Pack_${requisitionCode}.xlsx`);
    } catch (err: any) {
      alert('Failed to generate handover pack: ' + (err.message || 'Unknown error'));
    } finally {
      setHandoverPackLoading(false);
    }
  };

  const openDetail = async (req: JobRequisition) => {
    setSelectedRequisition(req);
    setShowDetail(true);
    setDetailTab('funnel');
    setFunnelData(null);
    setFunnelLoading(true);
    setJoinedEmployees([]);
    setSelectedCandidates([]);
    setSelectedCandidatesLoading(true);

    try {
      const funnelRes = await hrmsApi.get<{ success: boolean; data: RequisitionFunnel }>(`/api/job-requisition/${req.id}/funnel`);
      setFunnelData(funnelRes.data);
    } catch (err) {
      console.error('Failed to load funnel data:', err);
    } finally {
      setFunnelLoading(false);
    }

    hrmsApi.get<{ success: boolean; data: JoinedEmployee[] }>(`/api/job-requisition/${req.id}/joined-employees`)
      .then(res => setJoinedEmployees(res.data || []))
      .catch(() => setJoinedEmployees([]));

    hrmsApi.get<{ success: boolean; data: SelectedCandidate[] }>(`/api/job-requisition/${req.id}/candidates`)
      .then(res => setSelectedCandidates(res.data || []))
      .catch(() => setSelectedCandidates([]))
      .finally(() => setSelectedCandidatesLoading(false));
  };

  const openEdit = (req: JobRequisition) => {
    setEditingRequisition(req);
    setFormData({
      designation_name: req.designation_name,
      department_name: req.department_name || '',
      branch_name: req.branch_name,
      process_name: req.process_name || '',
      process_id: req.process_id || '',
      requested_headcount: req.requested_headcount,
      employment_type: req.employment_type,
      salary_min: req.salary_min?.toString() || '',
      salary_max: req.salary_max?.toString() || '',
      experience_min_years: '',
      experience_max_years: '',
      priority: req.priority,
      requisition_type: req.requisition_type,
      business_justification: req.business_justification || '',
      skills_required: '',
      job_description: '',
      planned_batch_no: req.planned_batch_no || '',
      training_start_date: req.training_start_date ? req.training_start_date.substring(0, 10) : '',
      target_joining_date: req.target_joining_date ? req.target_joining_date.substring(0, 10) : '',
      requisition_validity: req.requisition_validity ? req.requisition_validity.substring(0, 10) : '',
    });
    setFormError('');
    setShowModal(true);
  };

  const openCreate = () => {
    setEditingRequisition(null);
    resetForm();
    setShowModal(true);
  };

  const resetForm = () => {
    setFormData({ ...emptyForm });
    setEditingRequisition(null);
    setFormError('');
  };

  const field = useCallback((key: keyof typeof emptyForm, value: string | number) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  }, []);

  // ── Derived / Sorted Data ──────────────────────────────────────────────────────

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const filteredAndSorted = React.useMemo(() => {
    let list = [...requisitions];

    // Process filter (client-side since backend doesn't have it as param)
    if (processFilter) {
      list = list.filter(r => r.process_name === processFilter);
    }

    // Quick filters
    if (quickFilter === 'urgent') {
      list = list.filter(r => r.priority === 'urgent');
    } else if (quickFilter === 'overdue') {
      list = list.filter(r =>
        r.requisition_validity &&
        new Date(r.requisition_validity) < today &&
        r.approval_status === 'approved' &&
        r.fulfilled_headcount < r.requested_headcount
      );
    } else if (quickFilter === 'pending_approval') {
      list = list.filter(r => r.approval_status === 'pending_approval');
    } else if (quickFilter === 'ready_handover') {
      list = list.filter(r =>
        r.approval_status === 'approved' &&
        r.fulfilled_headcount >= r.requested_headcount &&
        r.handover_status !== 'handed_over'
      );
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === 'deadline_asc') {
        if (!a.requisition_validity && !b.requisition_validity) return 0;
        if (!a.requisition_validity) return 1;
        if (!b.requisition_validity) return -1;
        return new Date(a.requisition_validity).getTime() - new Date(b.requisition_validity).getTime();
      }
      if (sortBy === 'deadline_desc') {
        if (!a.requisition_validity && !b.requisition_validity) return 0;
        if (!a.requisition_validity) return 1;
        if (!b.requisition_validity) return -1;
        return new Date(b.requisition_validity).getTime() - new Date(a.requisition_validity).getTime();
      }
      if (sortBy === 'priority') {
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      }
      if (sortBy === 'aging_desc') {
        return b.aging_days - a.aging_days;
      }
      if (sortBy === 'fill_rate') {
        const ra = a.requested_headcount > 0 ? a.fulfilled_headcount / a.requested_headcount : 0;
        const rb = b.requested_headcount > 0 ? b.fulfilled_headcount / b.requested_headcount : 0;
        return ra - rb;
      }
      // created_desc
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return list;
  }, [requisitions, processFilter, quickFilter, sortBy]);

  // Alert counts
  const in3Days = new Date(today); in3Days.setDate(in3Days.getDate() + 3);
  const overdueCount = requisitions.filter(r => r.requisition_validity && new Date(r.requisition_validity) < today && r.approval_status === 'approved' && r.fulfilled_headcount < r.requested_headcount).length;
  const nearDeadlineCount = requisitions.filter(r => r.requisition_validity && new Date(r.requisition_validity) >= today && new Date(r.requisition_validity) <= in3Days && r.approval_status === 'approved' && r.fulfilled_headcount < r.requested_headcount).length;
  const staleDraftCount = requisitions.filter(r => r.approval_status === 'draft' && r.aging_days >= 7).length;
  const readyHandoverCount = requisitions.filter(r => r.approval_status === 'approved' && r.fulfilled_headcount >= r.requested_headcount && r.handover_status !== 'handed_over').length;

  // ── Render ─────────────────────────────────────────────────────────────────────

  if (loading && !requisitions.length) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  const selectedOnlyCandidates = selectedCandidates.filter(c => c.outcome === 'selected');

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Job Requisitions</h1>
            <p className="text-gray-500 text-sm">Manage hiring demands and headcount requests</p>
          </div>
          {pageTab === 'requisitions' && (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Requisition
            </button>
          )}
        </div>

        {/* Tabs. The shortage board lives here rather than on a page of its own so HR reads the
            gap and raises the requisition that closes it without changing screen. */}
        <div className="flex items-center gap-1 border-b border-slate-200">
          {([['requisitions', 'Requisitions'], ['headcount', 'Headcount & Shortage']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setPageTab(key);
                const url = new URL(window.location.href);
                if (key === 'headcount') url.searchParams.set('tab', 'headcount');
                else url.searchParams.delete('tab');
                window.history.replaceState({}, '', url);
              }}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                pageTab === key
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {pageTab === 'headcount' && (
          <HeadcountShortagePanel
            branchId={branchFilter || undefined}
            processId={processFilter || undefined}
          />
        )}

        <div className={pageTab === 'requisitions' ? 'space-y-5' : 'hidden'}>

        {/* Metrics Cards */}
        {metrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <MetricCard icon={<Briefcase className="w-5 h-5" />} label="Total" value={metrics.total_requisitions} color="blue" />
            <MetricCard icon={<Target className="w-5 h-5" />} label="Open Positions" value={metrics.total_open_positions} color="emerald" />
            <MetricCard icon={<Clock className="w-5 h-5" />} label="Pending Approval" value={metrics.pending_approval} color="amber" />
            <MetricCard icon={<CheckCircle className="w-5 h-5" />} label="Approved Active" value={metrics.approved_active} color="green" />
            <MetricCard icon={<Users className="w-5 h-5" />} label="Fulfilled" value={metrics.total_fulfilled} color="purple" />
            <MetricCard icon={<Target className="w-5 h-5" />} label="Fill Rate" value={`${metrics.fill_rate_percent}%`} color="cyan" />
          </div>
        )}

        {/* Alert Strip + Quick Filters */}
        {(overdueCount + nearDeadlineCount + staleDraftCount + readyHandoverCount > 0) && (
          <div className="flex flex-wrap gap-2 p-3 bg-white rounded-xl shadow-sm border border-gray-100">
            <span className="text-xs font-medium text-gray-500 self-center mr-1">Quick filter:</span>
            {overdueCount > 0 && (
              <button
                onClick={() => setQuickFilter(quickFilter === 'overdue' ? '' : 'overdue')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${quickFilter === 'overdue' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
              >
                <AlertCircle className="w-3.5 h-3.5" />
                {overdueCount} Deadline Overdue
              </button>
            )}
            {nearDeadlineCount > 0 && (
              <button
                onClick={() => setQuickFilter(quickFilter === 'near_deadline' ? '' : 'near_deadline')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${quickFilter === 'near_deadline' ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
              >
                <Clock className="w-3.5 h-3.5" />
                {nearDeadlineCount} Deadline Within 3 Days
              </button>
            )}
            {staleDraftCount > 0 && (
              <button
                onClick={() => setQuickFilter(quickFilter === 'stale' ? '' : 'stale')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${quickFilter === 'stale' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                <FileText className="w-3.5 h-3.5" />
                {staleDraftCount} Stale Draft{staleDraftCount > 1 ? 's' : ''}
              </button>
            )}
            {readyHandoverCount > 0 && (
              <button
                onClick={() => setQuickFilter(quickFilter === 'ready_handover' ? '' : 'ready_handover')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${quickFilter === 'ready_handover' ? 'bg-teal-700 text-white' : 'bg-teal-100 text-teal-700 hover:bg-teal-200'}`}
              >
                <CheckCircle className="w-3.5 h-3.5" />
                {readyHandoverCount} Ready for Handover
              </button>
            )}
            {quickFilter && (
              <button
                onClick={() => setQuickFilter('')}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-full text-xs text-gray-500 hover:text-gray-700"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
        )}

        {/* Filters + Sort */}
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search code, position, branch…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
              </div>
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm">
              <option value="">All Status</option>
              <option value="draft">Draft</option>
              <option value="pending_approval">Pending Approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="closed">Closed</option>
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm">
              <option value="">All Priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm">
              <option value="">All Branches</option>
              {branches.map(b => <option key={b.id} value={b.branch_name}>{b.branch_name}</option>)}
            </select>
            <select value={processFilter} onChange={(e) => setProcessFilter(e.target.value)} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 text-sm">
              <option value="">All Processes</option>
              {allProcesses.map(p => <option key={p.id} value={p.process_name}>{p.process_name}</option>)}
            </select>
            <div className="flex items-center gap-2 px-3 py-2 border rounded-lg bg-gray-50">
              <ArrowUpDown className="w-4 h-4 text-gray-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="text-sm bg-transparent focus:outline-none"
              >
                <option value="deadline_asc">Deadline: Nearest First</option>
                <option value="deadline_desc">Deadline: Latest First</option>
                <option value="priority">Priority: Urgent First</option>
                <option value="aging_desc">Oldest First</option>
                <option value="fill_rate">Fill Rate: Lowest First</option>
                <option value="created_desc">Newest Created</option>
              </select>
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-400">
            Showing {filteredAndSorted.length} of {requisitions.length} requisitions
          </div>
        </div>

        {/* Requisitions Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Position</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Branch / Process</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Headcount</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Priority</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Hiring Deadline</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Pipeline</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Selected</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Fill %</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Age</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredAndSorted.map((req) => {
                  const isOverdue = req.requisition_validity && new Date(req.requisition_validity) < today && req.approval_status === 'approved' && req.fulfilled_headcount < req.requested_headcount;
                  const isNearDeadline = !isOverdue && req.requisition_validity && new Date(req.requisition_validity) <= in3Days && req.approval_status === 'approved' && req.fulfilled_headcount < req.requested_headcount;
                  const fillPct = req.requested_headcount > 0 ? Math.round((req.fulfilled_headcount / req.requested_headcount) * 100) : 0;
                  const rowClass = isOverdue ? 'hover:bg-red-50 bg-red-50/40' : isNearDeadline ? 'hover:bg-amber-50 bg-amber-50/30' : 'hover:bg-gray-50';

                  return (
                    <React.Fragment key={req.id}>
                      <tr className={rowClass}>
                        <td className="px-4 py-3 text-sm font-medium text-blue-600">
                          {req.requisition_code}
                          {isOverdue && <span className="ml-1 text-red-500 text-xs">⚠</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-900">{req.designation_name}</div>
                          {req.department_name && <div className="text-xs text-gray-400">{req.department_name}</div>}
                          {(req.requester_name || req.requested_by_name) && (
                            <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5" title="Raised by">
                              <FileText className="w-3 h-3 text-slate-400" />
                              {req.requester_name || req.requested_by_name}
                              {req.requester_designation && <span className="text-slate-400">· {req.requester_designation}</span>}
                            </div>
                          )}
                          {req.owner_recruiter_name && (
                            <div className="text-xs text-blue-500 flex items-center gap-1 mt-0.5">
                              <UserCheck className="w-3 h-3" />{req.owner_recruiter_name}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-gray-700">{req.branch_name}</div>
                          {req.process_name && <div className="text-xs text-gray-500">{req.process_name}</div>}
                          {req.planned_batch_no && <div className="text-xs text-amber-600">Batch: {req.planned_batch_no}</div>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm font-medium text-gray-900">{req.fulfilled_headcount}/{req.requested_headcount}</span>
                          {req.open_positions > 0 && <span className="ml-1 text-xs text-orange-600">({req.open_positions} open)</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${PRIORITY_COLORS[req.priority]}`}>{req.priority}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[req.derived_status] || STATUS_COLORS[req.approval_status]}`}>
                            {req.derived_status.replace(/_/g, ' ')}
                          </span>
                          {req.handover_status === 'handed_over' && (
                            <div className="mt-1">
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-teal-100 text-teal-800">Handed Over</span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {req.requisition_validity ? (
                            <span className={`text-sm ${isOverdue ? 'text-red-600 font-semibold' : isNearDeadline ? 'text-amber-600 font-medium' : 'text-gray-500'}`}>
                              {req.requisition_validity.slice(0, 10)}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center text-sm font-medium text-gray-700">{req.pipeline_candidates ?? 0}</td>
                        <td className="px-4 py-3 text-center text-sm font-medium text-green-600">{req.selected_candidates ?? 0}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${fillPct >= 100 ? 'bg-green-500' : fillPct >= 50 ? 'bg-blue-500' : 'bg-amber-400'}`}
                                style={{ width: `${Math.min(fillPct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500">{fillPct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-sm text-gray-500">{req.aging_days}d</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openDetail(req)} className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded" title="View Details">
                              <Eye className="w-4 h-4" />
                            </button>
                            {req.approval_status === 'draft' && (
                              <>
                                <button onClick={() => openEdit(req)} className="p-1.5 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded" title="Edit">
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => setConfirmAction({ type: 'submit', id: req.id, code: req.requisition_code })}
                                  className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded" title="Submit for Approval"
                                >
                                  <Send className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            {req.approval_status === 'pending_approval' && (currentUserRole === 'super_admin' || currentUserRole === 'branch_head') && (
                              <>
                                <button
                                  onClick={() => setConfirmAction({ type: 'approve', id: req.id, code: req.requisition_code })}
                                  className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded" title="Approve"
                                >
                                  <ThumbsUp className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => setConfirmAction({ type: 'reject', id: req.id, code: req.requisition_code })}
                                  className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded" title="Reject"
                                >
                                  <ThumbsDown className="w-4 h-4" />
                                </button>
                              </>
                            )}
                            {req.approval_status === 'approved' &&
                             req.fulfilled_headcount >= req.requested_headcount &&
                             req.handover_status !== 'handed_over' && (
                              <button
                                onClick={() => openHandoverModal(req)}
                                className="p-1.5 text-gray-500 hover:text-teal-600 hover:bg-teal-50 rounded" title="Mark as Handed Over"
                              >
                                <Send className="w-4 h-4" />
                              </button>
                            )}
                            {req.handover_status === 'handed_over' && (
                              <button
                                onClick={() => downloadHandoverPack(req.id, req.requisition_code)}
                                disabled={handoverPackLoading}
                                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded" title="Download Handover Pack"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            )}
                            {currentUserRole === 'super_admin' && (
                              <button
                                onClick={() => setConfirmAction({ type: 'delete', id: req.id, code: req.requisition_code })}
                                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded" title="Delete Requisition"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Inline confirm row */}
                      {confirmAction?.id === req.id && (
                        <tr className="bg-yellow-50 border-l-4 border-yellow-400">
                          <td colSpan={12} className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className={`text-sm font-medium ${confirmAction.type === 'delete' ? 'text-red-700' : 'text-yellow-800'}`}>
                                {confirmAction.type === 'submit' && `Submit ${confirmAction.code} for approval?`}
                                {confirmAction.type === 'approve' && `Approve ${confirmAction.code}?`}
                                {confirmAction.type === 'reject' && `Reject ${confirmAction.code}?`}
                                {confirmAction.type === 'delete' && `Permanently delete ${confirmAction.code}? This cannot be undone.`}
                              </span>
                              {(confirmAction.type === 'approve' || confirmAction.type === 'reject') && (
                                <input
                                  autoFocus
                                  type="text"
                                  value={confirmInput}
                                  onChange={e => setConfirmInput(e.target.value)}
                                  placeholder={confirmAction.type === 'reject' ? 'Rejection reason (required, min 5 chars)' : 'Remarks (optional)'}
                                  className="flex-1 min-w-[240px] px-3 py-1.5 text-sm border rounded focus:ring-2 focus:ring-yellow-400"
                                />
                              )}
                              <button
                                onClick={handleConfirmAction}
                                className={`px-3 py-1.5 text-sm text-white rounded ${confirmAction.type === 'reject' || confirmAction.type === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                              >
                                {confirmAction.type === 'submit' ? 'Yes, Submit' : confirmAction.type === 'approve' ? 'Confirm Approve' : confirmAction.type === 'delete' ? 'Yes, Delete' : 'Confirm Reject'}
                              </button>
                              <button onClick={() => { setConfirmAction(null); setConfirmInput(''); }} className="px-3 py-1.5 text-sm text-gray-600 border rounded hover:bg-gray-100">
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {filteredAndSorted.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-8 text-center text-gray-500">No requisitions found. {requisitions.length > 0 ? 'Try clearing filters.' : 'Create one to get started.'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingRequisition ? 'Edit Requisition' : 'New Job Requisition'}
                </h2>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-400 hover:text-gray-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {formError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{formError}</div>
                )}
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Designation / Position *</label>
                    <select
                      value={formData.designation_name}
                      onChange={(e) => field('designation_name', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— Select Designation —</option>
                      {designations.map(d => (
                        <option key={d.id} value={d.designation_name}>{d.designation_name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Branch *</label>
                    <select
                      value={formData.branch_name}
                      onChange={(e) => field('branch_name', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— Select Branch —</option>
                      {branches.map(b => <option key={b.id} value={b.branch_name}>{b.branch_name}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Process {loadingFormProcesses && <span className="text-xs text-gray-400 ml-1">loading…</span>}
                    </label>
                    <select
                      value={formData.process_name}
                      onChange={(e) => {
                        const selectedProcess = formProcesses.find(p => p.process_name === e.target.value);
                        setFormData(prev => ({
                          ...prev,
                          process_name: e.target.value,
                          process_id: selectedProcess?.id || '',
                        }));
                      }}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      disabled={loadingFormProcesses}
                    >
                      <option value="">— Select Process —</option>
                      {formProcesses.map(p => <option key={p.id} value={p.process_name}>{p.process_name}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                    <select
                      value={formData.department_name}
                      onChange={(e) => field('department_name', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— Select Department —</option>
                      {departments.map(d => (
                        <option key={d.id} value={d.dept_name}>{d.dept_name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Headcount Required *</label>
                    <input
                      type="number" min="1"
                      value={formData.requested_headcount}
                      onChange={(e) => field('requested_headcount', Number(e.target.value))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Employment Type</label>
                    <select
                      value={formData.employment_type}
                      onChange={(e) => field('employment_type', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="full_time">Full Time</option>
                      <option value="part_time">Part Time</option>
                      <option value="contract">Contract</option>
                      <option value="intern">Intern</option>
                      <option value="trainee">Trainee</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Salary Min (Monthly CTC)</label>
                    <input
                      type="number"
                      value={formData.salary_min}
                      onChange={(e) => field('salary_min', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. 15000"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Salary Max (Monthly CTC)</label>
                    <input
                      type="number"
                      value={formData.salary_max}
                      onChange={(e) => field('salary_max', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. 20000"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                    <select
                      value={formData.priority}
                      onChange={(e) => field('priority', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Requisition Type</label>
                    <select
                      value={formData.requisition_type}
                      onChange={(e) => field('requisition_type', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="new_position">New Position</option>
                      <option value="replacement">Replacement</option>
                      <option value="expansion">Expansion</option>
                      <option value="seasonal">Seasonal</option>
                      <option value="project_based">Project Based</option>
                    </select>
                  </div>
                </div>

                <div className="pt-2 border-t">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <GraduationCap className="w-4 h-4 text-amber-600" /> Training Batch (optional)
                  </h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Batch No.</label>
                      <input
                        type="text"
                        value={formData.planned_batch_no}
                        onChange={(e) => field('planned_batch_no', e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g. B-2026-07"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Training Start Date</label>
                      <input
                        type="date"
                        value={formData.training_start_date}
                        onChange={(e) => {
                          const startDate = e.target.value;
                          let autoDeadline = '';
                          if (startDate) {
                            const d = new Date(startDate);
                            d.setDate(d.getDate() - 1);
                            autoDeadline = d.toISOString().slice(0, 10);
                          }
                          setFormData(prev => ({
                            ...prev,
                            training_start_date: startDate,
                            requisition_validity: autoDeadline || prev.requisition_validity,
                          }));
                        }}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Hiring Deadline <span className="text-xs text-gray-400">(auto: training date −1)</span></label>
                      <input
                        type="date"
                        value={formData.requisition_validity}
                        onChange={(e) => field('requisition_validity', e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Target Joining Date</label>
                      <input
                        type="date"
                        value={formData.target_joining_date}
                        onChange={(e) => field('target_joining_date', e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Business Justification</label>
                  <textarea
                    value={formData.business_justification}
                    onChange={(e) => field('business_justification', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    rows={3}
                    placeholder="Why is this position needed?"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Skills Required</label>
                  <textarea
                    value={formData.skills_required}
                    onChange={(e) => field('skills_required', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    rows={2}
                    placeholder="List required skills..."
                  />
                </div>
              </div>
              <div className="p-6 border-t bg-gray-50 flex justify-end gap-3">
                <button
                  onClick={() => { setShowModal(false); resetForm(); }}
                  className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !formData.designation_name || !formData.branch_name || formData.requested_headcount < 1}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {saving && <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block" />}
                  {editingRequisition ? 'Update' : 'Create Draft'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Detail Modal */}
        {showDetail && selectedRequisition && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">{selectedRequisition.requisition_code}</h2>
                  <p className="text-sm text-gray-500">{selectedRequisition.designation_name} · {selectedRequisition.branch_name}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_COLORS[selectedRequisition.derived_status]}`}>
                    {selectedRequisition.derived_status.replace(/_/g, ' ')}
                  </span>
                  <button onClick={() => setShowDetail(false)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Requisition Details */}
                <div className="grid md:grid-cols-3 gap-4">
                  <DetailItem label="Branch" value={selectedRequisition.branch_name} />
                  <DetailItem label="Process" value={selectedRequisition.process_name || '—'} />
                  <DetailItem label="Department" value={selectedRequisition.department_name || '—'} />
                  <DetailItem label="Headcount" value={`${selectedRequisition.fulfilled_headcount}/${selectedRequisition.requested_headcount} (${selectedRequisition.open_positions} open)`} />
                  <DetailItem label="Employment Type" value={selectedRequisition.employment_type.replace(/_/g, ' ')} />
                  <DetailItem label="Priority" value={<span className={`px-2 py-0.5 rounded text-xs ${PRIORITY_COLORS[selectedRequisition.priority]}`}>{selectedRequisition.priority}</span>} />
                  <DetailItem
                    label="Raised By"
                    value={
                      <span>
                        {selectedRequisition.requester_name || selectedRequisition.requested_by_name || '—'}
                        {selectedRequisition.requester_designation && <span className="text-gray-400 ml-1">· {selectedRequisition.requester_designation}</span>}
                        {selectedRequisition.requester_role && <span className="text-gray-400 ml-1">({selectedRequisition.requester_role.replace(/_/g, ' ')})</span>}
                      </span>
                    }
                  />
                  {selectedRequisition.approver_name && (
                    <DetailItem
                      label="Approved By"
                      value={
                        <span>
                          {selectedRequisition.approver_name}
                          {selectedRequisition.approver_designation && <span className="text-gray-400 ml-1">· {selectedRequisition.approver_designation}</span>}
                          {selectedRequisition.approver_role && <span className="text-gray-400 ml-1">({selectedRequisition.approver_role.replace(/_/g, ' ')})</span>}
                        </span>
                      }
                    />
                  )}
                  {selectedRequisition.owner_recruiter_name && (
                    <DetailItem label="Assigned Recruiter" value={selectedRequisition.owner_recruiter_name} />
                  )}
                  {selectedRequisition.salary_min && selectedRequisition.salary_max && (
                    <DetailItem label="Salary Range" value={`₹${selectedRequisition.salary_min.toLocaleString()} – ₹${selectedRequisition.salary_max.toLocaleString()}`} />
                  )}
                  {selectedRequisition.requisition_validity && (
                    <DetailItem label="Hiring Deadline" value={selectedRequisition.requisition_validity.slice(0, 10)} />
                  )}
                </div>

                {/* Key Dates */}
                {funnelData && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <Calendar className="w-4 h-4" /> Key Dates
                    </h3>
                    <div className="grid md:grid-cols-3 gap-4 text-sm">
                      <div><span className="text-gray-500">Demand Raised:</span> <span className="ml-2 font-medium">{formatISTDate(funnelData.demand_raised_date)}</span></div>
                      <div><span className="text-gray-500">Approved:</span> <span className="ml-2 font-medium">{funnelData.demand_approved_date ? formatISTDate(funnelData.demand_approved_date) : 'Pending'}</span></div>
                      <div><span className="text-gray-500">Target Joining:</span> <span className="ml-2 font-medium">{selectedRequisition.target_joining_date ? formatISTDate(selectedRequisition.target_joining_date) : '—'}</span></div>
                    </div>
                  </div>
                )}

                {/* Tab Nav */}
                <div className="flex gap-1 border-b">
                  {([
                    { key: 'funnel', icon: <TrendingUp className="w-3.5 h-3.5" />, label: 'Hiring Funnel' },
                    { key: 'selected', icon: <UserCheck className="w-3.5 h-3.5" />, label: `Selected (${selectedOnlyCandidates.length})` },
                    { key: 'joined', icon: <UserPlus className="w-3.5 h-3.5" />, label: `Joined (${joinedEmployees.length})` },
                  ] as const).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setDetailTab(tab.key)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${detailTab === tab.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                    >
                      {tab.icon}{tab.label}
                    </button>
                  ))}
                </div>

                {/* Hiring Funnel Tab */}
                {detailTab === 'funnel' && (funnelLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  </div>
                ) : funnelData ? (
                  <div className="bg-blue-50 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-blue-900 mb-4 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" /> Hiring Funnel
                    </h3>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <FunnelStep label="Walk-ins" count={funnelData.funnel.walkin_count} color="bg-gray-500" />
                      <FunnelArrow />
                      <FunnelStep label="Screened" count={funnelData.funnel.screened_count} color="bg-blue-500" />
                      <FunnelArrow />
                      <FunnelStep label="Selected" count={funnelData.funnel.selected_count} color="bg-emerald-500" />
                      <FunnelArrow />
                      <FunnelStep label="Offered" count={funnelData.funnel.offered_count} color="bg-cyan-500" />
                      <FunnelArrow />
                      <FunnelStep label="Onboarding" count={funnelData.funnel.onboarding_count} color="bg-purple-500" />
                      <FunnelArrow />
                      <FunnelStep label="Joined" count={funnelData.funnel.joined_count} color="bg-green-600" />
                      <FunnelArrow />
                      <FunnelStep label="LMS" count={funnelData.funnel.lms_enrolled_count} color="bg-indigo-600" />
                    </div>
                    <div className="mt-4 text-center text-sm text-blue-800">
                      Total linked: <strong>{funnelData.funnel.total_linked}</strong>
                    </div>
                    {funnelData.planned_batch_no && (
                      <div className="mt-4 pt-4 border-t border-blue-200">
                        <div className="flex items-center gap-2 text-sm text-amber-800">
                          <GraduationCap className="w-4 h-4" />
                          <span className="font-medium">{funnelData.planned_batch_name || funnelData.planned_batch_no}</span>
                          {funnelData.training_start_date && <span className="text-amber-600">· Training: {funnelData.training_start_date.slice(0, 10)}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                ) : null)}

                {/* Selected Candidates Tab */}
                {detailTab === 'selected' && (
                  <div>
                    {selectedCandidatesLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                      </div>
                    ) : selectedOnlyCandidates.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <UserCheck className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                        <p className="text-sm font-medium">No selected candidates yet.</p>
                        {selectedCandidates.filter(c => c.outcome === 'in_progress').length > 0 && (
                          <p className="text-xs text-gray-400 mt-1">{selectedCandidates.filter(c => c.outcome === 'in_progress').length} candidate(s) still in pipeline.</p>
                        )}
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm text-gray-500">
                            {selectedOnlyCandidates.length} selected · {selectedCandidates.filter(c => c.outcome === 'in_progress').length} in pipeline · {selectedCandidates.filter(c => c.outcome === 'rejected').length} rejected
                          </p>
                        </div>
                        <div className="overflow-x-auto rounded-lg border">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-emerald-50 text-left border-b">
                                <th className="px-3 py-2 text-xs font-semibold text-gray-500">#</th>
                                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Candidate</th>
                                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Contact</th>
                                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Recruiter</th>
                                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Date of Selection</th>
                                <th className="px-3 py-2 text-xs font-semibold text-gray-500">Remarks</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedOnlyCandidates.map((c, i) => (
                                <tr key={c.id} className="border-t hover:bg-emerald-50/40 bg-emerald-50/20">
                                  <td className="px-3 py-2.5 text-gray-400 text-xs">{i + 1}</td>
                                  <td className="px-3 py-2.5">
                                    <div className="font-medium text-gray-900">{c.candidate_name}</div>
                                    {c.current_stage && <div className="text-xs text-gray-400">{c.current_stage.replace(/_/g, ' ')}</div>}
                                  </td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-1 text-gray-700">
                                      <Phone className="w-3 h-3 text-gray-400" />
                                      <span className="text-xs">{c.mobile || '—'}</span>
                                    </div>
                                    {c.email && <div className="text-xs text-gray-500 truncate max-w-[160px]">{c.email}</div>}
                                    {c.alternate_mobile && <div className="text-xs text-gray-400">Alt: {c.alternate_mobile}</div>}
                                  </td>
                                  <td className="px-3 py-2.5 text-sm text-gray-700">
                                    {c.recruiter_name ? (
                                      <span className="flex items-center gap-1">
                                        <UserCheck className="w-3 h-3 text-blue-400" />
                                        {c.recruiter_name}
                                      </span>
                                    ) : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-3 py-2.5 text-sm text-emerald-700 font-medium">
                                    {c.date_of_selection ? c.date_of_selection.slice(0, 10) : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[140px] truncate" title={c.remarks || ''}>
                                    {c.remarks || '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Joined Employees Tab */}
                {detailTab === 'joined' && (
                  <div>
                    {joinedEmployees.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        <UserPlus className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                        <p className="text-sm">No employees have joined from this requisition yet.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 text-left border-b">
                              <th className="px-3 py-2 text-xs font-semibold text-gray-500">#</th>
                              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Name</th>
                              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Emp Code</th>
                              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Date of Joining</th>
                              <th className="px-3 py-2 text-xs font-semibold text-gray-500">Status</th>
                              <th className="px-3 py-2 text-xs font-semibold text-gray-500 text-center">LMS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {joinedEmployees.map((e, i) => (
                              <tr key={e.employee_id} className="border-t hover:bg-gray-50">
                                <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                                <td className="px-3 py-2 font-medium text-gray-900">{e.full_name}</td>
                                <td className="px-3 py-2 text-gray-500">{e.employee_code ?? '—'}</td>
                                <td className="px-3 py-2 text-gray-600">{e.date_of_joining ? e.date_of_joining.slice(0, 10) : '—'}</td>
                                <td className="px-3 py-2">
                                  <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">{e.bridge_status}</span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  {e.lms_enrolled
                                    ? <span className="text-green-600 font-semibold">✓</span>
                                    : <span className="text-gray-300">—</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Business Justification */}
                {selectedRequisition.business_justification && (
                  <div>
                    <span className="text-sm font-medium text-gray-500">Business Justification</span>
                    <p className="mt-1 text-gray-700 text-sm">{selectedRequisition.business_justification}</p>
                  </div>
                )}
              </div>

              <div className="p-6 border-t bg-gray-50 flex justify-end">
                <button onClick={() => setShowDetail(false)} className="px-4 py-2 text-gray-700 border rounded-lg hover:bg-gray-100">
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Handover Modal */}
      {showHandoverModal && handoverTargetReq && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Mark as Handed Over</h2>
                <p className="text-sm text-gray-500">{handoverTargetReq.requisition_code} · {handoverTargetReq.process_name ?? handoverTargetReq.branch_name}</p>
              </div>
              <button onClick={() => setShowHandoverModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-teal-50 rounded-lg p-3 text-sm grid grid-cols-2 gap-2">
                <div><span className="text-gray-500">Headcount:</span> <strong>{handoverTargetReq.fulfilled_headcount}/{handoverTargetReq.requested_headcount}</strong></div>
                <div><span className="text-gray-500">Batch:</span> <strong>{handoverTargetReq.planned_batch_no ?? '—'}</strong></div>
                <div><span className="text-gray-500">Training Start:</span> <strong>{handoverTargetReq.training_start_date ? handoverTargetReq.training_start_date.slice(0,10) : '—'}</strong></div>
                <div><span className="text-gray-500">Joined:</span> <strong>{joinedEmployees.length > 0 ? `${joinedEmployees.length} employees` : 'Loading…'}</strong></div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Handover Notes</label>
                <textarea
                  value={handoverNotes}
                  onChange={e => setHandoverNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  placeholder="Any notes for operations / training team…"
                />
              </div>

              {handoverRecipients.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" /> Email Notifications
                  </label>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto">
                    {handoverRecipients.map(r => (
                      <label key={r.user_id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                        <input
                          type="checkbox"
                          checked={handoverSelectedUserIds.includes(r.user_id)}
                          onChange={e => setHandoverSelectedUserIds(prev =>
                            e.target.checked ? [...prev, r.user_id] : prev.filter(id => id !== r.user_id)
                          )}
                          className="rounded text-teal-600"
                        />
                        <span className="text-gray-700">{r.email}</span>
                        <span className="text-xs text-gray-400 ml-auto">{r.role_key.replace(/_/g, ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Manual CC (comma-separated emails)</label>
                <input
                  type="text"
                  value={handoverManualCc}
                  onChange={e => setHandoverManualCc(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                  placeholder="ops@company.com, training@company.com"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => downloadHandoverPack(handoverTargetReq.id, handoverTargetReq.requisition_code)}
                  disabled={handoverPackLoading}
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-50 disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  {handoverPackLoading ? 'Generating…' : 'Download Pack (.xlsx)'}
                </button>
                <div className="flex gap-2">
                  <button onClick={() => setShowHandoverModal(false)} className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50">
                    Cancel
                  </button>
                  <button
                    onClick={handleHandoverSubmit}
                    disabled={handoverSubmitting}
                    className="px-4 py-2 text-sm text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {handoverSubmitting ? 'Submitting…' : <><Bell className="w-4 h-4" /> Confirm &amp; Notify</>}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

// ── Sub Components ─────────────────────────────────────────────────────────────

function MetricCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    amber: 'bg-amber-50 text-amber-600 border-amber-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
    cyan: 'bg-cyan-50 text-cyan-600 border-cyan-200',
  };
  return (
    <div className={`rounded-xl border p-4 ${colorClasses[color]}`}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs font-medium uppercase tracking-wide">{label}</span></div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-sm font-medium text-gray-500">{label}</span>
      <div className="mt-0.5 text-gray-900">{value}</div>
    </div>
  );
}

function FunnelStep({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className={`${color} text-white rounded-full w-12 h-12 flex items-center justify-center font-bold text-lg`}>{count}</div>
      <span className="text-xs text-gray-600 mt-1 whitespace-nowrap">{label}</span>
    </div>
  );
}

function FunnelArrow() {
  return <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />;
}
