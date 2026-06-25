import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useAutoSave } from '../useAutoSave';
import { VerificationBadge } from '../VerificationBadge';
import { InlineDocUpload } from '../InlineDocUpload';
import type { BgvCheck } from '../useOnboardingV2';

interface S5Props {
  token: string;
  initialData: Record<string, unknown> | null;
  saveSection: (endpoint: string, payload: Record<string, unknown>) => Promise<void>;
  verifyBgv: (endpoint: string, payload?: Record<string, unknown>) => Promise<void>;
  bankCheck?: BgvCheck;
}

export function S5_BankDetails({ token, initialData, saveSection, verifyBgv, bankCheck }: S5Props) {
  const [form, setForm] = useState({
    bank_name: '', branch_name: '', account_holder_name: '',
    account_no: '', ifsc_code: '', account_type: '', name_on_cheque: '',
  });
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (initialData) {
      setForm(prev => ({
        ...prev,
        bank_name: String(initialData.bank_name ?? ''),
        branch_name: String(initialData.branch_name ?? ''),
        account_holder_name: String(initialData.account_holder_name ?? ''),
        ifsc_code: String(initialData.ifsc_code ?? ''),
        account_type: String(initialData.account_type ?? ''),
        name_on_cheque: String(initialData.name_on_cheque ?? ''),
      }));
    }
  }, [initialData]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  useAutoSave(payload => saveSection('bank-details', {
    bank_name: payload.bank_name,
    branch_name: payload.branch_name,
    account_holder_name: payload.account_holder_name,
    ifsc_code: payload.ifsc_code,
    account_type: payload.account_type,
    name_on_cheque: payload.name_on_cheque,
  }), form);

  const doVerify = async () => {
    setVerifying(true);
    try {
      await verifyBgv('verify/bank', {
        accountNo: form.account_no,
        ifscCode: form.ifsc_code,
        accountHolderName: form.account_holder_name,
      });
    } finally {
      setVerifying(false);
    }
  };

  const lbl = 'block text-xs font-semibold text-gray-600 mb-1';
  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400';

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-gray-800">Bank Details</h2>
      <p className="text-xs text-gray-500 bg-amber-50 p-3 rounded-lg border border-amber-100">
        Salary will be credited to this account. Please ensure the account is in your name and is active.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Account Holder Name *</label>
          <input className={inp} value={form.account_holder_name} onChange={set('account_holder_name')} placeholder="As per bank records" />
        </div>
        <div>
          <label className={lbl}>Account Type *</label>
          <select className={inp} value={form.account_type} onChange={set('account_type')}>
            <option value="">Select</option>
            <option value="savings">Savings</option>
            <option value="current">Current</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={lbl}>Account Number *</label>
          <input className={inp} value={form.account_no} onChange={set('account_no')} placeholder="Enter raw account number for verification" />
          <p className="text-xs text-gray-400 mt-1">Number will be masked after verification. Enter carefully — verification is done via penny-less API.</p>
        </div>
        <div>
          <label className={lbl}>IFSC Code *</label>
          <input className={inp} value={form.ifsc_code} onChange={set('ifsc_code')} placeholder="SBIN0001234" maxLength={11} style={{ textTransform: 'uppercase' }} />
        </div>
        <div>
          <label className={lbl}>Bank Name *</label>
          <input className={inp} value={form.bank_name} onChange={set('bank_name')} />
        </div>
        <div>
          <label className={lbl}>Bank Branch</label>
          <input className={inp} value={form.branch_name} onChange={set('branch_name')} />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!form.account_no || !form.ifsc_code || verifying}
            onClick={doVerify}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 hover:bg-purple-700"
          >
            {verifying ? <Loader2 size={13} className="animate-spin" /> : null}
            Verify Bank Account
          </button>
          {bankCheck && <VerificationBadge status={bankCheck.status} summary={bankCheck.result_summary} />}
        </div>
      </div>

      <InlineDocUpload token={token} docType="cancelled_cheque" label="Upload Cancelled Cheque / Passbook front page *" />

      <div>
        <label className={lbl}>Name as on Cheque</label>
        <input
          className={inp}
          value={form.name_on_cheque}
          onChange={set('name_on_cheque')}
          placeholder="Enter name exactly as printed on cheque"
        />
        <p className="text-xs text-blue-600 mt-1 bg-blue-50 p-2 rounded-lg border border-blue-100">
          If the name doesn't match your account holder name, it will be reviewed by Payroll HO — your onboarding will not be blocked.
        </p>
      </div>
    </div>
  );
}
