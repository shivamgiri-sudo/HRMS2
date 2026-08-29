import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hrmsApi } from '@/lib/hrmsApi';
import { useWorkforceAccess } from '@/hooks/useUserRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  CalendarDays, CheckCircle2, XCircle, Clock3, Search, User,
  ChevronRight, Building2, RefreshCw, Plus, Loader2, AlertTriangle, TrendingUp,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RevisionRequest {
  id: number;
  employee_id: string;
  full_name: string;
  employee_code: string;
  branch_name: string | null;
  current_effective_from: string;
  requested_effective_from: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  review_remarks: string | null;
  created_at: string;
  reviewed_at: string | null;
  requested_by_email: string;
}

interface EmployeeResult {
  id: string;
  employee_code: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function empName(e: EmployeeResult) {
  return e.full_name ?? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim();
}

const REVIEWER_ROLES = ['payroll_head', 'admin', 'super_admin'];
const FIXER_ROLES    = ['payroll_hr', 'branch_head', 'hr', 'admin', 'super_admin'];

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; Icon: React.ElementType }> = {
    pending:  { label: 'Pending',  cls: 'bg-amber-100 text-amber-800 border-amber-300',   Icon: Clock3 },
    approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', Icon: CheckCircle2 },
    rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-800 border-red-300',         Icon: XCircle },
  };
  const cfg = map[status] ?? map.pending;
  const { Icon } = cfg;
  return (
    <Badge variant="outline" className={`text-xs font-semibold inline-flex items-center gap-1 ${cfg.cls}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

// ── KPI Tile ──────────────────────────────────────────────────────────────────

function KpiTile({
  label, value, tone, Icon,
}: { label: string; value: number; tone: 'blue' | 'amber' | 'green' | 'red'; Icon: React.ElementType }) {
  const tones = {
    blue:  { bg: 'bg-[#edf4ff]', text: 'text-[#0b63e5]', border: 'border-[#dce8fb]', icon: 'text-blue-500' },
    amber: { bg: 'bg-[#fff4e8]', text: 'text-[#ea580c]', border: 'border-[#fee3c5]', icon: 'text-amber-500' },
    green: { bg: 'bg-[#eaf8ef]', text: 'text-[#15803d]', border: 'border-[#d7f0df]', icon: 'text-emerald-500' },
    red:   { bg: 'bg-[#fff0f1]', text: 'text-[#dc2626]', border: 'border-[#ffdadd]', icon: 'text-red-500' },
  };
  const t = tones[tone];
  return (
    <div className={`rounded-2xl border ${t.border} ${t.bg} p-4 flex items-center gap-3`}
      style={{ boxShadow: '0 1px 3px rgba(37,99,235,0.08), 0 4px 12px rgba(37,99,235,0.06)' }}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center bg-white/60`}>
        <Icon className={`h-4.5 w-4.5 ${t.icon}`} />
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className={`text-2xl font-bold ${t.text}`}>{value}</p>
      </div>
    </div>
  );
}

// ── Employee Picker ───────────────────────────────────────────────────────────

