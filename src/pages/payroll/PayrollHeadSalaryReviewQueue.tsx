import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { hrmsApi } from '@/lib/hrmsApi';
import { useWorkforceAccess } from '@/hooks/useUserRole';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2, Search, RefreshCw, ShieldCheck, XCircle, Clock, AlertTriangle,
  ArrowRight, IndianRupee, CheckCircle2, Building2, Briefcase, Banknote,
  FileText, FileSignature, ExternalLink, Package, Calculator, RotateCcw,
  TrendingUp, Lock, ChevronRight, BadgeCheck, User,
} from 'lucide-react';
import { PackageBuilderDialog } from '@/components/payroll/PackageBuilderDialog';
import { SalaryRevisionDrawer } from '@/pages/payroll/SalaryRevisionDrawer';

// ── Types ─────────────────────────────────────────────────────────────────────

interface QueueRowSummary {
  offered: { status: string | null; ctc: number | null };
  final: { accepted: boolean; assigned: boolean; ctc: number | null };
  bgv: any;
  bank: any;
}

interface QueueRow {
  review_id: string;
  employee_id: string;
  status: 'pending_review' | 'approved' | 'rejected';
  package_accepted: number;
  rejection_category: string | null;
  rejection_reason_code: string | null;
  resubmit_count: number;
  reopen_count: number;
  created_at: string;
  reviewed_at: string | null;
  pending_hours: number;
  employee_code: string;
  full_name: string;
  designation_name: string | null;
  branch_name: string | null;
  ctc_annual?: number | null;
  final_ctc?: number | null;
  offer_status?: string | null;
  offered_ctc?: number | null;
  summary?: QueueRowSummary;
}

interface Reason { code: string; category: string; label: string; }

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
  created_at: string;
}

type SectionKey = 'offered' | 'final' | 'bgv' | 'bank';
const SECTION_META: Record<SectionKey, { label: string; icon: any; category: 'salary' | 'bgv' | 'bank' }> = {
  offered: { label: 'Offered Salary',  icon: Package,      category: 'salary' },
  final:   { label: 'Final Salary',    icon: IndianRupee,  category: 'salary' },
  bgv:     { label: 'BGV',             icon: ShieldCheck,  category: 'bgv' },
  bank:    { label: 'Bank Readiness',  icon: Banknote,     category: 'bank' },
};

// ── Constants ─────────────────────────────────────────────────────────────────

const REVIEWER_ROLES = ['payroll_head', 'admin', 'super_admin'];
const FIXER_ROLES = ['payroll_hr', 'branch_head', 'hr', 'payroll_head', 'admin', 'super_admin'];
const STATUS_CFG = {
  pending_review: { label: 'Pending Review', chip: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock },
  approved:       { label: 'Approved',       chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: BadgeCheck },
  rejected:       { label: 'Rejected',       chip: 'bg-rose-50 text-rose-700 border-rose-200', icon: XCircle },
} as const;

const inr = (n: number | null | undefined) =>
  n == null ? '—' : `₹${Math.round(Number(n)).toLocaleString('en-IN')}`;

const inrMo = (annual: number | null | undefined) =>
  annual == null ? '—' : `₹${Math.round(Number(annual) / 12).toLocaleString('en-IN')}/mo`;

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// ── Sub-components ─────────────────────────────────────────────────────────────

function AgingChip({ hours, status }: { hours: number; status: string }) {
  if (status !== 'pending_review') return null;
  if (hours >= 48) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
      <AlertTriangle className="h-2.5 w-2.5" />{Math.floor(hours / 24)}d
    </span>
  );
  if (hours >= 24) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
      <Clock className="h-2.5 w-2.5" />{Math.floor(hours / 24)}d
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
      {hours}h
    </span>
  );
}

