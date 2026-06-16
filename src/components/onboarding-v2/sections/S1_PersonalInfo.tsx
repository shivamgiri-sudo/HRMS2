import React, { useState, useEffect } from 'react';
import { useAutoSave } from '../useAutoSave';

interface S1Props {
  token: string;
  initialData: Record<string, unknown> | null;
  saveSection: (endpoint: string, payload: Record<string, unknown>) => Promise<void>;
}

export function S1_PersonalInfo({ token: _token, initialData, saveSection }: S1Props) {
  const [form, setForm] = useState({
    title: '', employee_name: '', relation: '', father_husband_name: '',
    gender: '', marital_status: '', date_of_birth: '', blood_group: '',
    mobile_number: '', alt_mobile_number: '', personal_email_id: '', official_email_id: '',
    landline_number: '', nominee_name: '', nominee_relation: '', nominee_date_of_birth: '',
    nominee2_name: '', nominee2_relation: '', nominee2_date_of_birth: '',
  });

  useEffect(() => {
    if (initialData) {
      setForm(prev => ({ ...prev, ...Object.fromEntries(Object.entries(initialData).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])) }));
    }
  }, [initialData]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  useAutoSave(payload => saveSection('employee-details', payload), form);

  const lbl = 'block text-xs font-semibold text-gray-600 mb-1';
  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white';
  const sel = `${inp}`;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-gray-800">Personal Information</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className={lbl}>Title *</label>
          <select className={sel} value={form.title} onChange={set('title')}>
            <option value="">Select</option>
            {['Mr.','Mrs.','Ms.','Dr.','Prof.'].map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={lbl}>Full Name *</label>
          <input className={inp} value={form.employee_name} onChange={set('employee_name')} placeholder="As per Aadhaar" />
        </div>
        <div>
          <label className={lbl}>Relation</label>
          <select className={sel} value={form.relation} onChange={set('relation')}>
            <option value="">Select</option>
            <option value="father">Father</option>
            <option value="husband">Husband</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={lbl}>Father's / Husband's Name *</label>
          <input className={inp} value={form.father_husband_name} onChange={set('father_husband_name')} />
        </div>
        <div>
          <label className={lbl}>Gender *</label>
          <select className={sel} value={form.gender} onChange={set('gender')}>
            <option value="">Select</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Marital Status</label>
          <select className={sel} value={form.marital_status} onChange={set('marital_status')}>
            <option value="">Select</option>
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="divorced">Divorced</option>
            <option value="widowed">Widowed</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Date of Birth *</label>
          <input type="date" className={inp} value={form.date_of_birth} onChange={set('date_of_birth')} />
        </div>
        <div>
          <label className={lbl}>Blood Group</label>
          <select className={sel} value={form.blood_group} onChange={set('blood_group')}>
            <option value="">Select</option>
            {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(g => <option key={g}>{g}</option>)}
          </select>
        </div>
      </div>

      <hr className="border-gray-100" />
      <h3 className="font-semibold text-gray-700 text-sm">Contact Details</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label className={lbl}>Mobile Number *</label><input className={inp} value={form.mobile_number} onChange={set('mobile_number')} type="tel" /></div>
        <div><label className={lbl}>Alternate Mobile</label><input className={inp} value={form.alt_mobile_number} onChange={set('alt_mobile_number')} type="tel" /></div>
        <div><label className={lbl}>Landline</label><input className={inp} value={form.landline_number} onChange={set('landline_number')} type="tel" /></div>
        <div><label className={lbl}>Personal Email *</label><input className={inp} value={form.personal_email_id} onChange={set('personal_email_id')} type="email" /></div>
        <div className="md:col-span-2"><label className={lbl}>Official / Company Email</label><input className={inp} value={form.official_email_id} onChange={set('official_email_id')} type="email" placeholder="Will be assigned by IT" /></div>
      </div>

      <hr className="border-gray-100" />
      <h3 className="font-semibold text-gray-700 text-sm">Nominee 1</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2"><label className={lbl}>Nominee Name</label><input className={inp} value={form.nominee_name} onChange={set('nominee_name')} /></div>
        <div><label className={lbl}>Relation</label><input className={inp} value={form.nominee_relation} onChange={set('nominee_relation')} /></div>
        <div><label className={lbl}>Nominee DOB</label><input type="date" className={inp} value={form.nominee_date_of_birth} onChange={set('nominee_date_of_birth')} /></div>
      </div>
      <h3 className="font-semibold text-gray-700 text-sm">Nominee 2 (Optional)</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2"><label className={lbl}>Nominee 2 Name</label><input className={inp} value={form.nominee2_name} onChange={set('nominee2_name')} /></div>
        <div><label className={lbl}>Relation</label><input className={inp} value={form.nominee2_relation} onChange={set('nominee2_relation')} /></div>
        <div><label className={lbl}>Nominee 2 DOB</label><input type="date" className={inp} value={form.nominee2_date_of_birth} onChange={set('nominee2_date_of_birth')} /></div>
      </div>
    </div>
  );
}
