# ATS BGV & Joining Pipeline Consolidation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicate pages, fix 10 known bugs, and deliver a single coherent ATS joining + BGV pipeline that one HR person can operate end-to-end without switching between confusing parallel surfaces.

**Architecture:** `NativeBGVReport.tsx` content is extracted into a new `BGVReportTab.tsx` component rendered as Tab 2 inside `NativeBGVVerificationCenter.tsx`. The original `NativeBGVReport.tsx` becomes a `<Navigate>` redirect. Six other targeted fixes address broken auth, fake tasks, raw browser dialogs, and missing role gates — all additive, nothing deleted.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind, shadcn/Radix, `hrmsApi` (custom fetch wrapper at `src/lib/hrmsApi.ts`), `@tanstack/react-query`, `useToast` from `@/hooks/use-toast`, Express + TypeScript backend.

## Global Constraints

- No new npm dependencies — use only what is already in the project.
- No new backend routes — only role additions on existing routes.
- `NativeBGVReport.tsx` must **not** be deleted — replaced with a `<Navigate>` redirect; its logic moves to `BGVReportTab.tsx`.
- All `alert()` / `window.confirm()` calls replaced with `toast` (useToast) or shadcn `AlertDialog` — never left as raw browser dialogs.
- All `<a href>` inside React Router context replaced with `<Link>` — no full-page reloads.
- `hrmsApi` used for all authenticated API calls.
- TypeScript: `npx tsc --noEmit` must pass with zero new errors after each task.
- Stage only explicitly named files — never `git add -A` or `git add .`.
- Push to `main` only after all tasks reviewed and approved — not per-task.
- CLAUDE.md concurrent-agent rule: commit with exact file paths, never broad staging.

---

## File Map

| File | Action | Task |
|---|---|---|
| `backend/src/modules/ats/ats.onboarding.routes.ts` | Modify — add `'hr', 'payroll_hr'` to 3 routes | 1 |
| `src/components/bgv/BGVReportTab.tsx` | **Create** — full BGV report form, all bugs fixed | 2 |
| `src/pages/NativeBGVReport.tsx` | Modify — replace body with `<Navigate>` redirect | 3 |
| `src/pages/NativeBGVVerificationCenter.tsx` | Modify — add Tabs wrapper + Tab 2 | 4 |
| `src/pages/NativeOfferLetterGeneration.tsx` | Modify — replace UUID input with employee search combobox | 5 |
| `src/pages/NativeJoiningControlRoom.tsx` | Modify — remove fake tasks, fix links, `<a>` → `<Link>` | 6 |
| `src/pages/JoiningDocumentsTrackerPage.tsx` | Modify — fix bulk-download auth, HR assign select | 7 |
| `src/config/routes/compliance.routes.tsx` | Modify — redirect `/provisioning/appointment-letter` | 8 |

---

## Task 1: Backend — Add `hr`/`payroll_hr` to Offer Approval Routes

**Files:**
- Modify: `backend/src/modules/ats/ats.onboarding.routes.ts:187-222`

**Interfaces:**
- Consumes: `requireRole(...)` middleware at each route
- Produces: HR role users can now call `GET /pending-approval`, `POST /offers/:id/approve`, `POST /offers/:id/reject` without 403

**Why this is safe:** Additive role addition. Existing branch_head/admin/super_admin access is unchanged.

- [ ] **Step 1: Open the file and locate the three routes**

  Read `backend/src/modules/ats/ats.onboarding.routes.ts`. Confirm these three routes currently have `requireRole('branch_head', 'admin', 'super_admin')` only (lines 188–222).

- [ ] **Step 2: Apply the role additions**

  In `backend/src/modules/ats/ats.onboarding.routes.ts`, make three replacements:

  **Route 1** (around line 189):
  ```ts
  // BEFORE:
  requireRole('branch_head', 'admin', 'super_admin'),

  // AFTER (GET /pending-approval):
  requireRole('branch_head', 'admin', 'super_admin', 'hr', 'payroll_hr'),
  ```

  **Route 2** (around line 204):
  ```ts
  // BEFORE:
  requireRole('branch_head', 'admin', 'super_admin'),

  // AFTER (POST /offers/:id/approve):
  requireRole('branch_head', 'admin', 'super_admin', 'hr', 'payroll_hr'),
  ```

  **Route 3** (around line 213):
  ```ts
  // BEFORE:
  requireRole('branch_head', 'admin', 'super_admin'),

  // AFTER (POST /offers/:id/reject):
  requireRole('branch_head', 'admin', 'super_admin', 'hr', 'payroll_hr'),
  ```

  The `requireRole` function signature is variadic — just append the new roles to the existing list. Do not change any other part of the routes.

- [ ] **Step 3: TypeScript check (backend)**

  Run from the repo root:
  ```bash
  cd backend && npx tsc --noEmit
  ```
  Expected: exits 0 with no errors.

- [ ] **Step 4: Verify the diff is correct**

  ```bash
  git diff backend/src/modules/ats/ats.onboarding.routes.ts
  ```
  Expected output: exactly 3 changed lines, each adds `'hr', 'payroll_hr'` to a `requireRole(...)` call. No other lines changed.

- [ ] **Step 5: Commit**

  ```bash
  git add backend/src/modules/ats/ats.onboarding.routes.ts
  git commit -m "fix(ats): add hr/payroll_hr to offer approval routes"
  ```

---

## Task 2: Create `BGVReportTab.tsx` — Full BGV Report with Bug Fixes

**Files:**
- Create: `src/components/bgv/BGVReportTab.tsx`

**Interfaces:**
- Consumes: `candidateId: string`, optional `candidateEmail?: string`, optional `candidateName?: string` from parent
- Produces: `<BGVReportTab>` component used by Task 4

**Bug fixes included:**
- Bug 1: `triggerVerify` calls correct endpoint for `pan`/`bank`; shows disabled button for `aadhaar-offline`
- Bug 4: all `alert()` → `toast()`; `window.confirm` → AlertDialog

- [ ] **Step 1: Create the directory if needed**

  Check whether `src/components/bgv/` exists:
  ```bash
  ls src/components/bgv/ 2>/dev/null || echo "does not exist"
  ```
  If it does not exist, it will be created automatically when the file is written.