function DrawerSalaryRow({ label, value, bold, separator }: {
  label: string; value: string; bold?: boolean; separator?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-1.5 ${separator ? 'border-t-2 border-slate-200 mt-1 pt-2.5' : 'border-b border-slate-50'}`}>
      <span className={`text-xs ${bold ? 'font-bold text-slate-900' : 'text-slate-500'}`}>{label}</span>
      <span className={`font-mono text-xs ${bold ? 'font-bold text-slate-900' : 'text-slate-700'}`}>{value}</span>
    </div>
  );
}

// ── Shared journey sections ──────────────────────────────────────────────────
// Extracted from ReviewDrawer so the exact same markup/logic renders both inside the full
// drawer (unchanged) and inside the new per-section popups — one implementation, two places.

function OfferedSalarySection({
  os, sc, review, status, isReviewer, effectiveDate, setEffectiveDate, busy, onApprove, payrollHrValidation, onEffectiveDateBlur,
}: {
  os: any; sc: any; review: any; status: string | undefined; isReviewer: boolean;
  effectiveDate: string; setEffectiveDate: (v: string) => void; busy: boolean;
  onApprove: () => void; payrollHrValidation?: any; onEffectiveDateBlur?: (date: string) => Promise<void>;
}) {
  if (!os) return <p className="text-xs text-slate-400 py-1">No offer on file for this candidate.</p>;
  return (
    <div className="rounded-xl border border-amber-200 overflow-hidden bg-amber-50/50">
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 flex items-center gap-2">
        <Package className="h-3.5 w-3.5 text-white" />
        <p className="text-xs font-semibold text-white">Offered Salary (Branch HR)</p>
        <span className={`ml-auto text-[10px] font-semibold rounded-full px-2 py-0.5 ${
          os.offer_status === 'bh_approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-white/20 text-white'
        }`}>{os.offer_status === 'bh_approved' ? 'BH Approved' : os.offer_status}</span>
      </div>
      <div className="p-3">
        <div className="grid grid-cols-2 gap-x-4">
          <div>
            <DrawerSalaryRow label="Basic" value={inr(os.basic)} />
            <DrawerSalaryRow label="HRA" value={inr(os.hra)} />
            <DrawerSalaryRow label="Conveyance" value={inr(os.conveyance)} />
            {Number(os.special_allowance) > 0 && <DrawerSalaryRow label="Special Allowance" value={inr(os.special_allowance)} />}
            {Number(os.bonus) > 0 && <DrawerSalaryRow label="Bonus" value={inr(os.bonus)} />}
            <DrawerSalaryRow label="Gross" value={inr(os.gross)} bold separator />
          </div>
          <div>
            <DrawerSalaryRow label="PF (Emp)" value={Number(os.pf_employee) > 0 ? `− ${inr(os.pf_employee)}` : '—'} />
            <DrawerSalaryRow label="ESIC (Emp)" value={Number(os.esic_employee) > 0 ? `− ${inr(os.esic_employee)}` : '—'} />
            <DrawerSalaryRow label="Net in Hand" value={inr(os.net_in_hand)} bold separator />
            <DrawerSalaryRow label="Offered CTC" value={inr(os.offered_ctc)} bold separator />
          </div>
        </div>
        {os.created_by_name && (
          <p className="text-[10px] text-amber-600 mt-2 flex items-center gap-1">
            <User className="h-3 w-3" />Created by {os.created_by_name} on {fmtDate(os.created_at)}
          </p>
        )}
        {/* Branch Payroll HR's own remarks from salary/onboarding validation — previously
            fetched from ats_payroll_hr_validation for salary_start_date only, so Payroll Head
            never saw these even though Branch HR routinely writes them. */}
        {(payrollHrValidation?.remarks || payrollHrValidation?.joining_remarks) && (
          <div className="mt-2 pt-2 border-t border-amber-200/70 space-y-1">
            <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1">
              <FileText className="h-3 w-3" />Branch Payroll HR Remarks
              {payrollHrValidation.validated_by_name && <span className="font-normal normal-case text-amber-500">— {payrollHrValidation.validated_by_name}</span>}
            </p>
            {payrollHrValidation.remarks && <p className="text-xs text-amber-800">{payrollHrValidation.remarks}</p>}
            {payrollHrValidation.joining_remarks && <p className="text-xs text-amber-800">{payrollHrValidation.joining_remarks}</p>}
          </div>
        )}
        {/* One-click approve offered package */}
        {status === 'pending_review' && isReviewer && !sc && !review?.package_accepted && (
          <div className="mt-3 pt-3 border-t border-amber-200 flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-[10px] font-medium mb-1 block text-amber-700">
                Effective Date <span className="text-red-500">*</span>
              </Label>
              <div className="flex flex-col gap-1">
                <Input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  onBlur={onEffectiveDateBlur ? async (e) => { await onEffectiveDateBlur(e.target.value); } : undefined}
                  className="w-[140px] h-8 text-xs rounded-lg border-amber-200"
                />
                {payrollHrValidation?.salary_start_date && (
                  <p className="text-xs text-slate-400">
                    Payroll HR set:{' '}
                    {new Date(payrollHrValidation.salary_start_date)
                      .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                )}
              </div>
            </div>
            <Button size="sm" disabled={busy || !effectiveDate}
              onClick={onApprove}
              className="h-8 text-xs cursor-pointer bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 gap-1.5">
              <CheckCircle2 className="h-3 w-3" />Approve This Package
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function FinalSalarySection({
  sc, os, review, status, isReviewer, effectiveDate, setEffectiveDate, busy,
  packages, selectedGrade, setSelectedGrade, selectedPkgId, setSelectedPkgId,
  assignExisting, acceptPackage, onBuildPackage, onEffectiveDateBlur, salaryStartDateHint,
}: {
  sc: any; os: any; review: any; status: string | undefined; isReviewer: boolean;
  effectiveDate: string; setEffectiveDate: (v: string) => void; busy: boolean;
  packages: any[]; selectedGrade: string; setSelectedGrade: (v: string) => void;
  selectedPkgId: string; setSelectedPkgId: (v: string) => void;
  assignExisting: () => void; acceptPackage: () => void; onBuildPackage: () => void;
  onEffectiveDateBlur?: (date: string) => Promise<void>; salaryStartDateHint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 overflow-hidden">
      <div className="bg-gradient-to-r from-purple-600 to-violet-600 px-4 py-2.5 flex items-center gap-2">
        <IndianRupee className="h-3.5 w-3.5 text-white" />
        <p className="text-xs font-semibold text-white">Final Salary (Payroll Head)</p>
        {review?.package_accepted ? (
          <span className="ml-auto text-[10px] font-semibold text-emerald-300 bg-white/15 rounded-full px-2 py-0.5 flex items-center gap-1">
            <CheckCircle2 className="h-2.5 w-2.5" />Accepted
          </span>
        ) : review?.salary_package_id ? (
          <span className="ml-auto text-[10px] text-amber-300 bg-white/15 rounded-full px-2 py-0.5">Not accepted</span>
        ) : sc ? (
          <span className="ml-auto text-[10px] text-emerald-300 bg-white/15 rounded-full px-2 py-0.5">Assigned</span>
        ) : (
          <span className="ml-auto text-[10px] text-white/60 bg-white/15 rounded-full px-2 py-0.5">Not assigned</span>
        )}
      </div>
      <div className="p-3">
        {sc ? (
          <div className="grid grid-cols-2 gap-x-4">
            <div>
              <DrawerSalaryRow label="Basic" value={inr(sc.basic)} />
              <DrawerSalaryRow label="HRA" value={inr(sc.hra)} />
              <DrawerSalaryRow label="Conveyance" value={inr(sc.conveyance)} />
              {(sc.special_allowance > 0) && <DrawerSalaryRow label="Special Allowance" value={inr(sc.special_allowance)} />}
              <DrawerSalaryRow label="Gross" value={inr(sc.gross_monthly ?? sc.gross)} bold separator />
            </div>
            <div>
              <DrawerSalaryRow label="PF (Emp)" value={sc.pf_employee ? `− ${inr(sc.pf_employee)}` : '—'} />
              <DrawerSalaryRow label="ESIC (Emp)" value={sc.esic_employee ? `− ${inr(sc.esic_employee)}` : '—'} />
              <DrawerSalaryRow label="Net in Hand" value={inr(sc.net_in_hand ?? sc.net_estimate)} bold separator />
              <DrawerSalaryRow label="CTC" value={inr(sc.ctc)} bold separator />
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 flex items-center gap-1.5 py-1">
            {os ? (
              <>Use the offered package above, or assign a different one below.</>
            ) : (
              <><AlertTriangle className="h-3.5 w-3.5 text-amber-500" />No package assigned yet — assign one below</>
            )}
          </p>
        )}

        {/* Assign different package or build custom */}
        {status === 'pending_review' && isReviewer && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              {os ? 'Or assign a different package' : 'Assign package'}
            </p>
            <div className="flex items-end gap-2">
              <div>
                <Label className="text-[10px] font-medium mb-1 block text-slate-600">
                  Effective Date <span className="text-red-500">*</span>
                </Label>
                <div className="flex flex-col gap-1">
                  <Input
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    onBlur={onEffectiveDateBlur ? async (e) => { await onEffectiveDateBlur(e.target.value); } : undefined}
                    className="w-[140px] h-8 text-xs rounded-lg"
                  />
                  {salaryStartDateHint && (
                    <p className="text-xs text-slate-400">Payroll HR set: {salaryStartDateHint}</p>
                  )}
                </div>
              </div>
            </div>
            {/* Grade selector — filter packages by band */}
            {packages.length > 0 && (() => {
              const grades = [...new Set(packages.map((p) => p.band_code).filter(Boolean))].sort();
              return grades.length > 1 ? (
                <div>
                  <Label className="text-[10px] font-medium mb-1 block text-slate-600">Grade / Band</Label>
                  <Select value={selectedGrade} onValueChange={(v) => { setSelectedGrade(v); setSelectedPkgId(''); }}>
                    <SelectTrigger className="w-full h-8 text-xs rounded-lg">
                      <SelectValue placeholder="Select grade…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__" className="text-xs">All grades</SelectItem>
                      {grades.map((g) => (
                        <SelectItem key={g} value={g} className="text-xs">
                          Grade {g} · {packages.filter((p) => p.band_code === g).length} package{packages.filter((p) => p.band_code === g).length !== 1 ? 's' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null;
            })()}
            <div className="flex items-center gap-2">
              {(() => {
                const filtered = selectedGrade && selectedGrade !== '__all__'
                  ? packages.filter((p) => p.band_code === selectedGrade)
                  : packages;
                return (
                  <Select value={selectedPkgId} onValueChange={setSelectedPkgId}>
                    <SelectTrigger className="flex-1 h-8 text-xs rounded-lg">
                      <SelectValue placeholder={filtered.length === 0 ? 'No packages for selected grade' : 'Choose package…'} />
                    </SelectTrigger>
                    <SelectContent>
                      {filtered.length === 0
                        ? <SelectItem value="__none__" disabled>No packages for this grade</SelectItem>
                        : filtered.map((p) => (
                          <SelectItem key={p.id} value={p.id} className="text-xs">
                            {p.name ?? `Band ${p.band_code}`} · {inr(p.package_amount)}/mo
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                );
              })()}

              <Button size="sm" disabled={busy || !selectedPkgId || !effectiveDate}
                onClick={() => assignExisting()}
                className="h-8 text-xs cursor-pointer bg-purple-600 hover:bg-purple-700 rounded-lg px-3 shrink-0">
                Assign
              </Button>
              <Button size="sm" variant="outline" disabled={busy || !effectiveDate}
                onClick={onBuildPackage}
                className="h-8 text-xs cursor-pointer rounded-lg px-2 border-purple-200 text-purple-700 hover:bg-purple-50 shrink-0 gap-1">
                <Calculator className="h-3 w-3" />Build
              </Button>
            </div>
            {/* Accept */}
            {review?.salary_package_id && !review?.package_accepted && (
              <Button size="sm" disabled={busy} onClick={() => acceptPackage()}
                className="w-full h-8 text-xs cursor-pointer bg-emerald-600 hover:bg-emerald-700 rounded-lg gap-1.5">
                <CheckCircle2 className="h-3 w-3" />Accept Package
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BgvSection({
  bgv, bgvOverall, isReviewer, bgvCandidateId, bgvManual, bgvWaive,
}: {
  bgv: any; bgvOverall: string | undefined; isReviewer: boolean; bgvCandidateId: string | null | undefined;
  bgvManual: (checkId: string, s: 'verified' | 'mismatch' | 'failed') => void;
  bgvWaive: (checkId: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-100 overflow-hidden">
      <div className="bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2.5 flex items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5 text-white" />
        <p className="text-xs font-semibold text-white">Background Verification</p>
        {bgvOverall && (
          <span className={`ml-auto text-[10px] font-semibold rounded-full px-2 py-0.5 ${
            bgvOverall === 'clear' ? 'bg-emerald-100 text-emerald-700' : bgvOverall === 'refer' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
          }`}>{bgvOverall}</span>
        )}
      </div>
      <div className="p-3">
        {Array.isArray(bgv?.checks) && bgv.checks.length > 0 ? (
          <div className="divide-y divide-slate-50">
            {bgv.checks.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    c.status === 'verified' || c.status === 'clear' ? 'bg-emerald-500'
                      : c.status === 'failed' || c.status === 'mismatch' ? 'bg-red-500'
                      : c.status === 'waived' ? 'bg-blue-400' : 'bg-amber-400'
                  }`} />
                  <p className="text-xs text-slate-700">{c.check_type}</p>
                  <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 border capitalize ${
                    c.status === 'verified' || c.status === 'clear' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : c.status === 'failed' || c.status === 'mismatch' ? 'bg-red-50 text-red-700 border-red-200'
                      : c.status === 'waived' ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>{c.status}</span>
                </div>
                {isReviewer && c.status !== 'verified' && c.status !== 'clear' && c.status !== 'waived' && bgvCandidateId && (
                  <div className="flex gap-1">
                    <button onClick={() => bgvManual(c.id, 'verified')}
                      className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 cursor-pointer hover:bg-emerald-100">
                      Verify
                    </button>
                    <button onClick={() => bgvWaive(c.id)}
                      className="text-[10px] text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 cursor-pointer hover:bg-blue-100">
                      Waive
                    </button>
                    <button onClick={() => bgvManual(c.id, 'failed')}
                      className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 cursor-pointer hover:bg-red-100">
                      Fail
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 py-1">{bgv?.message ?? 'No BGV checks on file.'}</p>
        )}
      </div>
    </div>
  );
}

