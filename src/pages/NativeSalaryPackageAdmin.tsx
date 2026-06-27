import { useState, useEffect, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Loader2, Plus, Pencil, Trash2, IndianRupee, Building2, Layers, Save, X, CheckCircle2,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────
interface Band { id: string; band_code: string; band_name: string; slab_from: number; slab_to: number; active_status: number; }
interface CostCentre { id: string; cost_centre_code: string; display_name: string; branch_name: string; category: string; client_name: string; process_name: string; active_status: number; }
interface Package {
  id: string; branch_name: string; cost_centre_code: string; band_code: string;
  package_amount: number; basic: number; hra: number; conveyance: number; gross: number;
  epf_employee: number; esic_employee: number; net_in_hand: number; epf_employer: number;
  esic_employer: number; admin_charges: number; ctc: number; bonus: number; pli: number;
  professional_tax: number; special_allowance: number; other_allowance: number;
  portfolio: number; medical: number; active_status: number;
}

const fmt = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const SEL = "flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400";

// ── Component ────────────────────────────────────────────────────────────────
export default function NativeSalaryPackageAdmin() {
  const [tab, setTab] = useState<'bands' | 'packages' | 'cost-centres'>('bands');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Bands
  const [bands, setBands] = useState<Band[]>([]);
  const [editBand, setEditBand] = useState<Partial<Band> | null>(null);

  // Cost Centres
  const [costCentres, setCostCentres] = useState<CostCentre[]>([]);
  const [ccFilter, setCcFilter] = useState('');
  const [editCC, setEditCC] = useState<Partial<CostCentre> | null>(null);

  // Packages
  const [packages, setPackages] = useState<Package[]>([]);
  const [pkgBranch, setPkgBranch] = useState('');
  const [pkgBand, setPkgBand] = useState('');
  const [pkgCC, setPkgCC] = useState('');
  const [editPkg, setEditPkg] = useState<Partial<Package> | null>(null);

  // Distinct branches from cost centres
  const branches = [...new Set(costCentres.map(c => c.branch_name))].sort();

  // ── Load ───────────────────────────────────────────────────────────────────
  const loadBands = useCallback(async () => {
    const r = await hrmsApi.get<any>('/api/payroll-masters/bands');
    setBands(r?.data ?? []);
  }, []);

  const loadCostCentres = useCallback(async () => {
    const r = await hrmsApi.get<any>('/api/payroll-masters/cost-centres');
    setCostCentres(r?.data ?? []);
  }, []);

  const loadPackages = useCallback(async () => {
    if (!pkgBranch) { setPackages([]); return; }
    setLoading(true);
    const params = new URLSearchParams({ branch: pkgBranch });
    if (pkgBand) params.set('band', pkgBand);
    if (pkgCC) params.set('costCentre', pkgCC);
    const r = await hrmsApi.get<any>(`/api/payroll-masters/packages?${params}`);
    setPackages(r?.data ?? []);
    setLoading(false);
  }, [pkgBranch, pkgBand, pkgCC]);

  useEffect(() => { void loadBands(); void loadCostCentres(); }, [loadBands, loadCostCentres]);
  useEffect(() => { void loadPackages(); }, [loadPackages]);

  // ── Save Band ──────────────────────────────────────────────────────────────
  const saveBand = async () => {
    if (!editBand?.band_code || editBand.slab_from == null || editBand.slab_to == null) return;
    setSaving(true); setMsg('');
    try {
      if (editBand.id) {
        await hrmsApi.put(`/api/payroll-masters/bands/${editBand.id}`, editBand);
      } else {
        await hrmsApi.post('/api/payroll-masters/bands', editBand);
      }
      setEditBand(null);
      await loadBands();
      setMsg('Band saved');
    } catch (e: any) { setMsg(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  // ── Save Cost Centre ───────────────────────────────────────────────────────
  const saveCC = async () => {
    if (!editCC?.cost_centre_code || !editCC?.branch_name) return;
    setSaving(true); setMsg('');
    try {
      await hrmsApi.post('/api/payroll-masters/cost-centres', editCC);
      setEditCC(null);
      await loadCostCentres();
      setMsg('Cost centre saved');
    } catch (e: any) { setMsg(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  // ── Save Package ───────────────────────────────────────────────────────────
  const savePkg = async () => {
    if (!editPkg?.branch_name || !editPkg?.band_code || !editPkg?.package_amount) return;
    setSaving(true); setMsg('');
    try {
      if (editPkg.id) {
        await hrmsApi.put(`/api/payroll-masters/packages/${editPkg.id}`, editPkg);
      } else {
        await hrmsApi.post('/api/payroll-masters/packages', editPkg);
      }
      setEditPkg(null);
      await loadPackages();
      setMsg('Package saved');
    } catch (e: any) { setMsg(e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const deletePkg = async (id: string) => {
    if (!confirm('Deactivate this package?')) return;
    await hrmsApi.delete(`/api/payroll-masters/packages/${id}`);
    await loadPackages();
    setMsg('Package deactivated');
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-600">Payroll Administration</p>
          <h1 className="text-2xl font-black text-slate-900">Salary Package Management</h1>
          <p className="text-sm text-slate-500 mt-1">Manage salary bands, cost centres, and pre-calculated packages per branch</p>
        </div>

        {msg && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-700 font-semibold flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> {msg}
            <button onClick={() => setMsg('')} className="ml-auto"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        <Tabs value={tab} onValueChange={v => setTab(v as any)}>
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="bands" className="gap-1.5"><Layers className="h-3.5 w-3.5" /> Bands</TabsTrigger>
            <TabsTrigger value="cost-centres" className="gap-1.5"><Building2 className="h-3.5 w-3.5" /> Cost Centres</TabsTrigger>
            <TabsTrigger value="packages" className="gap-1.5"><IndianRupee className="h-3.5 w-3.5" /> Packages</TabsTrigger>
          </TabsList>

          {/* ═══ BANDS TAB ═══ */}
          <TabsContent value="bands">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Salary Bands (A–N)</CardTitle>
                  <CardDescription>Monthly CTC ranges. Each band defines a salary bracket.</CardDescription>
                </div>
                <Button size="sm" onClick={() => setEditBand({ band_code: '', band_name: '', slab_from: 0, slab_to: 0 })} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Add Band
                </Button>
              </CardHeader>
              <CardContent>
                {editBand && (
                  <div className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4 mb-4 grid gap-3 sm:grid-cols-5 items-end">
                    <div><Label className="text-xs">Band Code *</Label><Input className="h-9" value={editBand.band_code ?? ''} onChange={e => setEditBand(p => ({ ...p!, band_code: e.target.value.toUpperCase() }))} placeholder="O" maxLength={3} /></div>
                    <div><Label className="text-xs">Name</Label><Input className="h-9" value={editBand.band_name ?? ''} onChange={e => setEditBand(p => ({ ...p!, band_name: e.target.value }))} placeholder="Band O" /></div>
                    <div><Label className="text-xs">From (₹/mo)</Label><Input className="h-9" type="number" value={editBand.slab_from ?? ''} onChange={e => setEditBand(p => ({ ...p!, slab_from: Number(e.target.value) }))} /></div>
                    <div><Label className="text-xs">To (₹/mo)</Label><Input className="h-9" type="number" value={editBand.slab_to ?? ''} onChange={e => setEditBand(p => ({ ...p!, slab_to: Number(e.target.value) }))} /></div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveBand} disabled={saving} className="gap-1"><Save className="h-3.5 w-3.5" />{saving ? '...' : 'Save'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditBand(null)}><X className="h-4 w-4" /></Button>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-slate-50 border-b">
                      {['Band', 'Name', 'From (₹/mo)', 'To (₹/mo)', 'Status', ''].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-slate-600">{h}</th>)}
                    </tr></thead>
                    <tbody className="divide-y">
                      {bands.map(b => (
                        <tr key={b.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-bold">{b.band_code}</td>
                          <td className="px-3 py-2">{b.band_name}</td>
                          <td className="px-3 py-2 font-mono">{fmt(b.slab_from)}</td>
                          <td className="px-3 py-2 font-mono">{fmt(b.slab_to)}</td>
                          <td className="px-3 py-2"><Badge variant={b.active_status ? 'default' : 'secondary'}>{b.active_status ? 'Active' : 'Inactive'}</Badge></td>
                          <td className="px-3 py-2"><Button size="sm" variant="ghost" onClick={() => setEditBand(b)}><Pencil className="h-3.5 w-3.5" /></Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ COST CENTRES TAB ═══ */}
          <TabsContent value="cost-centres">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Cost Centres</CardTitle>
                  <CardDescription>Branch-wise cost centres. Displayed as "Code (Name)" in offer form — raw code is saved.</CardDescription>
                </div>
                <Button size="sm" onClick={() => setEditCC({ cost_centre_code: '', branch_name: '', display_name: '', category: '' })} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Add Cost Centre
                </Button>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <Input placeholder="Filter by branch or code..." value={ccFilter} onChange={e => setCcFilter(e.target.value)} className="h-9 max-w-sm" />
                </div>
                {editCC && (
                  <div className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4 mb-4 grid gap-3 sm:grid-cols-4 items-end">
                    <div><Label className="text-xs">Code *</Label><Input className="h-9" value={editCC.cost_centre_code ?? ''} onChange={e => setEditCC(p => ({ ...p!, cost_centre_code: e.target.value }))} placeholder="BSS/BO/NOIDA-2/999" /></div>
                    <div><Label className="text-xs">Branch *</Label><Input className="h-9" value={editCC.branch_name ?? ''} onChange={e => setEditCC(p => ({ ...p!, branch_name: e.target.value }))} placeholder="NOIDA-2" /></div>
                    <div><Label className="text-xs">Display Name</Label><Input className="h-9" value={editCC.display_name ?? ''} onChange={e => setEditCC(p => ({ ...p!, display_name: e.target.value }))} placeholder="Back Office / Client" /></div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveCC} disabled={saving} className="gap-1"><Save className="h-3.5 w-3.5" />{saving ? '...' : 'Save'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditCC(null)}><X className="h-4 w-4" /></Button>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white"><tr className="bg-slate-50 border-b">
                      {['Code', 'Branch', 'Display Name', 'Category', 'Status'].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-slate-600">{h}</th>)}
                    </tr></thead>
                    <tbody className="divide-y">
                      {costCentres
                        .filter(c => !ccFilter || c.cost_centre_code.toLowerCase().includes(ccFilter.toLowerCase()) || c.branch_name.toLowerCase().includes(ccFilter.toLowerCase()))
                        .map(c => (
                          <tr key={c.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono text-xs">{c.cost_centre_code}</td>
                            <td className="px-3 py-2 font-medium">{c.branch_name}</td>
                            <td className="px-3 py-2 text-slate-600">{c.display_name || c.process_name || '—'}</td>
                            <td className="px-3 py-2 text-slate-500">{c.category || '—'}</td>
                            <td className="px-3 py-2"><Badge variant={c.active_status ? 'default' : 'secondary'} className="text-xs">{c.active_status ? 'Active' : 'Inactive'}</Badge></td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══ PACKAGES TAB ═══ */}
          <TabsContent value="packages">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Salary Packages</CardTitle>
                <CardDescription>Pre-calculated component breakdowns per Branch + Cost Centre + Band. All amounts monthly.</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Filters */}
                <div className="grid gap-3 sm:grid-cols-4 mb-4">
                  <div>
                    <Label className="text-xs">Branch *</Label>
                    <select className={`mt-1 ${SEL}`} value={pkgBranch} onChange={e => setPkgBranch(e.target.value)}>
                      <option value="">Select Branch</option>
                      {branches.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Band</Label>
                    <select className={`mt-1 ${SEL}`} value={pkgBand} onChange={e => setPkgBand(e.target.value)}>
                      <option value="">All Bands</option>
                      {bands.map(b => <option key={b.band_code} value={b.band_code}>Band {b.band_code} ({fmt(b.slab_from)}–{fmt(b.slab_to)})</option>)}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Cost Centre</Label>
                    <select className={`mt-1 ${SEL}`} value={pkgCC} onChange={e => setPkgCC(e.target.value)}>
                      <option value="">All</option>
                      {costCentres.filter(c => !pkgBranch || c.branch_name === pkgBranch).map(c => (
                        <option key={c.cost_centre_code} value={c.cost_centre_code}>{c.cost_centre_code}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <Button size="sm" onClick={() => setEditPkg({ branch_name: pkgBranch || '', band_code: pkgBand || '', cost_centre_code: pkgCC || '', package_amount: 0, basic: 0, hra: 0, conveyance: 0, gross: 0, epf_employee: 0, esic_employee: 0, net_in_hand: 0, epf_employer: 0, esic_employer: 0, admin_charges: 0, ctc: 0, bonus: 0, pli: 0, professional_tax: 0, special_allowance: 0, other_allowance: 0, portfolio: 0, medical: 0 })} className="gap-1.5 w-full">
                      <Plus className="h-3.5 w-3.5" /> New Package
                    </Button>
                  </div>
                </div>

                {/* Add/Edit package form */}
                {editPkg && (
                  <div className="rounded-xl border-2 border-blue-200 bg-blue-50/30 p-5 mb-4 space-y-4">
                    <p className="text-sm font-bold text-blue-700">
                      {editPkg.id ? 'Edit' : 'New'} Package — {editPkg.branch_name || 'Select branch'} / Band {editPkg.band_code || '?'}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div><Label className="text-xs">Branch *</Label><Input className="h-9" value={editPkg.branch_name ?? ''} onChange={e => setEditPkg(p => ({ ...p!, branch_name: e.target.value }))} /></div>
                      <div><Label className="text-xs">Cost Centre</Label><Input className="h-9" value={editPkg.cost_centre_code ?? ''} onChange={e => setEditPkg(p => ({ ...p!, cost_centre_code: e.target.value }))} /></div>
                      <div><Label className="text-xs">Band *</Label>
                        <select className={`mt-1 ${SEL} h-9`} value={editPkg.band_code ?? ''} onChange={e => setEditPkg(p => ({ ...p!, band_code: e.target.value }))}>
                          <option value="">Select</option>
                          {bands.map(b => <option key={b.band_code} value={b.band_code}>{b.band_code}</option>)}
                        </select>
                      </div>
                      <div><Label className="text-xs">Package Amount *</Label><Input className="h-9" type="number" value={editPkg.package_amount ?? ''} onChange={e => setEditPkg(p => ({ ...p!, package_amount: Number(e.target.value) }))} /></div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-6">
                      {(['basic', 'hra', 'conveyance', 'bonus', 'special_allowance', 'other_allowance', 'gross', 'epf_employee', 'esic_employee', 'professional_tax', 'net_in_hand', 'epf_employer', 'esic_employer', 'admin_charges', 'ctc', 'pli'] as const).map(f => (
                        <div key={f}>
                          <Label className="text-[10px] capitalize">{f.replace(/_/g, ' ')}</Label>
                          <Input className="h-8 text-xs" type="number" value={(editPkg as any)[f] ?? 0} onChange={e => setEditPkg(p => ({ ...p!, [f]: Number(e.target.value) }))} />
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={savePkg} disabled={saving} className="gap-1"><Save className="h-3.5 w-3.5" />{saving ? 'Saving...' : 'Save Package'}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditPkg(null)}>Cancel</Button>
                    </div>
                  </div>
                )}

                {loading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
                ) : !pkgBranch ? (
                  <p className="text-center text-slate-400 py-12">Select a branch to view packages</p>
                ) : (
                  <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-white z-10"><tr className="bg-slate-50 border-b">
                        {['Band', 'CC', 'Pkg Amt', 'Basic', 'HRA', 'Conv', 'Bonus', 'Gross', 'PF', 'ESI', 'Net', 'CTC', ''].map(h => (
                          <th key={h} className="px-2 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody className="divide-y">
                        {packages.map(p => (
                          <tr key={p.id} className="hover:bg-blue-50/30">
                            <td className="px-2 py-1.5 font-bold">{p.band_code}</td>
                            <td className="px-2 py-1.5 font-mono text-[10px] max-w-[120px] truncate" title={p.cost_centre_code}>{p.cost_centre_code || '—'}</td>
                            <td className="px-2 py-1.5 font-bold text-blue-700">{fmt(p.package_amount)}</td>
                            <td className="px-2 py-1.5">{fmt(p.basic)}</td>
                            <td className="px-2 py-1.5">{fmt(p.hra)}</td>
                            <td className="px-2 py-1.5">{fmt(p.conveyance)}</td>
                            <td className="px-2 py-1.5">{fmt(p.bonus)}</td>
                            <td className="px-2 py-1.5 font-semibold">{fmt(p.gross)}</td>
                            <td className="px-2 py-1.5 text-red-600">{fmt(p.epf_employee)}</td>
                            <td className="px-2 py-1.5 text-red-600">{fmt(p.esic_employee)}</td>
                            <td className="px-2 py-1.5 font-bold text-emerald-700">{fmt(p.net_in_hand)}</td>
                            <td className="px-2 py-1.5">{fmt(p.ctc)}</td>
                            <td className="px-2 py-1.5">
                              <div className="flex gap-1">
                                <button onClick={() => setEditPkg(p)} className="p-1 hover:bg-slate-200 rounded"><Pencil className="h-3 w-3 text-slate-500" /></button>
                                <button onClick={() => deletePkg(p.id)} className="p-1 hover:bg-red-100 rounded"><Trash2 className="h-3 w-3 text-red-400" /></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!packages.length && <p className="text-center text-slate-400 py-8">No packages for this filter</p>}
                    <p className="text-xs text-slate-400 mt-3 px-2">{packages.length} package(s) found</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