- [ ] **Step 2: Write the new file**

  Create `src/components/bgv/BGVReportTab.tsx` with the following complete content:

  ```tsx
  import { useState, useEffect, useCallback } from 'react';
  import { hrmsApi } from '@/lib/hrmsApi';
  import { Button } from '@/components/ui/button';
  import { Input } from '@/components/ui/input';
  import { Label } from '@/components/ui/label';
  import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
  import { Badge } from '@/components/ui/badge';
  import { Textarea } from '@/components/ui/textarea';
  import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
  } from '@/components/ui/alert-dialog';
  import {
    Shield, CheckCircle2, XCircle, Clock, AlertTriangle,
    FileText, Lock, User, Banknote, GraduationCap,
    Briefcase, MapPin, Fingerprint, Search, Download,
    Send, ExternalLink, RefreshCw,
  } from 'lucide-react';
  import { formatIST, formatISTDate } from '@/lib/utils';
  import { downloadBGVReportPDF } from '@/lib/bgvReportPdfGenerator';
  import { useToast } from '@/hooks/use-toast';

  // ── Types ──────────────────────────────────────────────────────────────────────

  type VerifStatus = 'not_run' | 'passed' | 'failed' | 'partial';
  type OverallStatus = 'pending' | 'in_progress' | 'clear' | 'refer' | 'negative';

  interface BGVReport {
    id?: string;
    candidate_id: string;
    candidate_name?: string;
    candidate_code?: string;
    branch_name?: string;
    process_name?: string;
    mobile?: string;
    email?: string;
    photo_received: boolean;
    aadhaar_received: boolean;
    pan_received: boolean;
    passport_received: boolean;
    driving_license_received: boolean;
    edu_cert_received: boolean;
    prev_exp_received: boolean;
    bank_proof_received: boolean;
    offer_letter_received: boolean;
    box_file_no: string;
    aadhaar_status: VerifStatus;
    aadhaar_name_match: string;
    aadhaar_remarks: string;
    pan_status: VerifStatus;
    pan_name_match: string;
    pan_remarks: string;
    bank_status: VerifStatus;
    bank_account_match: string;
    bank_remarks: string;
    education_status: VerifStatus;
    education_remarks: string;
    employment_status: VerifStatus;
    employment_remarks: string;
    address_status: VerifStatus;
    address_remarks: string;
    criminal_status: VerifStatus;
    criminal_remarks: string;
    digilocker_status: VerifStatus;
    digilocker_remarks: string;
    esignature_status: 'not_done' | 'validated' | 'invalid';
    esignature_remarks: string;
    overall_status: OverallStatus;
    bgv_score: number;
    hr_remarks: string;
    completed_by?: string;
    completed_at?: string;
    locked: boolean;
    infinity_ai_case_id?: string;
    portal_initiated_at?: string;
    portal_candidate_email?: string;
    portal_login_url?: string;
    portal_status?: 'not_initiated' | 'initiated' | 'candidate_submitted' | 'completed' | 'expired';
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────

  const statusBadge: Record<VerifStatus | OverallStatus, string> = {
    not_run:     'bg-slate-100 text-slate-500',
    passed:      'bg-emerald-100 text-emerald-700',
    failed:      'bg-red-100 text-red-700',
    partial:     'bg-amber-100 text-amber-700',
    pending:     'bg-slate-100 text-slate-600',
    in_progress: 'bg-blue-100 text-blue-700',
    clear:       'bg-emerald-100 text-emerald-700',
    refer:       'bg-amber-100 text-amber-700',
    negative:    'bg-red-100 text-red-700',
  };

  function StatusIcon({ status }: { status: VerifStatus | OverallStatus }) {
    if (status === 'passed' || status === 'clear') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (status === 'failed' || status === 'negative') return <XCircle className="w-4 h-4 text-red-500" />;
    if (status === 'partial' || status === 'refer') return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    return <Clock className="w-4 h-4 text-slate-400" />;
  }

  const VERIFSTATUSES: VerifStatus[] = ['not_run', 'passed', 'failed', 'partial'];
  const OVERALL_STATUSES: OverallStatus[] = ['pending', 'in_progress', 'clear', 'refer', 'negative'];

  function emptyReport(candidateId: string): BGVReport {
    return {
      candidate_id: candidateId,
      photo_received: false, aadhaar_received: false, pan_received: false,
      passport_received: false, driving_license_received: false, edu_cert_received: false,
      prev_exp_received: false, bank_proof_received: false, offer_letter_received: false,
      box_file_no: '',
      aadhaar_status: 'not_run', aadhaar_name_match: '', aadhaar_remarks: '',
      pan_status: 'not_run', pan_name_match: '', pan_remarks: '',
      bank_status: 'not_run', bank_account_match: '', bank_remarks: '',
      education_status: 'not_run', education_remarks: '',
      employment_status: 'not_run', employment_remarks: '',
      address_status: 'not_run', address_remarks: '',
      criminal_status: 'not_run', criminal_remarks: '',
      digilocker_status: 'not_run', digilocker_remarks: '',
      esignature_status: 'not_done', esignature_remarks: '',
      overall_status: 'pending', bgv_score: 0, hr_remarks: '',
      locked: false,
    };
  }

  function computeScore(r: BGVReport): number {
    const checks: VerifStatus[] = [r.aadhaar_status, r.pan_status, r.bank_status, r.education_status, r.employment_status, r.address_status, r.criminal_status];
    const weights = [25, 20, 15, 10, 10, 10, 10];
    let score = 0;
    checks.forEach((s, i) => {
      if (s === 'passed') score += weights[i];
      else if (s === 'partial') score += Math.round(weights[i] * 0.5);
    });
    return Math.min(100, score);
  }

  // ── Component ──────────────────────────────────────────────────────────────────

  interface BGVReportTabProps {
    candidateId: string;
    candidateEmail?: string;
    candidateName?: string;
  }

  export default function BGVReportTab({ candidateId, candidateEmail, candidateName }: BGVReportTabProps) {
    const { toast } = useToast();
    const [report, setReport] = useState<BGVReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [verifying, setVerifying] = useState('');
    const [initiatingPortal, setInitiatingPortal] = useState(false);
    const [confirmPortalOpen, setConfirmPortalOpen] = useState(false);

    const loadReport = useCallback(async (id: string) => {
      setLoading(true);
      try {
        const r = await hrmsApi.get<any>(`/api/ats/bgv/report?candidateId=${id}`);
        setReport(r?.data ?? emptyReport(id));
      } catch {
        setReport(emptyReport(id));
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => {
      if (!candidateId) { setReport(null); return; }
      void loadReport(candidateId);
    }, [candidateId, loadReport]);

    const setF = (key: keyof BGVReport, value: unknown) => {
      setReport(p => {
        if (!p) return p;
        const updated = { ...p, [key]: value };
        updated.bgv_score = computeScore(updated);
        return updated;
      });
    };

    const saveReport = async (lock = false) => {
      if (!report) return;
      setSaving(true);
      try {
        await hrmsApi.post('/api/ats/bgv/report', { ...report, locked: lock || report.locked });
        if (lock) {
          setReport(p => p ? { ...p, locked: true } : p);
          toast({ title: 'Report locked', description: 'BGV report finalised as audit evidence.' });
        } else {
          toast({ title: 'BGV report saved.' });
        }
      } catch (e: any) {
        toast({ title: 'Save failed', description: e?.message ?? 'Unknown error', variant: 'destructive' });
      } finally {
        setSaving(false);
      }
    };

    const syncFromApiResults = async () => {
      if (!candidateId || !report) return;
      setSyncing(true);
      try {
        await hrmsApi.post('/api/ats/bgv/sync-report', { candidate_id: candidateId });
        const r = await hrmsApi.get<any>(`/api/ats/bgv/report?candidateId=${candidateId}`);
        if (r?.data) setReport(r.data);
        toast({ title: 'Sync complete', description: 'API check results imported into report.' });
      } catch (e: any) {
        toast({ title: 'Sync failed', description: e?.message ?? 'Unknown error', variant: 'destructive' });
      } finally {
        setSyncing(false);
      }
    };

    // Bug fix: only pan and bank have candidate-scoped verify endpoints
    const triggerVerify = async (checkType: string) => {
      if (!candidateId) return;
      setVerifying(checkType);
      try {
        await hrmsApi.post(`/api/ats/bgv/candidates/${candidateId}/verify/${checkType}`, {});
        const r = await hrmsApi.get<any>(`/api/ats/bgv/report?candidateId=${candidateId}`);
        if (r?.data) setReport(r.data);
        toast({ title: 'Verification triggered successfully.' });
      } catch (e: any) {
        toast({ title: 'Verification failed', description: e?.message ?? 'Unknown error', variant: 'destructive' });
      } finally {
        setVerifying('');
      }
    };

    const initiatePortal = async () => {
      if (!candidateId) return;
      setInitiatingPortal(true);
      try {
        const r = await hrmsApi.post<any>('/api/ats/bgv/report/initiate-portal', { candidate_id: candidateId });
        const data = r?.data ?? r;
        const fresh = await hrmsApi.get<any>(`/api/ats/bgv/report?candidateId=${candidateId}`);
        if (fresh?.data) setReport(fresh.data);
        toast({
          title: 'BGV portal initiated',
          description: `Case ID: ${data?.caseId ?? '—'} · Candidate email: ${data?.candidateEmail ?? candidateEmail ?? '—'}`,
        });
      } catch (e: any) {
        toast({ title: 'Portal initiation failed', description: e?.message ?? 'Unknown error', variant: 'destructive' });
      } finally {
        setInitiatingPortal(false);
      }
    };

    const exportPDF = async () => {
      if (!candidateId) return;
      setExporting(true);
      try {
        const fullData = await hrmsApi.get<any>(`/api/ats/bgv/report/full?candidateId=${candidateId}`);
        await downloadBGVReportPDF(fullData.data);
      } catch (e: any) {
        toast({ title: 'PDF export failed', description: e?.message ?? 'Unknown error', variant: 'destructive' });
      } finally {
        setExporting(false);
      }
    };

    // ── Empty state ──────────────────────────────────────────────────────────────

    if (!candidateId) {
      return (
        <div className="rounded-2xl border bg-slate-50 p-8 text-sm text-slate-500">
          Select a candidate from the queue on the left.
        </div>
      );
    }

    if (loading) {
      return (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
        </div>
      );
    }

    if (!report) return null;

    const displayName = report.candidate_name ?? candidateName ?? candidateId;
    const displayEmail = report.email ?? candidateEmail ?? '';

    // ── Report ───────────────────────────────────────────────────────────────────

    return (
      <div className="max-w-5xl space-y-6">

        {/* InfinitiAI confirm dialog — replaces window.confirm */}
        <AlertDialog open={confirmPortalOpen} onOpenChange={setConfirmPortalOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Initiate BGV via InfinitiAI?</AlertDialogTitle>
              <AlertDialogDescription>
                This will create the candidate on the InfinitiAI portal and send them a login email
                {displayEmail ? ` at ${displayEmail}` : ''}. They will have 7 days to fill the BGV form and upload documents.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void initiatePortal()}>Confirm</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Header actions */}
        <div className="flex items-start justify-between print:hidden">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-indigo-600">HR Report &amp; Documents</p>
            <p className="mt-1 text-slate-600 text-sm">{displayName}</p>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            {(!report.portal_status || report.portal_status === 'not_initiated' || report.portal_status === 'expired') && !report.locked && (
              <Button variant="outline" onClick={() => setConfirmPortalOpen(true)} disabled={initiatingPortal}
                className="border-indigo-300 text-indigo-700 hover:bg-indigo-50">
                {initiatingPortal
                  ? <><RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Initiating…</>
                  : <><Send className="w-4 h-4 mr-1" /> Initiate BGV (InfinitiAI)</>}
              </Button>
            )}
            <Button variant="outline" onClick={() => void exportPDF()} disabled={exporting}>
              <Download className="w-4 h-4 mr-1" /> {exporting ? 'Generating...' : 'Download PDF'}
            </Button>
            {!report.locked && (
              <Button variant="outline" onClick={() => void syncFromApiResults()} disabled={syncing}
                className="border-teal-300 text-teal-700 hover:bg-teal-50">
                <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? 'animate-spin' : ''}`} /> Sync API Results
              </Button>
            )}
            {!report.locked && <Button variant="outline" onClick={() => void saveReport(false)} disabled={saving}>Save Draft</Button>}
            {!report.locked && (
              <Button onClick={() => void saveReport(true)} disabled={saving} className="bg-slate-900 text-white hover:bg-slate-700">
                <Lock className="w-4 h-4 mr-1" /> Finalise &amp; Lock
              </Button>
            )}
            {report.locked && <Badge className="bg-slate-900 text-white px-4 py-2 text-sm"><Lock className="w-3 h-3 mr-1" /> Locked</Badge>}
          </div>
        </div>

        {/* Report header card */}
        <div className="rounded-3xl bg-gradient-to-br from-slate-900 to-slate-700 text-white p-8">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em] text-slate-300">Background Verification Report</p>
              <h2 className="text-3xl font-black mt-2">{displayName}</h2>
              <p className="text-slate-300 mt-1">{report.candidate_code} &nbsp;·&nbsp; {report.branch_name} &nbsp;·&nbsp; {report.process_name}</p>
            </div>
            <div className="text-right">
              <div className={`text-5xl font-black ${report.bgv_score >= 80 ? 'text-emerald-400' : report.bgv_score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                {report.bgv_score}<span className="text-2xl text-slate-300">/100</span>
              </div>
              <div className={`mt-1 px-3 py-1 rounded-full text-sm font-bold inline-block ${
                report.overall_status === 'clear' ? 'bg-emerald-500' :
                report.overall_status === 'negative' ? 'bg-red-500' :
                report.overall_status === 'refer' ? 'bg-amber-500' : 'bg-slate-600'
              }`}>
                {report.overall_status.toUpperCase()}
              </div>
            </div>
          </div>
        </div>

        {report.locked && (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center gap-3">
            <Lock className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <p className="text-sm font-semibold text-amber-800">
              This BGV report is finalised and locked as audit evidence. No further edits are permitted.
              {report.completed_at && ` Locked on ${formatISTDate(report.completed_at)}.`}
            </p>
          </div>
        )}

        {/* InfinitiAI portal status */}
        {report.portal_status && report.portal_status !== 'not_initiated' && (
          <Card className="border-indigo-200 bg-indigo-50/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-indigo-800">
                <Send className="w-5 h-5" /> InfinitiAI BGV Portal
                <Badge className={
                  report.portal_status === 'completed' ? 'bg-emerald-100 text-emerald-700 ml-2' :
                  report.portal_status === 'candidate_submitted' ? 'bg-blue-100 text-blue-700 ml-2' :
                  report.portal_status === 'expired' ? 'bg-red-100 text-red-700 ml-2' :
                  'bg-indigo-100 text-indigo-700 ml-2'
                }>
                  {report.portal_status.replace(/_/g, ' ').toUpperCase()}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div><p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Case ID</p><p className="text-sm font-mono text-slate-700">{report.infinity_ai_case_id ?? '—'}</p></div>
              <div><p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Candidate Email</p><p className="text-sm text-slate-700">{report.portal_candidate_email ?? '—'}</p></div>
              <div><p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Initiated At</p><p className="text-sm text-slate-700">{report.portal_initiated_at ? formatIST(report.portal_initiated_at) : '—'}</p></div>
              {report.portal_login_url && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Portal Login URL</p>
                  <a href={report.portal_login_url} target="_blank" rel="noopener noreferrer"
                    className="text-sm text-indigo-600 hover:underline flex items-center gap-1 break-all">
                    {report.portal_login_url}<ExternalLink className="w-3 h-3 flex-shrink-0" />
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Physical document checklist */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> Physical Document Checklist</CardTitle>
            <p className="text-sm text-slate-500">HR confirms receipt of physical copies</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {([
                ['photo_received', 'Photograph'],
                ['aadhaar_received', 'Aadhaar Card'],
                ['pan_received', 'PAN Card'],
                ['passport_received', 'Passport'],
                ['driving_license_received', 'Driving License'],
                ['edu_cert_received', 'Education Certificate'],
                ['prev_exp_received', 'Experience Letter'],
                ['bank_proof_received', 'Bank Proof (Passbook/Cheque)'],
                ['offer_letter_received', 'Previous Offer Letter'],
              ] as [keyof BGVReport, string][]).map(([key, label]) => (
                <label key={key} className={`flex items-center gap-2 rounded-xl border p-3 cursor-pointer transition-colors ${report[key] ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'} ${report.locked ? 'opacity-70 cursor-not-allowed' : ''}`}>
                  <input type="checkbox" checked={Boolean(report[key])} disabled={report.locked} onChange={e => setF(key, e.target.checked)} className="w-4 h-4" />
                  <span className="text-sm font-medium">{label}</span>
                  {report[key] ? <CheckCircle2 className="w-4 h-4 text-emerald-500 ml-auto" /> : null}
                </label>
              ))}
            </div>
            <div className="max-w-xs">
              <Label>Box File Number</Label>
              <Input value={report.box_file_no} disabled={report.locked} onChange={e => setF('box_file_no', e.target.value)} placeholder="e.g. BF-2024-00123" />
            </div>
          </CardContent>
        </Card>

        {/* Verification checks */}
        {([
          { key: 'aadhaar', label: 'Aadhaar Verification', icon: <Fingerprint className="w-5 h-5" />, matchKey: 'aadhaar_name_match', remarksKey: 'aadhaar_remarks', apiType: 'aadhaar-offline', weight: 25 },
          { key: 'pan',     label: 'PAN Verification', icon: <CreditCardIcon className="w-5 h-5" />, matchKey: 'pan_name_match', remarksKey: 'pan_remarks', apiType: 'pan', weight: 20 },
          { key: 'bank',    label: 'Bank Account Verification', icon: <Banknote className="w-5 h-5" />, matchKey: 'bank_account_match', remarksKey: 'bank_remarks', apiType: 'bank', weight: 15 },
          { key: 'education', label: 'Education Verification', icon: <GraduationCap className="w-5 h-5" />, matchKey: null, remarksKey: 'education_remarks', apiType: null, weight: 10 },
          { key: 'employment', label: 'Previous Employment Verification', icon: <Briefcase className="w-5 h-5" />, matchKey: null, remarksKey: 'employment_remarks', apiType: null, weight: 10 },
          { key: 'address', label: 'Address Verification', icon: <MapPin className="w-5 h-5" />, matchKey: null, remarksKey: 'address_remarks', apiType: null, weight: 10 },
          { key: 'criminal', label: 'Criminal Record Check', icon: <Shield className="w-5 h-5" />, matchKey: null, remarksKey: 'criminal_remarks', apiType: null, weight: 10 },
        ] as const).map(check => {
          const statusKey = `${check.key}_status` as keyof BGVReport;
          const currentStatus = report[statusKey] as VerifStatus;
          return (
            <Card key={check.key}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {check.icon} {check.label}
                    <span className="text-xs text-slate-400 font-normal">({check.weight} pts)</span>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <StatusIcon status={currentStatus} />
                    <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${statusBadge[currentStatus]}`}>
                      {currentStatus.replace('_', ' ').toUpperCase()}
                    </span>
                    {/* Bug fix: aadhaar-offline has no candidate-scoped endpoint — show disabled button with tooltip */}
                    {check.apiType && !report.locked && (
                      check.apiType === 'aadhaar-offline' ? (
                        <Button size="sm" variant="ghost" disabled
                          title="Use the API Checks tab to trigger this check"
                          className="text-slate-400 text-xs">
                          API via Tab 1
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline"
                          disabled={verifying === check.apiType}
                          onClick={() => void triggerVerify(check.apiType!)}>
                          {verifying === check.apiType
                            ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                            : 'Run API Check'}
                        </Button>
                      )
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                <div>
                  <Label>Status</Label>
                  <select disabled={report.locked}
                    className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background disabled:opacity-60"
                    value={currentStatus}
                    onChange={e => setF(statusKey, e.target.value as VerifStatus)}>
                    {VERIFSTATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
                {check.matchKey && (
                  <div>
                    <Label>Name / Account Match %</Label>
                    <Input disabled={report.locked}
                      value={String(report[check.matchKey as keyof BGVReport] ?? '')}
                      onChange={e => setF(check.matchKey as keyof BGVReport, e.target.value)}
                      placeholder="e.g. 97%" />
                  </div>
                )}
                <div className={check.matchKey ? '' : 'md:col-span-2'}>
                  <Label>Remarks</Label>
                  <Input disabled={report.locked}
                    value={String(report[check.remarksKey as keyof BGVReport] ?? '')}
                    onChange={e => setF(check.remarksKey as keyof BGVReport, e.target.value)}
                    placeholder="Verification notes…" />
                </div>
              </CardContent>
            </Card>
          );
        })}

        {/* E-signature */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> E-Signature Validation</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>E-Signature Status</Label>
              <select disabled={report.locked}
                className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background disabled:opacity-60"
                value={report.esignature_status}
                onChange={e => setF('esignature_status', e.target.value)}>
                <option value="not_done">Not Done</option>
                <option value="validated">Validated</option>
                <option value="invalid">Invalid</option>
              </select>
            </div>
            <div>
              <Label>Remarks</Label>
              <Input disabled={report.locked} value={report.esignature_remarks} onChange={e => setF('esignature_remarks', e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {/* Final verdict */}
        <Card className="border-2 border-slate-200">
          <CardHeader><CardTitle className="flex items-center gap-2"><User className="w-5 h-5" /> Final BGV Verdict</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Overall Status *</Label>
                <select disabled={report.locked}
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background disabled:opacity-60"
                  value={report.overall_status}
                  onChange={e => setF('overall_status', e.target.value as OverallStatus)}>
                  {OVERALL_STATUSES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                </select>
                <p className="text-xs text-slate-400 mt-1">CLEAR = proceed to payroll · REFER = escalate · NEGATIVE = revoke offer</p>
              </div>
              <div>
                <Label>BGV Score (auto-computed)</Label>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${
                      report.bgv_score >= 80 ? 'bg-emerald-500' : report.bgv_score >= 50 ? 'bg-amber-500' : 'bg-red-500'
                    }`} style={{ width: `${report.bgv_score}%` }} />
                  </div>
                  <span className="text-lg font-black text-slate-900 w-12">{report.bgv_score}%</span>
                </div>
              </div>
            </div>
            <div>
              <Label>HR Remarks / Final Notes</Label>
              <Textarea disabled={report.locked} value={report.hr_remarks} onChange={e => setF('hr_remarks', e.target.value)}
                rows={4} placeholder="Summarise BGV findings, exceptions, or conditions for clearance…" />
            </div>
            {!report.locked && (
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => void saveReport(false)} disabled={saving}>Save Draft</Button>
                <Button onClick={() => void saveReport(true)} disabled={saving}
                  className="bg-slate-900 hover:bg-slate-700 text-white gap-2">
                  <Lock className="w-4 h-4" /> Finalise &amp; Lock Report
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Inline CreditCard icon (not in lucide-react standard set)
  function CreditCardIcon({ className }: { className: string }) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    );
  }
  ```

- [ ] **Step 3: TypeScript check (frontend)**

  ```bash
  npx tsc --noEmit
  ```
  Expected: exits 0 with no new errors. If `@/components/ui/alert-dialog` import errors, verify the component exists at `src/components/ui/alert-dialog.tsx` — it is a standard shadcn component that should already be installed.

- [ ] **Step 4: Verify file was created**

  ```bash
  ls src/components/bgv/BGVReportTab.tsx
  ```
  Expected: file exists.

- [ ] **Step 5: Commit**

  ```bash
  git add src/components/bgv/BGVReportTab.tsx
  git commit -m "feat(bgv): create BGVReportTab component (alert fixes, correct verify endpoints)"
  ```

---

## Task 3: Replace `NativeBGVReport.tsx` with Redirect

**Files:**
- Modify: `src/pages/NativeBGVReport.tsx`

**Interfaces:**
- Consumes: nothing (becomes a pure redirect)
- Produces: any visit to `/ats/bgv-report` redirects to `/ats/bgv`

**Why not delete:** The file is referenced in the route config. Replacing with `<Navigate>` preserves the import without a dead-code delete.

- [ ] **Step 1: Replace the file content**

  Replace the entire content of `src/pages/NativeBGVReport.tsx` with:

  ```tsx
  import { Navigate } from 'react-router-dom';

  export default function NativeBGVReport() {
    return <Navigate to="/ats/bgv" replace />;
  }
  ```

  The entire prior content (650+ lines) is intentionally discarded here because all its logic is now in `BGVReportTab.tsx` (Task 2).

- [ ] **Step 2: TypeScript check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: exits 0.

- [ ] **Step 3: Verify diff**

  ```bash
  git diff src/pages/NativeBGVReport.tsx
  ```
  Expected: entire old body replaced with 5-line redirect component.

- [ ] **Step 4: Commit**

  ```bash
  git add src/pages/NativeBGVReport.tsx
  git commit -m "refactor(bgv): replace NativeBGVReport with redirect to /ats/bgv"
  ```

---

## Task 4: Add BGV Report Tab to `NativeBGVVerificationCenter.tsx`

**Files:**
- Modify: `src/pages/NativeBGVVerificationCenter.tsx`

**Interfaces:**
- Consumes: `BGVReportTab` from Task 2 (`src/components/bgv/BGVReportTab.tsx`)
- Produces: two-tab BGV Center at `/ats/bgv`

**Tab 1:** existing API Checks & Vendor Dispatch content (unchanged)
**Tab 2:** `<BGVReportTab candidateId={selectedId} candidateEmail={...} candidateName={...} />`

- [ ] **Step 1: Add imports**

  At the top of `src/pages/NativeBGVVerificationCenter.tsx`, add two imports after the existing imports:

  ```tsx
  import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
  import BGVReportTab from "@/components/bgv/BGVReportTab";
  ```

  Note: `Tabs` components are already used throughout the app. Do not add them if they are somehow already imported (unlikely — check the existing import list to confirm).

- [ ] **Step 2: Wrap content in Tabs**

  The current structure inside `<DashboardLayout>` is:
  ```tsx
  <div className="space-y-6 p-6 lg:p-8">
    <div className="flex flex-col gap-4 ...">  {/* header */}
      ...
    </div>
    {message && ...}
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">  {/* 2-column grid */}
      ...
    </div>
  </div>
  ```

  Replace from the `{message && ...}` line through the end of the outer `<div>` (everything after the header) with:

  ```tsx
  {message && (
    <div className={`rounded-2xl border p-4 text-sm font-bold ${messageType === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
      {message}
    </div>
  )}

  <Tabs defaultValue="api-checks" className="space-y-4">
    <TabsList>
      <TabsTrigger value="api-checks">API Checks &amp; Vendor Dispatch</TabsTrigger>
      <TabsTrigger value="hr-report">HR Report &amp; Documents</TabsTrigger>
    </TabsList>

    <TabsContent value="api-checks">
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        {/* ── Queue ── */}
        <Card>
          ... {/* existing Queue card content — unchanged */}
        </Card>

        {/* ── Detail panel ── */}
        <div className="space-y-4">
          ... {/* existing detail panel content — unchanged */}
        </div>
      </div>
    </TabsContent>

    <TabsContent value="hr-report">
      <BGVReportTab
        candidateId={selectedId}
        candidateEmail={queue.find(q => q.candidate_id === selectedId)?.email}
        candidateName={queue.find(q => q.candidate_id === selectedId)?.full_name}
      />
    </TabsContent>
  </Tabs>
  ```

  **Important:** The existing Queue card and detail panel JSX must remain exactly as-is inside `<TabsContent value="api-checks">`. Do not alter any logic, states, or handlers.

- [ ] **Step 3: TypeScript check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: exits 0.

- [ ] **Step 4: Manual smoke test**

  Open `/ats/bgv` in the browser. Verify:
  - Two tabs appear: "API Checks & Vendor Dispatch" and "HR Report & Documents"
  - Tab 1 shows the queue + detail panel exactly as before
  - Select a candidate in Tab 1, switch to Tab 2 — the BGV report form loads for that candidate
  - "Select a candidate from the queue on the left." message appears on Tab 2 when no candidate selected

- [ ] **Step 5: Commit**

  ```bash
  git add src/pages/NativeBGVVerificationCenter.tsx
  git commit -m "feat(bgv): merge BGV report into tab 2 of BGV Verification Center"
  ```

---

## Task 5: Fix Offer Letter Generated Letters Tab — Employee Search Combobox

**Files:**
- Modify: `src/pages/NativeOfferLetterGeneration.tsx`

**Bug:** Generated Letters tab has a plain `"Paste employee UUID..."` input. HR doesn't know employee UUIDs. Replace with a search combobox that calls the existing employee search API.

- [ ] **Step 1: Add Loader2 to imports**

  In `src/pages/NativeOfferLetterGeneration.tsx`, the lucide-react import line already imports `FilePen, CheckCircle, ChevronRight, Search, Copy`. Add `Loader2` to it:

  ```tsx
  import { FilePen, CheckCircle, ChevronRight, Search, Copy, Loader2 } from 'lucide-react';
  ```

- [ ] **Step 2: Add `listEmpSearch` state**

  After the existing `const [fetchEmpId, setFetchEmpId] = useState('');` line, add:

  ```tsx
  const [listEmpSearch, setListEmpSearch] = useState('');
  ```

- [ ] **Step 3: Add `listEmpSearchData` query**

  After the existing `empSearchData` useQuery block (around line 106), add:

  ```tsx
  const { data: listEmpSearchData, isFetching: listEmpFetching } = useQuery({
    queryKey: ['employees-search-list', listEmpSearch],
    queryFn: () => hrmsApi.get<{ data: Employee[] }>(`/api/employees?search=${encodeURIComponent(listEmpSearch)}&limit=10`),
    enabled: listEmpSearch.trim().length >= 2,
    staleTime: 30_000,
  });
  ```

- [ ] **Step 4: Replace the UUID input in the Generated Letters tab**

  Find this block (around lines 398–411):

  ```tsx
  <div className="flex gap-2">
    <Input
      placeholder="Paste employee UUID..."
      value={listEmpId}
      onChange={(e) => setListEmpId(e.target.value)}
      className="max-w-sm"
    />
    <Button
      onClick={() => { setFetchEmpId(listEmpId.trim()); refetchLetters(); }}
      disabled={listEmpId.trim().length === 0}
    >
      Load
    </Button>
  </div>
  ```

  Replace with:

  ```tsx
  <div className="space-y-2 max-w-sm">
    <div className="relative flex items-center gap-2">
      <Search className="absolute left-3 h-4 w-4 text-slate-400 pointer-events-none" />
      <Input
        placeholder="Search employee by name or code…"
        value={listEmpSearch}
        onChange={(e) => {
          setListEmpSearch(e.target.value);
          setListEmpId('');
          setFetchEmpId('');
        }}
        className="pl-9"
      />
      {listEmpFetching && <Loader2 className="h-4 w-4 animate-spin text-slate-400 flex-shrink-0" />}
    </div>
    {(listEmpSearchData as any)?.data?.length > 0 && !listEmpId && (
      <div className="rounded-xl border shadow-sm bg-white max-h-48 overflow-y-auto divide-y">
        {((listEmpSearchData as any).data as Employee[]).map((e: Employee) => (
          <button
            key={e.id}
            type="button"
            className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 transition-colors"
            onClick={() => {
              setListEmpId(e.id);
              setListEmpSearch(`${e.first_name} ${e.last_name} (${e.employee_code})`);
              setFetchEmpId(e.id);
            }}
          >
            <span className="font-medium">{e.first_name} {e.last_name}</span>
            <span className="ml-2 text-slate-400 text-xs">{e.employee_code}</span>
          </button>
        ))}
      </div>
    )}
    {listEmpId && (
      <p className="text-xs text-emerald-700 font-medium">Employee selected — letters shown below.</p>
    )}
  </div>
  ```

  Note: `listEmpSearchData` is typed as `unknown` from hrmsApi. The cast `(listEmpSearchData as any)?.data` is safe here — same pattern used throughout the app.

- [ ] **Step 5: TypeScript check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: exits 0.

- [ ] **Step 6: Manual smoke test**

  Open `/offer-letter`, go to "Generated Letters" tab. Type 2+ characters of an employee's name. Dropdown should appear. Click an employee — letters for that employee load. No UUID pasting required.

- [ ] **Step 7: Commit**

  ```bash
  git add src/pages/NativeOfferLetterGeneration.tsx
  git commit -m "fix(offer-letter): replace UUID input with employee search combobox in Generated Letters tab"
  ```

---

## Task 6: Fix `NativeJoiningControlRoom.tsx` — Fake Tasks, Links, Anchors

**Files:**
- Modify: `src/pages/NativeJoiningControlRoom.tsx`

**Bugs fixed:**
- Bug 6: Remove 4 hardcoded fallback provisioning tasks
- Bug 7: Replace 4 broken provisioning `<a href>` with 2 `<Link>` buttons
- Bug 8: Replace `<a href="/ats/onboarding-requests">` with `<Link>` in 2 places

- [ ] **Step 1: Add `Link` import**

  In `src/pages/NativeJoiningControlRoom.tsx`, add `Link` to the react-router-dom import. Check if `react-router-dom` is already imported. If it is, add `Link` to the existing destructure. If not, add:

  ```tsx
  import { Link } from "react-router-dom";
  ```

  This import goes after the existing React import line.

- [ ] **Step 2: Fix the `<a href="/ats/onboarding-requests">` links**

  There are two bare anchor links pointing to `/ats/onboarding-requests` (around lines 464 and 473). Both are inside the offer display section. Replace each:

  **Occurrence 1** (plain link with no special class beyond `text-blue-600 hover:underline`):
  ```tsx
  // BEFORE:
  <a href="/ats/onboarding-requests" className="text-blue-600 hover:underline">Onboarding Requests</a>

  // AFTER:
  <Link to="/ats/onboarding-requests" className="text-blue-600 hover:underline">Onboarding Requests</Link>
  ```

  **Occurrence 2** (link with `font-medium underline`):
  ```tsx
  // BEFORE:
  <a href="/ats/onboarding-requests" className="font-medium underline">Onboarding Requests</a>

  // AFTER:
  <Link to="/ats/onboarding-requests" className="font-medium underline">Onboarding Requests</Link>
  ```

- [ ] **Step 3: Remove fake fallback provisioning tasks**

  Find the provisioning task rendering block (around lines 596–604) which currently reads:

  ```tsx
  {(detail.provisioningTasks?.length ? detail.provisioningTasks : [
    { task_code: "WFM_PROCESS_ALIGNMENT", task_label: "WFM Process Alignment", assigned_role: "wfm", status: "pending" },
    { task_code: "IT_EMAIL_DOMAIN_ASSET", task_label: "IT Email, Domain & Asset", assigned_role: "it", status: "pending" },
    { task_code: "ADMIN_BIOMETRIC_ID_CARD", task_label: "Admin Biometric & ID Card", assigned_role: "admin", status: "pending" },
    { task_code: "APPOINTMENT_LETTER_ESIGN", task_label: "Appointment Letter E-Sign", assigned_role: "hr", status: "pending" },
  ]).map((task) => (
    <ProvisioningTaskCard key={task.task_code} task={task} />
  ))}
  ```

  Replace with:

  ```tsx
  {detail.provisioningTasks?.length ? (
    detail.provisioningTasks.map((task) => (
      <ProvisioningTaskCard key={task.task_code} task={task} />
    ))
  ) : (
    <div className="col-span-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
      Provisioning tasks are being dispatched — refresh in a moment.
    </div>
  )}
  ```

- [ ] **Step 4: Replace 4 broken provisioning `<a href>` buttons with 2 `<Link>` buttons**

  Find the provisioning quick-links block (around lines 605–618):

  ```tsx
  <div className="flex flex-wrap gap-2">
    <Button type="button" variant="outline" size="sm" asChild>
      <a href="/provisioning/it"><Server className="mr-2 h-4 w-4" />IT Provisioning</a>
    </Button>
    <Button type="button" variant="outline" size="sm" asChild>
      <a href="/provisioning/admin"><ShieldCheck className="mr-2 h-4 w-4" />Admin Provisioning</a>
    </Button>
    <Button type="button" variant="outline" size="sm" asChild>
      <a href="/provisioning/wfm-alignment"><Clock className="mr-2 h-4 w-4" />WFM Alignment</a>
    </Button>
    <Button type="button" variant="outline" size="sm" asChild>
      <a href="/provisioning/appointment-letter"><FileText className="mr-2 h-4 w-4" />Appointment Letters</a>
    </Button>
  </div>
  ```

  Replace with:

  ```tsx
  <div className="flex flex-wrap gap-2">
    <Button type="button" variant="outline" size="sm" asChild>
      <Link to="/ats/joining-documents-tracker"><FileText className="mr-2 h-4 w-4" />Joining Documents Tracker</Link>
    </Button>
    <Button type="button" variant="outline" size="sm" asChild>
      <Link to="/ats/bgv"><ShieldCheck className="mr-2 h-4 w-4" />Open BGV Center</Link>
    </Button>
  </div>
  ```

- [ ] **Step 5: TypeScript check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: exits 0.

- [ ] **Step 6: Manual smoke test**

  Open `/ats/joining-control-room`. Select a candidate without a provisioning task dispatched. Confirm the provisioning tab shows the informational banner ("Provisioning tasks are being dispatched — refresh in a moment.") instead of 4 fake pending task cards. Confirm the two new Link buttons navigate in-app without page reload.

- [ ] **Step 7: Commit**

  ```bash
  git add src/pages/NativeJoiningControlRoom.tsx
  git commit -m "fix(jcr): remove fake provisioning tasks; fix quick-links to use react-router Link"
  ```

---

## Task 7: Fix `JoiningDocumentsTrackerPage.tsx` — Bulk Download Auth + HR Assign Select

**Files:**
- Modify: `src/pages/JoiningDocumentsTrackerPage.tsx`

**Bugs fixed:**
- Bug 9: Bulk download auth — replace `getAccessToken?.()` with `getAuthToken()` from hrmsApi
- Bug 10: Assign HR modal — replace raw UUID text input with a select dropdown from employee API

- [ ] **Step 1: Add `getAuthToken` import**

  In `src/pages/JoiningDocumentsTrackerPage.tsx`, the hrmsApi import line is:
  ```tsx
  import { hrmsApi } from "@/lib/hrmsApi";
  ```

  Change it to:
  ```tsx
  import { hrmsApi, getAuthToken } from "@/lib/hrmsApi";
  ```

- [ ] **Step 2: Remove `getAccessToken` from the `useAuth` destructure**

  Find:
  ```tsx
  const { getAccessToken } = useAuth();
  ```

  Check whether `useAuth` is used for anything else in the file. If `getAccessToken` is the only destructured value, replace the line with a comment-removal (delete the line entirely). If `useAuth` destructures other values (e.g., `user`), keep those and remove only `getAccessToken`.

  Based on the code read earlier, only `getAccessToken` is destructured at line 70. Delete that line:
  ```tsx
  // DELETE this line:
  const { getAccessToken } = useAuth();
  ```

  If `useAuth` import is now unused after removing `getAccessToken`, remove the import too:
  ```tsx
  // DELETE if now unused:
  import { useAuth } from "@/contexts/AuthContext";
  ```

- [ ] **Step 3: Fix the bulk download handler**

  Find `handleBulkDownload` (around lines 184–205). Replace the auth token retrieval from:
  ```tsx
  const token = getAccessToken?.();
  ```
  with:
  ```tsx
  const token = getAuthToken();
  ```

  The rest of the handler (the fetch call, blob handling, toast) remains unchanged. Only this one line changes.

- [ ] **Step 4: Add HR list query for the Assign HR modal**

  After the existing `bulkAssignMutation` definition, add a query for HR users:

  ```tsx
  const { data: hrUsersData } = useQuery({
    queryKey: ['hr-users-for-assign'],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; employee_code: string; first_name: string; last_name: string }> }>('/api/employees?role=hr&limit=50'),
    staleTime: 60_000,
  });
  const hrUsers = (hrUsersData as any)?.data ?? [];
  ```

- [ ] **Step 5: Replace the UUID input in the Assign HR modal with a select**

  Find the Assign HR modal content (around lines 518–529):

  ```tsx
  <div className="space-y-4">
    <div>
      <Label htmlFor="hrUserId">HR User ID</Label>
      <Input
        id="hrUserId"
        placeholder="Enter HR user ID..."
        value={assignedHrUserId}
        onChange={e => setAssignedHrUserId(e.target.value)}
        className="mt-1"
      />
    </div>
  </div>
  ```

  Replace with:

  ```tsx
  <div className="space-y-4">
    <div>
      <Label htmlFor="hrUserId">Assign HR User</Label>
      <select
        id="hrUserId"
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm mt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={assignedHrUserId}
        onChange={e => setAssignedHrUserId(e.target.value)}
      >
        <option value="">— Select HR —</option>
        {hrUsers.map((u: { id: string; employee_code: string; first_name: string; last_name: string }) => (
          <option key={u.id} value={u.id}>
            {u.first_name} {u.last_name} ({u.employee_code})
          </option>
        ))}
      </select>
    </div>
  </div>
  ```

  The `bulkAssignMutation.mutate(...)` call (which uses `assignedHrUserId`) at line 533 remains unchanged — it will now receive the selected UUID from the dropdown.

- [ ] **Step 6: TypeScript check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: exits 0. If `useAuth` import removal causes an error (e.g., it was also used for `user`), keep the import but only remove `getAccessToken` from the destructure.

- [ ] **Step 7: Manual smoke test**

  Open `/ats/joining-documents-tracker`. Select employees, click "Assign HR" — dropdown should show HR users by name and code. Select employee(s), click "Bulk Download" — no auth error, download starts.

- [ ] **Step 8: Commit**

  ```bash
  git add src/pages/JoiningDocumentsTrackerPage.tsx
  git commit -m "fix(joining-docs-tracker): fix bulk-download auth; replace UUID input with HR user select"
  ```

---

## Task 8: Redirect `/provisioning/appointment-letter` in Route Config

**Files:**
- Modify: `src/config/routes/compliance.routes.tsx`

**Change:** `/provisioning/appointment-letter` now navigates to `/ats/joining-control-room`. The appointment letter signing queue is already accessible from the JCR. This alias route is unused by normal navigation.

- [ ] **Step 1: Add `Navigate` import**

  In `src/config/routes/compliance.routes.tsx`, the react-router-dom import line is:
  ```tsx
  import { Route } from "react-router-dom";
  ```

  Change to:
  ```tsx
  import { Route, Navigate } from "react-router-dom";
  ```

- [ ] **Step 2: Replace the appointment-letter route**

  Find:
  ```tsx
  <Route path="/provisioning/appointment-letter" element={<ProtectedRoute roles={['hr','admin','super_admin']}><Gate pageCode="PROVISIONING_APPOINTMENT_LETTER"><NativeITProvisioningTracker /></Gate></ProtectedRoute>} />
  ```

  Replace with:
  ```tsx
  <Route path="/provisioning/appointment-letter" element={<Navigate to="/ats/joining-control-room" replace />} />
  ```

  **Important:** Do NOT remove the `NativeITProvisioningTracker` lazy import — it is still used by the four other routes in this file (`/it-provisioning`, `/provisioning/wfm-alignment`, `/provisioning/it`, `/provisioning/admin`).

- [ ] **Step 3: TypeScript check**

  ```bash
  npx tsc --noEmit
  ```
  Expected: exits 0.

- [ ] **Step 4: Verify diff is minimal**

  ```bash
  git diff src/config/routes/compliance.routes.tsx
  ```
  Expected: exactly 2 changed lines — the import and the one route element. The `NativeITProvisioningTracker` import line is untouched.

- [ ] **Step 5: Manual smoke test**

  Navigate to `/provisioning/appointment-letter` in the browser. Should redirect instantly to `/ats/joining-control-room`.

- [ ] **Step 6: Commit**

  ```bash
  git add src/config/routes/compliance.routes.tsx
  git commit -m "fix(routes): redirect /provisioning/appointment-letter to /ats/joining-control-room"
  ```

---

## Final Verification

After all 8 tasks are committed:

- [ ] **Full TypeScript check (both frontend and backend)**

  ```bash
  npx tsc --noEmit && echo "Frontend OK" && cd backend && npx tsc --noEmit && echo "Backend OK"
  ```
  Expected: both print "OK" with no errors.

- [ ] **Run contract tests**

  ```bash
  npx vitest run src/tests/app-shell-routing.contract.test.ts src/tests/rbac-page-matrix.test.ts src/tests/page-catalog-route-drift.contract.test.ts
  ```
  Expected: all pass. If any fail due to route changes (redirect tests), update the test expectation for `/ats/bgv-report` to confirm redirect to `/ats/bgv`.

- [ ] **End-to-end flow check**

  Walk through the ATS pipeline:
  1. `/ats/offer-approvals` — log in as `hr` role, confirm pending offers load (no 403)
  2. `/offer-letter` → Generated Letters tab — search by name, no UUID paste required
  3. `/ats/joining-control-room` — provisioning tab shows banner when no tasks dispatched; quick-links use react-router navigation
  4. `/ats/bgv` — Tab 1 shows queue, Tab 2 shows BGV report form for selected candidate, no alert() dialogs
  5. `/ats/bgv-report` — redirects to `/ats/bgv`
  6. `/provisioning/appointment-letter` — redirects to `/ats/joining-control-room`
  7. `/ats/joining-documents-tracker` — Assign HR dropdown shows HR users by name; bulk download works

- [ ] **Push to main (after user approval)**

  ```bash
  git fetch
  git log origin/main -1 --oneline
  # Confirm our commits are ahead of origin/main, not diverged
  git push origin HEAD:main
  git merge-base --is-ancestor HEAD origin/main && echo "confirmed on main"
  ```
