/**
 * Advanced salary package builder — fully reactive, compliance-aware.
 *
 * Calculation modes:
 *   CTC     → all components auto-derived top-down
 *   In-Hand → all components auto-derived top-down
 *   Manual  → edit any earning → gross bottom-up → net/CTC auto-derived
 *
 * Advanced features:
 *   - Branch selector → auto-resolves state → correct PT slab (Delhi/UP = ₹0)
 *   - Band compliance: red/amber/green indicator if CTC is in-band
 *   - Minimum wage compliance: state-wise floor check
 *   - Take-home % meter: healthy ≥ 72%, warn < 65%
 *   - Annual cost panel: annual CTC, take-home, gratuity provision, bonus provision
 *   - Component % of gross shown per row
 *   - Gratuity monthly accrual in employer cost section
 *   - Similar package detector: warns if catalog has a package within ±5% CTC
 *   - Component lock: tick "Lock Basic" → adjust special allowance to hit target CTC
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Calculator, Loader2, CheckCircle2, AlertTriangle, Lock, Unlock, TrendingUp, ShieldCheck } from 'lucide-react';
import {
  calcFromCtc, calcFromInHand, getProfessionalTax, PT_BY_STATE,
  type PkgCalcOptions, type PkgComponents,
} from '@/lib/salaryCalculator';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Band { id: string; band_code: string; band_name?: string; slab_from: number; slab_to: number; }
interface BranchState { branch_name: string; state: string; }
interface ExistingPkg { id: string; band_code: string; package_amount: number; name?: string; }

type Mode = 'ctc' | 'inhand' | 'manual';

type Draft = PkgComponents & {
  branch_name: string; band_code: string; cost_centre_code: string;
  package_amount: number; lta: number; gratuity: number;
};

const BLANK: Draft = {
  branch_name: '', band_code: '', cost_centre_code: '', package_amount: 0,
  lta: 0, gratuity: 0,
  basic: 0, hra: 0, conveyance: 0, special_allowance: 0, other_allowance: 0,
  bonus: 0, pli: 0, portfolio: 0, medical: 0, gross: 0,
  epf_employee: 0, esic_employee: 0, professional_tax: 0, net_in_hand: 0,
  epf_employer: 0, esic_employer: 0, admin_charges: 0, ctc: 0,
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const inr = (v: number) => v ? `₹${Math.round(v).toLocaleString('en-IN')}` : '—';
const pct = (part: number, total: number) => total > 0 ? `${Math.round((part / total) * 100)}%` : '';

// State minimum wages (monthly, 2024-25) — floor check only; actual varies by skill category
const STATE_MIN_WAGE: Record<string, number> = {
  'Gujarat': 12000, 'Maharashtra': 14842, 'Delhi': 17494, 'Karnataka': 11077,
  'Uttar Pradesh': 9867, 'Haryana': 12853, 'Punjab': 8654, 'Rajasthan': 10170,
  'West Bengal': 10628, 'Tamil Nadu': 13000, 'Andhra Pradesh': 11300,
  'Telangana': 13000, 'Madhya Pradesh': 10475,
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultBranch?: string;
  onPackageCreated: (packageId: string, pkg: Draft) => void;
}

export function PackageBuilderDialog({ open, onOpenChange, defaultBranch, onPackageCreated }: Props) {
  const [bands, setBands]               = useState<Band[]>([]);
  const [branchStates, setBranchStates] = useState<BranchState[]>([]);
  const [existingPkgs, setExistingPkgs] = useState<ExistingPkg[]>([]);
  const [draft, setDraft]               = useState<Draft>({ ...BLANK, branch_name: defaultBranch ?? '' });
  const [mode, setMode]                 = useState<Mode>('ctc');
  const [ctcInput, setCtcInput]         = useState('');
  const [inHandInput, setInHand]        = useState('');
  const [includePf, setIncludePf]       = useState(true);
  const [includeEsic, setIncludeEsic]   = useState(true);
  const [basicPct, setBasicPct]         = useState(40);
  const [hraPct, setHraPct]             = useState(40);
  const [lockBasic, setLockBasic]       = useState(false);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // ── Load data ─────────────────────────────────────────────────────────────

  useEffect(() => {
    hrmsApi.get<any>('/api/payroll-masters/bands').then((r: any) => setBands(r?.data ?? [])).catch(() => {});
    hrmsApi.get<any>('/api/payroll-masters/branch-states').then((r: any) => setBranchStates(r?.data ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!draft.branch_name) { setExistingPkgs([]); return; }
    hrmsApi.get<any>(`/api/payroll-masters/packages?branch=${encodeURIComponent(draft.branch_name)}`)
      .then((r: any) => setExistingPkgs(r?.data ?? []))
      .catch(() => {});
  }, [draft.branch_name]);

  useEffect(() => {
    if (open) {
      setDraft({ ...BLANK, branch_name: defaultBranch ?? '' });
      setCtcInput(''); setInHand(''); setMode('ctc'); setError(null); setLockBasic(false);
    }
  }, [open, defaultBranch]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const resolvedState = branchStates.find(b => b.branch_name === draft.branch_name)?.state;
  const selectedBand  = bands.find(b => b.band_code === draft.band_code);

  const ptApplicable = resolvedState ? !!(PT_BY_STATE[resolvedState] && PT_BY_STATE[resolvedState](50000) > 0) : false;

  const bandStatus: 'ok' | 'low' | 'high' | null = useMemo(() => {
    if (!selectedBand || !draft.ctc) return null;
    const monthly = draft.ctc;
    if (monthly < selectedBand.slab_from) return 'low';
    if (monthly > selectedBand.slab_to)   return 'high';
    return 'ok';
  }, [selectedBand, draft.ctc]);

  const minWage = resolvedState ? (STATE_MIN_WAGE[resolvedState] ?? 0) : 0;
  const minWageViolation = minWage > 0 && draft.gross > 0 && draft.gross < minWage;

  const takeHomePct = draft.gross > 0 ? Math.round((draft.net_in_hand / draft.gross) * 100) : 0;

  const similarPkg = useMemo(() => {
    if (!draft.ctc || existingPkgs.length === 0) return null;
    return existingPkgs.find(p => {
      const monthly = p.package_amount / 12;
      return Math.abs(monthly - draft.ctc) / draft.ctc < 0.05; // within ±5%
    });
  }, [draft.ctc, existingPkgs]);

  // ── Calculation helpers ───────────────────────────────────────────────────

  const getOpts = useCallback((): PkgCalcOptions => ({
    includePf, includeEsic, basicPct, hraPct, state: resolvedState,
  }), [includePf, includeEsic, basicPct, hraPct, resolvedState]);

  const deriveFromGross = useCallback((d: Draft): Draft => {
    const o = getOpts();
    const gross = Math.max(0,
      (d.basic || 0) + (d.hra || 0) + (d.lta || 0) + (d.conveyance || 0)
      + (d.special_allowance || 0) + (d.bonus || 0) + (d.portfolio || 0)
      + (d.medical || 0) + (d.other_allowance || 0) + (d.pli || 0)
    );
    const pfCap = 999999;
    const pfBase = Math.min(d.basic || 0, pfCap);
    const epf_employee  = o.includePf ? r2(pfBase * 0.12) : 0;
    const esic_employee = o.includeEsic && gross <= 21000 ? r2(gross * 0.0075) : 0;
    const professional_tax = r2(getProfessionalTax(gross, o.state));
    const net_in_hand = r2(gross - epf_employee - esic_employee - professional_tax);
    const epf_employer  = o.includePf ? r2(pfBase * 0.12) : 0;
    const esic_employer = o.includeEsic && gross <= 21000 ? r2(gross * 0.0325) : 0;
    const gratuity      = r2((d.basic || 0) * (15 / 26 / 12));
    const admin_charges = o.includePf ? r2(pfBase * 0.0101) : 0;
    const ctc = r2(gross + epf_employer + esic_employer + gratuity + admin_charges);
    return { ...d, gross, epf_employee, esic_employee, professional_tax, net_in_hand, epf_employer, esic_employer, gratuity, admin_charges, ctc, package_amount: ctc };
  }, [getOpts]);

  // ── Auto-calc trigger ─────────────────────────────────────────────────────

  useEffect(() => {
    if (mode === 'manual') {
      setDraft(d => deriveFromGross(d));
      return;
    }
    const o = getOpts();
    if (mode === 'ctc') {
      const v = parseFloat(ctcInput);
      if (!isNaN(v) && v > 0) {
        const c = calcFromCtc(v, o);
        const gratuity = r2(c.basic * (15 / 26 / 12));
        setDraft(d => ({ ...d, ...c, gratuity, package_amount: c.ctc }));
      }
    } else {
      const v = parseFloat(inHandInput);
      if (!isNaN(v) && v > 0) {
        const c = calcFromInHand(v, o);
        const gratuity = r2(c.basic * (15 / 26 / 12));
        setDraft(d => ({ ...d, ...c, gratuity, package_amount: c.ctc }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctcInput, inHandInput, includePf, includeEsic, basicPct, hraPct, mode, resolvedState]);

  // ── Component edit handler ────────────────────────────────────────────────

  const editComponent = (field: string, value: number) => {
    if (mode !== 'manual') setMode('manual');
    setDraft(d => {
      const updated = { ...d, [field]: value };
      // When basic is locked, adjust special_allowance to maintain current gross
      if (lockBasic && field !== 'basic' && field !== 'special_allowance') {
        const grossTarget = d.gross;
        const otherEarnings = (updated.hra || 0) + (updated.lta || 0) + (updated.conveyance || 0)
          + (updated.bonus || 0) + (updated.portfolio || 0) + (updated.medical || 0)
          + (updated.other_allowance || 0) + (updated.pli || 0);
        updated.special_allowance = Math.max(0, grossTarget - (updated.basic || 0) - otherEarnings);
      }
      return deriveFromGross(updated);
    });
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const canSave = !!draft.branch_name && !!draft.band_code && draft.package_amount > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true); setError(null);
    try {
      const res: any = await hrmsApi.post('/api/payroll-masters/packages', {
        ...draft,
        name: `${draft.branch_name} · Band ${draft.band_code} · ${inr(draft.ctc)}/mo`,
      });
      const newId = res?.data?.id ?? res?.id;
      if (!newId) throw new Error('Package saved but no ID returned.');
      onPackageCreated(newId, draft);
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save package.');
    } finally { setSaving(false); }
  };

  // ── Earnings rows ─────────────────────────────────────────────────────────

  const EARNINGS: [string, string][] = [
    ['basic',             'Basic'],
    ['hra',               'HRA'],
    ['lta',               'LTA'],
    ['conveyance',        'Conveyance'],
    ['special_allowance', 'Special Allowance'],
    ['bonus',             'Bonus'],
    ['portfolio',         'Portfolio'],
    ['medical',           'Medical'],
    ['other_allowance',   'Other Allowance'],
    ['pli',               'PLI'],
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[94vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <Calculator className="h-5 w-5 text-blue-600" />
            Advanced Salary Package Builder
            {mode === 'manual' && (
              <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[11px]">Manual mode</Badge>
            )}
            {resolvedState && (
              <Badge className={`text-[11px] ${ptApplicable ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                {resolvedState} · PT {ptApplicable ? '✓ applicable' : '✗ not applicable'}
              </Badge>
            )}
            {bandStatus === 'ok' && <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[11px]">✓ In Band {draft.band_code}</Badge>}
            {bandStatus === 'low' && <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[11px]">⚠ Below Band {draft.band_code} floor</Badge>}
            {bandStatus === 'high' && <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-[11px]">⚠ Above Band {draft.band_code} ceiling</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}

          {/* Compliance alerts */}
          {minWageViolation && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span><strong>Minimum wage alert:</strong> Gross {inr(draft.gross)} is below {resolvedState} minimum wage {inr(minWage)}/month.</span>
            </div>
          )}
          {similarPkg && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>Similar package exists:</strong> {similarPkg.name ?? `Band ${similarPkg.band_code}`} has CTC {inr(similarPkg.package_amount / 12)}/mo (within ±5%). Consider assigning that instead.
              </span>
            </div>
          )}

          {/* Branch + Band */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Branch <span className="text-rose-500">*</span></Label>
              <Select value={draft.branch_name || '__none__'}
                onValueChange={(v) => setDraft(d => ({ ...d, branch_name: v === '__none__' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="Select branch…" /></SelectTrigger>
                <SelectContent>
                  {branchStates.map(b => (
                    <SelectItem key={b.branch_name} value={b.branch_name}>
                      {b.branch_name}{b.state ? ` · ${b.state}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Band <span className="text-rose-500">*</span></Label>
              <Select value={draft.band_code || '__none__'}
                onValueChange={(v) => setDraft(d => ({ ...d, band_code: v === '__none__' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="Select band…" /></SelectTrigger>
                <SelectContent>
                  {bands.map(b => (
                    <SelectItem key={b.band_code} value={b.band_code}>
                      Band {b.band_code}{b.slab_from ? ` · ${inr(b.slab_from)}–${inr(b.slab_to)}/mo` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedBand && draft.ctc > 0 && (
                <p className={`text-[11px] mt-1 ${bandStatus === 'ok' ? 'text-emerald-600' : 'text-amber-600'}`}>
                  Band range: {inr(selectedBand.slab_from)} – {inr(selectedBand.slab_to)}/mo
                </p>
              )}
            </div>
          </div>

          {/* Calculator bar */}
          <div className="rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
                {(['ctc', 'inhand'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${mode === m ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    {m === 'ctc' ? 'From CTC' : 'From Net In-Hand'}
                  </button>
                ))}
              </div>
              {mode !== 'manual' && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">{mode === 'ctc' ? 'Monthly CTC (₹)' : 'Net In-Hand (₹)'}</Label>
                  <Input className="h-8 w-36 text-sm font-semibold" type="number" placeholder="e.g. 15000"
                    value={mode === 'ctc' ? ctcInput : inHandInput}
                    onChange={e => mode === 'ctc' ? setCtcInput(e.target.value) : setInHand(e.target.value)} />
                </div>
              )}
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium select-none">
                <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={includePf} onChange={e => setIncludePf(e.target.checked)} />
                Include PF
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium select-none">
                <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={includeEsic} onChange={e => setIncludeEsic(e.target.checked)} />
                Include ESIC
              </label>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs whitespace-nowrap">Basic%</Label>
                <Input className="h-8 w-16 text-xs" type="number" min={10} max={80} value={basicPct} onChange={e => setBasicPct(Number(e.target.value))} />
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs whitespace-nowrap">HRA%</Label>
                <Input className="h-8 w-16 text-xs" type="number" min={0} max={100} value={hraPct} onChange={e => setHraPct(Number(e.target.value))} />
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium select-none text-slate-600">
                {lockBasic ? <Lock className="h-3.5 w-3.5 text-amber-600" /> : <Unlock className="h-3.5 w-3.5 text-slate-400" />}
                <input type="checkbox" className="h-4 w-4 accent-amber-500" checked={lockBasic} onChange={e => setLockBasic(e.target.checked)} />
                Lock Basic
              </label>
            </div>
          </div>

          {/* Main grid */}
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">

            {/* Earnings */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b pb-1">
                Earnings — click any field to edit (switches to manual)
              </p>
              {EARNINGS.map(([field, label]) => {
                const val = (draft as any)[field] as number;
                const isBasicLocked = lockBasic && field === 'basic';
                return (
                  <div key={field} className="flex items-center gap-2">
                    <Label className="text-[11px] w-32 shrink-0 text-slate-600">{label}</Label>
                    <Input
                      className={`h-7 text-xs flex-1 tabular-nums ${isBasicLocked ? 'bg-amber-50 border-amber-200' : 'bg-white'}`}
                      type="number"
                      readOnly={isBasicLocked}
                      value={val ?? 0}
                      onChange={e => editComponent(field, Number(e.target.value))}
                    />
                    {draft.gross > 0 && val > 0 && (
                      <span className="text-[10px] text-slate-400 w-8 text-right tabular-nums shrink-0">
                        {pct(val, draft.gross)}
                      </span>
                    )}
                  </div>
                );
              })}
              <div className="flex items-center gap-2 border-t border-slate-100 pt-2">
                <Label className="text-[11px] w-32 shrink-0 font-semibold text-blue-700">Gross / Month</Label>
                <Input className="h-7 text-xs flex-1 bg-blue-50 font-bold text-blue-800 tabular-nums" readOnly value={draft.gross ? inr(draft.gross) : '—'} />
              </div>
            </div>

            {/* Deductions + Employer + Analysis */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b pb-1">Employee Deductions</p>
              {[
                ['epf_employee',    includePf ? 'PF (12% basic)' : 'PF (off)'],
                ['esic_employee',   draft.gross <= 21000 && includeEsic ? 'ESIC (0.75% gross)' : `ESIC (${draft.gross > 21000 ? 'gross >₹21k' : 'off'})`],
                ['professional_tax', resolvedState ? (ptApplicable ? `PT — ${resolvedState}` : `PT — N/A (${resolvedState})`) : 'PT (select branch)'],
              ].map(([field, label]) => (
                <div key={field} className="flex items-center gap-2">
                  <Label className="text-[11px] w-32 shrink-0 text-slate-600 truncate" title={label}>{label}</Label>
                  <Input className="h-7 text-xs flex-1 bg-slate-50 text-red-600 tabular-nums" readOnly
                    value={(draft as any)[field] ? `− ${inr((draft as any)[field])}` : '₹0'} />
                </div>
              ))}
              <div className="flex items-center gap-2 border-t border-slate-100 pt-2">
                <Label className="text-[11px] w-32 shrink-0 font-semibold text-emerald-700">Net In-Hand</Label>
                <Input className="h-7 text-xs flex-1 bg-emerald-50 font-bold text-emerald-800 tabular-nums" readOnly value={draft.net_in_hand ? inr(draft.net_in_hand) : '—'} />
                {takeHomePct > 0 && (
                  <span className={`text-[10px] font-semibold w-10 text-right shrink-0 ${takeHomePct >= 72 ? 'text-emerald-600' : takeHomePct >= 65 ? 'text-amber-600' : 'text-rose-600'}`}>
                    {takeHomePct}%
                  </span>
                )}
              </div>

              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b pb-1 mt-3">Employer Contributions</p>
              {[
                ['epf_employer',  includePf ? 'PF Employer (12%)' : 'PF Employer (off)'],
                ['esic_employer', includeEsic && draft.gross <= 21000 ? 'ESIC Employer (3.25%)' : 'ESIC Employer (off/exempt)'],
                ['admin_charges', includePf ? 'Admin Charges (1.01%)' : 'Admin Charges (off)'],
                ['gratuity',      'Gratuity Monthly Provision'],
              ].map(([field, label]) => (
                <div key={field} className="flex items-center gap-2">
                  <Label className="text-[11px] w-32 shrink-0 text-slate-500 truncate">{label}</Label>
                  <Input className="h-7 text-xs flex-1 bg-slate-50 text-slate-500 tabular-nums" readOnly
                    value={(draft as any)[field] ? inr((draft as any)[field]) : '₹0'} />
                </div>
              ))}
              <div className="flex items-center gap-2 border-t border-slate-100 pt-2">
                <Label className="text-[11px] w-32 shrink-0 font-semibold text-blue-700">Monthly CTC</Label>
                <Input className="h-7 text-xs flex-1 bg-blue-50 font-bold text-blue-800 tabular-nums" readOnly value={draft.ctc ? inr(draft.ctc) : '—'} />
              </div>
            </div>
          </div>

          {/* Annual analysis panel */}
          {draft.ctc > 0 && (
            <div className="rounded-xl bg-slate-900 text-white p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-slate-400 mb-0.5">Annual CTC</p>
                <p className="font-bold text-base tabular-nums">{inr(draft.ctc * 12)}</p>
              </div>
              <div>
                <p className="text-slate-400 mb-0.5">Annual Take-Home</p>
                <p className="font-bold text-base text-emerald-400 tabular-nums">{inr(draft.net_in_hand * 12)}</p>
                <p className="text-slate-500 text-[10px]">{takeHomePct}% of gross</p>
              </div>
              <div>
                <p className="text-slate-400 mb-0.5">Annual Gratuity</p>
                <p className="font-semibold tabular-nums text-amber-300">{inr(draft.gratuity * 12)}</p>
                <p className="text-slate-500 text-[10px]">P&L provision</p>
              </div>
              <div>
                <p className="text-slate-400 mb-0.5">Annual Bonus (Bonus Act)</p>
                <p className="font-semibold tabular-nums text-blue-300">{inr(draft.bonus * 12)}</p>
                <p className="text-slate-500 text-[10px]">8.33% of basic</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">Cancel</Button>
          <Button disabled={saving || !canSave} onClick={() => void save()} className="cursor-pointer bg-blue-600 hover:bg-blue-700">
            {saving
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
              : <><CheckCircle2 className="h-4 w-4 mr-2" />Create &amp; Assign Package</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
