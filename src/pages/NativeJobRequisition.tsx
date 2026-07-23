import React, { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { formatISTDate } from '@/lib/utils';
import {
  Users, Target, Clock, CheckCircle, XCircle, AlertCircle,
  Plus, Search, Filter, Building2, Briefcase, Calendar,
  ChevronDown, ChevronRight, Eye, Edit, Send, ThumbsUp, ThumbsDown,
  GraduationCap, UserCheck, FileText, TrendingUp, X
} from 'lucide-react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

// ── Types ──────────────────────────────────────────────────────────────────────

type ApprovalStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'cancelled' | 'on_hold' | 'closed';
type RequisitionPriority = 'low' | 'normal' | 'high' | 'urgent';
type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern' | 'trainee';

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
  requested_by_name: string | null;
  owner_recruiter_name: string | null;
  aging_days: number;
  derived_status: string;
  total_candidates: number;
  selected_candidates: number;
  pipeline_candidates: number;
  created_at: string;
  business_justification: string | null;
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

interface LmsBatch {
  batch_no: string;
  batch_name: string;
  batch_status: string;
  branch: string | null;
  process: string | null;
  start_date: string | null;
  end_date: string | null;
  expected_trainees: number;
  current_trainees: number;
}

interface Branch { id: string; branch_name: string; }
interface Process { id: string; process_name: string; }
interface Designation { id: string; designation_name: string; }
interface Department { id: string; dept_name: string; }

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

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const emptyForm = {
  designation_name: '',
  department_name: '',
  branch_name: '',
  process_name: '',
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
};

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeJobRequisition() {
  const [requisitions, setRequisitions] = useState<JobRequisition[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [branchFilter, setBranchFilter] = useState<string>('');

  // Masters
  const [branches, setBranches] = useState<Branch[]>([]);
  const [allProcesses, setAllProcesses] = useState<Process[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  // Branch-filtered processes for the create/edit form
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
    type: 'submit' | 'approve' | 'reject';
    id: string;
    code: string;
  } | null>(null);
  const [confirmInput, setConfirmInput] = useState('');

  // View detail and funnel
  const [selectedRequisition, setSelectedRequisition] = useState<JobRequisition | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [funnelData, setFunnelData] = useState<RequisitionFunnel | null>(null);
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [availableBatches, setAvailableBatches] = useState<LmsBatch[]>([]);
  const [batchAssigning, setBatchAssigning] = useState(false);

  // ── Load Data ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    loadRequisitions();
  }, [searchTerm, statusFilter, priorityFilter, branchFilter]);

  // When branch changes in form, load processes for that branch
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
    // Clear selected process if it doesn't belong to new branch
    setFormData(prev => ({ ...prev, process_name: '' }));
  }, [formData.branch_name]);

  const loadInitialData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadRequisitions(),
        loadMetrics(),
        loadMasters(),
      ]);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
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
      params.append('limit', '100');

      const res = await hrmsApi.get<{ success: boolean; data: JobRequisition[] }>(
        `/api/job-requisition?${params.toString()}`
      );
      setRequisitions(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      console.error('Failed to load requisitions:', err);
    }
  };

  const loadMetrics = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DashboardMetrics }>(
        '/api/job-requisition/dashboard'
      );
      if (res.data) {
        // MySQL returns ROUND/AVG as strings — coerce to numbers
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
    } catch (err: any) {
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
      }
      setConfirmAction(null);
      setConfirmInput('');
      loadRequisitions();
      loadMetrics();
    } catch (err: any) {
      alert(err.message || `Failed to ${type}`);
    }
  };

  const openDetail = async (req: JobRequisition) => {
    setSelectedRequisition(req);
    setShowDetail(true);
    setFunnelData(null);
    setFunnelLoading(true);
    try {
      const [funnelRes, batchesRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: RequisitionFunnel }>(`/api/job-requisition/${req.id}/funnel`),
        hrmsApi.get<{ success: boolean; data: LmsBatch[] }>(`/api/job-requisition/batches/available?branch=${encodeURIComponent(req.branch_name)}`),
      ]);
      setFunnelData(funnelRes.data);
      setAvailableBatches(batchesRes.data || []);
    } catch (err: any) {
      console.error('Failed to load funnel data:', err);
    } finally {
      setFunnelLoading(false);
    }
  };

  const handleAssignBatch = async (batchNo: string, batchName: string, startDate: string | null) => {
    if (!selectedRequisition) return;
    setBatchAssigning(true);
    try {
      await hrmsApi.patch(`/api/job-requisition/${selectedRequisition.id}/batch`, {
        batch_no: batchNo,
        batch_name: batchName,
        training_start_date: startDate,
      });
      if (funnelData) {
        setFunnelData({ ...funnelData, planned_batch_no: batchNo, planned_batch_name: batchName, training_start_date: startDate });
      }
    } catch (err: any) {
      alert(err.message || 'Failed to assign batch');
    } finally {
      setBatchAssigning(false);
    }
  };

  const handleClearBatch = async () => {
    if (!selectedRequisition) return;
    setBatchAssigning(true);
    try {
      await hrmsApi.patch(`/api/job-requisition/${selectedRequisition.id}/batch`, {
        batch_no: null, batch_name: null, training_start_date: null,
      });
      if (funnelData) {
        setFunnelData({ ...funnelData, planned_batch_no: null, planned_batch_name: null, training_start_date: null });
      }
    } catch (err: any) {
      alert(err.message || 'Failed to clear batch');
    } finally {
      setBatchAssigning(false);
    }
  };

  const openEdit = (req: JobRequisition) => {
    setEditingRequisition(req);
    setFormData({
      designation_name: req.designation_name,
      department_name: req.department_name || '',
      branch_name: req.branch_name,
      process_name: req.process_name || '',
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
      planned_batch_no: '',
      training_start_date: '',
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

  const branchChartData = metrics?.by_branch.slice(0, 6).map(b => ({
    name: b.branch_name.length > 12 ? b.branch_name.slice(0, 12) + '...' : b.branch_name,
    requisitions: b.count,
    openPositions: b.open_positions,
  })) || [];

  const statusChartData = metrics ? Object.entries(metrics.by_status).map(([status, count]) => ({
    name: status.replace('_', ' '),
    value: count,
  })).filter(d => d.value > 0) : [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Job Requisitions</h1>
            <p className="text-gray-500 text-sm">Manage hiring demands and headcount requests</p>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Requisition
          </button>
        </div>

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

        {/* Charts */}
        {metrics && (branchChartData.length > 0 || statusChartData.length > 0) && (
          <div className="grid md:grid-cols-2 gap-6">
            {branchChartData.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <h3 className="font-semibold text-gray-800 mb-4">Requisitions by Branch</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={branchChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="requisitions" fill="#3b82f6" name="Requisitions" />
                    <Bar dataKey="openPositions" fill="#10b981" name="Open Positions" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {statusChartData.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <h3 className="font-semibold text-gray-800 mb-4">Status Distribution</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={statusChartData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                      {statusChartData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search requisitions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">All Status</option>
              <option value="draft">Draft</option>
              <option value="pending_approval">Pending Approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="closed">Closed</option>
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">All Priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500">
              <option value="">All Branches</option>
              {branches.map(b => <option key={b.id} value={b.branch_name}>{b.branch_name}</option>)}
            </select>
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
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Candidates</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Age</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {requisitions.map((req) => (
                  <React.Fragment key={req.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-blue-600">{req.requisition_code}</td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{req.designation_name}</div>
                        {req.department_name && <div className="text-xs text-gray-400">{req.department_name}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-700">{req.branch_name}</div>
                        {req.process_name && <div className="text-xs text-gray-500">{req.process_name}</div>}
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
                      </td>
                      <td className="px-4 py-3 text-center text-sm">
                        <span className="text-gray-700">{req.total_candidates}</span>
                        {req.selected_candidates > 0 && <span className="ml-1 text-green-600">({req.selected_candidates} sel)</span>}
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
                          {req.approval_status === 'pending_approval' && (
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
                        </div>
                      </td>
                    </tr>
                    {/* Inline confirm row */}
                    {confirmAction?.id === req.id && (
                      <tr className="bg-yellow-50 border-l-4 border-yellow-400">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-sm font-medium text-yellow-800">
                              {confirmAction.type === 'submit' && `Submit ${confirmAction.code} for approval?`}
                              {confirmAction.type === 'approve' && `Approve ${confirmAction.code}?`}
                              {confirmAction.type === 'reject' && `Reject ${confirmAction.code}?`}
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
                              className={`px-3 py-1.5 text-sm text-white rounded ${confirmAction.type === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                            >
                              {confirmAction.type === 'submit' ? 'Yes, Submit' : confirmAction.type === 'approve' ? 'Confirm Approve' : 'Confirm Reject'}
                            </button>
                            <button onClick={() => { setConfirmAction(null); setConfirmInput(''); }} className="px-3 py-1.5 text-sm text-gray-600 border rounded hover:bg-gray-100">
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {requisitions.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-500">No requisitions found. Create one to get started.</td>
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
                  {/* Designation — dropdown from DB */}
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

                  {/* Branch */}
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

                  {/* Process — cascades on branch */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Process {loadingFormProcesses && <span className="text-xs text-gray-400 ml-1">loading…</span>}
                    </label>
                    <select
                      value={formData.process_name}
                      onChange={(e) => field('process_name', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      disabled={loadingFormProcesses}
                    >
                      <option value="">— Select Process —</option>
                      {formProcesses.map(p => <option key={p.id} value={p.process_name}>{p.process_name}</option>)}
                    </select>
                  </div>

                  {/* Department — dropdown from DB */}
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

                  {/* Headcount */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Headcount Required *</label>
                    <input
                      type="number" min="1"
                      value={formData.requested_headcount}
                      onChange={(e) => field('requested_headcount', Number(e.target.value))}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Employment Type */}
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

                  {/* Salary Range */}
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

                  {/* Priority */}
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

                  {/* Requisition Type */}
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

                {/* Batch Number Section */}
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
                        onChange={(e) => field('training_start_date', e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Justification / Skills */}
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

        {/* Detail Modal with Funnel */}
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
                  {selectedRequisition.salary_min && selectedRequisition.salary_max && (
                    <DetailItem label="Salary Range" value={`₹${selectedRequisition.salary_min.toLocaleString()} – ₹${selectedRequisition.salary_max.toLocaleString()}`} />
                  )}
                  {selectedRequisition.target_joining_date && (
                    <DetailItem label="Target Joining" value={formatISTDate(selectedRequisition.target_joining_date)} />
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

                {/* Hiring Funnel */}
                {funnelLoading ? (
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
                  </div>
                ) : null}

                {/* Batch Assignment */}
                {funnelData && (
                  <div className="bg-amber-50 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-amber-900 mb-3 flex items-center gap-2">
                      <GraduationCap className="w-4 h-4" /> Training Batch Assignment
                    </h3>
                    {funnelData.planned_batch_no ? (
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-amber-800">{funnelData.planned_batch_name || funnelData.planned_batch_no}</div>
                          <div className="text-sm text-amber-700">
                            Batch No: {funnelData.planned_batch_no}
                            {funnelData.training_start_date && ` · Training starts: ${formatISTDate(funnelData.training_start_date)}`}
                          </div>
                        </div>
                        <button onClick={handleClearBatch} disabled={batchAssigning} className="px-3 py-1.5 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50 disabled:opacity-50">
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm text-amber-700 mb-3">No batch assigned. Select a planned batch from LMS:</p>
                        {availableBatches.length > 0 ? (
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {availableBatches.map((batch) => (
                              <div
                                key={batch.batch_no}
                                className="flex items-center justify-between p-2 bg-white rounded border hover:border-amber-400 cursor-pointer"
                                onClick={() => handleAssignBatch(batch.batch_no, batch.batch_name, batch.start_date)}
                              >
                                <div>
                                  <div className="font-medium text-gray-800">{batch.batch_name}</div>
                                  <div className="text-xs text-gray-500">
                                    {batch.batch_no} · {batch.batch_status} · {batch.current_trainees}/{batch.expected_trainees} trainees
                                    {batch.start_date && ` · Starts: ${formatISTDate(batch.start_date)}`}
                                  </div>
                                </div>
                                <button className="px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200">Assign</button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 italic">No planned batches available for this branch.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Business Justification */}
                {selectedRequisition.business_justification && (
                  <div>
                    <span className="text-sm font-medium text-gray-500">Business Justification</span>
                    <p className="mt-1 text-gray-700">{selectedRequisition.business_justification}</p>
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
