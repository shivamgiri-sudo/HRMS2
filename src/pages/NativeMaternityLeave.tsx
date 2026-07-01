// src/pages/NativeMaternityLeave.tsx
import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type MaternityRecordType = 'delivery' | 'adoption' | 'miscarriage' | 'surrogacy';

type MaternityRecord = {
  id: string;
  record_type: MaternityRecordType;
  child_birth_order: number;
  entitled_weeks: number;
  leave_start_date: string;
  leave_end_date: string | null;
  expected_delivery_date: string | null;
  actual_delivery_date: string | null;
  complications: number;
  status: string;
  nursing_break_granted: number;
  nursing_break_end_date: string | null;
  work_from_home_option: number;
  leave_request_id: string | null;
  notes: string | null;
  created_at: string;
};

const ENTITLEMENT_INFO: Record<string, string> = {
  delivery_1: '26 weeks (182 days) — 1st or 2nd child',
  delivery_2: '26 weeks (182 days) — 1st or 2nd child',
  delivery_3: '12 weeks (84 days) — 3rd or subsequent child',
  adoption:   '8 weeks (56 days) — Adoption leave',
  miscarriage:'6 weeks (42 days) — Miscarriage / stillbirth',
  surrogacy:  '6 weeks (42 days) — Surrogacy',
};

const statusColors: Record<string, string> = {
  applied:   'bg-yellow-100 text-yellow-800',
  approved:  'bg-blue-100 text-blue-800',
  active:    'bg-green-100 text-green-800',
  completed: 'bg-slate-100 text-slate-700',
  rejected:  'bg-red-100 text-red-800',
};

