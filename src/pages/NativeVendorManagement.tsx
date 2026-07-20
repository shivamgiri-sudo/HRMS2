/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { VendorSheet } from '@/components/finance/vendor/VendorSheet';
import {
  FileText, Loader2, RefreshCw,
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

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeVendorManagement() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'vendors' | 'contracts'>('vendors');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');

  // Sheet state
  const [sheetVendor, setSheetVendor] = useState<Vendor | null>(null);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | 'detail'>('detail');
  const [sheetOpen, setSheetOpen] = useState(false);

  // ── Data
  const { data: vendorsData, isLoading: loadingV, refetch: refV } = useQuery({
    queryKey: ['erp-vendors', filterType],
    queryFn: async () => {
      const qs = filterType ? `?vendor_type=${filterType}` : '?is_active=1';
      const r = await hrmsApi.get<any>(`/api/erp/vendors${qs}`);
      return ((r as any)?.data ?? r ?? []) as Vendor[];
    },
  });

  const { data: contractsData, isLoading: loadingC, refetch: refC } = useQuery({
    queryKey: ['erp-contracts'],
    queryFn: async () => {
      const r = await hrmsApi.get<any>('/api/erp/contracts');
      return ((r as any)?.data ?? r ?? []) as Contract[];
    },
  });

  const filteredVendors = (vendorsData ?? []).filter(v =>
    !search || v.vendor_name?.toLowerCase().includes(search.toLowerCase()) ||
    v.vendor_code?.toLowerCase().includes(search.toLowerCase())
  );
  const contracts = (contractsData ?? []).filter(c =>
    !search || c.title?.toLowerCase().includes(search.toLowerCase()) ||
    c.vendor_name?.toLowerCase().includes(search.toLowerCase())
  );

  // Mutations (kept for compatibility — VendorSheet handles its own mutations but these remain available)
  const createVendor = useMutation({
    mutationFn: (body: any) => hrmsApi.post('/api/erp/vendors', body),
    onSuccess: () => { toast.success('Vendor created'); qc.invalidateQueries({ queryKey: ['erp-vendors'] }); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  const updateVendor = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => hrmsApi.put(`/api/erp/vendors/${id}`, body),
    onSuccess: () => { toast.success('Vendor updated'); qc.invalidateQueries({ queryKey: ['erp-vendors'] }); },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  // Suppress unused-variable warnings for mutations kept per contract
  void createVendor;
  void updateVendor;

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col">
        {/* ── Page header ── */}
        <div className="flex items-center justify-between border-b px-4 h-12 shrink-0">
          <h1 className="text-sm font-semibold">Vendor Management</h1>
          <div className="flex items-center gap-3">
            {vendorsData && (
              <>
                <span className="text-xs text-slate-500">
                  Active: <b className="text-slate-900">{vendorsData.filter((v: Vendor) => v.is_active).length}</b>
                </span>
                <span className="text-xs text-slate-500">
                  Total: <b className="text-slate-900">{vendorsData.length}</b>
                </span>
              </>
            )}
            {contractsData && (
              <span className="text-xs text-slate-500">
                Contracts: <b className="text-slate-900">{contractsData.length}</b>
              </span>
            )}
            <Button
              size="sm"
              onClick={() => { setSheetVendor(null); setSheetMode('create'); setSheetOpen(true); }}
            >
              + Add Vendor
            </Button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <Tabs value={tab} onValueChange={v => setTab(v as 'vendors' | 'contracts')} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
            <TabsList className="h-7">
              <TabsTrigger value="vendors" className="text-xs h-6">Vendors</TabsTrigger>
              <TabsTrigger value="contracts" className="text-xs h-6">Contracts</TabsTrigger>
            </TabsList>
            <Input
              className="h-7 w-44 text-xs"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="h-7 w-36 text-xs">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All types</SelectItem>
                {Object.entries(VENDOR_TYPE_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" onClick={() => { void refV(); void refC(); }}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* ── Vendors tab ── */}
          <TabsContent value="vendors" className="flex-1 overflow-auto px-4 py-2 m-0">
            {loadingV ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b">
                    <th className="h-8 text-left font-medium text-slate-500 w-24">Code</th>
                    <th className="h-8 text-left font-medium text-slate-500">Name</th>
                    <th className="h-8 text-left font-medium text-slate-500 hidden sm:table-cell w-28">Type</th>
                    <th className="h-8 text-left font-medium text-slate-500 hidden md:table-cell">GST</th>
                    <th className="h-8 text-left font-medium text-slate-500 w-16">Status</th>
                    <th className="h-8 text-left font-medium text-slate-500 w-16">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVendors.map((v: Vendor) => (
                    <tr
                      key={v.id}
                      className="h-9 cursor-pointer border-b hover:bg-slate-50"
                      onClick={() => { setSheetVendor(v); setSheetMode('detail'); setSheetOpen(true); }}
                    >
                      <td className="py-1 font-mono text-slate-500">{v.vendor_code}</td>
                      <td className="py-1 font-medium truncate max-w-[140px]">{v.vendor_name}</td>
                      <td className="py-1 hidden sm:table-cell">{VENDOR_TYPE_LABELS[v.vendor_type] ?? v.vendor_type}</td>
                      <td className="py-1 hidden md:table-cell text-slate-500">{v.gst_number ?? '-'}</td>
                      <td className="py-1">
                        <Badge variant={v.is_active ? 'default' : 'secondary'} className="text-xs">
                          {v.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="py-1" onClick={e => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => { setSheetVendor(v); setSheetMode('edit'); setSheetOpen(true); }}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {filteredVendors.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">No vendors found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </TabsContent>

          {/* ── Contracts tab ── KEEP EXISTING CONTENT UNCHANGED ── */}
          <TabsContent value="contracts" className="flex-1 overflow-auto px-4 py-2 m-0">
            {loadingC ? (
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
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── VendorSheet ── */}
      <VendorSheet
        vendor={sheetVendor as Parameters<typeof VendorSheet>[0]['vendor']}
        mode={sheetMode}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSaved={() => { void refV(); }}
      />
    </DashboardLayout>
  );
}
