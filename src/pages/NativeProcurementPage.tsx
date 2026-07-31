/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { HrmsModernShell, HrmsBentoTile } from '@/components/ui/hrms-modern';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  AlertTriangle, CheckCircle2, Clock, Loader2,
  Plus, RefreshCw, Search, ShoppingCart, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatISTDate } from '@/lib/utils';
import { useWorkforceAccess } from '@/hooks/useUserRole';

// ── Types ──────────────────────────────────────────────────────────────────────

type ProcStatus = 'draft' | 'submitted' | 'approved' | 'ordered' | 'received' | 'rejected';

interface ProcurementRequest {
  id: string; req_code: string; item_name: string;
  quantity: number; estimated_cost: number | null;
  vendor_id: string | null; vendor_name: string | null;
  department_id: string | null; department_name: string | null;
  required_by: string | null; justification: string | null;
  status: ProcStatus; requested_by: string; requester_name: string | null;
  approved_by: string | null; approved_at: string | null;
  remarks: string | null; created_at: string;
}

interface Vendor { id: string; vendor_code: string; vendor_name: string; }
interface Department { id: string; dept_name: string; }

const STATUS_COLOR: Record<ProcStatus, string> = {
  draft:     'bg-slate-100 text-slate-500 border-slate-200',
  submitted: 'bg-blue-50 text-blue-700 border-blue-200',
  approved:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  ordered:   'bg-violet-50 text-violet-700 border-violet-200',
  received:  'bg-teal-50 text-teal-700 border-teal-200',
  rejected:  'bg-red-50 text-red-700 border-red-200',
};

const STATUS_FLOW: Partial<Record<ProcStatus, ProcStatus>> = {
  submitted: 'approved',
  approved: 'ordered',
  ordered: 'received',
};