export default function NativeMaternityLeave() {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [records, setRecords] = useState<MaternityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [form, setForm] = useState({
    employee_id: '',
    record_type: 'delivery' as MaternityRecordType,
    child_birth_order: 1,
    expected_delivery_date: '',
    leave_start_date: '',
    complications: false,
    notes: '',
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const profile = await hrmsApi.get<{ success: boolean; data: { id: string } }>('/api/employees/me');
        if (!cancelled && profile.data?.id) {
          setEmployeeId(profile.data.id);
          setForm(f => ({ ...f, employee_id: profile.data.id }));
        }
        const res = await hrmsApi.get<{ success: boolean; data: MaternityRecord[] }>('/api/compliance/maternity');
        if (!cancelled) setRecords(res.data ?? []);
      } catch (err) {
        if (!cancelled) setMessage({ type: 'error', text: 'Could not load records' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const entitlementKey = form.record_type === 'delivery'
    ? `delivery_${Math.min(form.child_birth_order, 3)}`
    : form.record_type;
  const entitlementText = ENTITLEMENT_INFO[entitlementKey] ?? '';

  const handleSubmit = async () => {
    if (!form.leave_start_date) {
      setMessage({ type: 'error', text: 'Leave start date is required' });
      return;
    }
    if (!form.employee_id) {
      setMessage({ type: 'error', text: 'Your employee profile is not linked to this account. Contact HR.' });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      await hrmsApi.post('/api/compliance/maternity', {
        ...form,
        expected_delivery_date: form.expected_delivery_date || null,
        notes: form.notes || null,
      });
      setMessage({ type: 'success', text: 'Application submitted. HR will review and approve shortly.' });
      setShowForm(false);
      const res = await hrmsApi.get<{ success: boolean; data: MaternityRecord[] }>('/api/compliance/maternity');
      setRecords(res.data ?? []);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Submission failed' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-slate-950">Maternity Leave</h1>
          <p className="text-sm text-slate-500">
            Maternity Benefit Act 1961 (amended 2017) — your entitlements and applications
          </p>
        </div>

        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 space-y-2">
          <p className="font-bold text-indigo-900 text-sm">Your Entitlements Under MBA 1961</p>
          <ul className="text-xs text-indigo-800 space-y-1">
            <li>🤱 1st / 2nd child delivery — <b>26 weeks full paid leave</b></li>
            <li>🤱 3rd+ child delivery — <b>12 weeks full paid leave</b></li>
            <li>👶 Adoption — <b>8 weeks full paid leave</b></li>
            <li>💙 Miscarriage / stillbirth — <b>6 weeks full paid leave</b></li>
            <li>⚕️ Medical complications — additional <b>4 weeks</b></li>
            <li>🍼 Nursing breaks — 2 × 15 min/day for <b>15 months</b> post-delivery</li>
            <li>💰 All maternity leave is <b>fully paid</b> — no LWP deduction</li>
          </ul>
        </div>

        {message && (
          <div className={`rounded-xl px-4 py-2 text-sm font-medium ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            {message.text}
          </div>
        )}

        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="w-full rounded-2xl bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-700 transition"
          >
            + Apply for Maternity Leave
          </button>
        )}

        {showForm && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="font-bold text-slate-900">New Application</h2>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600">Leave Type</label>
              <select
                value={form.record_type}
                onChange={e => setForm(f => ({ ...f, record_type: e.target.value as MaternityRecordType, child_birth_order: 1 }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="delivery">Delivery / Childbirth</option>
                <option value="adoption">Adoption</option>
                <option value="miscarriage">Miscarriage / Stillbirth</option>
                <option value="surrogacy">Surrogacy</option>
              </select>
            </div>

            {form.record_type === 'delivery' && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600">This will be my</label>
                <select
                  value={form.child_birth_order}
                  onChange={e => setForm(f => ({ ...f, child_birth_order: parseInt(e.target.value) }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value={1}>1st child</option>
                  <option value={2}>2nd child</option>
                  <option value={3}>3rd or subsequent child</option>
                </select>
              </div>
            )}

            {entitlementText && (
              <p className="rounded-xl bg-indigo-50 px-3 py-2 text-xs text-indigo-700 font-medium">
                Entitlement: {entitlementText}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600">Leave Start Date *</label>
                <input
                  type="date"
                  value={form.leave_start_date}
                  onChange={e => setForm(f => ({ ...f, leave_start_date: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              {form.record_type === 'delivery' && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600">Expected Delivery Date</label>
                  <input
                    type="date"
                    value={form.expected_delivery_date}
                    onChange={e => setForm(f => ({ ...f, expected_delivery_date: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="comp"
                checked={form.complications}
                onChange={e => setForm(f => ({ ...f, complications: e.target.checked }))}
              />
              <label htmlFor="comp" className="text-sm text-slate-700">
                Medical complications (doctor's certificate required — additional 4 weeks)
              </label>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600">Notes (optional)</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="Any additional information for HR..."
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 rounded-xl bg-indigo-600 py-2 font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Application'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-400">Loading your records...</p>
        ) : records.length > 0 ? (
          <div className="space-y-3">
            <h2 className="font-bold text-slate-800">Your Applications</h2>
            {records.map(r => (
              <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-slate-900 capitalize">
                    {r.record_type}{r.record_type === 'delivery' ? ` — ${r.child_birth_order === 1 ? '1st' : r.child_birth_order === 2 ? '2nd' : '3rd+'} child` : ''}
                  </p>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusColors[r.status] ?? 'bg-slate-100 text-slate-700'}`}>
                    {r.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs text-slate-600">
                  <span><b>Entitled:</b> {r.entitled_weeks} weeks</span>
                  <span><b>Start:</b> {r.leave_start_date}</span>
                  <span><b>End:</b> {r.leave_end_date ?? 'Pending approval'}</span>
                  {r.complications ? <span className="text-orange-700">+ 4 weeks complications</span> : <span />}
                </div>
                {r.leave_request_id && (
                  <p className="text-xs text-green-700 font-medium">✓ Leave request created — salary fully protected</p>
                )}
                {r.nursing_break_granted ? (
                  <p className="text-xs text-purple-700">🍼 Nursing breaks granted until {r.nursing_break_end_date}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
