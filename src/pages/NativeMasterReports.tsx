import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { BarChart3, ChevronDown, ChevronRight, Download, Play, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReportMeta {
  id: string;
  report_code: string;
  report_name: string;
  report_category: string;
  query_key: string;
  admin_only: number;
  active_status: number;
}

interface ReportResult {
  columns: string[];
  rows: Record<string, unknown>[];
  count: number;
}

interface FilterState {
  branch: string;
  ccCode: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  month: string;
  year: string;
  financialYear: string;
  process: string;
  period: string;
  campaign: string;
  eventType: string;
}

// ── Export helpers ────────────────────────────────────────────────────────────

function downloadCsv(columns: string[], rows: Record<string, unknown>[], filename: string) {
  const header = columns.join(',');
  const body = rows
    .map((r) => columns.map((c) => JSON.stringify(r[c] ?? '')).join(','))
    .join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Category badge colours ─────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  branch:     'bg-blue-100 text-blue-700',
  user:       'bg-purple-100 text-purple-700',
  process:    'bg-orange-100 text-orange-700',
  employee:   'bg-green-100 text-green-700',
  payroll:    'bg-yellow-100 text-yellow-700',
  attendance: 'bg-pink-100 text-pink-700',
  kpi:        'bg-red-100 text-red-700',
  custom:     'bg-slate-100 text-slate-700',
};

function CategoryBadge({ cat }: { cat: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize', CATEGORY_COLOR[cat] ?? 'bg-slate-100 text-slate-700')}>
      {cat}
    </span>
  );
}

// ── Collapsible category section ──────────────────────────────────────────────

function CategorySection({
  category,
  reports,
  selected,
  onSelect,
}: {
  category: string;
  reports: ReportMeta[];
  selected: ReportMeta | null;
  onSelect: (r: ReportMeta) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <CategoryBadge cat={category} />
          <span className="text-xs text-slate-400">({reports.length})</span>
        </span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
      </button>
      {open && (
        <div className="pb-1">
          {reports.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r)}
              className={cn(
                'w-full px-4 py-2 text-left text-sm transition-colors',
                selected?.id === r.id
                  ? 'bg-indigo-600 text-white font-semibold'
                  : 'text-slate-700 hover:bg-slate-100'
              )}
            >
              {r.report_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NativeMasterReports() {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();

  const [selected, setSelected] = useState<ReportMeta | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    branch: '', ccCode: '', status: '', dateFrom: '', dateTo: '',
    month: '', year: String(currentYear), financialYear: '',
    process: '', period: '', campaign: '', eventType: '',
  });
  const [result, setResult] = useState<ReportResult | null>(null);

  // ── Data queries ─────────────────────────────────────────────────────────────

  const { data: reportsData, isLoading: reportsLoading } = useQuery({
    queryKey: ['report-master-list'],
    queryFn: () => hrmsApi.get<{ data: ReportMeta[] }>('/api/reports'),
    staleTime: 5 * 60_000,
  });

  const { data: branchData } = useQuery({
    queryKey: ['branches-for-filter'],
    queryFn: () => hrmsApi.get<{ data: { id: string; branch_name: string }[] }>('/api/org/branches'),
    staleTime: 5 * 60_000,
  });

  const { data: processData } = useQuery({
    queryKey: ['processes-for-filter'],
    queryFn: () => hrmsApi.get<{ data: { id: string; process_name: string }[] }>('/api/processes'),
    staleTime: 5 * 60_000,
  });

  const reports = reportsData?.data ?? [];
  const branches = branchData?.data ?? [];
  const processes = processData?.data ?? [];

  // ── Group reports by category ─────────────────────────────────────────────────

  const grouped = reports.reduce<Record<string, ReportMeta[]>>((acc, r) => {
    acc[r.report_category] = acc[r.report_category] ?? [];
    acc[r.report_category].push(r);
    return acc;
  }, {});

  // ── Run report ───────────────────────────────────────────────────────────────

  const runMut = useMutation({
    mutationFn: () =>
      hrmsApi.post<{ data: ReportResult }>(`/api/reports/${selected!.report_code}/run`, {
        filters: Object.fromEntries(
          Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined)
        ),
      }),
    onSuccess: (res) => {
      setResult(res.data);
      toast({ title: `${selected!.report_name} loaded`, description: `${res.data.count} rows` });
    },
    onError: (err: Error) => {
      toast({ title: 'Report failed', description: err.message, variant: 'destructive' });
    },
  });

  const f = filters;
  const sf = (patch: Partial<FilterState>) => setFilters(prev => ({ ...prev, ...patch }));

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Report Builder</h1>
            <p className="text-sm text-slate-500">34 built-in reports — Payroll, Attendance, APR, Employee, Leave, KPI, Compliance</p>
          </div>
        </div>

        <div className="flex gap-4 items-start">
          {/* ── Left panel ──────────────────────────────────────────────────── */}
          <Card className="w-64 shrink-0 sticky top-20 max-h-[calc(100vh-120px)] overflow-y-auto">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-600">Reports ({reports.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {reportsLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              )}
              {Object.entries(grouped).map(([cat, reps]) => (
                <CategorySection
                  key={cat}
                  category={cat}
                  reports={reps}
                  selected={selected}
                  onSelect={(r) => { setSelected(r); setResult(null); }}
                />
              ))}
              {!reportsLoading && reports.length === 0 && (
                <p className="px-4 py-6 text-xs text-slate-400">No reports found. Run migration 143.</p>
              )}
            </CardContent>
          </Card>

          {/* ── Main panel ──────────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 space-y-4">
            {!selected && (
              <Card>
                <CardContent className="py-16 text-center">
                  <BarChart3 className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-slate-400 text-sm">Select a report from the left panel to begin</p>
                  <p className="text-xs text-slate-300 mt-1">Branch-scoped: you only see data for your branch</p>
                </CardContent>
              </Card>
            )}

            {selected && (
              <>
                {/* Report title + actions */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <div>
                        <CardTitle className="text-base">{selected.report_name}</CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          <CategoryBadge cat={selected.report_category} />
                          <span className="text-xs text-slate-400 font-mono">{selected.report_code}</span>
                          {selected.admin_only === 1 && (
                            <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-600 font-semibold">Admin</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          onClick={() => runMut.mutate()}
                          disabled={runMut.isPending}
                          className="bg-indigo-600 hover:bg-indigo-700"
                        >
                          {runMut.isPending
                            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running...</>
                            : <><Play className="h-4 w-4 mr-2" />Run Report</>
                          }
                        </Button>
                        {result && result.rows.length > 0 && (
                          <>
                            <Button
                              variant="outline"
                              onClick={() =>
                                downloadCsv(
                                  result.columns,
                                  result.rows,
                                  `${selected.report_code}_${new Date().toISOString().slice(0, 10)}.csv`
                                )
                              }
                            >
                              <Download className="h-4 w-4 mr-2" />
                              CSV
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  {/* Filters */}
                  <CardContent>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">

                      {/* Branch */}
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Branch</Label>
                        <Select value={f.branch || '__all__'} onValueChange={(v) => sf({ branch: v === '__all__' ? '' : v })}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All branches" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All branches</SelectItem>
                            {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Process */}
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Process</Label>
                        <Select value={f.process || '__all__'} onValueChange={(v) => sf({ process: v === '__all__' ? '' : v })}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All processes" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All processes</SelectItem>
                            {processes.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Month */}
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Month</Label>
                        <Input
                          type="month"
                          className="h-8 text-sm"
                          value={f.month}
                          onChange={(e) => sf({ month: e.target.value })}
                        />
                      </div>

                      {/* Year */}
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Year</Label>
                        <Input
                          className="h-8 text-sm"
                          placeholder={String(currentYear)}
                          value={f.year}
                          onChange={(e) => sf({ year: e.target.value })}
                        />
                      </div>

                      {/* Financial Year */}
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Financial Year</Label>
                        <Input
                          className="h-8 text-sm"
                          placeholder="e.g. 2025-26"
                          value={f.financialYear}
                          onChange={(e) => sf({ financialYear: e.target.value })}
                        />
                      </div>

                      {/* Date From */}
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Date From</Label>
                        <Input
                          type="date"
                          className="h-8 text-sm"
                          value={f.dateFrom}
                          onChange={(e) => sf({ dateFrom: e.target.value })}
                        />
                      </div>

                      {/* Date To */}
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Date To</Label>
                        <Input
                          type="date"
                          className="h-8 text-sm"
                          value={f.dateTo}
                          onChange={(e) => sf({ dateTo: e.target.value })}
                        />
                      </div>

                      {/* Status */}
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Status</Label>
                        <Select value={f.status || '__all__'} onValueChange={(v) => sf({ status: v === '__all__' ? '' : v })}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All</SelectItem>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                            <SelectItem value="resigned">Resigned</SelectItem>
                            <SelectItem value="terminated">Terminated</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Campaign ID (APR) */}
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Campaign ID</Label>
                        <Input
                          className="h-8 text-sm"
                          placeholder="Campaign"
                          value={f.campaign}
                          onChange={(e) => sf({ campaign: e.target.value })}
                        />
                      </div>

                      {/* KPI Period */}
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">KPI Period</Label>
                        <Input
                          className="h-8 text-sm"
                          placeholder="e.g. 2026-05"
                          value={f.period}
                          onChange={(e) => sf({ period: e.target.value })}
                        />
                      </div>

                      {/* Event Type (lifecycle) */}
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">Event Type</Label>
                        <Select value={f.eventType || '__all__'} onValueChange={(v) => sf({ eventType: v === '__all__' ? '' : v })}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All events" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__all__">All events</SelectItem>
                            <SelectItem value="promotion">Promotion</SelectItem>
                            <SelectItem value="transfer">Transfer</SelectItem>
                            <SelectItem value="increment">Increment</SelectItem>
                            <SelectItem value="designation_change">Designation Change</SelectItem>
                            <SelectItem value="confirmation">Confirmation</SelectItem>
                            <SelectItem value="status_change">Status Change</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* CC Code */}
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-500">CC Code</Label>
                        <Input
                          className="h-8 text-sm"
                          placeholder="e.g. MCN-BLR"
                          value={f.ccCode}
                          onChange={(e) => sf({ ccCode: e.target.value })}
                        />
                      </div>

                    </div>
                  </CardContent>
                </Card>

                {/* Results table */}
                {result && (
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm text-slate-600">
                          {selected.report_name} — Results
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{result.count.toLocaleString()} rows</Badge>
                          <Badge variant="outline">{result.columns.length} columns</Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      {result.rows.length === 0 ? (
                        <p className="px-6 py-8 text-center text-sm text-slate-400">No data returned for the selected filters.</p>
                      ) : (
                        <div className="overflow-auto max-h-[65vh]">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-slate-50">
                                {result.columns.map((col) => (
                                  <TableHead
                                    key={col}
                                    className="whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-slate-600 sticky top-0 bg-slate-50"
                                  >
                                    {col.replace(/_/g, ' ')}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {result.rows.map((row, ri) => (
                                <TableRow key={ri} className="hover:bg-slate-50 transition-colors">
                                  {result.columns.map((col) => {
                                    const val = row[col];
                                    const display = val === null || val === undefined ? '—' : String(val);
                                    const isNum = typeof val === 'number';
                                    return (
                                      <TableCell
                                        key={col}
                                        className={cn(
                                          'text-sm whitespace-nowrap max-w-xs truncate py-2',
                                          isNum && 'text-right font-mono tabular-nums'
                                        )}
                                      >
                                        {display}
                                      </TableCell>
                                    );
                                  })}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