const EMPTY_FORM = {
  item_name: '', quantity: '1', estimated_cost: '',
  vendor_id: '', department_id: '', required_by: '', justification: '',
};

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeProcurementPage() {
  const qc = useQueryClient();
  const { roleKeys } = useWorkforceAccess();
  const isApprover = roleKeys.some(k => ['admin', 'hr', 'super_admin', 'finance', 'manager'].includes(k));

  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [detailReq, setDetailReq] = useState<ProcurementRequest | null>(null);
  const [approveTarget, setApproveTarget] = useState<{ id: string; action: 'approved' | 'rejected' } | null>(null);
  const [approveRemarks, setApproveRemarks] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);

  // ── Data
  const { data: reqData, isLoading, refetch } = useQuery({
    queryKey: ['erp-procurement', filterStatus],
    queryFn: async () => {
      const qs = filterStatus ? `?status=${filterStatus}` : '';
      const r = await hrmsApi.get<any>(`/api/erp/procurement${qs}`);
      return ((r as any)?.data ?? r ?? []) as ProcurementRequest[];
    },
  });

  const { data: vendorData } = useQuery({
    queryKey: ['erp-vendors-list'],
    queryFn: async () => {
      const r = await hrmsApi.get<any>('/api/erp/vendors?is_active=1');
      return ((r as any)?.data ?? r ?? []) as Vendor[];
    },
  });

  const { data: deptData } = useQuery({
    queryKey: ['departments-list'],
    queryFn: async () => {
      const r = await hrmsApi.get<any>('/api/departments');
      return ((r as any)?.data ?? r ?? []) as Department[];
    },
  });

  const requests = (reqData ?? []).filter(r =>
    !search || r.item_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.req_code?.toLowerCase().includes(search.toLowerCase()) ||
    r.requester_name?.toLowerCase().includes(search.toLowerCase())
  );

  // Stats
  const pending   = (reqData ?? []).filter(r => r.status === 'submitted').length;
  const approved  = (reqData ?? []).filter(r => r.status === 'approved').length;
  const totalCost = (reqData ?? [])
    .filter(r => ['approved', 'ordered', 'received'].includes(r.status) && r.estimated_cost)
    .reduce((s, r) => s + Number(r.estimated_cost), 0);

  // Mutations
  const createReq = useMutation({
    mutationFn: (body: any) => hrmsApi.post('/api/erp/procurement', body),
    onSuccess: () => { toast.success('Procurement request submitted'); qc.invalidateQueries({ queryKey: ['erp-procurement'] }); setShowCreate(false); setForm(EMPTY_FORM); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const approveReq = useMutation({
    mutationFn: ({ id, action, remarks }: { id: string; action: string; remarks: string }) =>
      hrmsApi.patch(`/api/erp/procurement/${id}/approve`, { action, remarks }),
    onSuccess: () => { toast.success('Decision recorded'); qc.invalidateQueries({ queryKey: ['erp-procurement'] }); setApproveTarget(null); setApproveRemarks(''); setDetailReq(null); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  return (
    <DashboardLayout>
      <HrmsModernShell
        eyebrow="ERP · Finance"
        title="Procurement"
        description="Raise, review and approve purchase requisitions. Track orders from request to receipt."
        icon={<ShoppingCart className="h-6 w-6" />}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading} className="gap-2 min-h-[40px]">
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" onClick={() => { setForm(EMPTY_FORM); setShowCreate(true); }} className="gap-2 min-h-[40px] bg-slate-950 hover:bg-slate-800 text-white">
              <Plus className="h-4 w-4" /> New Request
            </Button>
          </div>
        }
      >
        {/* Stats */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
          <HrmsBentoTile title="Pending Approval" value={pending} detail="Awaiting manager review" icon={<Clock className="h-5 w-5 text-amber-600" />} accentClassName="from-amber-500 to-orange-500" />
          <HrmsBentoTile title="Approved" value={approved} detail="Approved for ordering" icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} accentClassName="from-emerald-500 to-teal-500" />
          <HrmsBentoTile title="Approved Value" value={`₹${totalCost.toLocaleString('en-IN')}`} detail="Total approved spend" icon={<ShoppingCart className="h-5 w-5 text-blue-600" />} accentClassName="from-blue-500 to-cyan-500" className="col-span-2 lg:col-span-1" />
        </div>

        {/* Pending alert */}
        {pending > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-sm font-medium text-amber-800">{pending} procurement request{pending > 1 ? 's' : ''} awaiting approval</p>
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search requests…" className="pl-9" />
            </div>
            <Select value={filterStatus || 'all'} onValueChange={v => setFilterStatus(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-44 min-h-[40px]"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {(['submitted','approved','ordered','received','rejected'] as ProcStatus[]).map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <ShoppingCart className="h-12 w-12 mb-3 text-slate-200" />
              <p className="font-semibold text-slate-700">No procurement requests</p>
              <p className="text-sm text-slate-400 mt-1">Submit a new request to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Code</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Item</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide hidden sm:table-cell">Requested By</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide hidden md:table-cell">Est. Cost</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide hidden lg:table-cell">Required By</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Status</TableHead>
                    <TableHead className="text-xs font-bold uppercase tracking-wide">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map(req => (
                    <TableRow key={req.id} className="hover:bg-slate-50/60 transition-colors cursor-pointer" onClick={() => setDetailReq(req)}>
                      <TableCell className="font-mono text-xs text-slate-400">{req.req_code}</TableCell>
                      <TableCell>
                        <p className="font-semibold text-slate-900 text-sm">{req.item_name}</p>
                        <p className="text-xs text-slate-400">Qty: {req.quantity}{req.vendor_name ? ` · ${req.vendor_name}` : ''}</p>
                      </TableCell>
                      <TableCell className="text-sm text-slate-600 hidden sm:table-cell">{req.requester_name ?? '—'}</TableCell>
                      <TableCell className="font-semibold text-slate-700 hidden md:table-cell">
                        {req.estimated_cost != null ? `₹${Number(req.estimated_cost).toLocaleString('en-IN')}` : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 hidden lg:table-cell whitespace-nowrap">
                        {req.required_by ? formatISTDate(req.required_by) : '—'}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold capitalize whitespace-nowrap ${STATUS_COLOR[req.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                          {req.status}
                        </span>
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1.5">
                          {isApprover && req.status === 'submitted' && (
                            <>
                              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                                onClick={() => setApproveTarget({ id: req.id, action: 'approved' })}>Approve</Button>
                              <Button size="sm" variant="outline" className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50 cursor-pointer"
                                onClick={() => setApproveTarget({ id: req.id, action: 'rejected' })}>Reject</Button>
                            </>
                          )}
                          {isApprover && req.status in STATUS_FLOW && req.status !== 'submitted' && (
                            <Button size="sm" variant="outline" className="h-8 text-xs cursor-pointer"
                              onClick={() => approveReq.mutate({ id: req.id, action: STATUS_FLOW[req.status] as string, remarks: '' })}>
                              {`→ ${STATUS_FLOW[req.status]}`}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </HrmsModernShell>

      {/* Create Request Dialog */}
      <Dialog open={showCreate} onOpenChange={open => { setShowCreate(open); if (!open) setForm(EMPTY_FORM); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" />New Procurement Request</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="item">Item Name <span className="text-red-500">*</span></Label>
              <Input id="item" value={form.item_name} onChange={e => setForm(p => ({ ...p, item_name: e.target.value }))} placeholder="e.g. Office Chairs (ergonomic)" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="qty">Quantity <span className="text-red-500">*</span></Label>
              <Input id="qty" type="number" min="1" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="cost">Estimated Cost (₹)</Label>
              <Input id="cost" type="number" min="0" value={form.estimated_cost} onChange={e => setForm(p => ({ ...p, estimated_cost: e.target.value }))} placeholder="0.00" className="mt-1" />
            </div>
            <div>
              <Label>Preferred Vendor</Label>
              <Select value={form.vendor_id || 'none'} onValueChange={v => setForm(p => ({ ...p, vendor_id: v === 'none' ? '' : v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select vendor (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No preference</SelectItem>
                  {(vendorData ?? []).map(v => <SelectItem key={v.id} value={v.id}>{v.vendor_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Department</Label>
              <Select value={form.department_id || 'none'} onValueChange={v => setForm(p => ({ ...p, department_id: v === 'none' ? '' : v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  {(deptData ?? []).map(d => <SelectItem key={d.id} value={d.id}>{d.dept_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="reqby">Required By</Label>
              <Input id="reqby" type="date" value={form.required_by} onChange={e => setForm(p => ({ ...p, required_by: e.target.value }))} className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="just">Justification</Label>
              <Textarea id="just" rows={3} value={form.justification} onChange={e => setForm(p => ({ ...p, justification: e.target.value }))} placeholder="Why is this purchase needed?" className="mt-1 resize-none" />
            </div>
            <div className="sm:col-span-2 flex gap-2 pt-2">
              <Button className="flex-1 cursor-pointer" disabled={createReq.isPending || !form.item_name.trim()}
                onClick={() => createReq.mutate({ ...form, quantity: Number(form.quantity), estimated_cost: form.estimated_cost ? Number(form.estimated_cost) : null, vendor_id: form.vendor_id || null, department_id: form.department_id || null, required_by: form.required_by || null })}>
                {createReq.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Submit Request
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)} className="cursor-pointer"><X className="h-4 w-4" /></Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Approve / Reject Dialog */}
      <Dialog open={!!approveTarget} onOpenChange={open => { if (!open) { setApproveTarget(null); setApproveRemarks(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className={approveTarget?.action === 'approved' ? 'text-emerald-700' : 'text-red-700'}>
              {approveTarget?.action === 'approved' ? 'Approve Request' : 'Reject Request'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="remarks">Remarks {approveTarget?.action === 'rejected' && <span className="text-red-500">*</span>}</Label>
              <Textarea id="remarks" rows={3} value={approveRemarks} onChange={e => setApproveRemarks(e.target.value)}
                placeholder={approveTarget?.action === 'approved' ? 'Optional notes…' : 'Reason for rejection (required)'}
                className="mt-1 resize-none" />
            </div>
            <div className="flex gap-2">
              <Button className={`flex-1 cursor-pointer ${approveTarget?.action === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'} text-white`}
                disabled={approveReq.isPending || (approveTarget?.action === 'rejected' && !approveRemarks.trim())}
                onClick={() => approveTarget && approveReq.mutate({ id: approveTarget.id, action: approveTarget.action, remarks: approveRemarks })}>
                {approveReq.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Confirm {approveTarget?.action === 'approved' ? 'Approval' : 'Rejection'}
              </Button>
              <Button variant="outline" onClick={() => { setApproveTarget(null); setApproveRemarks(''); }} className="cursor-pointer">Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Sheet */}
      <Sheet open={!!detailReq} onOpenChange={open => { if (!open) setDetailReq(null); }}>
        <SheetContent side="right" className="w-full max-w-md p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3 border-b">
            <SheetTitle className="flex items-center gap-2"><ShoppingCart className="h-5 w-5" />{detailReq?.item_name}</SheetTitle>
            <p className="text-xs text-slate-500 font-mono">{detailReq?.req_code}</p>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {detailReq && ([
              { label: 'Status', value: detailReq.status },
              { label: 'Quantity', value: String(detailReq.quantity) },
              { label: 'Estimated Cost', value: detailReq.estimated_cost != null ? `₹${Number(detailReq.estimated_cost).toLocaleString('en-IN')}` : null },
              { label: 'Requested By', value: detailReq.requester_name },
              { label: 'Department', value: detailReq.department_name },
              { label: 'Vendor', value: detailReq.vendor_name },
              { label: 'Required By', value: detailReq.required_by ? formatISTDate(detailReq.required_by) : null },
              { label: 'Justification', value: detailReq.justification },
              { label: 'Remarks', value: detailReq.remarks },
            ].map(({ label, value }) => value ? (
              <div key={label}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                <p className="text-sm text-slate-800 mt-0.5">{value}</p>
              </div>
            ) : null))}
          </div>
          <div className="px-5 py-4 border-t flex gap-2">
            {isApprover && detailReq?.status === 'submitted' && (
              <>
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer" onClick={() => { setApproveTarget({ id: detailReq.id, action: 'approved' }); setDetailReq(null); }}>Approve</Button>
                <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 cursor-pointer" onClick={() => { setApproveTarget({ id: detailReq.id, action: 'rejected' }); setDetailReq(null); }}>Reject</Button>
              </>
            )}
            <Button variant="outline" onClick={() => setDetailReq(null)} className="cursor-pointer flex-1">Close</Button>
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
