import { useState, useEffect, useCallback } from 'react';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Shield, CheckCircle2, XCircle, Clock, AlertTriangle,
  FileText, Lock, User, Banknote, GraduationCap,
  Briefcase, MapPin, Fingerprint, Search, Download,
  Send, ExternalLink, RefreshCw,
} from 'lucide-react';
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

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
  // Document checklist
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
  // Verification results
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
  esignature_status: 'not_done' | 'validated' | 'invalid';
  esignature_remarks: string;
  overall_status: OverallStatus;
  bgv_score: number;
  hr_remarks: string;
  completed_by?: string;
  completed_at?: string;
  locked: boolean;
  // InfinitiAI portal initiation fields
  infinity_ai_case_id?: string;
  portal_initiated_at?: string;
  portal_candidate_email?: string;
  portal_login_url?: string;
  portal_status?: 'not_initiated' | 'initiated' | 'candidate_submitted' | 'completed' | 'expired';
}

interface CandidateSummary {
  id: string; candidate_code: string; full_name: string; mobile: string;
  email: string; branch_name: string; process_name: string; profile_status: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const statusColor: Record<VerifStatus | OverallStatus, string> = {
  not_run: 'text-slate-400',
  passed:  'text-emerald-600',
  failed:  'text-red-600',
  partial: 'text-amber-600',
  pending: 'text-slate-500',
  in_progress: 'text-blue-600',
  clear:    'text-emerald-600',
  refer:    'text-amber-600',
  negative: 'text-red-600',
};

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
  if (status === 'passed' || status === 'clear')
    return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (status === 'failed' || status === 'negative')
    return <XCircle className="w-4 h-4 text-red-500" />;
  if (status === 'partial' || status === 'refer')
    return <AlertTriangle className="w-4 h-4 text-amber-500" />;
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
    esignature_status: 'not_done', esignature_remarks: '',
    overall_status: 'pending', bgv_score: 0, hr_remarks: '',
    locked: false,
  };
}

// Auto-compute score from individual statuses
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

// ── Main Component ─────────────────────────────────────────────────────────────

