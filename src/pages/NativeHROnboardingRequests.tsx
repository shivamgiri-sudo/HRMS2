import { useState, useEffect, useCallback } from 'react';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

interface OnboardingRequest {
  id: string;
  status: string;
  candidate_id: string;
  candidate_code: string;
  full_name: string;
  mobile: string;
  email: string;
  profile_status: string;
  branch_name: string;
  offer_id?: string;
  offer_status?: string;
  offered_ctc?: number;
}

interface SalaryPreview {
  gross: number;
  basic: number;
  hra: number;
  net_in_hand: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
  bonus: number;
  conveyance: number;
}

const BANDS = ['D', 'C', 'B', 'A', 'M'];

function rowsFrom(payload: unknown): OnboardingRequest[] {
  if (Array.isArray(payload)) return payload as OnboardingRequest[];
  if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as OnboardingRequest[];
  }
  return [];
}

export default function NativeHROnboardingRequests() {
  const [rows, setRows] = useState<OnboardingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OnboardingRequest | null>(null);
  const [salaryPreview, setSalaryPreview] = useState<SalaryPreview | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [offer, setOffer] = useState({
    emp_type: 'OnRoll',
    date_of_joining: '',
    date_of_salary: '',
    profile: '',
    cost_centre: '',
    role_type: 'Analyst',
    salary_band: 'D',
    offered_ctc: '',
    department_id: '',
    designation_id: '',
    reporting_manager_id: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await hrmsApi.get<unknown>('/api/ats/onboarding/requests');
      setRows(rowsFrom(r));
    } catch (error: any) {
      alert(error?.message ?? 'Failed to load onboarding requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const calcSalary = async () => {
    if (!offer.offered_ctc || !offer.salary_band) return;
    setCalcLoading(true);
    try {
      const r = await hrmsApi.post<{ components?: SalaryPreview }>('/api/ats/onboarding/calculate-salary', {
        ctc: Number(offer.offered_ctc) * 12, // input as monthly CTC, API takes annual
        bandCode: offer.salary_band,
      });
      setSalaryPreview(r.components ?? null);
    } catch (error: any) {
      alert(error?.message ?? 'Failed to calculate salary');
    } finally {
      setCalcLoading(false);
    }
  };

  const submitOffer = async (submit: boolean) => {
    if (!selected) return;
    setSaving(true);
    try {
      await hrmsApi.post(`/api/ats/onboarding/requests/${selected.id}/offer`, {
        ...offer,
        offered_ctc: Number(offer.offered_ctc) * 12, // store annual
        submit,
      });
      await load();
      setSelected(null);
      setSalaryPreview(null);
    } catch (e: any) {
      alert(e?.message ?? 'Failed to save offer');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin" />
    </div>
  );

  if (selected) return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <Button variant="outline" onClick={() => { setSelected(null); setSalaryPreview(null); }}>← Back to Requests</Button>
      <Card>
        <CardHeader>
          <CardTitle>Employment Offer — {selected.full_name}</CardTitle>
          <p className="text-sm text-muted-foreground">{selected.candidate_code} | {selected.mobile} | {selected.email}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {[
            { label: 'Employment Type', key: 'emp_type', type: 'select', options: ['OnRoll', 'OffRoll'] },
            { label: 'Date of Joining *', key: 'date_of_joining', type: 'date' },
            { label: 'Date of Salary Start', key: 'date_of_salary', type: 'date' },
            { label: 'Profile / Designation Title', key: 'profile', type: 'text' },
            { label: 'Cost Centre', key: 'cost_centre', type: 'text' },
            { label: 'Role Type', key: 'role_type', type: 'select', options: ['Analyst', 'SupportStaff'] },
            { label: 'Salary Band', key: 'salary_band', type: 'select', options: BANDS },
            { label: 'Monthly CTC (₹) *', key: 'offered_ctc', type: 'number' },
          ].map(f => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              {f.type === 'select' ? (
                <select
                  className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background"
                  value={(offer as any)[f.key]}
                  onChange={e => setOffer(p => ({ ...p, [f.key]: e.target.value }))}
                >
                  {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <Input
                  type={f.type}
                  value={(offer as any)[f.key]}
                  onChange={e => setOffer(p => ({ ...p, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}

          <Button variant="outline" onClick={calcSalary} disabled={calcLoading || !offer.offered_ctc}>
            {calcLoading ? <Loader2 className="animate-spin w-4 h-4 mr-1" /> : null}
            Calculate Salary Components
          </Button>

          {salaryPreview && (
            <div className="bg-gray-50 rounded p-3 text-sm grid grid-cols-2 gap-x-4 gap-y-1 border">
              {(Object.entries(salaryPreview) as [string, number][]).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</span>
                  <span className="font-medium">₹{v.toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => submitOffer(false)} disabled={saving}>
              Save Draft
            </Button>
            <Button onClick={() => submitOffer(true)} disabled={saving || !offer.date_of_joining || !offer.offered_ctc}>
              {saving ? <Loader2 className="animate-spin w-4 h-4 mr-1" /> : null}
              Submit to Branch Head
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Onboarding Requests</h1>
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b">
              {['Code', 'Name', 'Mobile', 'Profile Status', 'Request Status', 'Offer', 'Action'].map(h => (
                <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">{r.candidate_code}</td>
                <td className="px-3 py-2">{r.full_name}</td>
                <td className="px-3 py-2">{r.mobile}</td>
                <td className="px-3 py-2"><Badge variant="outline">{r.profile_status}</Badge></td>
                <td className="px-3 py-2"><Badge>{r.status}</Badge></td>
                <td className="px-3 py-2">
                  {r.offer_status
                    ? <Badge variant="secondary">{r.offer_status}</Badge>
                    : <span className="text-muted-foreground text-xs">—</span>}
                </td>
                <td className="px-3 py-2">
                  {r.profile_status === 'profile_submitted' && (
                    <Button size="sm" onClick={() => setSelected(r)}>Create Offer</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="text-center text-muted-foreground py-8">No onboarding requests yet.</p>
        )}
      </div>
    </div>
  );
}