function BankSection({ bank }: { bank: any }) {
  return (
    <div className="rounded-xl border border-slate-100 overflow-hidden">
      <div className="bg-gradient-to-r from-blue-600 to-cyan-600 px-4 py-2.5 flex items-center gap-2">
        <Banknote className="h-3.5 w-3.5 text-white" />
        <p className="text-xs font-semibold text-white">Bank Readiness</p>
        {bank?.payable != null && (
          <span className={`ml-auto text-[10px] font-semibold rounded-full px-2 py-0.5 ${
            bank.payable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>{bank.payable ? 'Payable ✓' : 'Not payable'}</span>
        )}
      </div>
      <div className="p-3">
        {bank ? (
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              ['Bank', bank.bank_name ?? '—'],
              ['Account', bank.account_masked ?? '—'],
              ['Readiness', bank.readiness_class ?? '—'],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">{l}</p>
                <p className="font-semibold text-slate-800 mt-0.5">{v}</p>
              </div>
            ))}
            {bank.reason_detail && (
              <div className="col-span-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-700">
                {bank.reason_detail}
              </div>
            )}
          </div>
        ) : <p className="text-xs text-slate-400">No bank data available.</p>}
      </div>
    </div>
  );
}

// ── Section summary cards (Pending Review tab only) ─────────────────────────────
// Fill the space between employee info and the salary/status columns that used to sit mostly
// empty — one glanceable tile per section, each opening a focused popup on click.

function sectionStatus(section: SectionKey, row: QueueRow): { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  const s = row.summary;
  if (!s) return { text: 'Loading…', tone: 'neutral' };
  switch (section) {
    case 'offered': {
      if (!s.offered.status) return { text: 'No offer', tone: 'neutral' };
      const label = s.offered.status === 'bh_approved' ? 'BH Approved' : s.offered.status;
      return { text: s.offered.ctc ? `${label} · ${inr(s.offered.ctc)}` : label, tone: s.offered.status === 'bh_approved' ? 'good' : 'warn' };
    }
    case 'final': {
      if (s.final.accepted) return { text: s.final.ctc ? `Accepted · ${inr(s.final.ctc)}` : 'Accepted', tone: 'good' };
      if (s.final.assigned) return { text: 'Not accepted', tone: 'warn' };
      return { text: 'Not assigned', tone: 'bad' };
    }
    case 'bgv': {
      const overall = s.bgv?.overall_status ?? s.bgv?.status;
      if (s.bgv?.error || !overall) return { text: 'Unavailable', tone: 'neutral' };
      if (overall === 'clear') return { text: 'Clear', tone: 'good' };
      if (overall === 'refer') return { text: 'Refer', tone: 'warn' };
      return { text: overall, tone: 'bad' };
    }
    case 'bank': {
      if (s.bank?.error || s.bank?.payable == null) return { text: 'Unavailable', tone: 'neutral' };
      return s.bank.payable ? { text: 'Payable ✓', tone: 'good' } : { text: s.bank.readiness_class ?? 'Not payable', tone: 'bad' };
    }
  }
}

const TONE_CLASSES: Record<string, { border: string; text: string; dot: string }> = {
  good:    { border: 'border-emerald-200 bg-emerald-50/50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  warn:    { border: 'border-amber-200 bg-amber-50/50',     text: 'text-amber-700',   dot: 'bg-amber-500'   },
  bad:     { border: 'border-red-200 bg-red-50/50',         text: 'text-red-700',     dot: 'bg-red-500'     },
  neutral: { border: 'border-slate-150 bg-slate-50/50',     text: 'text-slate-500',   dot: 'bg-slate-300'   },
};

function SectionCard({ section, row, onClick }: { section: SectionKey; row: QueueRow; onClick: () => void }) {
  const meta = SECTION_META[section];
  const Icon = meta.icon;
  const { text, tone } = sectionStatus(section, row);
  const c = TONE_CLASSES[tone];
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`flex flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left cursor-pointer transition-colors hover:border-indigo-300 hover:shadow-sm min-w-[120px] ${c.border}`}
    >
      <span className="flex items-center gap-1 text-[9px] font-bold text-slate-500 uppercase tracking-wide">
        <Icon className="h-3 w-3 text-slate-400" />{meta.label}
      </span>
      <span className={`flex items-center gap-1 text-[11px] font-semibold truncate max-w-[130px] ${c.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />{text}
      </span>
    </button>
  );
}

// ── Section popup (Pending Review tab card click) ────────────────────────────────
// Fetches the same journey the full drawer uses, and renders exactly one of the four shared
// section components — same data, same actions, just scoped to one section in a small dialog.

function SectionPopup({
  section, employeeId, open, onClose, onRefreshQueue, isReviewer, reasons,
}: {
  section: SectionKey | null;
  employeeId: string | null;
  open: boolean;
  onClose: () => void;
  onRefreshQueue: () => void;
  isReviewer: boolean;
  reasons: Reason[];
}) {
  const [journey, setJourney] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectCategory, setRejectCategory] = useState('');
  const [rejectCode, setRejectCode] = useState('');
  const [rejectRemarks, setRejectRemarks] = useState('');

  const [packages, setPackages] = useState<any[]>([]);
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedPkgId, setSelectedPkgId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [loadedSalaryStartDate, setLoadedSalaryStartDate] = useState<string>('');
  const [pkgBuilderOpen, setPkgBuilderOpen] = useState(false);

  const loadJourney = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true); setError(null);
    try {
      const r = await hrmsApi.get<{ data: any }>(`/api/payroll-head-review/${employeeId}`);
      setJourney((r as any)?.data ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load.');
    } finally { setLoading(false); }
  }, [employeeId]);

  useEffect(() => {
    if (open && employeeId) {
      setJourney(null); setError(null); setNotice(null);
      setRejectOpen(false); setRejectCategory(section ? SECTION_META[section].category : '');
      setRejectCode(''); setRejectRemarks('');
      void loadJourney();
    }
  }, [open, employeeId, section]);

  useEffect(() => {
    if (effectiveDate) return;
    const preferred = journey?.payroll_hr_validation?.salary_start_date
                   ?? journey?.employee?.date_of_joining;
    if (!preferred) return;
    const d = new Date(preferred);
    if (!isNaN(d.getTime())) {
      const iso = d.toISOString().slice(0, 10);
      setEffectiveDate(iso);
      setLoadedSalaryStartDate(
        journey?.payroll_hr_validation?.salary_start_date ? iso : ''
      );
    }
  }, [journey]);

  useEffect(() => {
    const branch = journey?.employee?.branch_name;
    if (!branch) { setPackages([]); return; }
    hrmsApi.get<{ data: any[] }>(`/api/payroll-masters/packages?branch=${encodeURIComponent(branch)}`)
      .then((r: any) => setPackages(r?.data ?? [])).catch(() => {});
  }, [journey?.employee?.branch_name]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
      await loadJourney();
      onRefreshQueue();
    } catch (e: any) {
      setError(e?.message ?? 'Action failed.');
    } finally { setBusy(false); }
  }

  const handleEffectiveDateBlur = async (newDate: string) => {
    if (!newDate || newDate === loadedSalaryStartDate) return;
    try {
      await hrmsApi.patch(`/api/payroll-head-review/${employeeId}/salary-start-date`, {
        salary_start_date: newDate,
      });
      setLoadedSalaryStartDate(newDate);
      setNotice('Salary start date updated.');
      setTimeout(() => setNotice(null), 3000);
    } catch {
      setError('Failed to update salary start date.');
    }
  };

  const assignExisting = () => run(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/assign`, {
      package_id: selectedPkgId, effective_date: effectiveDate,
    }), 'Package assigned.'
  );
  const acceptPackage = () => run(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/accept`, {}), 'Package accepted.'
  );
  const approve = () => run(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/approve`, {}), 'Approved for payroll.'
  );
  // One click, full close: assign+accept the offered package, then immediately approve for
  // payroll — the two-click drawer path collapsed into one, as asked. If the assign call fails
  // approve is never attempted, so this can't leave a worse partial state than the manual path.
  const approveOfferedAndClose = () => run(async () => {
    await hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/approve-offered`, { effective_date: effectiveDate });
    await hrmsApi.post(`/api/payroll-head-review/${employeeId}/approve`, {});
  }, 'Offered package approved and payroll approval closed.');
  const onPackageBuilt = async (pkgId: string) => {
    if (!effectiveDate) { setError('Set effective date first.'); return; }
    await run(() =>
      hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/assign`, {
        package_id: pkgId, effective_date: effectiveDate,
      }), 'Package built and assigned.'
    );
  };
  const submitReject = () => run(async () => {
    await hrmsApi.post(`/api/payroll-head-review/${employeeId}/reject`, {
      category: rejectCategory, reason_code: rejectCode, remarks: rejectRemarks,
    });
    setRejectOpen(false); onClose();
  }, 'Rejected.');

  const bgvManual = (checkId: string, s: 'verified' | 'mismatch' | 'failed') => run(() =>
    hrmsApi.post(`/api/ats/bgv/candidates/${journey?.bgv?.candidateId}/manual-review`, {
      checkId, status: s, remarks: `Reviewed from section popup (${s}).`,
    })
  );
  const bgvWaive = (checkId: string) => run(() =>
    hrmsApi.post(`/api/ats/bgv/candidates/${journey?.bgv?.candidateId}/waive`, {
      checkId, exceptionType: 'waiver', reason: 'Waived from section popup.',
    })
  );

  const review = journey?.review;
  const sc = journey?.salary_components;
  const os = journey?.offered_salary;
  const status = review?.status;
  const reasonsFiltered = reasons.filter((r) => r.category === rejectCategory);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {section && <>{(() => { const Icon = SECTION_META[section].icon; return <Icon className="h-4 w-4 text-indigo-600" />; })()}{SECTION_META[section].label}</>}
              <span className="text-xs font-normal text-slate-400">— {journey?.employee?.full_name ?? '…'}</span>
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
            </div>
          ) : (
            <div className="space-y-3">
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />{error}
                </div>
              )}
              {notice && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />{notice}
                </div>
              )}

              {section === 'offered' && (
                <OfferedSalarySection
                  os={os} sc={sc} review={review} status={status} isReviewer={isReviewer}
                  effectiveDate={effectiveDate} setEffectiveDate={setEffectiveDate} busy={busy}
                  onApprove={() => void approveOfferedAndClose()}
                  payrollHrValidation={journey?.payroll_hr_validation}
                  onEffectiveDateBlur={handleEffectiveDateBlur}
                />
              )}
              {section === 'final' && (
                <>
                  <FinalSalarySection
                    sc={sc} os={os} review={review} status={status} isReviewer={isReviewer}
                    effectiveDate={effectiveDate} setEffectiveDate={setEffectiveDate} busy={busy}
                    packages={packages} selectedGrade={selectedGrade} setSelectedGrade={setSelectedGrade}
                    selectedPkgId={selectedPkgId} setSelectedPkgId={setSelectedPkgId}
                    assignExisting={() => void assignExisting()} acceptPackage={() => void acceptPackage()}
                    onBuildPackage={() => setPkgBuilderOpen(true)}
                    onEffectiveDateBlur={handleEffectiveDateBlur}
                    salaryStartDateHint={journey?.payroll_hr_validation?.salary_start_date
                      ? new Date(journey.payroll_hr_validation.salary_start_date)
                          .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                      : undefined}
                  />
                  {status === 'pending_review' && isReviewer && review?.package_accepted && (
                    <Button disabled={busy} onClick={() => void approve()}
                      className="w-full cursor-pointer bg-emerald-600 hover:bg-emerald-700 rounded-xl text-sm gap-2">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Approve for Payroll
                    </Button>
                  )}
                </>
              )}
              {section === 'bgv' && (
                <BgvSection
                  bgv={journey?.bgv} bgvOverall={journey?.bgv?.overall_status ?? journey?.bgv?.status} isReviewer={isReviewer}
                  bgvCandidateId={journey?.bgv?.candidateId}
                  bgvManual={(checkId, s) => void bgvManual(checkId, s)}
                  bgvWaive={(checkId) => void bgvWaive(checkId)}
                />
              )}
              {section === 'bank' && <BankSection bank={journey?.bank} />}

              {status === 'pending_review' && isReviewer && (
                <div className="pt-1">
                  {!rejectOpen ? (
                    <Button variant="outline" disabled={busy} onClick={() => setRejectOpen(true)}
                      className="w-full cursor-pointer rounded-xl text-sm gap-2 border-red-200 text-red-700 hover:bg-red-50">
                      <XCircle className="h-4 w-4" />Reject
                    </Button>
                  ) : (
                    <div className="rounded-xl border border-red-100 bg-red-50/50 p-3 space-y-2.5">
                      <p className="text-xs font-semibold text-red-800 flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5" />Reject Salary Review</p>
                      <Select value={rejectCategory} onValueChange={(v) => { setRejectCategory(v); setRejectCode(''); }}>
                        <SelectTrigger className="h-8 text-xs rounded-lg"><SelectValue placeholder="What's the issue?" /></SelectTrigger>
                        <SelectContent>
                          {['salary', 'documents', 'bgv', 'bank', 'other'].map((c) => (
                            <SelectItem key={c} value={c} className="capitalize text-xs">{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={rejectCode} onValueChange={setRejectCode} disabled={!rejectCategory}>
                        <SelectTrigger className="h-8 text-xs rounded-lg"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                        <SelectContent>
                          {reasonsFiltered.length === 0
                            ? <SelectItem value="__none__" disabled>No reasons for this category</SelectItem>
                            : reasonsFiltered.map((r) => <SelectItem key={r.code} value={r.code} className="text-xs">{r.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Textarea value={rejectRemarks} onChange={(e) => setRejectRemarks(e.target.value)}
                        rows={2} className="text-xs rounded-lg" placeholder="What needs to be fixed…" />
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setRejectOpen(false)} className="cursor-pointer rounded-lg text-xs">Cancel</Button>
                        <Button size="sm" variant="destructive" disabled={busy || !rejectCategory || !rejectCode || !rejectRemarks.trim()}
                          onClick={() => void submitReject()} className="cursor-pointer rounded-lg text-xs flex-1">
                          Submit Rejection
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <PackageBuilderDialog
        open={pkgBuilderOpen}
        onOpenChange={setPkgBuilderOpen}
        defaultBranch={journey?.employee?.branch_name ?? ''}
        onPackageCreated={(pkgId) => void onPackageBuilt(pkgId)}
      />
    </>
  );
}

// ── Review Drawer ─────────────────────────────────────────────────────────────

function ReviewDrawer({
  employeeId, open, onClose, onRefreshQueue, isReviewer, reasons,
}: {
  employeeId: string | null;
  open: boolean;
  onClose: () => void;
  onRefreshQueue: () => void;
  isReviewer: boolean;
  reasons: Reason[];
}) {
  const navigate = useNavigate();
  const [journey, setJourney] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [notice, setNotice]   = useState<string | null>(null);

  const [rejectOpen, setRejectOpen]         = useState(false);
  const [rejectCategory, setRejectCategory] = useState('');
  const [rejectCode, setRejectCode]         = useState('');
  const [rejectRemarks, setRejectRemarks]   = useState('');

  const [packages, setPackages]           = useState<any[]>([]);
  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedPkgId, setSelectedPkgId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [loadedSalaryStartDate, setLoadedSalaryStartDate] = useState<string>('');
  const [pkgBuilderOpen, setPkgBuilderOpen] = useState(false);

  const loadJourney = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true); setError(null);
    try {
      const r = await hrmsApi.get<{ data: any }>(`/api/payroll-head-review/${employeeId}`);
      setJourney((r as any)?.data ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load.');
    } finally { setLoading(false); }
  }, [employeeId]);

  useEffect(() => {
    if (open && employeeId) {
      setJourney(null); setError(null); setNotice(null);
      void loadJourney();
    }
  }, [open, employeeId]);

  useEffect(() => {
    if (effectiveDate) return;
    const preferred = journey?.payroll_hr_validation?.salary_start_date
                   ?? journey?.employee?.date_of_joining;
    if (!preferred) return;
    const d = new Date(preferred);
    if (!isNaN(d.getTime())) {
      const iso = d.toISOString().slice(0, 10);
      setEffectiveDate(iso);
      setLoadedSalaryStartDate(
        journey?.payroll_hr_validation?.salary_start_date ? iso : ''
      );
    }
  }, [journey]);

  useEffect(() => {
    const branch = journey?.employee?.branch_name;
    if (!branch) { setPackages([]); return; }
    hrmsApi.get<{ data: any[] }>(`/api/payroll-masters/packages?branch=${encodeURIComponent(branch)}`)
      .then((r: any) => setPackages(r?.data ?? [])).catch(() => {});
  }, [journey?.employee?.branch_name]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await fn();
      if (ok) setNotice(ok);
      await loadJourney();
      onRefreshQueue();
    } catch (e: any) {
      setError(e?.message ?? 'Action failed.');
    } finally { setBusy(false); }
  }

  const handleEffectiveDateBlur = async (newDate: string) => {
    if (!newDate || newDate === loadedSalaryStartDate) return;
    try {
      await hrmsApi.patch(`/api/payroll-head-review/${employeeId}/salary-start-date`, {
        salary_start_date: newDate,
      });
      setLoadedSalaryStartDate(newDate);
      setNotice('Salary start date updated.');
      setTimeout(() => setNotice(null), 3000);
    } catch {
      setError('Failed to update salary start date.');
    }
  };

  const assignExisting = () => run(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/assign`, {
      package_id: selectedPkgId, effective_date: effectiveDate,
    }), 'Package assigned.'
  );

  const acceptPackage = () => run(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/accept`, {}),
    'Package accepted.'
  );

  const approve = () => run(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/approve`, {})
  );

  const approveOfferedPackage = () => run(() =>
    hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/approve-offered`, {
      effective_date: effectiveDate,
    }), 'Offered package approved and assigned.'
  );

  const onPackageBuilt = async (pkgId: string) => {
    if (!effectiveDate) { setError('Set effective date first.'); return; }
    await run(() =>
      hrmsApi.post(`/api/payroll-head-review/${employeeId}/package/assign`, {
        package_id: pkgId, effective_date: effectiveDate,
      }), 'Package built and assigned.'
    );
  };

  const submitReject = () => run(async () => {
    await hrmsApi.post(`/api/payroll-head-review/${employeeId}/reject`, {
      category: rejectCategory, reason_code: rejectCode, remarks: rejectRemarks,
    });
    setRejectOpen(false); setRejectCategory(''); setRejectCode(''); setRejectRemarks('');
  });

  const review   = journey?.review;
  const employee = journey?.employee;
  const sc       = journey?.salary_components;
  const os       = journey?.offered_salary; // Offered salary from Branch HR
  const status   = review?.status;
  const bgvCandidateId = journey?.bgv?.candidateId as string | null | undefined;

  const bgvOverall = journey?.bgv?.overall_status ?? journey?.bgv?.status;
  const reasonsFiltered = reasons.filter((r) => r.category === rejectCategory);

  const bgvManual = (checkId: string, s: 'verified' | 'mismatch' | 'failed') => run(() =>
    hrmsApi.post(`/api/ats/bgv/candidates/${bgvCandidateId}/manual-review`, {
      checkId, status: s, remarks: `Reviewed from Queue drawer (${s}).`,
    })
  );
  const bgvWaive = (checkId: string) => run(() =>
    hrmsApi.post(`/api/ats/bgv/candidates/${bgvCandidateId}/waive`, {
      checkId, exceptionType: 'waiver', reason: 'Waived from Queue drawer.',
    })
  );

  const initials = employee?.full_name?.split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase() ?? '?';
  const statusCfg = STATUS_CFG[status as keyof typeof STATUS_CFG] ?? STATUS_CFG.pending_review;

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto p-0" side="right">
          {/* Header */}
          <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-indigo-700 px-5 py-5 sticky top-0 z-10">
            <SheetHeader>
              <SheetTitle className="text-white text-left">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center text-white font-bold text-base flex-shrink-0">
                      {initials}
                    </div>
                    <div>
                      <p className="text-base font-bold text-white leading-tight">{employee?.full_name ?? '—'}</p>
                      <p className="text-white/70 text-xs mt-0.5">{employee?.employee_code} · {employee?.branch_name ?? '—'}</p>
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold border ${statusCfg.chip}`}>
                    <statusCfg.icon className="h-3 w-3" />{statusCfg.label}
                  </span>
                </div>
              </SheetTitle>
            </SheetHeader>
            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-white/20 text-xs text-white/70">
              {employee?.designation_name && <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" />{employee.designation_name}</span>}
              {employee?.date_of_joining && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />DOJ: {fmtDate(employee.date_of_joining)}</span>}
              <button onClick={() => navigate(`/payroll/salary-review/${employeeId}`)}
                className="ml-auto flex items-center gap-1 text-white/70 hover:text-white transition-colors cursor-pointer">
                <ExternalLink className="h-3 w-3" />Full page
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
            </div>
          ) : (
            <div className="p-4 space-y-4 pb-8">
              {/* Banners */}
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />{error}
                </div>
              )}
              {notice && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />{notice}
                </div>
              )}
              {status === 'rejected' && review?.rejection_remarks && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-bold text-red-800">Rejected — {review.rejection_category} / {review.rejection_reason_code}</p>
                  <p className="text-xs text-red-600 mt-1">{review.rejection_remarks}</p>
                </div>
              )}

              {/* ── Offered Salary from Branch HR ── */}
              {os && (
                <OfferedSalarySection
                  os={os} sc={sc} review={review} status={status} isReviewer={isReviewer}
                  effectiveDate={effectiveDate} setEffectiveDate={setEffectiveDate} busy={busy}
                  onApprove={() => void approveOfferedPackage()}
                  payrollHrValidation={journey?.payroll_hr_validation}
                  onEffectiveDateBlur={handleEffectiveDateBlur}
                />
              )}

              {/* ── Salary Package (Payroll Head Assigned) ── */}
              <FinalSalarySection
                sc={sc} os={os} review={review} status={status} isReviewer={isReviewer}
                effectiveDate={effectiveDate} setEffectiveDate={setEffectiveDate} busy={busy}
                packages={packages} selectedGrade={selectedGrade} setSelectedGrade={setSelectedGrade}
                selectedPkgId={selectedPkgId} setSelectedPkgId={setSelectedPkgId}
                assignExisting={() => void assignExisting()} acceptPackage={() => void acceptPackage()}
                onBuildPackage={() => setPkgBuilderOpen(true)}
                onEffectiveDateBlur={handleEffectiveDateBlur}
                salaryStartDateHint={journey?.payroll_hr_validation?.salary_start_date
                  ? new Date(journey.payroll_hr_validation.salary_start_date)
                      .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                  : undefined}
              />

              {/* ── BGV ── */}
              <BgvSection
                bgv={journey?.bgv} bgvOverall={bgvOverall} isReviewer={isReviewer}
                bgvCandidateId={bgvCandidateId}
                bgvManual={(checkId, s) => void bgvManual(checkId, s)}
                bgvWaive={(checkId) => void bgvWaive(checkId)}
              />

              {/* ── Bank ── */}
              <BankSection bank={journey?.bank} />

              {/* ── Joining Kit ── */}
              {(journey?.joining_checklist ?? []).length > 0 && (
                <div className="rounded-xl border border-slate-100 overflow-hidden">
                  <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 flex items-center gap-2">
                    <FileSignature className="h-3.5 w-3.5 text-white" />
                    <p className="text-xs font-semibold text-white">Joining Kit</p>
                    <span className="ml-auto text-[10px] text-white/70 bg-white/15 rounded-full px-2 py-0.5">
                      {journey?.joining_kit?.status ?? 'No kit sent'}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {(journey.joining_checklist as any[]).map((c: any) => {
                      const done = c.status === 'signed' || c.status === 'completed' || c.status === 'esign_completed';
                      return (
                        <div key={c.id} className="flex items-center justify-between px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full ${done ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                            <span className="text-xs text-slate-700">{c.document_name || c.document_code}</span>
                          </div>
                          <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 border ${
                            done ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}>{c.status}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Decision panel ── */}
              {status === 'pending_review' && isReviewer && (
                <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-purple-50 p-4 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Ready to decide?</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {review?.package_accepted
                        ? 'Package accepted — you can approve for payroll.'
                        : 'Assign and accept a salary package first.'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      disabled={busy || !review?.package_accepted}
                      onClick={() => void approve()}
                      className="flex-1 cursor-pointer bg-emerald-600 hover:bg-emerald-700 rounded-xl text-sm gap-2 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Approve for Payroll
                    </Button>
                    <Button disabled={busy} variant="destructive" onClick={() => setRejectOpen(true)}
                      className="cursor-pointer rounded-xl text-sm gap-2">
                      <XCircle className="h-4 w-4" />Reject
                    </Button>
                  </div>
                  {!review?.package_accepted && (
                    <p className="text-[11px] text-slate-400 flex items-center gap-1">
                      <Lock className="h-3 w-3" />Approve unlocks after package acceptance.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <XCircle className="h-5 w-5" />Reject Salary Review
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Category</Label>
              <Select value={rejectCategory} onValueChange={(v) => { setRejectCategory(v); setRejectCode(''); }}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="What's the issue?" /></SelectTrigger>
                <SelectContent>
                  {['salary', 'documents', 'bgv', 'bank', 'other'].map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Reason</Label>
              <Select value={rejectCode} onValueChange={setRejectCode} disabled={!rejectCategory}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                <SelectContent>
                  {reasonsFiltered.length === 0
                    ? <SelectItem value="__none__" disabled>No reasons for this category</SelectItem>
                    : reasonsFiltered.map((r) => <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs font-medium mb-1.5 block">Remarks (required)</Label>
              <Textarea value={rejectRemarks} onChange={(e) => setRejectRemarks(e.target.value)}
                rows={3} className="rounded-xl" placeholder="What needs to be fixed…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} className="cursor-pointer rounded-xl">Cancel</Button>
            <Button variant="destructive" disabled={busy || !rejectCategory || !rejectCode || !rejectRemarks.trim()}
              onClick={() => void submitReject()} className="cursor-pointer rounded-xl">
              Submit Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PackageBuilderDialog
        open={pkgBuilderOpen}
        onOpenChange={setPkgBuilderOpen}
        defaultBranch={journey?.employee?.branch_name ?? ''}
        onPackageCreated={(pkgId) => void onPackageBuilt(pkgId)}
      />
    </>
  );
}

// ── Main Queue Page ───────────────────────────────────────────────────────────

export default function PayrollHeadSalaryReviewQueue() {
  const navigate = useNavigate();
  const { hasAnyRole } = useWorkforceAccess();
  const isReviewer = hasAnyRole(...REVIEWER_ROLES);
  const isFixer = hasAnyRole(...FIXER_ROLES);

  const [tab, setTab] = useState<'pending_review' | 'approved' | 'rejected' | 'revisions'>('pending_review');
  const [q, setQ] = useState('');
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Revisions tab state
  const [revisions, setRevisions]               = useState<RevisionRequest[]>([]);
  const [rejectingRevId, setRejectingRevId]     = useState<number | null>(null);
  const [revRejectRemarks, setRevRejectRemarks] = useState('');
  const [revBusy, setRevBusy]                   = useState(false);
  const [pendingRevisionCount, setPendingRevisionCount] = useState(0);

  // Drawer
  const [drawerEmployee, setDrawerEmployee] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Salary revision drawer
  const [revDrawerOpen, setRevDrawerOpen] = useState(false);
  const [revDrawerTarget, setRevDrawerTarget] = useState<{ id: string; name: string } | null>(null);

  // Section popup (Pending Review tab card click)
  const [popupSection, setPopupSection] = useState<SectionKey | null>(null);
  const [popupEmployee, setPopupEmployee] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const openSectionPopup = (section: SectionKey, employeeId: string) => {
    setPopupSection(section); setPopupEmployee(employeeId); setPopupOpen(true);
  };

  // Quick-action busy state (per row)
  const [quickBusy, setQuickBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (tab === 'revisions') return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: tab });
      if (q.trim()) params.set('q', q.trim());
      if (branch) params.set('branch', branch);
      const r = await hrmsApi.get<{ data: QueueRow[] }>(`/api/payroll-head-review/queue?${params}`);
      const data = (r as any)?.data ?? [];
      setRows(data);
      setCounts(prev => ({ ...prev, [tab]: data.length }));
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [tab, q, branch]);

  useEffect(() => { void load(); }, [load]);

  const loadRevisions = useCallback(async () => {
    try {
      const r = await hrmsApi.get<{ success: boolean; data: RevisionRequest[] }>(
        '/api/salary-revision?status=pending'
      );
      const data = (r as any)?.data ?? [];
      setRevisions(data);
      setPendingRevisionCount(data.length);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void loadRevisions(); }, [loadRevisions]);

  const reviewRevision = async (id: number, action: 'approve' | 'reject', remarks?: string) => {
    setError(null);
    setRevBusy(true);
    try {
      await hrmsApi.post(`/api/salary-revision/${id}/review`, { action, remarks });
      setRejectingRevId(null); setRevRejectRemarks('');
      void loadRevisions();
    } catch (e: any) {
      setError(e?.message ?? 'Action failed.');
    } finally { setRevBusy(false); }
  };

  useEffect(() => {
    hrmsApi.get<{ data: string[] }>('/api/payroll-head-review/branches')
      .then((r: any) => setBranches(r?.data ?? [])).catch(() => {});
    hrmsApi.get<{ data: Reason[] }>('/api/payroll-head-review/reasons')
      .then((r: any) => setReasons(r?.data ?? [])).catch(() => {});
  }, []);

  const openDrawer = (employeeId: string) => {
    setDrawerEmployee(employeeId);
    setDrawerOpen(true);
  };

  // Quick approve directly from row (only if package already accepted)
  const quickApprove = async (e: React.MouseEvent, employeeId: string) => {
    e.stopPropagation();
    setQuickBusy(employeeId);
    try {
      await hrmsApi.post(`/api/payroll-head-review/${employeeId}/approve`, {});
      await load();
    } catch { /* ignore — let them use the drawer for details */ }
    finally { setQuickBusy(null); }
  };

  const pendingCount  = counts['pending_review'] ?? rows.filter(r => r.status === 'pending_review').length;
  const approvedCount = counts['approved'] ?? 0;
  const rejectedCount = counts['rejected'] ?? 0;
  const overdueCount  = rows.filter(r => r.status === 'pending_review' && r.pending_hours >= 48).length;

  const tabLabel = (s: string) => {
    const c = counts[s];
    const base = STATUS_CFG[s as keyof typeof STATUS_CFG]?.label ?? s;
    return c != null ? `${base} (${c})` : base;
  };

  return (
    <DashboardLayout>
      <div className="p-4 sm:p-6 space-y-5">

        {/* Header */}
        <div className="rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 text-white px-6 py-5 shadow-lg">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Salary Review Queue</h1>
                <p className="text-indigo-200 text-sm mt-0.5">
                  Every new employee is blocked from payroll until reviewed and approved
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}
              className="border-white/30 bg-white/15 text-white hover:bg-white/25 cursor-pointer">
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Refresh
            </Button>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Pending Review', value: pendingCount, icon: Clock, bg: 'from-amber-50 to-orange-50', border: 'border-amber-200', text: 'text-amber-600', val: 'text-amber-900', sub: 'awaiting decision' },
            { label: `Overdue (>48h)`, value: overdueCount, icon: AlertTriangle, bg: overdueCount > 0 ? 'from-red-50 to-rose-50' : 'from-slate-50 to-slate-100', border: overdueCount > 0 ? 'border-red-200' : 'border-slate-200', text: overdueCount > 0 ? 'text-red-600' : 'text-slate-500', val: overdueCount > 0 ? 'text-red-900' : 'text-slate-900', sub: overdueCount > 0 ? 'salary blocked' : 'all on time' },
            { label: 'Approved', value: approvedCount, icon: CheckCircle2, bg: 'from-emerald-50 to-green-50', border: 'border-emerald-200', text: 'text-emerald-600', val: 'text-emerald-900', sub: 'cleared for payroll' },
            { label: 'Rejected', value: rejectedCount, icon: XCircle, bg: 'from-rose-50 to-pink-50', border: 'border-rose-200', text: 'text-rose-600', val: 'text-rose-900', sub: 'requires correction' },
          ].map(({ label, value, icon: Icon, bg, border, text, val, sub }) => (
            <div key={label} className={`rounded-2xl border bg-gradient-to-br ${bg} ${border} p-4 shadow-sm`}>
              <div className="flex items-start justify-between mb-3">
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${text}`}>{label}</p>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center bg-white/60`}>
                  <Icon className={`w-3.5 h-3.5 ${text}`} />
                </div>
              </div>
              <p className={`text-2xl font-bold ${val}`}>{value}</p>
              <p className={`text-[11px] mt-1 ${text} opacity-80`}>{sub}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="rounded-xl">
              <TabsTrigger value="pending_review" className="cursor-pointer text-xs">{tabLabel('pending_review')}</TabsTrigger>
              <TabsTrigger value="approved" className="cursor-pointer text-xs">{tabLabel('approved')}</TabsTrigger>
              <TabsTrigger value="rejected" className="cursor-pointer text-xs">{tabLabel('rejected')}</TabsTrigger>
              <TabsTrigger value="revisions" className="cursor-pointer text-xs relative">
                Pending Revisions
                {pendingRevisionCount > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold">
                    {pendingRevisionCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input placeholder="Name or employee code…" value={q} onChange={(e) => setQ(e.target.value)}
              className="pl-8 h-9 text-sm rounded-xl" />
          </div>
          <Select value={branch || '__all__'} onValueChange={(v) => setBranch(v === '__all__' ? '' : v)}>
            <SelectTrigger className="w-[160px] h-9 text-sm rounded-xl"><SelectValue placeholder="All branches" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All branches</SelectItem>
              {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Revisions content */}
        {tab === 'revisions' && (
          <div className="space-y-3 mt-3">
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
            )}
            {revisions.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">No pending revision requests.</p>
            )}
            {revisions.map((r) => (
              <div key={r.id} className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">{r.full_name}</p>
                    <p className="text-xs text-slate-500">{r.employee_code} · {r.branch_name ?? '—'}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-700 shrink-0">
                    <span className="text-slate-500">{new Date(r.current_effective_from).toLocaleDateString('en-IN')}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-blue-500" />
                    <span className="text-blue-700 font-semibold">{new Date(r.requested_effective_from).toLocaleDateString('en-IN')}</span>
                  </div>
                </div>
                <p className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2 line-clamp-3">{r.reason}</p>

                {rejectingRevId === r.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={revRejectRemarks}
                      onChange={(e) => setRevRejectRemarks(e.target.value)}
                      placeholder="Rejection reason (required)"
                      rows={2}
                      className="rounded-xl resize-none text-sm"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setRejectingRevId(null); setRevRejectRemarks(''); }} className="rounded-xl flex-1">
                        Cancel
                      </Button>
                      <Button size="sm" disabled={revBusy || !revRejectRemarks.trim()} onClick={() => void reviewRevision(r.id, 'reject', revRejectRemarks)}
                        className="rounded-xl flex-1 bg-red-600 hover:bg-red-700 text-white">
                        Confirm Reject
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={revBusy} onClick={() => void reviewRevision(r.id, 'approve')}
                      className="rounded-xl flex-1 bg-blue-600 hover:bg-blue-700 text-white">
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={revBusy} onClick={() => setRejectingRevId(r.id)}
                      className="rounded-xl flex-1 border-red-200 text-red-600 hover:bg-red-50">
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Employee cards */}
        <div className="space-y-2" style={{ display: tab === 'revisions' ? 'none' : undefined }}>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center py-16 rounded-2xl border border-dashed border-slate-200 text-slate-400">
              <ShieldCheck className="h-10 w-10 mb-3 text-slate-300" />
              <p className="font-medium text-slate-600">No employees in this state</p>
              <p className="text-sm mt-1">{tab === 'pending_review' ? 'All new hires have been reviewed.' : 'Nothing here yet.'}</p>
            </div>
          ) : (
            rows.map((row) => {
              const cfg = STATUS_CFG[row.status];
              const Icon = cfg.icon;
              const isOverdue = row.status === 'pending_review' && row.pending_hours >= 48;
              const initials = row.full_name?.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase() ?? '?';
              const canQuickApprove = isReviewer && row.status === 'pending_review' && row.package_accepted;

              return (
                <div
                  key={row.review_id}
                  onClick={() => openDrawer(row.employee_id)}
                  className={`group flex items-center gap-4 rounded-2xl border bg-white px-4 py-3.5 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-indigo-200 ${
                    isOverdue ? 'border-l-4 border-l-red-400 border-red-100' : row.status === 'pending_review' ? 'border-l-4 border-l-amber-400 border-slate-100' : row.status === 'approved' ? 'border-l-4 border-l-emerald-400 border-slate-100' : 'border-l-4 border-l-rose-400 border-slate-100'
                  }`}
                >
                  {/* Avatar */}
                  <div className="h-9 w-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-sm flex-shrink-0">
                    {initials}
                  </div>

                  {/* Employee info */}
                  <div className="min-w-0 shrink-0 w-[220px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900 text-sm">{row.full_name}</p>
                      <span className="font-mono text-[11px] text-slate-400 bg-slate-50 rounded px-1">{row.employee_code}</span>
                      {isOverdue && <span className="text-[10px] font-bold text-red-600 bg-red-50 rounded-full px-1.5 py-0.5 flex items-center gap-0.5 border border-red-200"><AlertTriangle className="h-2.5 w-2.5" />Overdue</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                      {row.designation_name && <span className="flex items-center gap-1"><Briefcase className="h-3 w-3 text-slate-300" />{row.designation_name}</span>}
                      {row.branch_name && <span className="flex items-center gap-1"><Building2 className="h-3 w-3 text-slate-300" />{row.branch_name}</span>}
                    </div>
                  </div>

                  {/* Section summary cards — fills the space that used to sit empty, Pending
                      Review tab only (Approved/Rejected keep this simpler row layout). */}
                  {tab === 'pending_review' && (
                    <div className="hidden lg:flex flex-1 items-center gap-2 flex-wrap">
                      {(Object.keys(SECTION_META) as SectionKey[]).map((section) => (
                        <SectionCard key={section} section={section} row={row}
                          onClick={() => openSectionPopup(section, row.employee_id)} />
                      ))}
                    </div>
                  )}

                  {/* Salary */}
                  <div className="hidden sm:flex flex-col items-end min-w-[90px] ml-auto">
                    <p className="text-sm font-bold text-slate-900 tabular-nums">
                      {/* final_ctc/offered_ctc are already monthly figures (salary_component_assignments.ctc,
                          ats_employment_offer.offered_ctc) — only ctc_annual needs the /12 that inrMo() does. */}
                      {row.final_ctc ? `${inr(row.final_ctc)}/mo` : row.offered_ctc ? `${inr(row.offered_ctc)}/mo` : row.ctc_annual ? inrMo(row.ctc_annual) : '—'}
                    </p>
                    <p className="text-[10px] text-slate-400">monthly CTC</p>
                  </div>

                  {/* Status + aging */}
                  <div className="hidden md:flex flex-col items-center gap-1 min-w-[110px]">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border ${cfg.chip}`}>
                      <Icon className="h-3 w-3" />{cfg.label}
                    </span>
                    {row.status === 'pending_review' && !row.package_accepted && (
                      <span className="text-[10px] text-amber-500">Pkg not accepted</span>
                    )}
                    <AgingChip hours={row.pending_hours} status={row.status} />
                  </div>

                  {/* Quick actions */}
                  <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    {canQuickApprove && (
                      <Button size="sm" disabled={quickBusy === row.employee_id}
                        onClick={(e) => void quickApprove(e, row.employee_id)}
                        className="h-7 text-xs cursor-pointer bg-emerald-600 hover:bg-emerald-700 rounded-lg px-2.5 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {quickBusy === row.employee_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Approve
                      </Button>
                    )}
                    {isFixer && (
                      <Button size="sm" variant="outline"
                        onClick={(e) => { e.stopPropagation(); setRevDrawerTarget({ id: row.employee_id, name: row.full_name }); setRevDrawerOpen(true); }}
                        className="h-7 text-xs cursor-pointer rounded-lg px-2.5 gap-1 opacity-0 group-hover:opacity-100 transition-opacity border-blue-200 text-blue-600 hover:bg-blue-50">
                        Request Date Revision
                      </Button>
                    )}
                    <Button size="sm" variant="ghost"
                      onClick={(e) => { e.stopPropagation(); openDrawer(row.employee_id); }}
                      className="h-7 text-xs cursor-pointer text-indigo-600 hover:bg-indigo-50 rounded-lg px-2.5 gap-1">
                      Review <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {tab !== 'revisions' && rows.length > 0 && (
          <p className="text-xs text-slate-400">
            {rows.length} employee{rows.length !== 1 ? 's' : ''} shown
            {tab === 'pending_review' && ' — salary will not build for any of these until approved'}
          </p>
        )}
      </div>

      {/* Review Drawer */}
      <ReviewDrawer
        employeeId={drawerEmployee}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onRefreshQueue={load}
        isReviewer={isReviewer}
        reasons={reasons}
      />

      {/* Section popup — opened from the summary cards on each pending row */}
      <SectionPopup
        section={popupSection}
        employeeId={popupEmployee}
        open={popupOpen}
        onClose={() => setPopupOpen(false)}
        onRefreshQueue={load}
        isReviewer={isReviewer}
        reasons={reasons}
      />

      {/* Salary date revision drawer — triggered from employee card rows */}
      {revDrawerTarget && (
        <SalaryRevisionDrawer
          open={revDrawerOpen}
          onClose={() => { setRevDrawerOpen(false); setRevDrawerTarget(null); }}
          employeeId={revDrawerTarget.id}
          employeeName={revDrawerTarget.name}
          currentEffectiveFrom=""
          dateOfJoining=""
          onSuccess={() => { void loadRevisions(); }}
        />
      )}
    </DashboardLayout>
  );
}
