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
  Building2, CheckCircle2, Edit2, FileText, Loader2,
  Plus, RefreshCw, Search, Users, X,
} from 'lucide-react';
import { toast } from 'sonner';

// ── Types ──────────────────────────────────────────────────────────────────────

type VendorType = 'supplier' | 'service' | 'contractor' | 'other';

interface Vendor {
  id: string; vendor_code: string; vendor_name: string;
  vendor_type: VendorType; contact_name: string | null;
  contact_email: string | null; contact_phone: string | null;
  address: string | null; gst_number: string | null;
  pan_number: string | null; payment_terms: string | null;
  is_active: number;
}

interface Contract {
  id: string; contract_code: string; title: string;
  vendor_id: string | null; vendor_name: string | null;
  contract_type: string; start_date: string; end_date: string | null;
  value: number | null; status: string; notes: string | null;
}

const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  supplier: 'Supplier', service: 'Service Provider',
  contractor: 'Contractor', other: 'Other',
};

const CONTRACT_STATUS_COLOR: Record<string, string> = {
  draft:      'bg-slate-100 text-slate-500 border-slate-200',
  active:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  expired:    'bg-amber-50 text-amber-700 border-amber-200',
  terminated: 'bg-red-50 text-red-700 border-red-200',
};

const EMPTY_VENDOR = {
  vendor_code: '', vendor_name: '', vendor_type: 'supplier' as VendorType,
  contact_name: '', contact_email: '', contact_phone: '',
  address: '', gst_number: '', pan_number: '', payment_terms: '',
};

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeVendorManagement() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'vendors' | 'contracts'>('vendors');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Vendor | null>(null);
  const [detailVendor, setDetailVendor] = useState<Vendor | null>(null);
  const [form, setForm] = useState(EMPTY_VENDOR);

  // ── Data
  const { data: vendorsData, isLoading: loadingV, refetch: refV } = useQuery({
    queryKey: ['erp-vendors', filterType],
    queryFn: async () => {
      const qs = filterType ? `?vendor_type=${filterType}` : '?is_active=1';
      const r = await hrmsApi.get<any>(`/api/erp/vendors${qs}`);
      return ((r as any)?.data ?? r ?? []) as Vendor[];
    },
  });

  const { data: contractsData, isLoading: loadingC } = useQuery({
    queryKey: ['erp-contracts'],
    queryFn: async () => {
      const r = await hrmsApi.get<any>('/api/erp/contracts');
      return ((r as any)?.data ?? r ?? []) as Contract[];
    },
  });

  const vendors = (vendorsData ?? []).filter(v =>
    !search || v.vendor_name?.toLowerCase().includes(search.toLowerCase()) ||
    v.vendor_code?.toLowerCase().includes(search.toLowerCase())
  );
  const contracts = (contractsData ?? []).filter(c =>
    !search || c.title?.toLowerCase().includes(search.toLowerCase()) ||
    c.vendor_name?.toLowerCase().includes(search.toLowerCase())
  );

  // Stats
  const active      = (vendorsData ?? []).filter(v => v.is_active).length;
  const suppliers   = (vendorsData ?? []).filter(v => v.vendor_type === 'supplier').length;
  const activeContracts = (contractsData ?? []).filter(c => c.status === 'active').length;

  // Mutations
  const createVendor = useMutation({
    mutationFn: (body: any) => hrmsApi.post('/api/erp/vendors', body),
    onSuccess: () => { toast.success('Vendor created'); qc.invalidateQueries({ queryKey: ['erp-vendors'] }); setShowCreate(false); setForm(EMPTY_VENDOR); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const updateVendor = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => hrmsApi.put(`/api/erp/vendors/${id}`, body),
    onSuccess: () => { toast.success('Vendor updated'); qc.invalidateQueries({ queryKey: ['erp-vendors'] }); setEditTarget(null); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  function openEdit(v: Vendor) {
    setEditTarget(v);
    setForm({
      vendor_code: v.vendor_code, vendor_name: v.vendor_name,
      vendor_type: v.vendor_type, contact_name: v.contact_name ?? '',
      contact_email: v.contact_email ?? '', contact_phone: v.contact_phone ?? '',
      address: v.address ?? '', gst_number: v.gst_number ?? '',
      pan_number: v.pan_number ?? '', payment_terms: v.payment_terms ?? '',
    });
  }

  const VendorForm = ({ isEdit }: { isEdit?: boolean }) => (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="vcode">Vendor Code {!isEdit && <span className="text-red-500">*</span>}</Label>
        <Input id="vcode" value={form.vendor_code} onChange={e => setForm(p => ({ ...p, vendor_code: e.target.value }))} placeholder="VND-001" className="mt-1" disabled={isEdit} />
      </div>
      <div>
        <Label htmlFor="vname">Vendor Name <span className="text-red-500">*</span></Label>
        <Input id="vname" value={form.vendor_name} onChange={e => setForm(p => ({ ...p, vendor_name: e.target.value }))} placeholder="Acme Supplies Pvt Ltd" className="mt-1" />
      </div>
      <div>
        <Label>Vendor Type</Label>
        <Select value={form.vendor_type} onValueChange={v => setForm(p => ({ ...p, vendor_type: v as VendorType }))}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(VENDOR_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="vpayment">Payment Terms</Label>
        <Input id="vpayment" value={form.payment_terms} onChange={e => setForm(p => ({ ...p, payment_terms: e.target.value }))} placeholder="Net 30 days" className="mt-1" />
      </div>
      <div>
        <Label htmlFor="vcname">Contact Name</Label>
        <Input id="vcname" value={form.contact_name} onChange={e => setForm(p => ({ ...p, contact_name: e.target.value }))} className="mt-1" />
      </div>
      <div>
        <Label htmlFor="vcemail">Contact Email</Label>
        <Input id="vcemail" type="email" value={form.contact_email} onChange={e => setForm(p => ({ ...p, contact_email: e.target.value }))} className="mt-1" />
      </div>
      <div>
        <Label htmlFor="vcphone">Contact Phone</Label>
        <Input id="vcphone" value={form.contact_phone} onChange={e => setForm(p => ({ ...p, contact_phone: e.target.value }))} className="mt-1" />
      </div>
      <div>
        <Label htmlFor="vgst">GST Number</Label>
        <Input id="vgst" value={form.gst_number} onChange={e => setForm(p => ({ ...p, gst_number: e.target.value }))} placeholder="22AAAAA0000A1Z5" className="mt-1" />
      </div>
      <div>
        <Label htmlFor="vpan">PAN Number</Label>
        <Input id="vpan" value={form.pan_number} onChange={e => setForm(p => ({ ...p, pan_number: e.target.value }))} className="mt-1" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="vaddr">Address</Label>
        <Textarea id="vaddr" rows={2} value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} className="mt-1 resize-none" />
      </div>
    </div>
  );

  return (
    <DashboardLayout>
      <HrmsModernShell
        eyebrow="ERP · Finance"
        title="Vendor Management"
        description="Manage suppliers, service providers, contractors and associated contracts."
        icon={<Building2 className="h-6 w-6" />}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { void refV(); }} className="gap-2 min-h-[40px]">
              <RefreshCw className="h-4 w-4" />
            </Button>
            {tab === 'vendors' && (
              <Button size="sm" onClick={() => { setForm(EMPTY_VENDOR); setShowCreate(true); }} className="gap-2 min-h-[40px] bg-slate-950 hover:bg-slate-800 text-white">
                <Plus className="h-4 w-4" /> Add Vendor
              </Button>
            )}
          </div>
        }
      >
        {/* Stats */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
          <HrmsBentoTile title="Active Vendors" value={active} detail="Currently enabled vendors" icon={<Building2 className="h-5 w-5 text-blue-600" />} accentClassName="from-blue-500 to-cyan-500" />
          <HrmsBentoTile title="Suppliers" value={suppliers} detail="Product/material suppliers" icon={<Users className="h-5 w-5 text-violet-600" />} accentClassName="from-violet-500 to-purple-500" />
          <HrmsBentoTile title="Active Contracts" value={activeContracts} detail="Currently active contracts" icon={<FileText className="h-5 w-5 text-emerald-600" />} accentClassName="from-emerald-500 to-teal-500" className="col-span-2 lg:col-span-1" />
        </div>

        {/* Tab bar + search */}
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center gap-0 border-b border-slate-100 px-1 pt-1">
            {(['vendors', 'contracts'] as const).map(t => (
              <button key={t} type="button" onClick={() => { setTab(t); setSearch(''); }}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-t-lg transition-colors cursor-pointer select-none
                  ${tab === t ? 'bg-slate-950 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}>
                {t === 'vendors' ? <><Building2 className="h-4 w-4" />Vendors ({(vendorsData ?? []).length})</> : <><FileText className="h-4 w-4" />Contracts ({(contractsData ?? []).length})</>}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-100">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <Input value={search} onChange={e => setSearch(e.target.value)}
                placeholder={tab === 'vendors' ? 'Search vendors…' : 'Search contracts…'} className="pl-9" />
            </div>
            {tab === 'vendors' && (
              <Select value={filterType || 'all'} onValueChange={v => setFilterType(v === 'all' ? '' : v)}>
                <SelectTrigger className="w-44 min-h-[40px]"><SelectValue placeholder="All Types" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {Object.entries(VENDOR_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Vendor Table */}
          {tab === 'vendors' && (
            loadingV ? (
              <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
            ) : vendors.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Building2 className="h-12 w-12 mb-3 text-slate-200" />
                <p className="font-semibold text-slate-700">No vendors found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Code</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Vendor Name</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide hidden sm:table-cell">Type</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide hidden md:table-cell">Contact</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide hidden lg:table-cell">GST</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Status</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendors.map(v => (
                      <TableRow key={v.id} className="hover:bg-slate-50/60 transition-colors cursor-pointer" onClick={() => setDetailVendor(v)}>
                        <TableCell className="font-mono text-xs text-slate-400">{v.vendor_code}</TableCell>
                        <TableCell>
                          <p className="font-semibold text-slate-900 text-sm">{v.vendor_name}</p>
                          {v.payment_terms && <p className="text-xs text-slate-400">{v.payment_terms}</p>}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-[10px] font-bold text-blue-700">
                            {VENDOR_TYPE_LABELS[v.vendor_type]}
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-slate-600">
                          {v.contact_name && <p className="text-sm">{v.contact_name}</p>}
                          {v.contact_email && <p className="text-xs text-slate-400">{v.contact_email}</p>}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-slate-500 font-mono">{v.gst_number ?? '—'}</TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${v.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                            {v.is_active ? <><CheckCircle2 className="h-3 w-3" />Active</> : 'Inactive'}
                          </span>
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Button size="sm" variant="outline" className="h-8 text-xs cursor-pointer gap-1" onClick={() => openEdit(v)}>
                            <Edit2 className="h-3 w-3" />Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          )}

          {/* Contract Table */}
          {tab === 'contracts' && (
            loadingC ? (
              <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
            ) : contracts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <FileText className="h-12 w-12 mb-3 text-slate-200" />
                <p className="font-semibold text-slate-700">No contracts found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Code</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Title</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide hidden sm:table-cell">Vendor</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide hidden md:table-cell">Period</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide hidden lg:table-cell">Value</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contracts.map(c => (
                      <TableRow key={c.id} className="hover:bg-slate-50/60 transition-colors">
                        <TableCell className="font-mono text-xs text-slate-400">{c.contract_code}</TableCell>
                        <TableCell>
                          <p className="font-semibold text-slate-900 text-sm">{c.title}</p>
                          <p className="text-xs text-slate-400 capitalize">{c.contract_type}</p>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600 hidden sm:table-cell">{c.vendor_name ?? '—'}</TableCell>
                        <TableCell className="text-xs text-slate-500 hidden md:table-cell whitespace-nowrap">
                          {c.start_date} → {c.end_date ?? 'Open'}
                        </TableCell>
                        <TableCell className="font-semibold text-slate-700 hidden lg:table-cell">
                          {c.value != null ? `₹${Number(c.value).toLocaleString('en-IN')}` : '—'}
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold capitalize ${CONTRACT_STATUS_COLOR[c.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                            {c.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          )}
        </div>
      </HrmsModernShell>

      {/* Create Vendor Dialog */}
      <Dialog open={showCreate} onOpenChange={open => { setShowCreate(open); if (!open) setForm(EMPTY_VENDOR); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" />Add New Vendor</DialogTitle>
          </DialogHeader>
          <VendorForm />
          <div className="flex gap-2 pt-2">
            <Button className="flex-1 cursor-pointer"
              disabled={createVendor.isPending || !form.vendor_code.trim() || !form.vendor_name.trim()}
              onClick={() => createVendor.mutate({ ...form, is_active: 1 })}>
              {createVendor.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Create Vendor
            </Button>
            <Button variant="outline" onClick={() => setShowCreate(false)} className="cursor-pointer"><X className="h-4 w-4" /></Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Vendor Dialog */}
      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit: {editTarget?.vendor_name}</DialogTitle>
          </DialogHeader>
          <VendorForm isEdit />
          <div className="flex gap-2 pt-2">
            <Button className="flex-1 cursor-pointer"
              disabled={updateVendor.isPending || !form.vendor_name.trim()}
              onClick={() => editTarget && updateVendor.mutate({ id: editTarget.id, body: form })}>
              {updateVendor.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Save Changes
            </Button>
            <Button variant="outline" onClick={() => setEditTarget(null)} className="cursor-pointer">Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Vendor Detail Sheet */}
      <Sheet open={!!detailVendor} onOpenChange={open => { if (!open) setDetailVendor(null); }}>
        <SheetContent side="right" className="w-full max-w-md p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-3 border-b">
            <SheetTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" />{detailVendor?.vendor_name}</SheetTitle>
            <p className="text-xs text-slate-500 font-mono">{detailVendor?.vendor_code}</p>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {detailVendor && ([
              { label: 'Type', value: VENDOR_TYPE_LABELS[detailVendor.vendor_type] },
              { label: 'Contact', value: detailVendor.contact_name },
              { label: 'Email', value: detailVendor.contact_email },
              { label: 'Phone', value: detailVendor.contact_phone },
              { label: 'GST', value: detailVendor.gst_number },
              { label: 'PAN', value: detailVendor.pan_number },
              { label: 'Payment Terms', value: detailVendor.payment_terms },
              { label: 'Address', value: detailVendor.address },
            ].map(({ label, value }) => value ? (
              <div key={label}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                <p className="text-sm text-slate-800 mt-0.5">{value}</p>
              </div>
            ) : null))}
          </div>
          <div className="px-5 py-4 border-t flex gap-2">
            <Button className="flex-1 cursor-pointer" onClick={() => { if (detailVendor) openEdit(detailVendor); setDetailVendor(null); }}>Edit Vendor</Button>
            <Button variant="outline" onClick={() => setDetailVendor(null)} className="cursor-pointer">Close</Button>
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