export default function NativeBGVReport() {
  const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CandidateSummary | null>(null);
  const [report, setReport] = useState<BGVReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState('');
  const [initiatingPortal, setInitiatingPortal] = useState(false);
  const [search, setSearch] = useState('');

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await hrmsApi.get<unknown>('/api/ats/onboarding/requests');
      const arr = Array.isArray(r) ? r : Array.isArray((r as any)?.data) ? (r as any).data : [];
      setCandidates(arr.filter((c: any) => c.profile_status === 'profile_submitted' || c.profile_status === 'approved' || c.profile_status === 'onboarded'));
    } catch { setCandidates([]); } finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  const openCandidate = async (c: CandidateSummary) => {
    setSelected(c);
    try {
      const r = await hrmsApi.get<any>(`/api/ats/bgv/report?candidateId=${c.id}`);
      setReport(r?.data ?? emptyReport(c.id));
    } catch {
      setReport(emptyReport(c.id));
    }
  };

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
        alert('BGV report has been locked as audit evidence.');
      } else {
        alert('BGV report saved.');
      }
    } catch (e: any) {
      alert(e?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const triggerVerify = async (checkType: string) => {
    if (!selected || !report) return;
    setVerifying(checkType);
    try {
      await hrmsApi.post(`/api/ats/bgv/verify/${checkType}`, {
        candidateId: selected.id,
        token: null, // HR-initiated — backend resolves token from candidateId
      });
      // Reload report after verification
      const r = await hrmsApi.get<any>(`/api/ats/bgv/report?candidateId=${selected.id}`);
      if (r?.data) setReport(r.data);
    } catch (e: any) {
      alert(`Verification failed: ${e?.message ?? 'Unknown error'}`);
    } finally {
      setVerifying('');
    }
  };

  const initiatePortal = async () => {
    if (!selected) return;
    const confirmed = window.confirm(
      `Initiate BGV via InfinitiAI for ${selected.full_name}?\n\n` +
      `This will create the candidate on the InfinitiAI portal and send them a login email at ${selected.email}.\n` +
      `They will have 7 days to fill the BGV form and upload documents.`
    );
    if (!confirmed) return;
    setInitiatingPortal(true);
    try {
      const r = await hrmsApi.post<any>('/api/ats/bgv/report/initiate-portal', { candidate_id: selected.id });
      const data = r?.data ?? r;
      // Reload the report to show portal status
      const fresh = await hrmsApi.get<any>(`/api/ats/bgv/report?candidateId=${selected.id}`);
      if (fresh?.data) setReport(fresh.data);
      alert(
        `BGV portal initiated!\n\n` +
        `Case ID: ${data?.caseId ?? '—'}\n` +
        `Candidate email: ${data?.candidateEmail ?? selected.email}\n` +
        `Portal link: ${data?.portalLoginUrl ?? '—'}\n\n` +
        `The candidate will receive a login email shortly.`
      );
    } catch (e: any) {
      alert(`Failed to initiate BGV portal: ${e?.message ?? 'Unknown error'}`);
    } finally {
      setInitiatingPortal(false);
    }
  };

  const exportPDF = () => {
    window.print();
  };

  const filtered = candidates.filter(c =>
    !search || c.full_name.toLowerCase().includes(search.toLowerCase()) ||
    c.candidate_code.toLowerCase().includes(search.toLowerCase())
  );

  // ── Candidate List View ─────────────────────────────────────────────────────
  if (!selected) return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">BGV — Background Verification</h1>
          <p className="text-slate-500 text-sm">Manage and generate BGV reports for onboarded candidates</p>
        </div>
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-400" />
          <Input placeholder="Search by name or code…" value={search} onChange={e => setSearch(e.target.value)} className="w-64" />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" /></div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>{['Code', 'Name', 'Branch', 'Process', 'Status', 'Action'].map(h => <th key={h} className="px-4 py-3 text-left font-semibold text-slate-600">{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-b hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.candidate_code}</td>
                  <td className="px-4 py-3 font-semibold">{c.full_name}</td>
                  <td className="px-4 py-3 text-slate-600">{c.branch_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{c.process_name || '—'}</td>
                  <td className="px-4 py-3"><Badge className="text-xs">{c.profile_status}</Badge></td>
                  <td className="px-4 py-3">
                    <Button size="sm" onClick={() => void openCandidate(c)}>
                      <Shield className="w-3 h-3 mr-1" /> Open BGV
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <p className="text-center text-slate-400 py-10">No candidates found.</p>}
        </div>
      )}
    </div>
  );

  if (!report) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" /></div>;

  // ── BGV Report View ─────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 print:p-0">

      {/* Header */}
      <div className="flex items-start justify-between print:hidden">
        <Button variant="outline" onClick={() => setSelected(null)}>← Back</Button>
        <div className="flex gap-2 flex-wrap justify-end">
          {/* InfinitiAI portal initiation */}
          {(!report.portal_status || report.portal_status === 'not_initiated' || report.portal_status === 'expired') && !report.locked && (
            <Button variant="outline" onClick={() => void initiatePortal()} disabled={initiatingPortal}
              className="border-indigo-300 text-indigo-700 hover:bg-indigo-50">
              {initiatingPortal
                ? <><RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Initiating…</>
                : <><Send className="w-4 h-4 mr-1" /> Initiate BGV (InfinitiAI)</>}
            </Button>
          )}
          <Button variant="outline" onClick={exportPDF}><Download className="w-4 h-4 mr-1" /> Export PDF</Button>
          {!report.locked && <Button variant="outline" onClick={() => void saveReport(false)} disabled={saving}>Save Draft</Button>}
          {!report.locked && (
            <Button onClick={() => void saveReport(true)} disabled={saving} className="bg-slate-900 text-white hover:bg-slate-700">
              <Lock className="w-4 h-4 mr-1" /> Finalise &amp; Lock
            </Button>
          )}
          {report.locked && <Badge className="bg-slate-900 text-white px-4 py-2 text-sm"><Lock className="w-3 h-3 mr-1" /> Locked</Badge>}
        </div>
      </div>

      {/* Report header */}
      <div className="rounded-3xl bg-gradient-to-br from-slate-900 to-slate-700 text-white p-8 print:rounded-none print:bg-white print:text-black">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-slate-300 print:text-slate-600">Background Verification Report</p>
            <h2 className="text-3xl font-black mt-2">{selected.full_name}</h2>
            <p className="text-slate-300 mt-1 print:text-slate-600">{selected.candidate_code} &nbsp;·&nbsp; {selected.branch_name} &nbsp;·&nbsp; {selected.process_name}</p>
          </div>
          <div className="text-right">
            <div className={`text-5xl font-black ${report.bgv_score >= 80 ? 'text-emerald-400' : report.bgv_score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
              {report.bgv_score}
              <span className="text-2xl text-slate-300">/100</span>
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

      {/* InfinitiAI portal status card */}
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
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Case ID</p>
              <p className="text-sm font-mono text-slate-700">{report.infinity_ai_case_id ?? '—'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Candidate Email</p>
              <p className="text-sm text-slate-700">{report.portal_candidate_email ?? '—'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Initiated At</p>
              <p className="text-sm text-slate-700">
                {report.portal_initiated_at ? formatIST(report.portal_initiated_at) : '—'}
              </p>
            </div>
            {report.portal_login_url && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Portal Login URL</p>
                <a href={report.portal_login_url} target="_blank" rel="noopener noreferrer"
                  className="text-sm text-indigo-600 hover:underline flex items-center gap-1 break-all">
                  {report.portal_login_url}
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              </div>
            )}
            {report.portal_status === 'initiated' && (
              <div className="md:col-span-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                Awaiting candidate to fill the BGV form at the InfinitiAI portal. They received a login email with the link above.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Document checklist + box file */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> Physical Document Checklist</CardTitle>
          <p className="text-sm text-slate-500">HR confirms receipt of physical copies of these documents</p>
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
            <p className="text-xs text-slate-400 mt-1">Physical box file reference where documents are stored</p>
          </div>
        </CardContent>
      </Card>

      {/* Verification checks */}
      {([
        { key: 'aadhaar', label: 'Aadhaar Verification', icon: <Fingerprint className="w-5 h-5" />, matchKey: 'aadhaar_name_match', remarksKey: 'aadhaar_remarks', apiType: 'aadhaar-offline', weight: 25 },
        { key: 'pan', label: 'PAN Verification', icon: <CreditCard className="w-5 h-5" />, matchKey: 'pan_name_match', remarksKey: 'pan_remarks', apiType: 'pan', weight: 20 },
        { key: 'bank', label: 'Bank Account Verification', icon: <Banknote className="w-5 h-5" />, matchKey: 'bank_account_match', remarksKey: 'bank_remarks', apiType: 'bank', weight: 15 },
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
                  {check.apiType && !report.locked && (
                    <Button size="sm" variant="outline" disabled={verifying === check.apiType}
                      onClick={() => void triggerVerify(check.apiType!)}>
                      {verifying === check.apiType ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" /> : 'Run API Check'}
                    </Button>
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> E-Signature Validation</CardTitle>
        </CardHeader>
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

      {/* Overall verdict */}
      <Card className="border-2 border-slate-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="w-5 h-5" /> Final BGV Verdict</CardTitle>
        </CardHeader>
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
              <p className="text-xs text-slate-400 mt-1">
                CLEAR = proceed to payroll activation · REFER = escalate to manager · NEGATIVE = revoke offer
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
              rows={4} placeholder="Summarise the BGV findings, any exceptions, or conditions for clearance…" />
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

// CreditCard icon inline since it's not imported above
function CreditCard({ className }: { className: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}
