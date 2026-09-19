import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Download, Search, CalendarDays } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AttRow {
  emp_code: string;
  bio_code?: string;
  emp_name: string;
  department?: string;
  designation?: string;
  profile?: string;
  cost_center?: string;
  emp_location?: string;
  process_name?: string;
  doj_display?: string;
  billable?: string;
  employee_status?: string;
  absent_count?: number;
  present_count?: number;
  od_count?: number;
  hd_count?: number;
  leave_count?: number;
  holiday_count?: number;
  weekoff_count?: number;
  sal_days?: number;
  total?: number;
  [key: string]: unknown; // day_N and day_N_reg fields
}
interface BranchRow   { id: string; branch_name: string; }
interface CcRow       { id: string; cost_centre_name: string; process_name?: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DOW_SHORT    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function currentMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`;
}

function monthOptions() {
  const opts: {value:string;label:string}[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    opts.push({ value: val, label: `${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}` });
  }
  return opts;
}

function daysInMonth(yyyymm: string): number {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function dayLabel(yyyymm: string, day: number): { date: string; dow: string } {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 1, day);
  const mn = SHORT_MONTHS[m - 1];
  return {
    date: `${String(day).padStart(2,'0')}-${mn}`,
    dow:  DOW_SHORT[d.getDay()],
  };
}

// Status colour map — matches I-Spark codes exactly
const STATUS_CLS: Record<string, string> = {
  P:   'bg-green-100  text-green-900  font-bold',
  A:   'bg-red-100    text-red-800    font-semibold',
  HD:  'bg-amber-100  text-amber-900  font-semibold',
  L:   'bg-blue-100   text-blue-800   font-semibold',
  H:   'bg-slate-200  text-slate-700',
  OD:  'bg-purple-100 text-purple-900 font-semibold',
  AP:  'bg-sky-100    text-sky-800',
  HDP: 'bg-orange-100 text-orange-900 font-semibold',
  WO:  'bg-slate-100  text-slate-600',
};

function statusCls(code: string): string {
  return STATUS_CLS[code?.toUpperCase()] ?? 'text-slate-400';
}

function num(v: unknown): number {
  return v == null ? 0 : Number(v);
}

function exportCsv(rows: AttRow[], month: string) {
  const nd = daysInMonth(month);
  const dayHdrs = Array.from({ length: nd }, (_, i) => dayLabel(month, i+1).date);
  const fixed = ['Emp Code','Bio Code','Name','Department','Designation','Profile','Cost Centre','Branch','Process','DOJ','Billable','Status'];
  const summ  = ['P','A','OD','HD','L','H','WO','Sal Days','Total'];
  const header = [...fixed, ...dayHdrs, ...summ].join(',');
  const body = rows.map(r => [
    r.emp_code, r.bio_code??'', r.emp_name, r.department??'', r.designation??'', r.profile??'',
    r.cost_center??'', r.emp_location??'', r.process_name??'', r.doj_display??'', r.billable??'', r.employee_status??'',
    ...Array.from({ length: nd }, (_, i) => String(r[`day_${i+1}`] ?? '')),
    num(r.present_count), num(r.absent_count), num(r.od_count), num(r.hd_count),
    num(r.leave_count), num(r.holiday_count), num(r.weekoff_count), num(r.sal_days), num(r.total),
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
  const blob = new Blob([[header, ...body].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `attendance-register-${month}.csv`; a.click();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AttendanceRegisterExport() {
  const [month,        setMonth]        = useState(currentMonth());
  const [branchId,     setBranchId]     = useState('all');
  const [costCentreId, setCostCentreId] = useState('all');
  const [empCode,      setEmpCode]      = useState('');
  const [empStatus,    setEmpStatus]    = useState('active');
  const [queryKey,     setQueryKey]     = useState<string|null>(null);

  const branchesQ = useQuery({
    queryKey: ['att-reg-branches'],
    queryFn: () => hrmsApi.get<{data:BranchRow[]}>('/api/org/branches?active_status=1').then(r => r.data ?? []),
    staleTime: 300_000,
  });

  const ccQ = useQuery({
    queryKey: ['att-reg-cc', branchId],
    queryFn: () => {
      const p = branchId !== 'all' ? `?branch_id=${branchId}` : '';
      return hrmsApi.get<{data:CcRow[]}>(`/api/org/cost-centres${p}`).then(r => r.data ?? []);
    },
    staleTime: 120_000,
  });

  const dataQ = useQuery({
    queryKey: ['att-reg-data', queryKey],
    enabled: !!queryKey,
    queryFn: () => {
      const p = new URLSearchParams({ month, limit: '1000' });
      if (branchId !== 'all')     p.set('branchId',     branchId);
      if (costCentreId !== 'all') p.set('costCentreId', costCentreId);
      if (empStatus !== 'all')    p.set('employeeStatus', empStatus);
      if (empCode.trim()) {
        // If the value contains any digit it's an employee code; otherwise name search.
        // "MAS61061" / "24852C" → code  |  "shivam" / "John Smith" → name
        const v = empCode.trim();
        if (/\d/.test(v)) p.set('employeeCode', v);
        else              p.set('employeeName',  v);
      }
      return hrmsApi.get<{data:AttRow[]}>(`/api/reports/suite/attendance-register-monthly?${p}`).then(r => r.data ?? []);
    },
    staleTime: 0,
  });

  function handleShow() {
    setQueryKey(`${month}|${branchId}|${costCentreId}|${empCode}|${empStatus}`);
  }

  const rows     = dataQ.data ?? [];
  const loading  = dataQ.isFetching;
  const branches = branchesQ.data ?? [];
  const ccs      = ccQ.data       ?? [];
  const nd       = daysInMonth(month);
  const days     = Array.from({ length: nd }, (_, i) => i + 1);
  const [y, m]   = month.split('-').map(Number);
  const monthLabel = `${SHORT_MONTHS[m-1]} ${y}`;

  return (
    <DashboardLayout>
      <div className="p-4 space-y-3">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-teal-100">
            <CalendarDays className="h-5 w-5 text-teal-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Attendance Register</h1>
            <p className="text-xs text-slate-500">Day-wise attendance grid — complete replica of the attendance register report</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-white border rounded-xl p-4 shadow-sm">
          <div className="grid grid-cols-2 md:grid-cols-7 gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-600">Month</Label>
              <Select value={month} onValueChange={v => {
                setMonth(v);
                if (queryKey !== null) setQueryKey(`${v}|${branchId}|${costCentreId}|${empCode}|${empStatus}`);
              }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {monthOptions().map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-600">Branch</Label>
              <Select value={branchId} onValueChange={v => { setBranchId(v); setCostCentreId('all'); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="ALL" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ALL</SelectItem>
                  {branches.map(b => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 col-span-2 md:col-span-1">
              <Label className="text-xs font-medium text-slate-600">Cost Centre</Label>
              <Select value={costCentreId} onValueChange={setCostCentreId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="ALL" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ALL</SelectItem>
                  {ccs.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.cost_centre_name}{c.process_name ? ` (${c.process_name})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-600">Status</Label>
              <Select value={empStatus} onValueChange={setEmpStatus}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium text-slate-600">Emp Code / Name</Label>
              <Input
                className="h-9 text-sm" placeholder="Code or name"
                value={empCode} onChange={e => setEmpCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleShow()}
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleShow} disabled={loading} className="h-9 bg-teal-600 hover:bg-teal-700 text-white flex-1">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
                Show
              </Button>
              {rows.length > 0 && (
                <Button variant="outline" className="h-9" onClick={() => exportCsv(rows, month)}>
                  <Download className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Legend */}
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 px-1">
            {[
              { code: 'P',  label: 'Present' },
              { code: 'A',  label: 'Absent' },
              { code: 'HD', label: 'Half Day' },
              { code: 'L',  label: 'Leave' },
              { code: 'OD', label: 'On Duty' },
              { code: 'H',  label: 'Holiday' },
              { code: 'AP', label: 'Approved Leave' },
            ].map(({ code, label }) => (
              <span key={code} className="flex items-center gap-1">
                <span className={`inline-flex items-center justify-center w-5 h-4 rounded text-[10px] ${statusCls(code)}`}>{code}</span>
                {label}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="inline-flex items-center justify-center w-5 h-4 rounded text-[10px] bg-green-100 text-green-900 font-bold ring-1 ring-inset ring-orange-500">P</span>
              Regularized
            </span>
            <span className="ml-auto font-medium text-slate-700">{rows.length} employee{rows.length !== 1 ? 's' : ''} · {monthLabel}</span>
          </div>
        )}

        {/* Grid */}
        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border shadow-sm bg-white">
            <table className="min-w-max text-[11px] border-collapse">
              <thead>
                {/* Row 1: group headers */}
                <tr className="bg-slate-800 text-white">
                  <th rowSpan={2} className="sticky left-0 z-20 bg-slate-800 px-2 py-1 text-left whitespace-nowrap min-w-[80px] border-r border-slate-600">#</th>
                  <th rowSpan={2} className="sticky left-[44px] z-20 bg-slate-800 px-2 py-1 text-left whitespace-nowrap min-w-[80px] border-r border-slate-600">Emp Code</th>
                  <th rowSpan={2} className="sticky left-[124px] z-20 bg-slate-800 px-2 py-1 text-left whitespace-nowrap min-w-[140px] border-r border-slate-600">Name</th>
                  <th rowSpan={2} className="px-2 py-1 text-left whitespace-nowrap min-w-[100px] border-r border-slate-600">Branch</th>
                  <th rowSpan={2} className="px-2 py-1 text-left whitespace-nowrap min-w-[120px] border-r border-slate-600">Cost Centre</th>
                  <th rowSpan={2} className="px-2 py-1 text-left whitespace-nowrap min-w-[110px] border-r border-slate-600">Process</th>
                  <th rowSpan={2} className="px-2 py-1 text-left whitespace-nowrap min-w-[70px] border-r border-slate-600">Desig.</th>
                  <th rowSpan={2} className="px-2 py-1 text-center whitespace-nowrap min-w-[52px] border-r border-slate-600">Status</th>
                  <th colSpan={nd} className="px-2 py-1 text-center border-l border-slate-600 bg-slate-700">{monthLabel} — Day wise</th>
                  <th colSpan={9} className="px-2 py-1 text-center bg-teal-700">Summary</th>
                </tr>
                {/* Row 2: day numbers + summary labels */}
                <tr className="bg-slate-700 text-white">
                  {days.map(d => {
                    const { date, dow } = dayLabel(month, d);
                    const isSun = dow === 'Sun';
                    const isSat = dow === 'Sat';
                    return (
                      <th key={d} className={`px-0 py-0 text-center border-l border-slate-600 min-w-[28px] ${isSun||isSat ? 'bg-slate-600' : ''}`}>
                        <div className="text-[10px] font-bold leading-tight px-1">{String(d).padStart(2,'0')}</div>
                        <div className={`text-[8px] leading-tight px-1 ${isSun ? 'text-red-300' : isSat ? 'text-sky-300' : 'text-slate-200'}`}>{dow}</div>
                      </th>
                    );
                  })}
                  {['P','A','OD','HD','L','H','WO','Sal','Total'].map(h => (
                    <th key={h} className="px-1 py-1 text-center whitespace-nowrap border-l border-teal-600 bg-teal-700 text-teal-100 min-w-[32px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={row.emp_code} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className={`sticky left-0 z-10 px-2 py-1 text-center text-slate-400 border-r border-slate-100 ${ri%2===0?'bg-white':'bg-slate-50'}`}>{ri+1}</td>
                    <td className={`sticky left-[44px] z-10 px-2 py-1 font-mono font-semibold text-slate-700 whitespace-nowrap border-r border-slate-100 ${ri%2===0?'bg-white':'bg-slate-50'}`}>{row.emp_code}</td>
                    <td className={`sticky left-[124px] z-10 px-2 py-1 whitespace-nowrap border-r border-slate-100 ${ri%2===0?'bg-white':'bg-slate-50'}`}>{row.emp_name}</td>
                    <td className="px-2 py-1 whitespace-nowrap text-slate-600 border-r border-slate-100">{row.emp_location ?? '—'}</td>
                    <td className="px-2 py-1 whitespace-nowrap text-slate-600 border-r border-slate-100 max-w-[140px] truncate">{row.cost_center ?? '—'}</td>
                    <td className="px-2 py-1 whitespace-nowrap text-slate-600 border-r border-slate-100 max-w-[130px] truncate">{row.process_name ?? '—'}</td>
                    <td className="px-2 py-1 whitespace-nowrap text-slate-500 text-[10px] border-r border-slate-100">{row.designation ?? '—'}</td>
                    <td className="px-1 py-1 text-center border-r border-slate-100">
                      <span className={`text-[9px] font-semibold px-1 py-0.5 rounded ${row.employee_status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                        {row.employee_status === 'Active' ? 'A' : 'I'}
                      </span>
                    </td>
                    {days.map(d => {
                      const code = String(row[`day_${d}`] ?? '').trim();
                      const isReg = Boolean(row[`day_${d}_reg`]);
                      const { dow } = dayLabel(month, d);
                      const isSun = dow === 'Sun';
                      const isSat = dow === 'Sat';
                      return (
                        <td
                          key={d}
                          className={`px-0 py-0 text-center border-l border-slate-100 ${isSun||isSat ? 'bg-slate-50' : ''}`}
                          title={isReg ? 'Regularized' : undefined}
                        >
                          {code ? (
                            <span className={`inline-flex items-center justify-center w-full h-6 text-[10px] ${statusCls(code)} ${isReg ? 'ring-1 ring-inset ring-orange-500' : ''}`}>
                              {code}
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center w-full h-6 text-slate-300">·</span>
                          )}
                        </td>
                      );
                    })}
                    {/* Summary */}
                    {[
                      row.present_count,
                      row.absent_count,
                      row.od_count,
                      row.hd_count,
                      row.leave_count,
                      row.holiday_count,
                      row.weekoff_count,
                      row.sal_days,
                      row.total,
                    ].map((v, si) => (
                      <td key={si} className="px-1 py-1 text-center border-l border-teal-100 bg-teal-50 font-semibold text-teal-800 whitespace-nowrap">
                        {v == null ? '—' : num(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty state */}
        {queryKey && !loading && rows.length === 0 && (
          <div className="text-center py-16 text-slate-400">
            <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No attendance records found for the selected filters.</p>
            <p className="text-xs mt-1">Try a different month, branch or cost centre.</p>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
