import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import React, { useState, useEffect } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import {
  TrendingUp, Users, UserCheck, UserX, Calendar, Award,
  Building2, Target, Clock, CheckCircle, BarChart3, PieChart,
  Activity, Briefcase, GraduationCap, Filter
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, PieChart as RechartsPie, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DashboardMetrics {
  total_candidates: number;
  active_candidates: number;
  selected_candidates: number;
  rejected_candidates: number;
  total_interviews_today: number;
  pending_approvals: number;
  employees_joined_this_month: number;
  conversion_rate: number;
}

interface TimelineData {
  date: string;
  registrations: number;
  interviews: number;
  selections: number;
  rejections: number;
}

interface BranchMetrics {
  branch_name: string;
  branch_display_name: string;
  total_candidates: number;
  selected_count: number;
  pending_bgv: number;
  active_recruiters: number;
}

interface RecruiterPerformance {
  recruiter_code: string;
  recruiter_name: string;
  total_interviews: number;
  selected_count: number;
  selection_rate: number;
  avg_communication_rating: number;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ATSCommandCentre() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [timeline, setTimeline] = useState<TimelineData[]>([]);
  const [branches, setBranches] = useState<BranchMetrics[]>([]);
  const [recruiters, setRecruiters] = useState<RecruiterPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timelineDays, setTimelineDays] = useState(30);

  // ── Load Data ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadAllData();
  }, []);

  useEffect(() => {
    loadTimeline();
  }, [timelineDays]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadMetrics(),
        loadTimeline(),
        loadBranches(),
        loadRecruiters(),
      ]);
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadMetrics = async () => {
    const res = await hrmsApi.get<{ success: boolean; data: DashboardMetrics }>(
      '/api/ats/command-centre/metrics'
    );
    setMetrics(res.data);
  };

  const loadTimeline = async () => {
    const res = await hrmsApi.get<{ success: boolean; data: TimelineData[] }>(
      `/api/ats/command-centre/timeline?days=${timelineDays}`
    );
    setTimeline(res.data || []);
  };

  const loadBranches = async () => {
    const res = await hrmsApi.get<{ success: boolean; data: BranchMetrics[] }>(
      '/api/ats/command-centre/branches'
    );
    setBranches(res.data || []);
  };

  const loadRecruiters = async () => {
    const res = await hrmsApi.get<{ success: boolean; data: RecruiterPerformance[] }>(
      '/api/ats/command-centre/recruiters'
    );
    setRecruiters((res.data || []).slice(0, 10));
  };

  // ── Chart Colors ───────────────────────────────────────────────────────────────
  const COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

  // ── Render ─────────────────────────────────────────────────────────────────────

  if (loading && !metrics) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-screen">
          <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <BarChart3 className="w-4 h-4" />
            <span>ATS / Command Centre</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
          <p className="text-sm text-gray-600 mt-1">
            Comprehensive metrics and insights for ATS operations
          </p>
        </div>

        {/* KPI Cards */}
        {metrics && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Total Candidates</span>
                <Users className="w-5 h-5 text-purple-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{metrics.total_candidates}</p>
              <p className="text-xs text-gray-500 mt-1">All time registrations</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Active Pipeline</span>
                <Activity className="w-5 h-5 text-blue-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{metrics.active_candidates}</p>
              <p className="text-xs text-gray-500 mt-1">Currently in process</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Selected</span>
                <UserCheck className="w-5 h-5 text-green-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{metrics.selected_candidates}</p>
              <p className="text-xs text-green-600 mt-1">{metrics.conversion_rate}% conversion</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Today's Interviews</span>
                <Clock className="w-5 h-5 text-orange-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900">{metrics.total_interviews_today}</p>
              <p className="text-xs text-gray-500 mt-1">{metrics.pending_approvals} pending approvals</p>
            </div>
          </div>
        )}

        {/* Timeline Chart */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Recruitment Timeline</h2>
              <p className="text-sm text-gray-600 mt-1">Daily registrations and interview trends</p>
            </div>
            <select
              value={timelineDays}
              onChange={(e) => setTimelineDays(parseInt(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
            >
              <option value={7}>Last 7 days</option>
              <option value={15}>Last 15 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </div>

          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="date"
                stroke="#6b7280"
                fontSize={12}
                tickFormatter={(date) => formatISTDate(date)}
              />
              <YAxis stroke="#6b7280" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="registrations"
                stroke="#8b5cf6"
                strokeWidth={2}
                name="Registrations"
                dot={{ fill: '#8b5cf6', r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="interviews"
                stroke="#3b82f6"
                strokeWidth={2}
                name="Interviews"
                dot={{ fill: '#3b82f6', r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="selections"
                stroke="#10b981"
                strokeWidth={2}
                name="Selections"
                dot={{ fill: '#10b981', r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Branch Performance */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900">Branch Performance</h2>
              <p className="text-sm text-gray-600 mt-1">Recruitment metrics by branch</p>
            </div>

            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={branches}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="branch_display_name"
                  stroke="#6b7280"
                  fontSize={11}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis stroke="#6b7280" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Legend />
                <Bar dataKey="total_candidates" fill="#8b5cf6" name="Total" radius={[4, 4, 0, 0]} />
                <Bar dataKey="selected_count" fill="#10b981" name="Selected" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top Recruiters */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Top Recruiters</h2>
              <p className="text-sm text-gray-600 mt-1">Best performing recruiters</p>
            </div>

            <div className="space-y-3">
              {recruiters.map((recruiter, idx) => (
                <div
                  key={recruiter.recruiter_code}
                  className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center font-bold text-purple-600 text-sm">
                    #{idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {recruiter.recruiter_name}
                    </p>
                    <p className="text-xs text-gray-500">{recruiter.recruiter_code}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      {recruiter.total_interviews}
                    </p>
                    <p className="text-xs text-green-600">
                      {recruiter.selection_rate}% selected
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Branch Stats Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Detailed Branch Statistics</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                    Branch
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                    Total
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                    Selected
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                    Pending
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                    Active Recruiters
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                    Conversion
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {branches.map((branch) => {
                  const conversionRate = branch.total_candidates > 0
                    ? ((branch.selected_count / branch.total_candidates) * 100).toFixed(1)
                    : '0.0';

                  return (
                    <tr key={branch.branch_name} className="hover:bg-gray-50">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-gray-400" />
                          <span className="text-sm font-medium text-gray-900">
                            {branch.branch_display_name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-900">
                        {branch.total_candidates}
                      </td>
                      <td className="px-4 py-4 text-sm text-green-600 font-medium">
                        {branch.selected_count}
                      </td>
                      <td className="px-4 py-4 text-sm text-orange-600">
                        {branch.pending_bgv}
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-900">
                        {branch.active_recruiters}
                      </td>
                      <td className="px-4 py-4">
                        <span className="inline-flex px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded">
                          {conversionRate}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
