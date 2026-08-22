/**
 * Reusable salary package builder in a Dialog.
 *
 * Wraps the same calculator logic used in NativeSalaryPackageAdmin
 * (calcFromCtc / calcFromInHand from @/lib/salaryCalculator) so Payroll Head
 * can build a new package right inside the salary review screen without
 * navigating away. After saving, calls onPackageCreated(packageId, pkg).
 *
 * Branch is pre-set from the prop and locked — the reviewer is building a
 * package for a specific employee's branch. Band and CTC must be chosen.
 */
import { useState, useEffect, useCallback } from 'react';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Calculator, Loader2, CheckCircle2 } from 'lucide-react';
import { calcFromCtc, calcFromInHand, getProfessionalTax, PT_BY_STATE, type PkgCalcOptions, type PkgComponents } from '@/lib/salaryCalculator';

interface Band { id: string; band_code: string; band_name: string; slab_from: number; slab_to: number; }

type PkgDraft = PkgComponents & {
  branch_name: string;
  band_code: string;
  cost_centre_code: string;
  package_amount: number;
  lta: number;
};

const fmt = (v: number) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const SEL = "flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400";

const BLANK: PkgDraft = {
  branch_name: '', band_code: '', cost_centre_code: '', package_amount: 0, lta: 0,
  basic: 0, hra: 0, conveyance: 0, special_allowance: 0, other_allowance: 0,
  bonus: 0, pli: 0, portfolio: 0, medical: 0, gross: 0,
  epf_employee: 0, esic_employee: 0, professional_tax: 0, net_in_hand: 0,
  epf_employer: 0, esic_employer: 0, admin_charges: 0, ctc: 0,
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultBranch: string;
  /** branch_master.state — used to compute correct Professional Tax slab */
  branchState?: string;
  onPackageCreated: (packageId: string, pkg: PkgDraft) => void;
}

