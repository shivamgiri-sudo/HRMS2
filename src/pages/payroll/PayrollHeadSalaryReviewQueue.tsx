/**
 * Payroll Head mandatory salary/journey review queue.
 *
 * Lists every employee waiting on a Payroll Head decision before payroll can
 * build their salary — see payrollCalculate.service.ts's employee_payroll_head_review
 * gate (migration 1541). One central queue, all branches, per the owner decision
 * that scoping this per-branch is out of scope for v1.
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, RefreshCw, ShieldCheck, XCircle, Clock, ArrowRight } from 'lucide-react';

interface QueueRow {
  review_id: string;
  employee_id: string;
  status: 'pending_review' | 'approved' | 'rejected';
  package_accepted: number;
  rejection_category: string | null;
  rejection_reason_code: string | null;
  resubmit_count: number;
  created_at: string;
  reviewed_at: string | null;
  employee_code: string;
  full_name: string;
  designation_name: string | null;
  branch_name: string | null;
}

const STATUS_META: Record<string, { label: string; className: string; icon: typeof Clock }> = {
  pending_review: { label: 'Pending Review', className: 'bg-amber-100 text-amber-800', icon: Clock },
  approved: { label: 'Approved', className: 'bg-emerald-100 text-emerald-800', icon: ShieldCheck },
  rejected: { label: 'Rejected', className: 'bg-red-100 text-red-800', icon: XCircle },
};

export default function PayrollHeadSalaryReviewQueue() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'pending_review' | 'approved' | 'rejected'>('pending_review');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status });
      if (q.trim()) params.set('q', q.trim());
      const r = await hrmsApi.get<{ success: boolean; data: QueueRow[] }>(`/api/payroll-head-review/queue?${params}`);
      setRows((r as any)?.data ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status, q]);

  useEffect(() => { void load(); }, [load]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Salary Review Queue</h1>
            <p className="text-sm text-slate-500 mt-1">
              Every newly created employee stays out of payroll until reviewed here.
            </p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1 rounded-lg border border-slate-200 p-1">
                {(['pending_review', 'approved', 'rejected'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
                      status === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {STATUS_META[s].label}
                  </button>
                ))}
              </div>
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search name or employee code…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void load(); }}
                  className="pl-8"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : rows.length === 0 ? (
              <div className="text-center py-16 text-slate-400">No employees in this state.</div>
            ) : (
              <div className="space-y-2">
                {rows.map((row) => {
                  const meta = STATUS_META[row.status];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={row.review_id}
                      onClick={() => navigate(`/payroll/salary-review/${row.employee_id}`)}
                      className="w-full flex items-center justify-between rounded-xl border border-slate-200 p-4 text-left hover:border-slate-300 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-semibold">
                          {row.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">{row.full_name}</div>
                          <div className="text-xs text-slate-500">
                            {row.employee_code} · {row.designation_name ?? '—'} · {row.branch_name ?? '—'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {row.status === 'pending_review' && !row.package_accepted && (
                          <Badge className="bg-slate-100 text-slate-600">Package not accepted</Badge>
                        )}
                        {row.resubmit_count > 0 && (
                          <Badge className="bg-blue-100 text-blue-800">Resubmitted ×{row.resubmit_count}</Badge>
                        )}
                        <Badge className={meta.className}>
                          <Icon className="h-3 w-3 mr-1 inline" /> {meta.label}
                        </Badge>
                        <ArrowRight className="h-4 w-4 text-slate-400" />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