function EmployeePicker({
  value, onSelect,
}: { value: EmployeeResult | null; onSelect: (e: EmployeeResult | null) => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<EmployeeResult[]>([]);
  const [open, setOpen] = useState(false);
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (!search.trim() || value) { setResults([]); setOpen(false); return; }
    debRef.current = setTimeout(async () => {
      try {
        const data = await hrmsApi.get<any>(`/api/employees?search=${encodeURIComponent(search.trim())}&limit=10`);
        const list: EmployeeResult[] = Array.isArray(data) ? data : (data.employees ?? data.data ?? []);
        setResults(list); setOpen(list.length > 0);
      } catch { setResults([]); setOpen(false); }
    }, 350);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [search, value]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
        <User className="h-4 w-4 text-blue-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-slate-800 flex-1 truncate">
          {empName(value)} <span className="text-slate-400 font-mono text-xs">({value.employee_code})</span>
        </span>
        <button type="button" onClick={() => { onSelect(null); setSearch(''); }}
          className="text-xs text-slate-400 hover:text-blue-600 cursor-pointer transition-colors duration-150">
          Change
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
      <Input
        placeholder="Search by name or employee code…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="pl-8 h-9 text-sm rounded-xl border-slate-200"
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg max-h-52 overflow-y-auto">
          {results.map((r) => (
            <button key={r.id} type="button"
              onClick={() => { onSelect(r); setSearch(''); setOpen(false); }}
              className="w-full text-left px-3 py-2.5 text-sm hover:bg-blue-50 cursor-pointer flex items-center justify-between transition-colors duration-100">
              <span className="font-medium text-slate-800">{empName(r)}</span>
              <span className="font-mono text-[11px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{r.employee_code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Request Detail Drawer ─────────────────────────────────────────────────────

function DetailDrawer({
  request, open, onClose,
  isReviewer, onApprove, onReject,
}: {
  request: RevisionRequest | null;
  open: boolean;
  onClose: () => void;
  isReviewer: boolean;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
}) {
  if (!request) return null;
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="max-w-2xl w-full flex flex-col p-0 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-5 flex-shrink-0">
          <SheetHeader>
            <SheetTitle className="text-white text-base font-semibold">Salary Date Revision Request</SheetTitle>
          </SheetHeader>
          <p className="text-blue-100 text-sm mt-0.5">{request.full_name} &middot; {request.employee_code}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge status={request.status} />
            {request.branch_name && (
              <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                <Building2 className="h-3 w-3" /> {request.branch_name}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Dates */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Date Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Current Salary Date</p>
                <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                  {fmtDate(request.current_effective_from)}
                </p>
              </div>
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
                <p className="text-[11px] text-blue-500 uppercase tracking-wide mb-1">Requested New Date</p>
                <p className="text-sm font-bold text-blue-700 flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5 text-blue-400" />
                  {fmtDate(request.requested_effective_from)}
                </p>
              </div>
            </div>
          </div>

          {/* Reason */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Reason</p>
            <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 leading-relaxed">
              {request.reason}
            </p>
          </div>

          {/* Review remarks */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Review Remarks</p>
            {request.review_remarks ? (
              <p className={`text-sm rounded-xl px-3 py-2.5 border leading-relaxed ${
                request.status === 'rejected'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}>
                {request.review_remarks}
              </p>
            ) : (
              <p className="text-xs text-slate-400 italic">None</p>
            )}
          </div>

          {/* Audit */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-3">Audit</p>
            <div className="space-y-2 text-sm text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">Submitted by</span>
                <span className="font-medium text-slate-700">{request.requested_by_email || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Submitted at</span>
                <span className="font-medium text-slate-700">{fmtDateTime(request.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Reviewed at</span>
                <span className="font-medium text-slate-700">{fmtDateTime(request.reviewed_at)}</span>
              </div>
            </div>
          </div>
        </div>

        {isReviewer && request.status === 'pending' && (
          <div className="border-t p-4 flex gap-3 flex-shrink-0">
            <Button variant="outline" onClick={() => onReject(request.id)}
              className="flex-1 rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 cursor-pointer">
              <XCircle className="h-4 w-4 mr-1.5" /> Reject
            </Button>
            <Button onClick={() => onApprove(request.id)}
              className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
              style={{ boxShadow: '0 4px 12px rgba(5,150,105,0.3)' }}>
              <CheckCircle2 className="h-4 w-4 mr-1.5" /> Approve
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Reject Dialog ─────────────────────────────────────────────────────────────

function RejectDialog({
  open, onClose, onConfirm, busy,
}: { open: boolean; onClose: () => void; onConfirm: (remarks: string) => void; busy: boolean }) {
  const [remarks, setRemarks] = useState('');
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setRemarks(''); } }}>
      <DialogContent className="rounded-2xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-slate-800">Reject Revision Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm text-slate-500">Provide a reason — this will be visible to the requester.</p>
          <Textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Reason for rejection…"
            rows={3}
            className="rounded-xl resize-none text-sm"
          />
          {remarks.trim().length > 0 && remarks.trim().length < 5 && (
            <p className="text-xs text-red-500">At least 5 characters required.</p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { onClose(); setRemarks(''); }} disabled={busy}
            className="rounded-xl cursor-pointer">
            Cancel
          </Button>
          <Button
            onClick={() => { if (remarks.trim().length >= 5) onConfirm(remarks.trim()); }}
            disabled={busy || remarks.trim().length < 5}
            className="rounded-xl bg-red-600 hover:bg-red-700 text-white cursor-pointer">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Submit Form (Fixer view) ───────────────────────────────────────────────────

function SubmitForm({ onSuccess }: { onSuccess: () => void }) {
  const [employee, setEmployee] = useState<EmployeeResult | null>(null);
  const [newDate, setNewDate] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: (payload: object) => hrmsApi.post('/api/salary-revision', payload),
    onSuccess: () => {
      setEmployee(null); setNewDate(''); setReason(''); setErr(null);
      onSuccess();
    },
    onError: (e: any) => setErr(e?.message ?? 'Failed to submit.'),
  });

  const handleSubmit = () => {
    setErr(null);
    if (!employee) return setErr('Select an employee.');
    if (!newDate)  return setErr('New salary date is required.');
    if (reason.trim().length < 10) return setErr('Reason must be at least 10 characters.');
    submit.mutate({ employee_id: employee.id, requested_effective_from: newDate, reason: reason.trim() });
  };

  return (
    <div className="rounded-2xl border border-blue-200 bg-white/95 backdrop-blur-sm overflow-hidden"
      style={{ boxShadow: '0 1px 3px rgba(37,99,235,0.08), 0 4px 12px rgba(37,99,235,0.06)' }}>
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-4">
        <div className="flex items-center gap-2 text-white">
          <Plus className="h-4 w-4" />
          <h3 className="text-sm font-semibold">New Revision Request</h3>
        </div>
        <p className="text-blue-100 text-xs mt-0.5">Submit a salary date change for Payroll Head approval</p>
      </div>
      <div className="p-5 space-y-4">
        {err && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2.5">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            {err}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Employee <span className="text-red-500">*</span>
            </Label>
            <EmployeePicker value={employee} onSelect={setEmployee} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              New Salary Date <span className="text-red-500">*</span>
            </Label>
            <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
              className="rounded-xl h-9 text-sm" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Reason <span className="text-red-500">*</span>
          </Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why the salary date needs to change (min 10 characters)…"
            rows={3} className="rounded-xl resize-none text-sm" />
          <p className="text-[11px] text-slate-400">{reason.trim().length}/10 minimum</p>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={submit.isPending}
            className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold cursor-pointer"
            style={{ boxShadow: '0 4px 12px rgba(37,99,235,0.3)' }}>
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
            Submit Request
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Requests Table ────────────────────────────────────────────────────────────

function RequestsTable({
  requests, isReviewer, onRowClick,
}: { requests: RevisionRequest[]; isReviewer: boolean; onRowClick: (r: RevisionRequest) => void }) {
  if (!requests.length) {
    return (
      <div className="text-center py-14 text-slate-400">
        <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium">No requests found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100">
            {['Employee', 'Branch', 'Current Date', 'Requested Date', 'Reason', isReviewer ? 'Requested By' : 'Submitted', 'Status', ''].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}
              onClick={() => onRowClick(r)}
              className="border-b border-slate-50 hover:bg-blue-50/50 cursor-pointer transition-colors duration-150 group">
              <td className="px-4 py-3">
                <p className="font-semibold text-slate-800">{r.full_name}</p>
                <p className="text-[11px] font-mono text-slate-400">{r.employee_code}</p>
              </td>
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.branch_name || '—'}</td>
              <td className="px-4 py-3 whitespace-nowrap text-slate-600">{fmtDate(r.current_effective_from)}</td>
              <td className="px-4 py-3 whitespace-nowrap font-semibold text-blue-700">{fmtDate(r.requested_effective_from)}</td>
              <td className="px-4 py-3 max-w-[200px]">
                <p className="text-slate-600 truncate" title={r.reason}>{r.reason}</p>
              </td>
              <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                {isReviewer ? (r.requested_by_email || '—') : fmtDate(r.created_at)}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={r.status} />
              </td>
              <td className="px-4 py-3">
                <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-blue-400 transition-colors duration-150" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SalaryRevisionPage() {
  const qc = useQueryClient();
  const { roleKeys, isResolved } = useWorkforceAccess();

  const isReviewer = REVIEWER_ROLES.some((r) => roleKeys.includes(r));
  const isFixer    = FIXER_ROLES.some((r) => roleKeys.includes(r));

  const [tab, setTab]             = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [drawer, setDrawer]       = useState<RevisionRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<number | null>(null);

  const listQuery = useQuery({
    queryKey: ['salary-revision', tab],
    queryFn: () =>
      hrmsApi.get<{ success: boolean; data: RevisionRequest[] }>(`/api/salary-revision?status=${tab}`)
        .then((r) => r.data ?? []),
    enabled: isResolved && isReviewer,
  });

  const myQuery = useQuery({
    queryKey: ['salary-revision-mine'],
    queryFn: () =>
      hrmsApi.get<{ success: boolean; data: RevisionRequest[] }>(`/api/salary-revision?status=pending`)
        .then((r) => r.data ?? []),
    enabled: isResolved && isFixer && !isReviewer,
  });

  const approveMut = useMutation({
    mutationFn: (id: number) =>
      hrmsApi.post(`/api/salary-revision/${id}/review`, { action: 'approve' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary-revision'] });
      setDrawer(null);
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, remarks }: { id: number; remarks: string }) =>
      hrmsApi.post(`/api/salary-revision/${id}/review`, { action: 'reject', remarks }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary-revision'] });
      setDrawer(null); setRejectTarget(null);
    },
  });

  const requests = listQuery.data ?? [];
  const pending  = requests.filter((r) => r.status === 'pending').length;

  if (!isResolved) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!isReviewer && !isFixer) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <AlertTriangle className="h-5 w-5 mr-2" /> You don't have access to this page.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-blue-50 p-4 sm:p-6 space-y-5">

      {/* ── Page Header ── */}
      <div className="rounded-3xl overflow-hidden"
        style={{ boxShadow: '0 4px 16px rgba(37,99,235,0.12), 0 2px 6px rgba(37,99,235,0.08)' }}>
        <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-700 px-6 py-5 text-white relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.08), transparent 55%)' }} />
          <div className="relative flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-white" />
                </div>
                <h1 className="text-xl font-bold">Salary Date Revision</h1>
              </div>
              <p className="text-blue-100 text-sm">
                {isReviewer
                  ? 'Review and approve salary effective date change requests'
                  : 'Submit a salary date revision for Payroll Head approval'}
              </p>
            </div>
            {isReviewer && (
              <Button variant="outline" size="sm"
                onClick={() => qc.invalidateQueries({ queryKey: ['salary-revision'] })}
                className="bg-white/10 border-white/30 text-white hover:bg-white/20 rounded-xl cursor-pointer">
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Reviewer Layout ── */}
      {isReviewer && (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KpiTile label="Pending Approval" value={requests.filter((r) => r.status === 'pending').length} tone="amber" Icon={Clock3} />
            <KpiTile label="Approved" value={requests.filter((r) => r.status === 'approved').length} tone="green" Icon={CheckCircle2} />
            <KpiTile label="Rejected" value={requests.filter((r) => r.status === 'rejected').length} tone="red" Icon={XCircle} />
          </div>

          {/* Tab bar + table */}
          <div className="rounded-2xl border border-blue-200 bg-white/95 backdrop-blur-sm overflow-hidden"
            style={{ boxShadow: '0 1px 3px rgba(37,99,235,0.08), 0 4px 12px rgba(37,99,235,0.06)' }}>
            <div className="flex border-b border-slate-100">
              {(['pending', 'approved', 'rejected'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-3 text-sm font-semibold capitalize transition-colors duration-150 cursor-pointer border-b-2 ${
                    tab === t
                      ? 'border-blue-600 text-blue-700 bg-blue-50/60'
                      : 'border-transparent text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                  }`}>
                  {t}
                  {t === 'pending' && pending > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full bg-amber-500 text-white">
                      {pending}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {listQuery.isLoading ? (
              <div className="flex items-center justify-center py-14">
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              </div>
            ) : (
              <RequestsTable
                requests={listQuery.data ?? []}
                isReviewer
                onRowClick={setDrawer}
              />
            )}
          </div>
        </>
      )}

      {/* ── Fixer (non-reviewer) Layout ── */}
      {!isReviewer && isFixer && (
        <>
          <SubmitForm onSuccess={() => qc.invalidateQueries({ queryKey: ['salary-revision-mine'] })} />

          <div className="rounded-2xl border border-blue-200 bg-white/95 backdrop-blur-sm overflow-hidden"
            style={{ boxShadow: '0 1px 3px rgba(37,99,235,0.08), 0 4px 12px rgba(37,99,235,0.06)' }}>
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">My Submitted Requests</h3>
              <button onClick={() => qc.invalidateQueries({ queryKey: ['salary-revision-mine'] })}
                className="text-slate-400 hover:text-blue-600 cursor-pointer transition-colors duration-150">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
            {myQuery.isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
              </div>
            ) : (
              <RequestsTable
                requests={myQuery.data ?? []}
                isReviewer={false}
                onRowClick={setDrawer}
              />
            )}
          </div>
        </>
      )}

      {/* ── Detail Drawer ── */}
      <DetailDrawer
        request={drawer}
        open={!!drawer}
        onClose={() => setDrawer(null)}
        isReviewer={isReviewer}
        onApprove={(id) => approveMut.mutate(id)}
        onReject={(id) => { setRejectTarget(id); }}
      />

      {/* ── Reject Dialog ── */}
      <RejectDialog
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={(remarks) => { if (rejectTarget) rejectMut.mutate({ id: rejectTarget, remarks }); }}
        busy={rejectMut.isPending}
      />
    </div>
  );
}