export function PackageBuilderDialog({ open, onOpenChange, defaultBranch, branchState, onPackageCreated }: Props) {
  const [bands, setBands]         = useState<Band[]>([]);
  const [draft, setDraft]         = useState<PkgDraft>({ ...BLANK, branch_name: defaultBranch });
  const [calcMode, setCalcMode]   = useState<'ctc' | 'inhand'>('ctc');
  const [ctcInput, setCtcInput]   = useState('');
  const [inHandInput, setInHandInput] = useState('');
  const [includePf, setIncludePf]   = useState(true);
  const [includeEsic, setIncludeEsic] = useState(true);
  const [basicPct, setBasicPct]   = useState(40);
  const [hraPct, setHraPct]       = useState(40);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Load bands once
  useEffect(() => {
    hrmsApi.get<{ data: Band[] }>('/api/payroll-masters/bands')
      .then((r: any) => setBands(r?.data ?? []))
      .catch(() => {});
  }, []);

  // Reset when opened with a new branch
  useEffect(() => {
    if (open) {
      setDraft({ ...BLANK, branch_name: defaultBranch });
      setCtcInput(''); setInHandInput('');
      setCalcMode('ctc'); setError(null);
    }
  }, [open, defaultBranch]);

  // Auto-calculate on input change
  useEffect(() => {
    const opts: PkgCalcOptions = { includePf, includeEsic, basicPct, hraPct, state: branchState };
    if (calcMode === 'ctc') {
      const v = parseFloat(ctcInput);
      if (!isNaN(v) && v > 0) {
        const c = calcFromCtc(v, opts);
        setDraft(p => ({ ...p, ...c, package_amount: c.ctc }));
      }
    } else {
      const v = parseFloat(inHandInput);
      if (!isNaN(v) && v > 0) {
        const c = calcFromInHand(v, opts);
        setDraft(p => ({ ...p, ...c, package_amount: c.ctc }));
      }
    }
  }, [ctcInput, inHandInput, includePf, includeEsic, basicPct, hraPct, calcMode]);

  const canSave = !!draft.branch_name && !!draft.band_code && draft.package_amount > 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res: any = await hrmsApi.post('/api/payroll-masters/packages', {
        ...draft,
        name: `${draft.branch_name} · Band ${draft.band_code} · ${fmt(draft.ctc)}/mo`,
      });
      const newId = res?.data?.id ?? res?.id;
      if (!newId) throw new Error('Package saved but no ID returned');
      onPackageCreated(newId, draft);
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to save package');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-blue-600" />
            Build Salary Package — {defaultBranch}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          {/* Header fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Branch</Label>
              <Input value={draft.branch_name} readOnly className="bg-slate-50 text-slate-500 h-9" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Band *</Label>
              <select className={SEL} value={draft.band_code}
                onChange={e => setDraft(p => ({ ...p, band_code: e.target.value }))}>
                <option value="">Select band</option>
                {bands.map(b => (
                  <option key={b.band_code} value={b.band_code}>
                    Band {b.band_code}{b.slab_from ? ` (${fmt(b.slab_from)}–${fmt(b.slab_to)})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Calculator bar */}
          <div className="rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3 space-y-3">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Auto Calculator</p>
            <div className="flex flex-wrap items-center gap-4">
              {/* Mode */}
              <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
                {(['ctc', 'inhand'] as const).map(m => (
                  <button key={m}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                      calcMode === m ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                    onClick={() => setCalcMode(m)}>
                    {m === 'ctc' ? 'From CTC' : 'From In-Hand'}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">
                  {calcMode === 'ctc' ? 'Monthly CTC (₹)' : 'Net In-Hand (₹)'}
                </Label>
                <Input className="h-8 w-32 text-sm font-semibold" type="number" placeholder="e.g. 15000"
                  value={calcMode === 'ctc' ? ctcInput : inHandInput}
                  onChange={e => calcMode === 'ctc' ? setCtcInput(e.target.value) : setInHandInput(e.target.value)} />
              </div>
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium">
                <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={includePf} onChange={e => setIncludePf(e.target.checked)} />
                PF
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium">
                <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={includeEsic} onChange={e => setIncludeEsic(e.target.checked)} />
                ESIC
              </label>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs whitespace-nowrap">Basic %</Label>
                <Input className="h-8 w-16 text-xs" type="number" min={10} max={80} value={basicPct}
                  onChange={e => setBasicPct(Number(e.target.value))} />
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs whitespace-nowrap">HRA %</Label>
                <Input className="h-8 w-16 text-xs" type="number" min={0} max={100} value={hraPct}
                  onChange={e => setHraPct(Number(e.target.value))} />
              </div>
            </div>
          </div>

          {/* Component grid */}
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {/* Earnings */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b pb-1">Earnings (Monthly)</p>
              {([
                ['basic', 'Basic', true],
                ['hra', 'HRA', true],
                ['lta', 'LTA', false],
                ['conveyance', 'Conveyance', true],
                ['special_allowance', 'Special Allowance', true],
                ['bonus', 'Bonus', true],
                ['portfolio', 'Portfolio', false],
                ['medical', 'Medical Allowance', false],
                ['other_allowance', 'Other Allowance', false],
                ['pli', 'PLI', false],
              ] as [string, string, boolean][]).map(([field, label, auto]) => (
                <div key={field} className="flex items-center gap-2">
                  <Label className="text-xs w-36 shrink-0">{label}</Label>
                  <Input className={`h-8 text-xs flex-1 ${auto ? 'bg-slate-50 text-slate-600' : 'bg-white'}`}
                    type="number"
                    value={(draft as any)[field] ?? 0}
                    onChange={e => setDraft(p => ({ ...p, [field]: Number(e.target.value) }))} />
                </div>
              ))}
              <div className="flex items-center gap-2 border-t pt-2">
                <Label className="text-xs w-36 shrink-0 font-semibold">Gross</Label>
                <Input className="h-8 text-xs flex-1 bg-blue-50 font-bold text-blue-800" readOnly
                  value={draft.gross ? fmt(draft.gross) : ''} placeholder="Auto" />
              </div>
            </div>

            {/* Deductions + CTC */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b pb-1">Deductions</p>
              {([
                ['epf_employee', "PF (Employee 12%)", true],
                ['esic_employee', "ESIC (Employee 0.75%)", true],
                ['professional_tax', branchState
                  ? PT_BY_STATE[branchState]
                    ? `Prof. Tax (${branchState})`
                    : `Prof. Tax — Not applicable in ${branchState}`
                  : 'Prof. Tax (state unknown)', true],
              ] as [string, string, boolean][]).map(([field, label, auto]) => (
                <div key={field} className="flex items-center gap-2">
                  <Label className="text-xs w-36 shrink-0">{label}</Label>
                  <Input className={`h-8 text-xs flex-1 ${auto ? 'bg-slate-50 text-slate-600' : 'bg-white'}`}
                    type="number"
                    value={(draft as any)[field] ?? 0}
                    onChange={e => setDraft(p => ({ ...p, [field]: Number(e.target.value) }))} />
                </div>
              ))}
              <div className="flex items-center gap-2 border-t pt-2">
                <Label className="text-xs w-36 shrink-0 font-semibold text-emerald-700">Net In-Hand</Label>
                <Input className="h-8 text-xs flex-1 bg-emerald-50 font-bold text-emerald-800" readOnly
                  value={draft.net_in_hand ? fmt(draft.net_in_hand) : ''} placeholder="Auto" />
              </div>

              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b pb-1 mt-4">Employer Contributions</p>
              {([
                ['epf_employer', "PF (Employer 12%)", true],
                ['esic_employer', "ESIC (Employer 3.25%)", true],
                ['admin_charges', "Admin Charges", true],
              ] as [string, string, boolean][]).map(([field, label, auto]) => (
                <div key={field} className="flex items-center gap-2">
                  <Label className="text-xs w-36 shrink-0">{label}</Label>
                  <Input className={`h-8 text-xs flex-1 ${auto ? 'bg-slate-50 text-slate-600' : 'bg-white'}`}
                    type="number"
                    value={(draft as any)[field] ?? 0}
                    onChange={e => setDraft(p => ({ ...p, [field]: Number(e.target.value) }))} />
                </div>
              ))}
              <div className="flex items-center gap-2 border-t pt-2">
                <Label className="text-xs w-36 shrink-0 font-semibold text-blue-700">Monthly CTC</Label>
                <Input className="h-8 text-xs flex-1 bg-blue-50 font-bold text-blue-800" readOnly
                  value={draft.ctc ? fmt(draft.ctc) : ''} placeholder="Auto" />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="cursor-pointer">Cancel</Button>
          <Button
            disabled={saving || !canSave}
            onClick={() => void save()}
            className="cursor-pointer bg-blue-600 hover:bg-blue-700"
          >
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
