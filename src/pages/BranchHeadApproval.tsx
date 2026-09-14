import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { formatISTDate } from '@/lib/utils';
import {
  User, CheckCircle, XCircle, Clock, Search, Filter, TrendingUp, Award,
  FileText, Eye, ThumbsUp, ThumbsDown
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PendingApproval {
  id: string;
  candidate_id: string;
  candidate_code: string;
  candidate_name: string;
  mobile: string;
  email: string;
  applied_for_role: string;
  applied_for_branch: string;
  branch_display_name: string;
  employment_type: 'onroll' | 'offrole';
  gross_salary: number;
  joining_date: string;
  salary_start_date: string;
  basic_salary: number;
  hra: number;
  conveyance: number;
  special_allowance: number;
  pf_amount: number;
  esic_amount: number;
  submitted_by: string;
  submitted_at: string;
}

interface Stats {
  total_pending: number;
  total_approved: number;
  total_rejected: number;
  this_month_approved: number;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function BranchHeadApproval() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [filteredApprovals, setFilteredApprovals] = useState<PendingApproval[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  const [employmentTypeFilter, setEmploymentTypeFilter] = useState('all');

  // Modal state
  const [selectedApproval, setSelectedApproval] = useState<PendingApproval | null>(null);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [approvalAction, setApprovalAction] = useState<'approved' | 'rejected' | null>(null);
  const [remarks, setRemarks] = useState('');

  // ── Load Data ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [searchTerm, branchFilter, employmentTypeFilter, approvals]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      // Load pending approvals
      const approvalsRes = await hrmsApi.get<{ success: boolean; data: PendingApproval[] }>(
        '/api/ats/branch-head-approval/pending'
      );
      setApprovals(approvalsRes.data || []);

      // Load stats
      const statsRes = await hrmsApi.get<{ success: boolean; data: Stats }>(
        '/api/ats/branch-head-approval/stats'
      );
      setStats(statsRes.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // ── Apply Filters ──────────────────────────────────────────────────────────────
  const applyFilters = () => {
    let filtered = [...approvals];

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.candidate_name.toLowerCase().includes(term) ||
          a.candidate_code.toLowerCase().includes(term) ||
          a.mobile.includes(term) ||
          a.email.toLowerCase().includes(term)
      );
    }

    // Branch filter
    if (branchFilter !== 'all') {
      filtered = filtered.filter((a) => a.applied_for_branch === branchFilter);
    }

    // Employment type filter
    if (employmentTypeFilter !== 'all') {
      filtered = filtered.filter((a) => a.employment_type === employmentTypeFilter);
    }

    setFilteredApprovals(filtered);
  };

  // ── Handle Approval ────────────────────────────────────────────────────────────
  const handleApprovalAction = (approval: PendingApproval, action: 'approved' | 'rejected') => {
    setSelectedApproval(approval);
    setApprovalAction(action);
    setShowApprovalModal(true);
    setRemarks('');
  };

  const confirmApproval = async () => {
    if (!selectedApproval || !approvalAction) return;

    setActionLoading(selectedApproval.id);
    setError('');
    setSuccess('');

    try {
      const res = await hrmsApi.post<{ success: boolean; message: string; employee_code?: string }>(
        '/api/ats/branch-head-approval/process',
        {
          approval_id: selectedApproval.id,
          approval_status: approvalAction,
          remarks: remarks.trim() || undefined,
        }
      );

      if (res.success) {
        setSuccess(
          approvalAction === 'approved'
            ? `Approved! Employee Code: ${res.employee_code}`
            : 'Rejection recorded successfully'
        );
        setShowApprovalModal(false);
        setSelectedApproval(null);
        await loadData();
      } else {
        setError(res.message || 'Action failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to process approval');
    } finally {
      setActionLoading('');
    }
  };

  // ── Get Unique Branches ────────────────────────────────────────────────────────
  const uniqueBranches = Array.from(new Set(approvals.map((a) => a.applied_for_branch)));

  // ── Format Currency ────────────────────────────────────────────────────────────
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <Award className="w-4 h-4" />
            <span>ATS / Branch Head Approval</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Salary Approvals</h1>
          <p className="text-sm text-gray-600 mt-1">
            Review and approve salary packages for selected candidates
          </p>
        </div>

        {/* Success/Error Messages */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <span className="text-sm text-red-800">{error}</span>
          </div>
        )}

        {success && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <span className="text-sm text-green-800">{success}</span>
          </div>
        )}

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Pending</span>
                <Clock className="w-5 h-5 text-yellow-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.total_pending}</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Approved</span>
                <CheckCircle className="w-5 h-5 text-green-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.total_approved}</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Rejected</span>
                <XCircle className="w-5 h-5 text-red-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.total_rejected}</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">This Month</span>
                <TrendingUp className="w-5 h-5 text-purple-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{stats.this_month_approved}</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Search */}
            <div className="md:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, code, mobile, email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                />
              </div>
            </div>

            {/* Branch Filter */}
            <div>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
              >
                <option value="all">All Branches</option>
                {uniqueBranches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
            </div>

            {/* Employment Type Filter */}
            <div>
              <select
                value={employmentTypeFilter}
                onChange={(e) => setEmploymentTypeFilter(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
              >
                <option value="all">All Types</option>
                <option value="onroll">On Roll</option>
                <option value="offrole">Off Role</option>
              </select>
            </div>
          </div>
        </div>

        {/* Approvals Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : filteredApprovals.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No pending approvals</p>
              <p className="text-sm text-gray-500 mt-1">
                {approvals.length === 0
                  ? 'All candidates have been processed'
                  : 'Try adjusting your filters'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                      Candidate
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                      Role & Branch
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                      Salary
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                      Joining Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                      Submitted By
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredApprovals.map((approval) => (
                    <tr
                      key={approval.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                            <User className="w-5 h-5 text-purple-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {approval.candidate_name}
                            </p>
                            <p className="text-xs text-gray-500">{approval.candidate_code}</p>
                            <p className="text-xs text-gray-500">{approval.mobile}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm font-medium text-gray-900">{approval.applied_for_role}</p>
                        <p className="text-xs text-gray-500">{approval.branch_display_name}</p>
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                            approval.employment_type === 'onroll'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {approval.employment_type === 'onroll' ? 'On Roll' : 'Off Role'}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm font-semibold text-gray-900">
                          {formatCurrency(approval.gross_salary)}
                        </p>
                        <p className="text-xs text-gray-500">Gross/month</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm text-gray-900">
                          {formatISTDate(approval.joining_date)}
                        </p>
                        {approval.salary_start_date !== approval.joining_date && (
                          <p className="text-xs text-gray-500">
                            Salary: {formatISTDate(approval.salary_start_date)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm text-gray-900">{approval.submitted_by}</p>
                        <p className="text-xs text-gray-500">
                          {formatISTDate(approval.submitted_at)}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => {
                              setSelectedApproval(approval);
                              setShowApprovalModal(true);
                              setApprovalAction(null);
                            }}
                            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleApprovalAction(approval, 'approved')}
                            disabled={actionLoading === approval.id}
                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                            title="Approve"
                          >
                            <ThumbsUp className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleApprovalAction(approval, 'rejected')}
                            disabled={actionLoading === approval.id}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                            title="Reject"
                          >
                            <ThumbsDown className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Approval Modal */}
      {showApprovalModal && selectedApproval && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">
                {approvalAction ? (approvalAction === 'approved' ? 'Approve' : 'Reject') + ' Candidate' : 'Candidate Details'}
              </h2>
            </div>

            <div className="p-6 space-y-6">
              {/* Candidate Info */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Candidate Information</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Name</p>
                    <p className="font-medium text-gray-900">{selectedApproval.candidate_name}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Code</p>
                    <p className="font-medium text-gray-900">{selectedApproval.candidate_code}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Mobile</p>
                    <p className="font-medium text-gray-900">{selectedApproval.mobile}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Email</p>
                    <p className="font-medium text-gray-900 text-xs">{selectedApproval.email}</p>
                  </div>
                </div>
              </div>

              {/* Salary Breakdown */}
              <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Salary Breakdown</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Basic Salary (40%)</span>
                    <span className="font-medium">{formatCurrency(selectedApproval.basic_salary)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">HRA (30%)</span>
                    <span className="font-medium">{formatCurrency(selectedApproval.hra)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Conveyance (10%)</span>
                    <span className="font-medium">{formatCurrency(selectedApproval.conveyance)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Special Allowance</span>
                    <span className="font-medium">{formatCurrency(selectedApproval.special_allowance)}</span>
                  </div>
                  {selectedApproval.employment_type === 'onroll' && (
                    <>
                      <div className="border-t border-purple-200 pt-2 mt-2"></div>
                      <div className="flex justify-between text-red-600">
                        <span>PF (12%)</span>
                        <span className="font-medium">- {formatCurrency(selectedApproval.pf_amount)}</span>
                      </div>
                      <div className="flex justify-between text-red-600">
                        <span>ESIC (0.75%)</span>
                        <span className="font-medium">- {formatCurrency(selectedApproval.esic_amount)}</span>
                      </div>
                    </>
                  )}
                  <div className="border-t border-purple-200 pt-2 mt-2 flex justify-between font-bold text-gray-900">
                    <span>Gross Salary</span>
                    <span>{formatCurrency(selectedApproval.gross_salary)}</span>
                  </div>
                </div>
              </div>

              {/* Remarks */}
              {approvalAction && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Remarks {approvalAction === 'rejected' && <span className="text-red-500">*</span>}
                  </label>
                  <textarea
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    rows={3}
                    placeholder={approvalAction === 'approved' ? 'Optional approval notes...' : 'Please provide rejection reason...'}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 flex gap-3">
              <button
                onClick={() => {
                  setShowApprovalModal(false);
                  setSelectedApproval(null);
                  setApprovalAction(null);
                  setRemarks('');
                }}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                {approvalAction ? 'Cancel' : 'Close'}
              </button>
              {approvalAction && (
                <button
                  onClick={confirmApproval}
                  disabled={actionLoading === selectedApproval.id || (approvalAction === 'rejected' && !remarks.trim())}
                  className={`flex-1 px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                    approvalAction === 'approved'
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {actionLoading === selectedApproval.id ? 'Processing...' : `Confirm ${approvalAction === 'approved' ? 'Approval' : 'Rejection'}`}
                </button>
              )}
              {!approvalAction && (
                <>
                  <button
                    onClick={() => setApprovalAction('approved')}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => setApprovalAction('rejected')}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                  >
                    Reject
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
