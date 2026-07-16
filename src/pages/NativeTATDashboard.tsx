/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { HrmsModernShell, HrmsBentoTile } from '@/components/ui/hrms-modern';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatISTDate } from '@/lib/utils';

interface TatTask {
  id: string; task_type: string; entity_type: string; entity_id: string;
  assigned_to: string; assigned_to_name?: string;
  due_at: string; status: 'open' | 'completed' | 'escalated' | 'overdue';
  completed_at?: string | null; created_at: string; branch_name?: string;
}

interface DashboardStats {
  total_open: number; overdue: number; due_today: number;
  completed_today: number; avg_completion_hours?: number | null;
}

function isOverdue(dueAt: string, status: string) {
  return status !== 'completed' && new Date(dueAt) < new Date();
}

function urgencyBadge(dueAt: string, status: string) {
  if (status === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (isOverdue(dueAt, status)) return 'bg-red-50 text-red-700 border-red-200';
  const hoursLeft = (new Date(dueAt).getTime() - Date.now()) / 3600000;
  if (hoursLeft < 4) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

export default function NativeTATDashboard() {
  const qc = useQueryClient();

  const { data: stats, isLoading: statsLoading, refetch } = useQuery({
    queryKey: ['tat-dashboard-stats'],
    queryFn: async () => {
      const r = await hrmsApi.get<any>('/api/governance/tat/dashboard');
      return (r as any)?.data as DashboardStats;
    },
  });

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['tat-tasks'],
    queryFn: async () => {
      const r = await hrmsApi.get<any>('/api/governance/tat/tasks');
      return ((r as any)?.data ?? []) as TatTask[];
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/governance/tat/tasks/${id}/complete`, {}),
    onSuccess: () => { toast.success('Task completed'); qc.invalidateQueries({ queryKey: ['tat-tasks'] }); qc.invalidateQueries({ queryKey: ['tat-dashboard-stats'] }); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const isLoading   = statsLoading || tasksLoading;
  const allTasks    = tasksData ?? [];
  const openTasks   = allTasks.filter(t => t.status !== 'completed');
  const overdueTasks = openTasks.filter(t => isOverdue(t.due_at, t.status));

  return (
    <DashboardLayout>
      <HrmsModernShell
        eyebrow="Governance"
        title="TAT Dashboard"
        description="Monitor turnaround time compliance and overdue task alerts across all workflows."
        icon={<Clock className="h-6 w-6" />}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading} className="gap-2 min-h-[40px]">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        }
      >

        {/* Stat tiles — responsive 2→4 columns */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <HrmsBentoTile title="Open Tasks" value={stats?.total_open ?? openTasks.length} detail="Pending action" icon={<Clock className="h-5 w-5 text-blue-600" />} accentClassName="from-blue-500 to-cyan-500" />
          <HrmsBentoTile title="Overdue" value={stats?.overdue ?? overdueTasks.length} detail="Past SLA deadline" icon={<AlertTriangle className="h-5 w-5 text-red-600" />} accentClassName="from-red-500 to-rose-500" />
          <HrmsBentoTile title="Due Today" value={stats?.due_today ?? 0} detail="Due within 24 hours" icon={<Clock className="h-5 w-5 text-amber-600" />} accentClassName="from-amber-500 to-orange-500" />
          <HrmsBentoTile title="Completed Today" value={stats?.completed_today ?? 0} detail="Resolved today" icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} accentClassName="from-emerald-500 to-teal-500" />
        </div>

        {/* Overdue alert banner */}
        {overdueTasks.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">
                {overdueTasks.length} task{overdueTasks.length > 1 ? 's' : ''} overdue — immediate action required
              </p>
              <p className="text-xs text-red-600 mt-0.5">Overdue tasks may block downstream workflows.</p>
            </div>
          </div>
        )}

        {/* Task table — scrolls horizontally on mobile */}
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">Active Tasks ({openTasks.length})</p>
          </div>
          {tasksLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
            </div>
          ) : openTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <CheckCircle2 className="h-12 w-12 mb-3 text-emerald-200" />
              <p className="font-semibold text-slate-700">All tasks are on track</p>
              <p className="text-sm text-slate-400 mt-1">No open TAT tasks at this time.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Task Type</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide hidden sm:table-cell">Entity</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide hidden md:table-cell">Assigned To</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Due At</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Status</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openTasks.slice(0, 100).map(t => (
                    <TableRow key={t.id} className={`transition-colors ${isOverdue(t.due_at, t.status) ? 'bg-red-50/20 hover:bg-red-50/40' : 'hover:bg-slate-50/60'}`}>
                      <TableCell className="font-semibold text-slate-900 text-sm">{t.task_type}</TableCell>
                      <TableCell className="text-xs text-slate-400 hidden sm:table-cell font-mono">{t.entity_type}:{t.entity_id?.slice(0, 8)}…</TableCell>
                      <TableCell className="text-sm text-slate-600 hidden md:table-cell">{t.assigned_to_name ?? t.assigned_to?.slice(0, 8) ?? '—'}</TableCell>
                      <TableCell className="text-sm text-slate-600 whitespace-nowrap">{t.due_at ? formatISTDate(t.due_at) : '—'}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${urgencyBadge(t.due_at, t.status)}`}>
                          {isOverdue(t.due_at, t.status) ? 'OVERDUE' : t.status.toUpperCase()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs cursor-pointer whitespace-nowrap"
                          disabled={completeMutation.isPending}
                          onClick={() => completeMutation.mutate(t.id)}
                        >
                          {completeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Complete'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {openTasks.length > 100 && (
                <p className="text-xs text-slate-500 px-4 py-2 border-t">Showing 100 of {openTasks.length} tasks.</p>
              )}
            </div>
          )}
        </div>
      </HrmsModernShell>
    </DashboardLayout>
  );
}
