import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Search, ChevronDown, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAutoSave } from '../useAutoSave';
import { VerificationBadge } from '../VerificationBadge';
import { InlineDocUpload } from '../InlineDocUpload';
import type { BgvCheck } from '../useOnboardingV2';
import { apiUrl } from '@/lib/apiBase';
import { hrmsApi } from '@/lib/hrmsApi';

interface Bank { code: string; name: string; }
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
    account_no: '', ifsc_code: '', account_type: 'savings', name_on_cheque: '',
  });
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankSearch, setBankSearch] = useState('');
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false);
  const [ifscLookupResult, setIfscLookupResult] = useState<any>(null);
  const [lookingUpIFSC, setLookingUpIFSC] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [accountTypes, setAccountTypes] = useState<any[]>([]);
  const initializedRef = useRef(false);

  // Load master data
  useEffect(() => {
    Promise.all([
      hrmsApi.get('/api/onboarding/data/banks').then(r => setBanks(Array.isArray(r.data) ? r.data : r.data?.data ?? [])).catch(() => {}),
      hrmsApi.get('/api/onboarding/data/account-types').then(r => setAccountTypes(Array.isArray(r.data) ? r.data : r.data?.data ?? [])).catch(() => {}),
    ]);
  }, []);

  // Initialize from server data
  useEffect(() => {
    if (initialData && !initializedRef.current) {
      initializedRef.current = true;
      setForm(prev => ({
        ...prev,
        bank_name: String(initialData.bank_name ?? ''),
        branch_name: String(initialData.branch_name ?? ''),
        account_holder_name: String(initialData.account_holder_name ?? ''),
        ifsc_code: String(initialData.ifsc_code ?? ''),
        account_type: String(initialData.account_type ?? 'savings'),
        name_on_cheque: String(initialData.name_on_cheque ?? ''),
      }));
    }
  }, [initialData]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const filteredBanks = bankSearch.trim()
    ? banks.filter(b => b.name.toLowerCase().includes(bankSearch.toLowerCase()) || b.code.toLowerCase().includes(bankSearch.toLowerCase()))
    : [];

  const selectBank = (bank: Bank) => {
    setForm(prev => ({ ...prev, bank_name: bank.name }));
    setBankSearch('');
    setBankDropdownOpen(false);
  };

  const lookupIFSC = async () => {
    const code = form.ifsc_code.trim().toUpperCase();
    if (!code || code.length < 4) return;
    setLookingUpIFSC(true);
    try {
      const res = await hrmsApi.get(`/api/onboarding/data/ifsc/${code}`);
      if (res.success && res.data) {
        setIfscLookupResult(res.data);
        setForm(prev => ({
          ...prev,
          bank_name: res.data.bankName || prev.bank_name,
          branch_name: res.data.branchName || prev.branch_name,
        }));
      } else {
        setIfscLookupResult(null);
      }
    } catch {
      setIfscLookupResult(null);
    } finally {
      setLookingUpIFSC(false);
    }
  };

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
      // Trigger name validation cross-check (non-blocking)
      if (token) {
        fetch(
          apiUrl('/api/onboarding/name-validation/validate'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          }
        ).catch(() => {});
      }
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Bank Account Details</h2>
        <p className="text-sm text-slate-600 mt-1">Salary will be credited to this account. Ensure it's active and in your name.</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex gap-3">
        <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-slate-700">
          <p className="font-medium">Account Verification Required</p>
          <p className="text-slate-600 mt-1">We'll verify your account via penny-less validation. Bank details are stored securely.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Account Holder Name */}
        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-1.5">Account Holder Name *</label>
          <input
            type="text"
            value={form.account_holder_name}
            onChange={set('account_holder_name')}
            placeholder="As per bank records"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Account Type Dropdown */}
        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-1.5">Account Type *</label>
          <select
            value={form.account_type}
            onChange={set('account_type')}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white"
          >
            <option value="">Select account type</option>
            {accountTypes.map((t: any) => <option key={t.code} value={t.code.toLowerCase()}>{t.name}</option>)}
          </select>
        </div>

        {/* Bank Name with Autocomplete */}
        <div className="relative">
          <label className="block text-sm font-semibold text-slate-900 mb-1.5">Bank Name *</label>
          <div className="relative">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={bankSearch || form.bank_name}
                onChange={(e) => { setBankSearch(e.target.value); setBankDropdownOpen(true); }}
                onFocus={() => setBankDropdownOpen(true)}
                placeholder="Search or type bank name"
                className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            {bankDropdownOpen && filteredBanks.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-300 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                {filteredBanks.map(bank => (
                  <button
                    key={bank.code}
                    type="button"
                    onClick={() => selectBank(bank)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-100 text-sm text-slate-900 border-b border-slate-100 last:border-0"
                  >
                    <div className="font-medium">{bank.name}</div>
                    <div className="text-xs text-slate-500">{bank.code}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {form.bank_name && !bankSearch && (
            <div className="mt-1.5 text-xs text-green-700 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> {form.bank_name}
            </div>
          )}
        </div>

        {/* IFSC Code with Lookup */}
        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-1.5">IFSC Code *</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={form.ifsc_code}
              onChange={(e) => { setForm(prev => ({ ...prev, ifsc_code: e.target.value.toUpperCase() })); setIfscLookupResult(null); }}
              placeholder="e.g., SBIN0001234"
              maxLength={11}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
            />
            <button
              type="button"
              onClick={lookupIFSC}
              disabled={form.ifsc_code.length < 4 || lookingUpIFSC}
              className="px-3 py-2 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              {lookingUpIFSC ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Lookup'}
            </button>
          </div>
          {ifscLookupResult && (
            <div className="mt-1.5 text-xs bg-green-50 text-green-800 p-2 rounded border border-green-200">
              ✓ {ifscLookupResult.branchName} • {ifscLookupResult.city}
            </div>
          )}
        </div>

        {/* Account Number */}
        <div className="md:col-span-2">
          <label className="block text-sm font-semibold text-slate-900 mb-1.5">Account Number *</label>
          <input
            type="text"
            value={form.account_no}
            onChange={set('account_no')}
            placeholder="Enter your 11-18 digit account number"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
          />
          <p className="text-xs text-slate-600 mt-1">Your account number will be verified securely and masked afterward.</p>
        </div>

        {/* Branch Name */}
        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-1.5">Branch Name</label>
          <input
            type="text"
            value={form.branch_name}
            onChange={set('branch_name')}
            placeholder="Auto-filled from IFSC or enter manually"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Name on Cheque */}
        <div>
          <label className="block text-sm font-semibold text-slate-900 mb-1.5">Name as on Cheque</label>
          <input
            type="text"
            value={form.name_on_cheque}
            onChange={set('name_on_cheque')}
            placeholder="Extracted from cheque or enter manually"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Verification Section */}
      <div className="border-t pt-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <button
            type="button"
            disabled={!form.account_no || !form.ifsc_code || verifying}
            onClick={doVerify}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {verifying && <Loader2 className="h-4 w-4 animate-spin" />}
            Verify Bank Account
          </button>
          {bankCheck && <VerificationBadge status={bankCheck.status} summary={bankCheck.result_summary} />}
        </div>
      </div>

      {/* Document Upload */}
      <div className="border-t pt-6">
        <InlineDocUpload token={token} docType="cancelled_cheque" label="Upload Cancelled Cheque / Passbook Front Page *" />
      </div>
    </div>
  );
}
