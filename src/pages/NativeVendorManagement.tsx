/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
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
  FileText, Info, Loader2, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

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

interface VendorMappingSummary {
  id: string; vendor_code: string; vendor_name: string;
  vendor_type: VendorType; is_active: number; mapping_count: number;
}

export default function NativeVendorManagement() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'vendors' | 'contracts' | 'mapping'>('vendors');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [mappingUnmappedOnly, setMappingUnmappedOnly] = useState(false);

  // Sheet state
  const [sheetVendor, setSheetVendor] = useState<Vendor | null>(null);
  const [sheetMode, setSheetMode] = useState<'create' | 'edit' | 'detail'>('detail');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetInitialTab, setSheetInitialTab] = useState<'identity' | 'mapping'>('identity');

  // ── Data
  // Vendor search runs on the server. vendorService.list already supports `q` and `limit`, and
  // 1,821 live vendors is too many to ship to the browser on every keystroke just to filter
  // them in JS. `q` also matches GSTIN, which the old client-side filter could not.
  // Debounced so typing does not issue a request per character.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: vendorsData, isLoading: loadingV, refetch: refV } = useQuery({
    queryKey: ['erp-vendors', filterType, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterType) params.set('vendor_type', filterType);
      else params.set('is_active', '1');
      if (debouncedSearch) params.set('q', debouncedSearch);
      // Capped server-side at 500. A search narrows well before that; an unfiltered list is
      // paged by the table rather than being unbounded.
      params.set('limit', '200');
      const r = await hrmsApi.get<any>(`/api/erp/vendors?${params.toString()}`);
      return ((r as any)?.data ?? r ?? []) as Vendor[];
    },
    placeholderData: (previous) => previous,
  });

  const { data: contractsData, isLoading: loadingC, refetch: refC } = useQuery({
    queryKey: ['erp-contracts'],
    queryFn: async () => {
      const r = await hrmsApi.get<any>('/api/erp/contracts');
      return ((r as any)?.data ?? r ?? []) as Contract[];
    },
  });

  const { data: enforcementData, refetch: refEnforcement } = useQuery({
    queryKey: ['vendor-mapping-enforced'],
    queryFn: async () => {
      const r = await hrmsApi.get<any>('/api/finance/config/vendor-expense-mapping-enforced');
      return (r as any)?.data?.enforced ?? (r as any)?.enforced ?? false;
    },
  });
  const enforced: boolean = enforcementData ?? false;

  const enforcementMutation = useMutation({
    mutationFn: (on: boolean) => hrmsApi.patch('/api/finance/config/vendor-expense-mapping-enforced', { enforced: on }),
    onSuccess: () => {
      void refEnforcement();
      qc.invalidateQueries({ queryKey: ['vendor-mapping-enforced'] });
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not update enforcement setting'),
  });

  const { data: mappingSummaryData, isLoading: loadingMapping, refetch: refMapping } = useQuery({
    queryKey: ['vendor-mapping-summary', mappingUnmappedOnly],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (mappingUnmappedOnly) params.set('unmappedOnly', '1');
      const r = await hrmsApi.get<any>(`/api/finance/vendors/mapping-summary?${params}`);
      return ((r as any)?.data?.data ?? (r as any)?.data ?? []) as VendorMappingSummary[];
    },
    enabled: tab === 'mapping',
  });
  const mappingSummary = mappingSummaryData ?? [];
  const unmappedCount = mappingSummary.filter(v => v.mapping_count === 0).length;

  // Already filtered by the server; re-filtering here would drop GSTIN matches the API found.
  const filteredVendors = vendorsData ?? [];
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
        <div className="flex items-center justify-between border-b px-4 h-12 shrink-0 gap-3">
          <h1 className="text-sm font-semibold shrink-0">Vendor Management</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {vendorsData && (
              <>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  {vendorsData.filter((v: Vendor) => v.is_active).length} active
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                  {vendorsData.length} total
                </span>
              </>
            )}
            {contractsData && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                {contractsData.length} contracts
              </span>
            )}
          </div>
          <Button
            size="sm"
            className="ml-auto shrink-0"
            onClick={() => { setSheetVendor(null); setSheetMode('create'); setSheetInitialTab('identity'); setSheetOpen(true); }}
          >
            + Add Vendor
          </Button>
        </div>

        {/* ── Tabs ── */}
        <Tabs value={tab} onValueChange={v => setTab(v as 'vendors' | 'contracts' | 'mapping')} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0 flex-wrap">
            <TabsList>
              <TabsTrigger value="vendors">Vendors</TabsTrigger>
              <TabsTrigger value="contracts">Contracts</TabsTrigger>
              <TabsTrigger value="mapping">Expense Mapping</TabsTrigger>
            </TabsList>
            <Input
              className="h-8 w-52"
              placeholder="Search name or code…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <Select
              value={filterType || "_all"}
              onValueChange={(value) => setFilterType(value === "_all" ? "" : value)}
            >
              <SelectTrigger className="h-8 w-40">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">All types</SelectItem>
                {Object.entries(VENDOR_TYPE_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>{l}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" onClick={() => { void refV(); void refC(); }}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {/* ── Vendors tab ── */}
          <TabsContent value="vendors" className="flex-1 overflow-auto m-0">

            {/* Enforcement banner — visible to all finance roles; server gates write access */}
            <div className="flex items-center gap-3 border-b bg-slate-50 px-4 py-2">
              <Info className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-600">
                  <span className="font-semibold">Vendor expense mapping enforcement</span>
                  {' '}— when ON, a GRN raiser can only book against the heads mapped to their selected
                  vendor (intersected with approved branch budget). When OFF, all budgeted heads remain
                  selectable regardless of mapping.
                  {unmappedCount > 0 && (
                    <span className="ml-1 text-amber-600 font-medium">
                      {unmappedCount} vendor{unmappedCount !== 1 ? 's' : ''} currently unmapped (unrestricted until mapped).
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Label htmlFor="enforcement-toggle" className="text-xs font-medium text-slate-700 cursor-pointer">
                  {enforced ? 'Enforced' : 'Advisory'}
                </Label>
                <Switch
                  id="enforcement-toggle"
                  checked={enforced}
                  disabled={enforcementMutation.isPending}
                  onCheckedChange={(on) => enforcementMutation.mutate(on)}
                />
              </div>
            </div>

            {loadingV ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : filteredVendors.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20">
                <FileText className="h-12 w-12 mb-3 text-slate-200" />
                <p className="font-semibold text-slate-700">No vendors found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white z-10 border-b">
                    <tr>
                      <th className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-28">Code</th>
                      <th className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor name</th>
                      <th className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-36">Type</th>
                      <th className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hidden md:table-cell">Contact</th>
                      <th className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hidden lg:table-cell w-36">GST</th>
                      <th className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hidden lg:table-cell w-24">Payment</th>
                      <th className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-20">Status</th>
                      <th className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-20">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVendors.map((v: Vendor) => (
                      <tr
                        key={v.id}
                        className="h-11 cursor-pointer border-b hover:bg-slate-50 transition-colors"
                        onClick={() => { setSheetVendor(v); setSheetMode('detail'); setSheetInitialTab('identity'); setSheetOpen(true); }}
                      >
                        <td className="px-4 py-2 font-mono text-xs text-slate-500">{v.vendor_code}</td>
                        <td className="px-4 py-2">
                          <p className="font-semibold text-slate-900">{v.vendor_name}</p>
                          {v.contact_name && <p className="text-xs text-slate-400 hidden md:block">{v.contact_name}</p>}
                        </td>
                        <td className="px-4 py-2">
                          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                            {VENDOR_TYPE_LABELS[v.vendor_type] ?? v.vendor_type}
                          </span>
                        </td>
                        <td className="px-4 py-2 hidden md:table-cell">
                          <p className="text-xs text-slate-600">{v.contact_email ?? '—'}</p>
                          {v.contact_phone && <p className="text-xs text-slate-400">{v.contact_phone}</p>}
                        </td>
                        <td className="px-4 py-2 hidden lg:table-cell text-xs font-mono text-slate-500">{v.gst_number ?? '—'}</td>
                        <td className="px-4 py-2 hidden lg:table-cell text-xs text-slate-500">{v.payment_terms ?? '—'}</td>
                        <td className="px-4 py-2">
                          <Badge variant={v.is_active ? 'default' : 'secondary'}>
                            {v.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => { setSheetVendor(v); setSheetMode('edit'); setSheetInitialTab('identity'); setSheetOpen(true); }}
                          >
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Vendor</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Period</TableHead>
                      <TableHead className="text-xs font-bold uppercase tracking-wide">Value</TableHead>
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
                        <TableCell className="text-sm text-slate-600">{c.vendor_name ?? '—'}</TableCell>
                        <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                          {c.start_date} → {c.end_date ?? 'Open'}
                        </TableCell>
                        <TableCell className="font-semibold text-slate-700">
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

          {/* ── Expense Mapping tab ── */}
          <TabsContent value="mapping" className="flex-1 overflow-auto m-0">
            <div className="flex items-center gap-3 border-b px-4 py-2">
              <p className="text-xs text-slate-500 flex-1">
                Click a vendor to configure its allowed expense heads. Vendors with no mapping are
                unrestricted (all budgeted heads selectable) until enforcement is turned on.
              </p>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={mappingUnmappedOnly}
                  onChange={e => setMappingUnmappedOnly(e.target.checked)}
                />
                Unmapped only
              </label>
              <Button size="sm" variant="ghost" onClick={() => { void refMapping(); }}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            {loadingMapping ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : mappingSummary.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20">
                <FileText className="h-12 w-12 mb-3 text-slate-200" />
                <p className="font-semibold text-slate-700">No vendors found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white z-10 border-b">
                    <tr>
                      <th className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-28">Code</th>
                      <th className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Vendor name</th>
                      <th className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-36">Type</th>
                      <th className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-36">Mapping</th>
                      <th className="h-9 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 w-20">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappingSummary.map((v) => (
                      <tr
                        key={v.id}
                        className="h-11 cursor-pointer border-b hover:bg-slate-50 transition-colors"
                        onClick={() => {
                          setSheetVendor(v as any);
                          setSheetMode('detail');
                          setSheetInitialTab('mapping');
                          setSheetOpen(true);
                        }}
                      >
                        <td className="px-4 py-2 font-mono text-xs text-slate-500">{v.vendor_code}</td>
                        <td className="px-4 py-2 font-semibold text-slate-900">{v.vendor_name}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                            {VENDOR_TYPE_LABELS[v.vendor_type] ?? v.vendor_type}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          {v.mapping_count === 0 ? (
                            <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                              Unmapped
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                              {v.mapping_count} mapped
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant={v.is_active ? 'default' : 'secondary'}>
                            {v.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
        onSaved={() => { void refV(); void refMapping(); }}
        initialTab={sheetInitialTab}
      />
    </DashboardLayout>
  );
}
