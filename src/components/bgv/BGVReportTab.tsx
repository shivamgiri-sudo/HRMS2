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
  Briefcase, MapPin, Fingerprint, Download,
  Send, ExternalLink, RefreshCw,
} from 'lucide-react';
import { formatIST, formatISTDate } from '@/lib/utils';
import { downloadBGVReportPDF, fetchDigilockerPhotoBase64 } from '@/lib/bgvReportPdfGenerator';
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
  // Recovered DigiLocker Aadhaar face photo — thumbnail next to the
  // Photograph checklist row, and reused for the PDF export below. Not every
  // candidate has completed DigiLocker, so this can stay undefined.
  const [digilockerPhoto, setDigilockerPhoto] = useState<string | undefined>(undefined);

  const loadReport = useCallback(async (id: string) => {
    setLoading(true);
    try {
      // Auto-sync check results into report before loading so statuses are always fresh
      await hrmsApi.post('/api/ats/bgv/sync-report', { candidate_id: id }).catch(() => {});
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

  useEffect(() => {
    if (!candidateId) { setDigilockerPhoto(undefined); return; }
    void fetchDigilockerPhotoBase64(candidateId).then(setDigilockerPhoto);
  }, [candidateId]);

  // Score and overall_status are no longer computed client-side: the backend
  // (computeAndSaveScore, called on every save) is the one canonical formula, so
  // there is nothing here for a local copy to drift from any more. Editing a check
  // field just updates that field; the score/status shown stay as last returned by
  // the server until the next save/sync refreshes them.
  const setF = (key: keyof BGVReport, value: unknown) => {
    setReport(p => (p ? { ...p, [key]: value } : p));
  };

  const saveReport = async (lock = false) => {
    if (!report) return;
    setSaving(true);
    try {
      await hrmsApi.post('/api/ats/bgv/report', { ...report, locked: lock || report.locked });
      // The server recomputes bgv_score and overall_status from the fields just
      // saved (and, for locked, freezes them) — refetch so what's on screen is the
      // real persisted verdict, not whatever was in `report` before the save.
      const r = await hrmsApi.get<any>(`/api/ats/bgv/report?candidateId=${candidateId}`);
      if (r?.data) setReport(r.data);
      if (lock) {
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

  /** The only overall_status a user may set directly: an explicit hard-reject. */
  const markNegative = async () => {
    if (!report) return;
    setF('overall_status', 'negative');
    setSaving(true);
    try {
      await hrmsApi.post('/api/ats/bgv/report', { ...report, overall_status: 'negative', locked: report.locked });
      const r = await hrmsApi.get<any>(`/api/ats/bgv/report?candidateId=${candidateId}`);
      if (r?.data) setReport(r.data);
      toast({ title: 'Marked NEGATIVE', description: 'This candidate is blocked from appointment letter issuance.' });
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
      await downloadBGVReportPDF({ ...fullData.data, digilockerPhotoBase64: digilockerPhoto });
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
          {/* The full report page had a route but no link anywhere in the app,
              so it could only be reached by typing a candidate UUID into the
              address bar. */}
          <Button variant="outline" onClick={() => window.open(`/bgv-report-view/${candidateId}`, '_blank')}>
            <FileText className="w-4 h-4 mr-1" /> View Full Report
          </Button>
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
                {key === 'photo_received' && digilockerPhoto && (
                  <img
                    src={digilockerPhoto}
                    alt="DigiLocker Aadhaar photo"
                    title="Recovered DigiLocker Aadhaar photo"
                    className="w-6 h-6 rounded object-cover border border-slate-300 ml-1"
                  />
                )}
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
              <Label>Overall Status (auto-computed)</Label>
              <div className="mt-2 flex items-center gap-3 flex-wrap">
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${statusBadge[report.overall_status]}`}>
                  {report.overall_status.toUpperCase()}
                </span>
                {!report.locked && report.overall_status !== 'negative' && (
                  <Button type="button" size="sm" variant="outline"
                    className="border-red-300 text-red-700 hover:bg-red-50"
                    disabled={saving} onClick={() => void markNegative()}>
                    Mark NEGATIVE (hard reject)
                  </Button>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Computed from the checks above — CLEAR requires every applicable category verified/waived
                (DigiLocker covers Aadhaar + PAN). REFER means a category came back mismatched/failed.
                NEGATIVE is the one status a person sets directly, to hard-block appointment letter issuance.
              </p>
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
