import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search, RefreshCw, ShieldCheck, XCircle, Clock, AlertTriangle, ArrowRight, IndianRupee } from 'lucide-react';

interface QueueRow {
  review_id: string;
  employee_id: string;
  status: 'pending_review' | 'approved' | 'rejected';
  package_accepted: number;
  rejection_category: string | null;
  rejection_reason_code: string | null;
  resubmit_count: number;
  reopen_count: number;
  created_at: string;
  reviewed_at: string | null;
  pending_hours: number;
  employee_code: string;
  full_name: string;
  designation_name: string | null;
  branch_name: string | null;
  ctc_annual?: number | null;
}

const STATUS_CFG = {
  pending_review: { label: 'Pending Review', chip: 'bg-amber-50 text-amber-700 border border-amber-200', icon: Clock },
  approved:       { label: 'Approved',       chip: 'bg-emerald-50 text-emerald-700 border border-emerald-200', icon: ShieldCheck },
  rejected:       { label: 'Rejected',       chip: 'bg-rose-50 text-rose-700 border border-rose-200', icon: XCircle },
} as const;

function AgingChip({ hours, status }: { hours: number; status: string }) {
  if (status !== 'pending_review') return null;
  if (hours >= 48) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
      <AlertTriangle className="h-3 w-3" />{Math.floor(hours / 24)}d overdue
    </span>
  );
  if (hours >= 24) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
      <Clock className="h-3 w-3" />{Math.floor(hours / 24)}d
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
      {hours}h
    </span>
  );
}

const inr = (n: number | null | undefined) =>
  n == null ? '—' : `₹${Math.round(Number(n) / 12).toLocaleString('en-IN')}/mo`;

export default function PayrollHeadSalaryReviewQueue() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'pending_review' | 'approved' | 'rejected'>('pending_review');
  const [q, setQ] = useState('');
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: tab });
      if (q.trim()) params.set('q', q.trim());
      if (branch) params.set('branch', branch);
      const r = await hrmsApi.get<{ success: boolean; data: QueueRow[] }>(`/api/payroll-head-review/queue?${params}`);
      const data = (r as any)?.data ?? [];
      setRows(data);
      setCounts(prev => ({ ...prev, [tab]: data.length }));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab, q, branch]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    hrmsApi.get<{ success: boolean; data: string[] }>('/api/payroll-head-review/branches')
      .then((r: any) => setBranches(r?.data ?? []))
      .catch(() => {});
  }, []);

  const tabLabel = (s: string) => {
    const c = counts[s];
    const base = STATUS_CFG[s as keyof typeof STATUS_CFG]?.label ?? s;
    return c != null ? `${base} (${c})` : base;
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Salary Review Queue</h1>
            <p className="mt-1 text-sm text-slate-500">
              Every new employee is blocked from payroll until reviewed and approved here.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="min-h-[40px]">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList>
              <TabsTrigger value="pending_review" className="cursor-pointer">{tabLabel('pending_review')}</TabsTrigger>
              <TabsTrigger value="approved" className="cursor-pointer">{tabLabel('approved')}</TabsTrigger>
              <TabsTrigger value="rejected" className="cursor-pointer">{tabLabel('rejected')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative flex-1 min-w-[220px] max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Name or employee code…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
          <Select value={branch || '__all__'} onValueChange={(v) => setBranch(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-[180px] h-9 text-sm">
              <SelectValue placeholder="All branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All branches</SelectItem>
              {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-slate-400">
              <ShieldCheck className="h-10 w-10 mb-3 text-slate-300" />
              <p className="font-medium text-slate-600">No employees in this state</p>
              <p className="text-sm mt-1">
                {tab === 'pending_review' ? 'All new hires have been reviewed.' : 'Nothing here yet.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow className="border-slate-200 hover:bg-slate-50">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 w-[220px]">Employee</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Designation</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Branch</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 text-right">Monthly CTC</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Waiting</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const cfg = STATUS_CFG[row.status];
                  const Icon = cfg.icon;
                  return (
                    <TableRow
                      key={row.review_id}
                      className="cursor-pointer hover:bg-slate-50 transition-colors border-slate-100"
                      onClick={() => navigate(`/payroll/salary-review/${row.employee_id}`)}
                    >
                      <TableCell className="py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-semibold text-sm flex-shrink-0">
                            {row.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900 text-sm leading-tight">{row.full_name}</p>
                            <p className="font-mono text-[11px] text-slate-400 mt-0.5">{row.employee_code}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-slate-700 py-3">{row.designation_name ?? '—'}</TableCell>
                      <TableCell className="text-sm text-slate-700 py-3">{row.branch_name ?? '—'}</TableCell>
                      <TableCell className="text-sm text-right tabular-nums text-slate-700 py-3">
                        <span className="inline-flex items-center gap-0.5">
                          <IndianRupee className="h-3 w-3 text-slate-400" />
                          {row.ctc_annual ? Math.round(row.ctc_annual / 12).toLocaleString('en-IN') : '—'}
                        </span>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.chip}`}>
                            <Icon className="h-3 w-3" />{cfg.label}
                          </span>
                          {row.status === 'pending_review' && !row.package_accepted && (
                            <span className="text-[10px] text-slate-400">Package not accepted</span>
                          )}
                          {row.status === 'rejected' && row.rejection_category && (
                            <span className="text-[10px] text-rose-500">{row.rejection_category}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex flex-col gap-1">
                          <AgingChip hours={row.pending_hours} status={row.status} />
                          {row.resubmit_count > 0 && (
                            <span className="text-[10px] text-blue-600">Resubmitted ×{row.resubmit_count}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3">
                        <ArrowRight className="h-4 w-4 text-slate-300" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        <p className="text-xs text-slate-400">
          {rows.length > 0 && `${rows.length} employee${rows.length !== 1 ? 's' : ''} shown`}
          {tab === 'pending_review' && rows.length > 0 && ' — salary will not build for any of these until approved'}
        </p>
      </div>
    </DashboardLayout>
  );
}
