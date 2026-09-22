import { useState, useRef } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Download, Search, TrendingUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { inr } from './PayrollHeadSalaryReviewQueue';

// ─── Types ───────────────────────────────────────────────────────────────────

interface MonthSlot { year: number; month: number; label: string; }
interface MonthSalary {
  basic: number; hra: number; conveyance: number; gross: number;
  ctc: number; net_in_hand: number; pf: string; esi: string;
  effective_date: string; changed: boolean;
}
interface EmployeeTrend {
  id: string; employee_code: string; full_name: string;
  branch_name: string | null; cost_centre_name: string | null;
  monthly: (MonthSalary | null)[];
}
interface TrendData { months: MonthSlot[]; employees: EmployeeTrend[]; }
interface BranchRow { id: string; branch_name: string; }
interface CcRow    { id: string; cost_centre_name: string; process_name?: string; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function currentFy(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

function fyOptions(): string[] {
  const cur = parseInt(currentFy().split('-')[0], 10);
  return [cur - 2, cur - 1, cur, cur + 1].map((y) => `${y}-${String(y + 1).slice(2)}`);
}

function compact(n: number | undefined | null): string {
  if (n == null) return '—';
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000)   return `₹${(n / 1000).toFixed(1)}k`;
  return `₹${n}`;
}

function exportCsv(data: TrendData) {
  const headers = ['EmpCode','Name','Branch','Cost Centre',
    ...data.months.map((m) => `Basic-${m.label}`),
    ...data.months.map((m) => `Gross-${m.label}`),
    ...data.months.map((m) => `CTC-${m.label}`),
    ...data.months.map((m) => `Net-${m.label}`),
  ];
  const rows = data.employees.map((emp) => {
    const basics  = emp.monthly.map((m) => m?.basic   ?? '');
    const grosses = emp.monthly.map((m) => m?.gross    ?? '');
    const ctcs    = emp.monthly.map((m) => m?.ctc      ?? '');
    const nets    = emp.monthly.map((m) => m?.net_in_hand ?? '');
    return [
      emp.employee_code, emp.full_name,
      emp.branch_name ?? '', emp.cost_centre_name ?? '',
      ...basics, ...grosses, ...ctcs, ...nets,
    ].map((v) => `"${v}"`).join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `salary-trend-${Date.now()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SalaryTrendExport() {
  const [fy,             setFy]            = useState(currentFy());
  const [branchId,       setBranchId]      = useState('all');
  const [costCentreId,   setCostCentreId]  = useState('all');
  const [employeeCode,   setEmployeeCode]  = useState('');
  const [queryKey,       setQueryKey]      = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Filter options
  const branchesQ = useQuery({
    queryKey: ['salary-trend-branches'],
    queryFn: () => hrmsApi.get<{ data: BranchRow[] }>('/api/org/branches?active_status=1').then((r) => r.data ?? []),
    staleTime: 300_000,
  });
  const ccQ = useQuery({
    queryKey: ['salary-trend-cc', branchId],
    queryFn: () => {
      const params = new URLSearchParams({ active_status: '1', limit: '500' });
      if (branchId !== 'all') params.set('branch_id', branchId);
      return hrmsApi.get<{ data: CcRow[] }>(`/api/org/cost-centres?${params.toString()}`).then((r) => r.data ?? []);
    },
    staleTime: 120_000,
  });

  // Main data
  const trendQ = useQuery({
    queryKey: ['salary-trend-data', queryKey],
    enabled: !!queryKey,
    queryFn: () => {
      const p = new URLSearchParams({ fy });
      if (branchId !== 'all')       p.set('branch_id',      branchId);
      if (costCentreId !== 'all')   p.set('cost_centre_id', costCentreId);
      if (employeeCode.trim())      p.set('employee_code',  employeeCode.trim());
      return hrmsApi.get<{ data: TrendData }>(`/api/salary-change/trend?${p}`).then((r) => r.data);
    },
    staleTime: 0,
  });

  function handleShow() {
    setQueryKey(`${fy}|${branchId}|${costCentreId}|${employeeCode}`);
  }

  const data     = trendQ.data;
  const loading  = trendQ.isFetching;
  const branches = branchesQ.data ?? [];
  const ccs      = ccQ.data       ?? [];

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-100">
            <TrendingUp className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Salary Trend Export</h1>
            <p className="text-xs text-slate-500">Month-by-month salary grid — mirrors attendance export format</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-600">Financial Year</Label>
              <Select value={fy} onValueChange={setFy}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fyOptions().map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-600">Branch</Label>
              <Select value={branchId} onValueChange={(v) => { setBranchId(v); setCostCentreId('all'); }}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="ALL" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ALL</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-600">Cost Centre</Label>
              <Select value={costCentreId} onValueChange={setCostCentreId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="ALL" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ALL</SelectItem>
                  {ccs.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.cost_centre_name}{c.process_name ? ` (${c.process_name})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-600">Emp Code</Label>
              <Input
                className="h-9 text-sm"
                placeholder="e.g. MAS56873"
                value={employeeCode}
                onChange={(e) => setEmployeeCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleShow()}
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleShow} disabled={loading} className="h-9 bg-violet-600 hover:bg-violet-700 text-white flex-1">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                Show
              </Button>
              {data && data.employees.length > 0 && (
                <Button variant="outline" className="h-9" onClick={() => exportCsv(data)}>
                  <Download className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Legend */}
        {data && (
          <div className="flex items-center gap-4 text-xs text-slate-500 px-1">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-amber-100 border border-amber-300" />
              Salary changed this month
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded bg-slate-100 border border-slate-200" />
              No change
            </span>
            <span className="ml-auto font-medium text-slate-700">
              {data.employees.length} employee{data.employees.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Grid */}
        {data && data.employees.length > 0 && (
          <div ref={scrollRef} className="overflow-x-auto rounded-xl border shadow-sm bg-white">
            <table className="min-w-max text-xs border-collapse">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="sticky left-0 z-20 bg-slate-800 px-3 py-2 text-left font-semibold whitespace-nowrap min-w-[90px]">Emp Code</th>
                  <th className="sticky left-[90px] z-20 bg-slate-800 px-3 py-2 text-left font-semibold whitespace-nowrap min-w-[160px]">Name</th>
                  <th className="px-3 py-2 text-left font-semibold whitespace-nowrap min-w-[100px]">Branch</th>
                  <th className="px-3 py-2 text-left font-semibold whitespace-nowrap min-w-[130px]">Cost Centre</th>
                  {data.months.map((m) => (
                    <th key={m.label} className="px-2 py-2 text-center font-semibold whitespace-nowrap min-w-[80px] border-l border-slate-700">
                      {m.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-center font-semibold whitespace-nowrap min-w-[80px] border-l border-slate-600 bg-violet-800">Basic</th>
                  <th className="px-3 py-2 text-center font-semibold whitespace-nowrap min-w-[80px] bg-violet-800">Gross</th>
                  <th className="px-3 py-2 text-center font-semibold whitespace-nowrap min-w-[80px] bg-violet-800">CTC</th>
                  <th className="px-3 py-2 text-center font-semibold whitespace-nowrap min-w-[80px] bg-violet-800">Net</th>
                </tr>
                {/* Sub-header: Gross / CTC */}
                <tr className="bg-slate-100 text-slate-600 border-b border-slate-300">
                  <th className="sticky left-0 z-20 bg-slate-100 px-3 py-1 text-left font-normal" />
                  <th className="sticky left-[90px] z-20 bg-slate-100 px-3 py-1 text-left font-normal" />
                  <th className="px-3 py-1" />
                  <th className="px-3 py-1" />
                  {data.months.map((m) => (
                    <th key={m.label} className="px-2 py-1 text-center border-l border-slate-200">
                      <div className="text-[10px] text-slate-400">Gross</div>
                      <div className="text-[10px] text-slate-400">CTC</div>
                    </th>
                  ))}
                  <th className="border-l border-slate-300" />
                  <th /><th /><th />
                </tr>
              </thead>
              <tbody>
                {data.employees.map((emp, ri) => {
                  const lastSal = [...emp.monthly].reverse().find(Boolean);
                  return (
                    <tr key={emp.id} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className={`sticky left-0 z-10 px-3 py-1.5 font-mono font-semibold text-slate-700 whitespace-nowrap border-r border-slate-100 ${ri % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                        {emp.employee_code}
                      </td>
                      <td className={`sticky left-[90px] z-10 px-3 py-1.5 whitespace-nowrap border-r border-slate-100 ${ri % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                        {emp.full_name}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-slate-600">{emp.branch_name ?? '—'}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-slate-600 max-w-[160px] truncate">{emp.cost_centre_name ?? '—'}</td>
                      {emp.monthly.map((sal, mi) => (
                        <td
                          key={mi}
                          className={`px-2 py-1 text-center border-l border-slate-100 ${sal?.changed ? 'bg-amber-50' : ''}`}
                        >
                          {sal ? (
                            <>
                              {sal.changed && (
                                <div className="text-[9px] font-bold text-amber-600 leading-none mb-0.5">↑ CHG</div>
                              )}
                              <div className="font-medium text-slate-700 leading-tight">{compact(sal.gross)}</div>
                              <div className="text-[10px] text-slate-400 leading-tight">{compact(sal.ctc)}</div>
                            </>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      ))}
                      {/* Current salary summary */}
                      <td className="px-3 py-1.5 text-center border-l border-violet-200 bg-violet-50 font-medium text-slate-700">
                        {lastSal ? compact(lastSal.basic) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-center bg-violet-50 font-medium text-slate-700">
                        {lastSal ? compact(lastSal.gross) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-center bg-violet-50 font-semibold text-violet-700">
                        {lastSal ? compact(lastSal.ctc) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-center bg-violet-50 font-medium text-slate-700">
                        {lastSal ? compact(lastSal.net_in_hand) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty state */}
        {data && data.employees.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No employees found for the selected filters.</p>
            <p className="text-xs mt-1">Try adjusting the branch, cost centre, or financial year.</p>
          </div>
        )}

        {/* Hover tooltip key */}
        {data && data.employees.length > 0 && (
          <p className="text-[11px] text-slate-400 px-1">
            Each cell shows <strong>Gross</strong> (top) / <strong>CTC</strong> (bottom) for that month.
            Amber cells mark months where a salary change took effect.
            Summary columns (right) show the current active salary.
            Values ≥ ₹1 lakh shown as <code>L</code>, values ≥ ₹1,000 shown as <code>k</code>.
          </p>
        )}
      </div>
    </DashboardLayout>
  );
}
