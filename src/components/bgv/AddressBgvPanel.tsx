import { useCallback, useEffect, useState } from 'react';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RefreshCw, MapPin } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

/**
 * Compact Address-BGV panel for Payroll HR, embedded in the Joining Control
 * Room's BGV tab. Address has no automated verification provider (unlike
 * Aadhaar/PAN/Bank/Criminal, which BEFISC/Luckpay/Crimescan cover) — it is
 * Payroll HR's own read of the candidate's address proof, entered here
 * instead of requiring a trip to the separate ATS BGV Verification Center.
 *
 * Saving re-runs the backend's canonical computeAndSaveScore, which folds
 * this manual field into the score and the auto-derived overall_status —
 * so once Address (and every other applicable category) reads clear, the
 * candidate becomes eligible for appointment letter issuance without any
 * further step here.
 */

type VerifStatus = 'not_run' | 'passed' | 'failed' | 'partial';
type OverallStatus = 'pending' | 'in_progress' | 'clear' | 'refer' | 'negative';

interface BGVReportLite {
  candidate_id: string;
  address_status: VerifStatus;
  address_remarks: string;
  digilocker_status?: VerifStatus;
  overall_status: OverallStatus;
  bgv_score: number;
  locked: boolean;
  [key: string]: unknown;
}

const overallBadge: Record<OverallStatus, string> = {
  pending: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-blue-700',
  clear: 'bg-emerald-100 text-emerald-700',
  refer: 'bg-amber-100 text-amber-700',
  negative: 'bg-red-100 text-red-700',
};

const STATUS_OPTIONS: VerifStatus[] = ['not_run', 'passed', 'failed', 'partial'];

export function AddressBgvPanel({ candidateId }: { candidateId?: string | null }) {
  const { toast } = useToast();
  const [report, setReport] = useState<BGVReportLite | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addressStatus, setAddressStatus] = useState<VerifStatus>('not_run');
  const [addressRemarks, setAddressRemarks] = useState('');

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const r = await hrmsApi.get<any>(`/api/ats/bgv/report?candidateId=${id}`);
      const data: BGVReportLite | null = r?.data ?? null;
      setReport(data);
      setAddressStatus((data?.address_status as VerifStatus) ?? 'not_run');
      setAddressRemarks(data?.address_remarks ?? '');
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!candidateId) { setReport(null); return; }
    void load(candidateId);
  }, [candidateId, load]);

  const saveAddress = async () => {
    if (!candidateId || !report) return;
    setSaving(true);
    try {
      // POST /report is a full-row upsert — send the existing report back with
      // only the address fields changed, exactly like the full BGV Report Tab does.
      await hrmsApi.post('/api/ats/bgv/report', {
        ...report,
        address_status: addressStatus,
        address_remarks: addressRemarks,
      });
      await load(candidateId);
      toast({ title: 'Address BGV status saved', description: 'Overall BGV status recomputed from all checks.' });
    } catch (e: any) {
      toast({ title: 'Save failed', description: e?.message ?? 'Unknown error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!candidateId) {
    return <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 text-sm text-slate-500">No candidate selected.</div>;
  }
  if (loading) {
    return <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 text-sm text-slate-500">Loading BGV report…</div>;
  }
  if (!report) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        No BGV report exists yet for this candidate. Initiate BGV from the{' '}
        <a href="/ats/bgv" className="font-medium underline">BGV Verification Center</a> first.
      </div>
    );
  }

  const digilockerCovers = report.digilocker_status === 'passed';

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-500">Overall BGV Status (auto-computed)</div>
          <div className="mt-2 flex items-center gap-2">
            <span className={`text-sm font-bold px-3 py-1 rounded-full ${overallBadge[report.overall_status]}`}>
              {report.overall_status.toUpperCase()}
            </span>
            <span className="text-sm text-slate-500">Score: {report.bgv_score}/100</span>
          </div>
          {report.overall_status === 'clear' ? (
            <p className="mt-2 text-xs text-emerald-700">BGV is clear — this no longer blocks appointment letter issuance.</p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              Recomputed automatically from every applicable check — not a status you pick.
            </p>
          )}
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-500">Aadhaar / PAN</div>
          <div className="mt-2 text-sm text-slate-700">
            {digilockerCovers
              ? 'Covered via DigiLocker eKYC — manual Aadhaar/PAN verification not required.'
              : 'Not covered via DigiLocker. Run Aadhaar/PAN verification from the BGV Verification Center.'}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 font-semibold text-slate-900">
          <MapPin className="h-4 w-4" /> Address Verification
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Address has no automated verification provider — record Payroll HR's own read of the
          candidate's address proof here.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Address Status">
            <select
              disabled={report.locked || saving}
              className="w-full border rounded px-2 py-1.5 text-sm bg-background disabled:opacity-60"
              value={addressStatus}
              onChange={(e) => setAddressStatus(e.target.value as VerifStatus)}
            >
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label="Remarks">
            <Textarea
              disabled={report.locked || saving}
              value={addressRemarks}
              onChange={(e) => setAddressRemarks(e.target.value)}
              placeholder="Address verification notes…"
              rows={2}
            />
          </Field>
        </div>
        {report.locked ? (
          <p className="mt-3 text-xs font-medium text-amber-700">This BGV report is finalised and locked; address status can no longer be changed here.</p>
        ) : (
          <Button type="button" size="sm" className="mt-3" disabled={saving} onClick={() => void saveAddress()}>
            {saving ? <RefreshCw className="mr-2 h-3 w-3 animate-spin" /> : null}
            Save Address Verification
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
