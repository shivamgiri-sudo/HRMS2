/**
 * Roster Audit Trail Dashboard
 * Track who changed what roster, when, and why
 * Follows MAS HRMS frozen design patterns
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Clock,
  User,
  Calendar,
  RefreshCw,
  Filter,
  History,
  GitBranch,
  ChevronRight,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { hrmsApi as api } from '@/lib/hrmsApi';

interface AuditTrail {
  id: string;
  date: string;
  changeType: string;
  changeTypeCode: string;
  reason: string;
  timestamp: string;
  employee: {
    id: string;
    code: string;
    name: string;
  };
  processName: string;
  branchName: string;
  shiftName: string | null;
  changedBy: string;
  runType: string | null;
}

interface GenerationRun {
  id: string;
  cycleId: string;
  processName: string;
  branchName: string | null;
  runType: string;
  status: string;
  stats: {
    employeesProcessed: number;
    assignmentsCreated: number;
    weekoffsAllocated: number;
    conflictsFound: number;
  };
  startedAt: string;
  completedAt: string | null;
  duration: number | null;
  triggeredBy: string;
}

interface AuditSummary {
  totalChanges: number;
  manualOverrides: number;
  overrideRate: number;
  byType: Record<string, number>;
  generationRuns: {
    auto: number;
    manual: number;
    totalAssignments: number;
    totalConflicts: number;
  };
}

const toneColors = {
  blue: { iconBg: '#edf4ff', value: '#0b63e5', border: '#dce8fb' },
  green: { iconBg: '#eaf8ef', value: '#15803d', border: '#d7f0df' },
  amber: { iconBg: '#fff4e8', value: '#ea580c', border: '#fee3c5' },
  violet: { iconBg: '#f3efff', value: '#6d28d9', border: '#e6ddff' },
  slate: { iconBg: '#f1f4f8', value: '#0b1f44', border: '#e3e9f2' },
};

export default function RosterAuditTrail() {
  const [activeTab, setActiveTab] = useState('trails');
  const [dateFrom, setDateFrom] = useState(
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [changeTypeFilter, setChangeTypeFilter] = useState<string>('all');

  const { data: trailsData, isLoading: trailsLoading, refetch: refetchTrails } = useQuery({
    queryKey: ['roster-audit-trails', dateFrom, dateTo, changeTypeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);
      if (changeTypeFilter && changeTypeFilter !== 'all') {
        params.append('changeType', changeTypeFilter);
      }
      params.append('limit', '200');
      const res = await api.get(`/roster-audit/trails?${params}`);
      return res.data as { trails: AuditTrail[]; count: number };
    },
  });

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['roster-audit-summary', dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);
      const res = await api.get(`/roster-audit/summary?${params}`);
      return res.data as AuditSummary;
    },
  });

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ['roster-audit-runs'],
    queryFn: async () => {
      const res = await api.get('/roster-audit/generation-runs?limit=50');
      return res.data as { runs: GenerationRun[] };
    },
    enabled: activeTab === 'runs',
  });

  const getChangeTypeBadge = (type: string, code: string) => {
    const colorMap: Record<string, string> = {
      shift_assigned: 'bg-blue-100 text-blue-700',
      weekoff_assigned: 'bg-green-100 text-green-700',
      weekoff_denied: 'bg-red-100 text-red-700',
      weekoff_waitlisted: 'bg-amber-100 text-amber-700',
      shift_frozen: 'bg-violet-100 text-violet-700',
      holiday_applied: 'bg-cyan-100 text-cyan-700',
      rejected_request: 'bg-red-100 text-red-700',
      manager_override: 'bg-orange-100 text-orange-700',
    };
    return (
      <Badge className={`${colorMap[code] || 'bg-gray-100 text-gray-700'} font-medium`}>
        {type}
      </Badge>
    );
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string }> = {
      completed: { bg: 'bg-green-100', text: 'text-green-700' },
      running: { bg: 'bg-blue-100', text: 'text-blue-700' },
      failed: { bg: 'bg-red-100', text: 'text-red-700' },
      partial: { bg: 'bg-amber-100', text: 'text-amber-700' },
    };
    const colors = map[status] || map.completed;
    return <Badge className={`${colors.bg} ${colors.text}`}>{status}</Badge>;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-4 sm:p-6">
      <div className="max-w-[1600px] mx-auto space-y-6">
        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 p-6 text-white shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <History className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Roster Audit Trail</h1>
                <p className="text-slate-300 text-sm">
                  Track every roster change for compliance and accountability
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2">
                <Calendar className="w-4 h-4" />
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-transparent border-0 text-white w-32 h-6 p-0"
                />
                <span>to</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-transparent border-0 text-white w-32 h-6 p-0"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchTrails()}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        {!summaryLoading && summaryData && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: toneColors.blue.iconBg }}
                  >
                    <FileText className="w-5 h-5" style={{ color: toneColors.blue.value }} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium">Total Changes</p>
                    <p className="text-xl font-bold" style={{ color: toneColors.blue.value }}>
                      {summaryData.totalChanges.toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: toneColors.amber.iconBg }}
                  >
                    <User className="w-5 h-5" style={{ color: toneColors.amber.value }} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium">Manual Overrides</p>
                    <p className="text-xl font-bold" style={{ color: toneColors.amber.value }}>
                      {summaryData.manualOverrides}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: toneColors.violet.iconBg }}
                  >
                    <GitBranch className="w-5 h-5" style={{ color: toneColors.violet.value }} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium">Override Rate</p>
                    <p className="text-xl font-bold" style={{ color: toneColors.violet.value }}>
                      {summaryData.overrideRate}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: toneColors.green.iconBg }}
                  >
                    <CheckCircle className="w-5 h-5" style={{ color: toneColors.green.value }} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium">Auto Runs</p>
                    <p className="text-xl font-bold" style={{ color: toneColors.green.value }}>
                      {summaryData.generationRuns.auto}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{
                      backgroundColor:
                        summaryData.generationRuns.totalConflicts > 0
                          ? '#fff0f1'
                          : toneColors.slate.iconBg,
                    }}
                  >
                    <AlertTriangle
                      className="w-5 h-5"
                      style={{
                        color:
                          summaryData.generationRuns.totalConflicts > 0 ? '#dc2626' : '#64748b',
                      }}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-medium">Conflicts</p>
                    <p
                      className="text-xl font-bold"
                      style={{
                        color:
                          summaryData.generationRuns.totalConflicts > 0 ? '#dc2626' : '#64748b',
                      }}
                    >
                      {summaryData.generationRuns.totalConflicts}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-white/80 border border-white/60 rounded-xl p-1">
            <TabsTrigger value="trails" className="rounded-lg">
              <History className="w-4 h-4 mr-2" />
              Audit Trail
            </TabsTrigger>
            <TabsTrigger value="runs" className="rounded-lg">
              <GitBranch className="w-4 h-4 mr-2" />
              Generation Runs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="trails" className="mt-4">
            <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm">
              <CardHeader className="border-b pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-slate-600" />
                    Change History
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-gray-400" />
                    <Select value={changeTypeFilter} onValueChange={setChangeTypeFilter}>
                      <SelectTrigger className="w-48 h-9">
                        <SelectValue placeholder="All change types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All change types</SelectItem>
                        <SelectItem value="shift_assigned">Shift Assigned</SelectItem>
                        <SelectItem value="weekoff_assigned">Week-off Assigned</SelectItem>
                        <SelectItem value="weekoff_denied">Week-off Denied</SelectItem>
                        <SelectItem value="weekoff_waitlisted">Week-off Waitlisted</SelectItem>
                        <SelectItem value="shift_frozen">Shift Frozen</SelectItem>
                        <SelectItem value="holiday_applied">Holiday Applied</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {trailsLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                  </div>
                ) : !trailsData?.trails?.length ? (
                  <div className="text-center py-20 text-gray-500">
                    No audit records found for the selected period
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50/50">
                          <TableHead className="font-semibold">Date</TableHead>
                          <TableHead className="font-semibold">Employee</TableHead>
                          <TableHead className="font-semibold">Change Type</TableHead>
                          <TableHead className="font-semibold">Reason</TableHead>
                          <TableHead className="font-semibold">Process</TableHead>
                          <TableHead className="font-semibold">Changed By</TableHead>
                          <TableHead className="font-semibold">Timestamp</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {trailsData.trails.map((trail) => (
                          <TableRow key={trail.id} className="hover:bg-slate-50/50">
                            <TableCell className="font-medium">
                              {new Date(trail.date).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium text-gray-900">{trail.employee.name}</p>
                                <p className="text-xs text-gray-500">{trail.employee.code}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              {getChangeTypeBadge(trail.changeType, trail.changeTypeCode)}
                            </TableCell>
                            <TableCell className="max-w-[200px]">
                              <p className="text-sm text-gray-600 truncate" title={trail.reason}>
                                {trail.reason}
                              </p>
                            </TableCell>
                            <TableCell>
                              <p className="text-sm">{trail.processName}</p>
                              <p className="text-xs text-gray-500">{trail.branchName}</p>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <User className="w-3 h-3 text-gray-400" />
                                <span className="text-sm">{trail.changedBy}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-gray-500">
                              {new Date(trail.timestamp).toLocaleString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="runs" className="mt-4">
            <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm">
              <CardHeader className="border-b pb-4">
                <CardTitle className="text-lg font-semibold flex items-center gap-2">
                  <GitBranch className="w-5 h-5 text-slate-600" />
                  Roster Generation Runs
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {runsLoading ? (
                  <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                  </div>
                ) : !runsData?.runs?.length ? (
                  <div className="text-center py-20 text-gray-500">
                    No generation runs found
                  </div>
                ) : (
                  <div className="divide-y">
                    {runsData.runs.map((run) => (
                      <div
                        key={run.id}
                        className="p-4 hover:bg-slate-50/50 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              run.runType === 'auto'
                                ? 'bg-green-100'
                                : 'bg-blue-100'
                            }`}
                          >
                            <RefreshCw
                              className={`w-5 h-5 ${
                                run.runType === 'auto' ? 'text-green-600' : 'text-blue-600'
                              }`}
                            />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-gray-900">
                                {run.processName || 'All Processes'}
                              </p>
                              {getStatusBadge(run.status)}
                              <Badge variant="outline" className="text-xs">
                                {run.runType}
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-500">
                              {run.branchName || 'All Branches'} • Triggered by {run.triggeredBy}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <p className="text-sm font-medium text-gray-900">
                              {run.stats.assignmentsCreated} assignments
                            </p>
                            <p className="text-xs text-gray-500">
                              {run.stats.employeesProcessed} employees •{' '}
                              {run.stats.weekoffsAllocated} week-offs
                            </p>
                          </div>
                          {run.stats.conflictsFound > 0 && (
                            <Badge className="bg-red-100 text-red-700">
                              {run.stats.conflictsFound} conflicts
                            </Badge>
                          )}
                          <div className="text-right text-sm text-gray-500">
                            <p>
                              {new Date(run.startedAt).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                              })}
                            </p>
                            <p className="text-xs">
                              {run.duration ? `${run.duration}s` : 'Running...'}
                            </p>
                          </div>
                          <ChevronRight className="w-5 h-5 text-gray-400" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
