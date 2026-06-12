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

interface CostCentre {
  id: string;
  cost_centre_code: string;
  cost_centre_name: string;
  branch_id: string | null;
}

const BANDS = ['D', 'C', 'B', 'A', 'M'];

export default function NativeHROnboardingRequests() {
  const [rows, setRows] = useState<OnboardingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<OnboardingRequest | null>(null);
  const [salaryPreview, setSalaryPreview] = useState<SalaryPreview | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [costCentres, setCostCentres] = useState<CostCentre[]>([]);
  const [ccLoading, setCcLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
      const r = await hrmsApi.get('/ats/onboarding/requests');
      setRows(r.data.data ?? []);
    } catch {
      // silent — show empty state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load branch-scoped cost centres when HR opens a candidate's offer form
  useEffect(() => {
    if (!selected) return;
    setCcLoading(true);
    hrmsApi.get('/org/cost-centres/by-branch')
      .then(r => setCostCentres(r.data.data ?? []))
      .catch(() => setCostCentres([]))
      .finally(() => setCcLoading(false));
  }, [selected]);

  const calcSalary = async () => {
    if (!offer.offered_ctc || !offer.salary_band) return;
    setCalcLoading(true);
    try {
      const r = await hrmsApi.post('/ats/onboarding/calculate-salary', {
        ctc: Number(offer.offered_ctc) * 12, // input as monthly CTC, API takes annual
        bandCode: offer.salary_band,
      });
      setSalaryPreview(r.data.components);
    } catch {
      // ignore
    } finally {
      setCalcLoading(false);
    }
  };

  const submitOffer = async (submit: boolean) => {
    if (!selected) return;

    // Validate required fields before submitting
    if (submit) {
      if (!offer.date_of_joining) { setFormError('Date of Joining is required.'); return; }
      if (!offer.offered_ctc)     { setFormError('Monthly CTC is required.'); return; }
      if (!offer.cost_centre)     { setFormError('Cost Centre is required. Please select one from the dropdown.'); return; }
    }
    setFormError(null);

    setSaving(true);
    try {
      await hrmsApi.post(`/ats/onboarding/requests/${selected.id}/offer`, {
        ...offer,
        offered_ctc: Number(offer.offered_ctc) * 12, // store annual
        submit,
      });
      await load();
      setSelected(null);
      setSalaryPreview(null);
    } catch (e: any) {
      alert(e?.response?.data?.error ?? 'Failed to save offer');
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
      <Button variant="outline" onClick={() => { setSelected(null); setSalaryPreview(null); setFormError(null); }}>← Back to Requests</Button>
      <Card>
        <CardHeader>
          <CardTitle>Employment Offer — {selected.full_name}</CardTitle>
          <p className="text-sm text-muted-foreground">{selected.candidate_code} | {selected.mobile} | {selected.email}</p>
        </CardHeader>
        <CardContent className="space-y-3">

          {/* Employment Type */}
          <div>
            <Label>Employment Type</Label>
            <select
              className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background"
              value={offer.emp_type}
              onChange={e => setOffer(p => ({ ...p, emp_type: e.target.value }))}
            >
              {['OnRoll', 'OffRoll'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          {/* Date of Joining */}
          <div>
            <Label>Date of Joining <span className="text-red-500">*</span></Label>
            <Input type="date" value={offer.date_of_joining}
              onChange={e => setOffer(p => ({ ...p, date_of_joining: e.target.value }))} />
          </div>

          {/* Date of Salary Start */}
          <div>
            <Label>Date of Salary Start</Label>
            <Input type="date" value={offer.date_of_salary}
              onChange={e => setOffer(p => ({ ...p, date_of_salary: e.target.value }))} />
          </div>

          {/* Profile / Designation Title */}
          <div>
            <Label>Profile / Designation Title</Label>
            <Input type="text" value={offer.profile}
              onChange={e => setOffer(p => ({ ...p, profile: e.target.value }))} />
          </div>

          {/* Cost Centre — branch-scoped dropdown, required */}
          <div>
            <Label>
              Cost Centre <span className="text-red-500">*</span>
              {ccLoading && <Loader2 className="inline animate-spin w-3 h-3 ml-1" />}
            </Label>
            <select
              className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background"
              value={offer.cost_centre}
              onChange={e => setOffer(p => ({ ...p, cost_centre: e.target.value }))}
              disabled={ccLoading}
            >
              <option value="">— Select Cost Centre —</option>
              {costCentres.map(cc => (
                <option key={cc.id} value={cc.cost_centre_code}>
                  {cc.cost_centre_code} — {cc.cost_centre_name}
                </option>
              ))}
            </select>
            {costCentres.length === 0 && !ccLoading && (
              <p className="text-xs text-amber-600 mt-1">
                No active cost centres found for your branch. Contact admin to configure cost centres.
              </p>
            )}
          </div>

          {/* Role Type */}
          <div>
            <Label>Role Type</Label>
            <select
              className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background"
              value={offer.role_type}
              onChange={e => setOffer(p => ({ ...p, role_type: e.target.value }))}
            >
              {['Analyst', 'SupportStaff'].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          {/* Salary Band */}
          <div>
            <Label>Salary Band</Label>
            <select
              className="w-full border rounded px-2 py-1.5 text-sm mt-1 bg-background"
              value={offer.salary_band}
              onChange={e => setOffer(p => ({ ...p, salary_band: e.target.value }))}
            >
              {BANDS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          {/* Monthly CTC */}
          <div>
            <Label>Monthly CTC (₹) <span className="text-red-500">*</span></Label>
            <Input type="number" value={offer.offered_ctc}
              onChange={e => setOffer(p => ({ ...p, offered_ctc: e.target.value }))} />
          </div>

          {/* Validation error */}
          {formError && (
            <p className="text-sm text-red-600 font-medium">{formError}</p>
          )}

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
            <Button
              onClick={() => submitOffer(true)}
              disabled={saving || !offer.date_of_joining || !offer.offered_ctc || !offer.cost_centre}
            >
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
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">HR Onboarding Requests</h2>
        <Badge variant="outline">{rows.length} request{rows.length !== 1 ? 's' : ''}</Badge>
      </div>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No onboarding requests pending.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map(row => (
            <Card key={row.id} className="cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => {
                setSelected(row);
                setSalaryPreview(null);
                setFormError(null);
                setOffer({
                  emp_type: 'OnRoll', date_of_joining: '', date_of_salary: '',
                  profile: '', cost_centre: '', role_type: 'Analyst',
                  salary_band: 'D', offered_ctc: '',
                  department_id: '', designation_id: '', reporting_manager_id: '',
                });
              }}>
              <CardContent className="py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium">{row.full_name}</p>
                  <p className="text-sm text-muted-foreground">{row.candidate_code} · {row.branch_name}</p>
                </div>
                <Badge variant={
                  row.status === 'offer_submitted' ? 'default' :
                  row.status === 'offer_approved' ? 'secondary' : 'outline'
                }>
                  {row.status?.replace(/_/g, ' ')}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
