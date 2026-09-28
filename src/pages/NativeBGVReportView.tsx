import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Printer, Download, MapPin, Send, CheckCircle, XCircle, Clock } from 'lucide-react';
import { formatISTDate, formatISTTime } from '@/lib/utils';
import QRCode from 'qrcode';
import { downloadBGVReportPDF, fetchDigilockerPhotoBase64, qualificationRow } from '@/lib/bgvReportPdfGenerator';

export default function NativeBGVReportView() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [exporting, setExporting] = useState(false);
  // Recovered DigiLocker Aadhaar face photo, for HTML preview + PDF parity.
  // Not every candidate has completed DigiLocker, so this can stay undefined
  // with no error shown — the photo block simply doesn't render.
  const [digilockerPhoto, setDigilockerPhoto] = useState<string | undefined>(undefined);
  const [addrVerif, setAddrVerif] = useState<any[]>([]);
  const [addrMeta, setAddrMeta] = useState<{ totalAttempts: number; maxAttempts: number; attemptsLeft: number } | null>(null);
  const [sendingLink, setSendingLink] = useState(false);

  const loadAddrVerif = useCallback(async () => {
    if (!candidateId) return;
    try {
      const r = await hrmsApi.get<any>(`/api/bgv/address-verification/result/${candidateId}`);
      setAddrVerif(r.data?.data ?? []);
      setAddrMeta(r.data?.meta ?? null);
    } catch { /* non-critical */ }
  }, [candidateId]);

  useEffect(() => {
    if (!candidateId) return;
    const load = async () => {
      try {
        const res = await hrmsApi.get<any>(`/api/ats/bgv/report/full?candidateId=${candidateId}`);
        setData(res.data);

        // Generate QR code pointing to this report's URL so scanning opens it in a browser.
        if (res.data?.report) {
          const reportUrl = `${window.location.origin}/bgv-report-view/${res.data.report.candidate_id}`;
          const qr = await QRCode.toDataURL(reportUrl, { width: 200, margin: 1 });
          setQrCodeUrl(qr);
        }
      } catch (e: any) {
        alert(e?.message || 'Failed to load BGV report data');
      } finally {
        setLoading(false);
      }
    };
    void load();
    void fetchDigilockerPhotoBase64(candidateId).then(setDigilockerPhoto);
    void loadAddrVerif();
  }, [candidateId, loadAddrVerif]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await downloadBGVReportPDF({ ...data, digilockerPhotoBase64: digilockerPhoto });
    } catch (e: any) {
      alert(e?.message || 'PDF download failed');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!data || !data.report) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-xl text-slate-700">BGV Report not found</p>
          <p className="text-sm text-slate-500 mt-2">This candidate may not have a BGV report yet.</p>
        </div>
      </div>
    );
  }

  const { report, profile = {}, bank = {}, qualifications = [], experience = {}, family = {}, documents = [], bgvChecks = [], completedByName } = data;

  const reportDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const reportId = `BGV-${report.candidate_code}-${reportDate}`;

  // Build per-category best status from API checks (same normalization as the backend).
  // Falls back to the manual *_status field on the report for categories with no API check.
  const checkNorm: Record<string, string> = {
    aadhaar_offline: 'aadhaar', address_doc: 'address',
    education_doc: 'education', court: 'criminal', experience: 'employment',
  };
  const precedence: Record<string, number> = { verified: 4, waived: 3, manual_review: 2, mismatch: 1, failed: 1, partial: 1 };
  const bestCheckStatus = new Map<string, string>();
  for (const c of bgvChecks as any[]) {
    const norm = checkNorm[c.check_type] ?? c.check_type;
    const inc = precedence[c.status] ?? 0;
    const ex = precedence[bestCheckStatus.get(norm) ?? ''] ?? -1;
    if (inc > ex) bestCheckStatus.set(norm, c.status);
  }
  // Fold in manual statuses for categories not covered by an API check
  const manualMap: Record<string, string | undefined> = {
    aadhaar: report.aadhaar_status, pan: report.pan_status, bank: report.bank_status,
    education: report.education_status, employment: report.employment_status,
    address: report.address_status, criminal: report.criminal_status,
  };
  for (const [cat, val] of Object.entries(manualMap)) {
    if (bestCheckStatus.has(cat)) continue;
    if (val === 'passed') bestCheckStatus.set(cat, 'verified');
    else if (val === 'failed') bestCheckStatus.set(cat, 'failed');
    else if (val === 'partial') bestCheckStatus.set(cat, 'partial');
  }
  const digilockerClear = bestCheckStatus.get('digilocker') === 'verified' || bestCheckStatus.get('digilocker') === 'waived';
  const isClearCat = (t: string) => { const s = bestCheckStatus.get(t); return s === 'verified' || s === 'waived'; };
  const isHalfCat = (t: string) => bestCheckStatus.get(t) === 'partial';

  // Derive denominator and inclusion flags from offer/experience data
  const expYears = parseFloat(String(experience?.experience_year ?? '0'));
  const expText = String(experience?.working_experience ?? '').toLowerCase();
  const isFresherDerived = !expYears && (!expText || expText === 'fresher' || expText === 'no' || expText === '0');
  const includeEmployment = !isFresherDerived;
  const denominator = 80 + (includeEmployment ? 10 : 0);

  type ScoreRow = { label: string; weight: number; earned: number; status: string; applicable: boolean };
  const scoreRows: ScoreRow[] = [
    {
      label: 'Aadhaar / Identity', weight: 25,
      earned: digilockerClear || isClearCat('aadhaar') ? 25 : isHalfCat('aadhaar') ? 12.5 : 0,
      status: digilockerClear ? 'verified (DigiLocker)' : (bestCheckStatus.get('aadhaar') ?? 'not_run'),
      applicable: true,
    },
    {
      label: 'PAN', weight: 20,
      earned: digilockerClear || isClearCat('pan') ? 20 : isHalfCat('pan') ? 10 : 0,
      status: digilockerClear ? 'verified (DigiLocker)' : (bestCheckStatus.get('pan') ?? 'not_run'),
      applicable: true,
    },
    {
      label: 'Bank Account', weight: 15,
      earned: isClearCat('bank') ? 15 : isHalfCat('bank') ? 7.5 : 0,
      status: bestCheckStatus.get('bank') ?? 'not_run',
      applicable: true,
    },
    {
      label: 'Education', weight: 10,
      earned: isClearCat('education') ? 10 : isHalfCat('education') ? 5 : 0,
      status: bestCheckStatus.get('education') ?? 'not_run',
      applicable: true,
    },
    {
      label: 'Address', weight: 10,
      earned: isClearCat('address') ? 10 : isHalfCat('address') ? 5 : 0,
      status: bestCheckStatus.get('address') ?? 'not_run',
      applicable: true,
    },
    {
      label: 'Employment / Experience', weight: 10,
      earned: isClearCat('employment') ? 10 : isHalfCat('employment') ? 5 : 0,
      status: bestCheckStatus.get('employment') ?? 'not_run',
      applicable: includeEmployment,
    },
  ];

  const safeText = (value: any) => value || '-';
  const boolText = (value: any) => (value ? 'Yes' : 'No');

  const statusColors: Record<string, string> = {
    passed: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    verified: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    waived: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    failed: 'bg-red-100 text-red-800 border-red-300',
    partial: 'bg-amber-100 text-amber-800 border-amber-300',
    not_run: 'bg-slate-100 text-slate-600 border-slate-300',
    clear: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    refer: 'bg-amber-100 text-amber-800 border-amber-300',
    negative: 'bg-red-100 text-red-800 border-red-300',
    pending: 'bg-slate-100 text-slate-600 border-slate-300',
    in_progress: 'bg-blue-100 text-blue-800 border-blue-300',
    pending_review: 'bg-amber-100 text-amber-800 border-amber-300',
    manual_review: 'bg-amber-100 text-amber-800 border-amber-300',
    validated: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    not_done: 'bg-slate-100 text-slate-600 border-slate-300',
    invalid: 'bg-red-100 text-red-800 border-red-300',
  };

  const StatusBadge = ({ status }: { status: string }) => (
    <span className={`inline-block px-3 py-1 rounded-md text-xs font-bold border ${statusColors[status] || statusColors.not_run}`}>
      {status.toUpperCase().replace(/_/g, ' ')}
    </span>
  );

  // Build a quick lookup from bgvChecks for match scores and provider details
  const checkDetailMap = new Map<string, any>();
  (bgvChecks || []).forEach((c: any) => {
    // Keep the most recent (first due to ORDER BY updated_at DESC) entry per check_type
    if (!checkDetailMap.has(c.check_type)) checkDetailMap.set(c.check_type, c);
  });

  // photo_match and name_match are internal system checks — surface them for HR
  const photoCheck = checkDetailMap.get('photo_match');
  const nameMatchCheck = checkDetailMap.get('name_match');

  // Zero and placeholder match values from the API response are not meaningful to display.
  const cleanMatch = (v: unknown) => {
    if (!v) return null;
    const s = String(v).trim();
    if (!s || s === '0' || s === '0%' || s === '-' || s === 'null') return null;
    return s;
  };

  // photo_match "manual_review" means the system flagged for human review, NOT that fraud
  // was detected. Show it as "Pending HR Review" so HR can act, rather than as a failure badge.
  const photoStatus = photoCheck?.status === 'manual_review' ? 'pending_review' : photoCheck?.status;

  const verificationChecks = [
    { name: 'Aadhaar Verification', status: report.aadhaar_status, match: cleanMatch(report.aadhaar_name_match), remarks: report.aadhaar_remarks, type: 'aadhaar' },
    { name: 'DigiLocker KYC', status: report.digilocker_status || 'not_run', match: null, remarks: report.digilocker_remarks, type: 'digilocker' },
    { name: 'PAN Verification', status: report.pan_status, match: cleanMatch(report.pan_name_match), remarks: report.pan_remarks, type: 'pan' },
    { name: 'Bank Account Verification', status: report.bank_status, match: cleanMatch(report.bank_account_match), remarks: report.bank_remarks, type: 'bank' },
    { name: 'Education Verification', status: report.education_status, match: null, remarks: report.education_remarks, type: 'education' },
    { name: 'Employment Verification', status: report.employment_status, match: null, remarks: report.employment_remarks, type: 'employment' },
    { name: 'Address Verification', status: report.address_status, match: null, remarks: report.address_remarks, type: 'address' },
    { name: 'Criminal / Court Records Check', status: report.criminal_status || report.court_status || 'not_run', match: null, remarks: report.criminal_remarks || report.court_remarks, type: 'court' },
    // E-Signature is a joining document flow, not a BGV check — excluded from this report section
    // Photo match and name reconciliation — internal system checks shown to HR
    ...(photoCheck ? [{ name: 'Photo Identity Match', status: photoStatus, match: null, remarks: photoCheck.result_summary, type: 'photo_match' }] : []),
    ...(nameMatchCheck ? [{ name: 'Cross-Source Name Match', status: nameMatchCheck.status, match: nameMatchCheck.matched_name ? `${nameMatchCheck.matched_name}${nameMatchCheck.match_score != null && nameMatchCheck.match_score > 0 ? ` (${nameMatchCheck.match_score}%)` : ''}` : null, remarks: nameMatchCheck.result_summary, type: 'name_match' }] : []),
  ];

  return (
    <>
      {/* Print/Download Toolbar - Hidden on print */}
      <div className="fixed top-4 right-4 z-50 flex gap-2 print:hidden">
        <Button variant="default" onClick={handlePrint} className="shadow-lg">
          <Printer className="w-4 h-4 mr-2" />
          Print
        </Button>
        <Button variant="outline" onClick={() => void handleDownloadPDF()} disabled={exporting} className="shadow-lg">
          <Download className="w-4 h-4 mr-2" />
          {exporting ? 'Generating...' : 'Download PDF'}
        </Button>
      </div>

      {/* Report Container - A4 size, print-optimized */}
      <div className="min-h-screen bg-slate-100 print:bg-white p-8 print:p-0">
        <div className="max-w-[210mm] mx-auto bg-white shadow-xl print:shadow-none" style={{ fontFamily: 'Lato, sans-serif' }}>

          {/* PAGE 1: TITLE PAGE */}
          <div className="p-12 print:p-8 page-break-after relative">
            {/* Watermark */}
            <div className="absolute inset-0 flex items-center justify-center opacity-5 pointer-events-none transform rotate-45">
              <p className="text-9xl font-bold text-slate-900" style={{ fontFamily: 'EB Garamond, serif' }}>CONFIDENTIAL</p>
            </div>

            {/* Logo and QR */}
            <div className="flex justify-between items-start mb-12">
              <img src="/mcn-logo.png" alt="MAS Callnet" className="h-16" />
              {qrCodeUrl && (
                <div className="text-center">
                  <img src={qrCodeUrl} alt="QR Code" className="w-24 h-24" />
                  <p className="text-xs text-slate-500 mt-1">Scan to verify</p>
                </div>
              )}
            </div>

            {/* Title */}
            <div className="text-center mb-12">
              <h1 className="text-4xl font-bold text-slate-800 mb-2" style={{ fontFamily: 'EB Garamond, serif' }}>
                BACKGROUND VERIFICATION REPORT
              </h1>
              <p className="text-sm text-slate-500">Confidential - For Internal Use Only</p>
            </div>

            {/* Report Metadata */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm mb-12">
              <div><span className="font-bold">Report ID:</span> {reportId}</div>
              <div><span className="font-bold">Generated On:</span> {formatISTDate(new Date())} {formatISTTime(new Date())}</div>
              <div><span className="font-bold">Candidate Name:</span> {safeText(report.candidate_name)}</div>
              <div><span className="font-bold">Candidate Code:</span> {safeText(report.candidate_code)}</div>
              {report.employee_code && (
                <div><span className="font-bold">Employee Code:</span> {safeText(report.employee_code)}</div>
              )}
              <div><span className="font-bold">Branch:</span> {safeText(report.branch_name)}</div>
              <div><span className="font-bold">Process / LOB:</span> {safeText(report.process_name)}</div>
              <div><span className="font-bold">Mobile:</span> {safeText(report.mobile)}</div>
              <div><span className="font-bold">Email:</span> {safeText(report.email)}</div>
            </div>

            {/* Status Badges */}
            <div className="flex items-center gap-8 text-sm">
              <div>
                <span className="font-bold mr-2">Overall Status:</span>
                <StatusBadge status={report.overall_status} />
              </div>
              <div>
                <span className="font-bold mr-2">BGV Score:</span>
                <span className={`text-2xl font-bold ${report.bgv_score >= 80 ? 'text-emerald-600' : report.bgv_score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                  {report.bgv_score}/100
                </span>
              </div>
            </div>

            <div className="mt-4 text-sm">
              <span className="font-bold">Locked:</span> {report.locked ? 'Yes 🔒 Audit Evidence' : 'No'}
            </div>

            {/* Footer */}
            <div className="absolute bottom-8 left-8 right-8 text-xs text-slate-500 flex justify-between border-t pt-2">
              <span>MAS Callnet Private Limited | BGV Report | Confidential</span>
              <span>{reportId}</span>
            </div>
          </div>

          {/* PAGE 2: CANDIDATE PROFILE */}
          <div className="p-12 print:p-8 page-break-after">
            <div className="flex items-start justify-between gap-4 mb-6 border-b-2 border-slate-300 pb-2">
              <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'EB Garamond, serif' }}>
                CANDIDATE INFORMATION
              </h2>
              {digilockerPhoto && (
                <div className="text-center shrink-0">
                  <img
                    src={digilockerPhoto}
                    alt="Aadhaar photo (DigiLocker verified)"
                    className="w-24 h-24 object-cover rounded border border-slate-300"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Aadhaar Photo<br />(DigiLocker Verified)</p>
                </div>
              )}
            </div>

            {/* Personal Details */}
            <h3 className="text-lg font-bold text-slate-700 mb-3">Personal Details</h3>
            <table className="w-full text-sm border-collapse border border-slate-300 mb-6">
              <tbody>
                {[
                  ['Full Name', safeText(profile.employee_name || report.candidate_name)],
                  ['Title', safeText(profile.title)],
                  ['Gender', safeText(profile.gender)],
                  ['Date of Birth', profile.date_of_birth ? formatISTDate(new Date(profile.date_of_birth)) : '-'],
                  ['Blood Group', safeText(profile.blood_group)],
                  ['Marital Status', safeText(profile.marital_status)],
                  ['Nationality', safeText(profile.nationality)],
                  ['Religion', safeText(profile.religion)],
                  ['Category', safeText(profile.category)],
                  ['Father/Husband Name', safeText(profile.father_husband_name)],
                  ['Relation', safeText(profile.relation)],
                  ['Mother Name', safeText(profile.mother_name)],
                ].map(([label, value], i) => (
                  <tr key={i} className="border-b border-slate-200">
                    <td className="py-2 px-3 font-semibold bg-slate-50 w-1/3">{label}</td>
                    <td className="py-2 px-3">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Contact Information */}
            <h3 className="text-lg font-bold text-slate-700 mb-3">Contact Information</h3>
            <table className="w-full text-sm border-collapse border border-slate-300 mb-6">
              <tbody>
                {[
                  ['Mobile', safeText(profile.mobile_number || report.mobile)],
                  ['Alternate Mobile', safeText(profile.alt_mobile_number)],
                  ['Personal Email', safeText(profile.personal_email_id || report.email)],
                  ['Official Email', safeText(profile.official_email_id)],
                  ['Emergency Contact Name', safeText(profile.emergency_contact_name)],
                  ['Emergency Contact Relation', safeText(profile.emergency_contact_relation)],
                  ['Emergency Contact Mobile', safeText(profile.emergency_contact_mobile)],
                ].map(([label, value], i) => (
                  <tr key={i} className="border-b border-slate-200">
                    <td className="py-2 px-3 font-semibold bg-slate-50 w-1/3">{label}</td>
                    <td className="py-2 px-3">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Address */}
            <h3 className="text-lg font-bold text-slate-700 mb-3">Address</h3>
            <div className="overflow-x-auto mb-6">
            <table className="w-full min-w-[42rem] text-sm border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="py-2 px-3 text-left">Type</th>
                  <th className="py-2 px-3 text-left">Address</th>
                  <th className="py-2 px-3 text-left">City</th>
                  <th className="py-2 px-3 text-left">State</th>
                  <th className="py-2 px-3 text-left">Pincode</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-200">
                  <td className="py-2 px-3 font-semibold">Permanent</td>
                  <td className="py-2 px-3">{safeText(profile.permanent_address)}</td>
                  <td className="py-2 px-3">{safeText(profile.permanent_city)}</td>
                  <td className="py-2 px-3">{safeText(profile.permanent_state)}</td>
                  <td className="py-2 px-3">{safeText(profile.permanent_pincode)}</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-semibold">Present</td>
                  <td className="py-2 px-3">{safeText(profile.present_address)}</td>
                  <td className="py-2 px-3">{safeText(profile.present_city)}</td>
                  <td className="py-2 px-3">{safeText(profile.present_state)}</td>
                  <td className="py-2 px-3">{safeText(profile.present_pincode)}</td>
                </tr>
              </tbody>
            </table>
            </div>

            {/* KYC & Identification */}
            <h3 className="text-lg font-bold text-slate-700 mb-3">KYC & Identification</h3>
            <table className="w-full text-sm border-collapse border border-slate-300">
              <tbody>
                {[
                  ['PAN Number', safeText(profile.pan_number_masked)],
                  ['Aadhaar Number', safeText(profile.aadhaar_number_masked)],
                  ['Passport No', safeText(profile.passport_no)],
                  ['Driving License No', safeText(profile.driving_license_no)],
                  ['UAN Number', safeText(profile.uan_number)],
                  ['EPF Number', safeText(profile.epf_number)],
                  ['ESIC Number', safeText(profile.esic_number)],
                ].map(([label, value], i) => (
                  <tr key={i} className="border-b border-slate-200">
                    <td className="py-2 px-3 font-semibold bg-slate-50 w-1/3">{label}</td>
                    <td className="py-2 px-3 font-mono text-xs">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* PAGE 3: QUALIFICATIONS & EXPERIENCE */}
          <div className="p-12 print:p-8 page-break-after">
            <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b-2 border-slate-300 pb-2" style={{ fontFamily: 'EB Garamond, serif' }}>
              EDUCATION & EXPERIENCE
            </h2>

            {/* Qualifications */}
            <h3 className="text-lg font-bold text-slate-700 mb-3">Educational Qualifications</h3>
            <div className="overflow-x-auto mb-6">
            <table className="w-full min-w-[48rem] text-sm border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="py-2 px-3 text-left">Degree</th>
                  <th className="py-2 px-3 text-left">Institution</th>
                  <th className="py-2 px-3 text-left">Board/Univ</th>
                  <th className="py-2 px-3 text-left">Field</th>
                  <th className="py-2 px-3 text-left">Year</th>
                  <th className="py-2 px-3 text-left">Marks</th>
                </tr>
              </thead>
              <tbody>
                {qualifications.length > 0 ? qualifications.map((q: any, i: number) => {
                  const row = qualificationRow(q);
                  return (
                  <tr key={i} className="border-b border-slate-200">
                    <td className="py-2 px-3">{row.degree}</td>
                    <td className="py-2 px-3">{row.institution}</td>
                    <td className="py-2 px-3">{row.board}</td>
                    <td className="py-2 px-3">{row.field}</td>
                    <td className="py-2 px-3">{row.year}</td>
                    <td className="py-2 px-3">{row.marks}</td>
                  </tr>
                  );
                }) : (
                  <tr><td colSpan={6} className="py-4 px-3 text-center text-slate-500">No qualifications recorded</td></tr>
                )}
              </tbody>
            </table>
            </div>

            {/* Employment History */}
            <h3 className="text-lg font-bold text-slate-700 mb-3">Employment History</h3>
            <table className="w-full text-sm border-collapse border border-slate-300 mb-6">
              <tbody>
                <tr className="border-b border-slate-200">
                  <td className="py-2 px-3 font-semibold bg-slate-50 w-1/3">Status</td>
                  <td className="py-2 px-3">{safeText(experience?.working_experience)}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-2 px-3 font-semibold bg-slate-50">Total Experience</td>
                  <td className="py-2 px-3">{experience?.experience_year ? `${experience.experience_year} years` : '-'}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-2 px-3 font-semibold bg-slate-50">Last Employer</td>
                  <td className="py-2 px-3">{safeText(experience?.employer_name)}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-2 px-3 font-semibold bg-slate-50">Last Designation</td>
                  <td className="py-2 px-3">{safeText(experience?.last_designation)}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-2 px-3 font-semibold bg-slate-50">Last CTC</td>
                  <td className="py-2 px-3">{experience?.last_ctc ? new Intl.NumberFormat('en-IN').format(experience.last_ctc) : '-'}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-2 px-3 font-semibold bg-slate-50">Employment Period</td>
                  <td className="py-2 px-3">
                    {experience?.from_date && experience?.to_date
                      ? `${formatISTDate(new Date(experience.from_date))} to ${formatISTDate(new Date(experience.to_date))}`
                      : '-'}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-semibold bg-slate-50">Reason for Leaving</td>
                  <td className="py-2 px-3">{safeText(experience?.reason_for_leaving)}</td>
                </tr>
              </tbody>
            </table>

            {/* Family Details */}
            <h3 className="text-lg font-bold text-slate-700 mb-3">Family Details</h3>
            <table className="w-full text-sm border-collapse border border-slate-300">
              <tbody>
                <tr className="border-b border-slate-200">
                  <td className="py-2 px-3 font-semibold bg-slate-50 w-1/3">Annual Family Income</td>
                  <td className="py-2 px-3">{family?.annual_income ? new Intl.NumberFormat('en-IN').format(family.annual_income) : '-'}</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-semibold bg-slate-50">Count of Dependents</td>
                  <td className="py-2 px-3">{safeText(family?.count_of_dependents)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* PAGE 4: BANK & STATUTORY */}
          <div className="p-12 print:p-8 page-break-after">
            <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b-2 border-slate-300 pb-2" style={{ fontFamily: 'EB Garamond, serif' }}>
              BANK & STATUTORY DETAILS
            </h2>

            {/* Bank Account */}
            <h3 className="text-lg font-bold text-slate-700 mb-3">Bank Account</h3>
            <table className="w-full text-sm border-collapse border border-slate-300 mb-6">
              <tbody>
                {[
                  ['Bank Name', safeText(bank.bank_name)],
                  ['Branch Name', safeText(bank.branch_name)],
                  ['IFSC Code', safeText(bank.ifsc_code)],
                  ['Account Holder Name', safeText(bank.account_holder_name)],
                  ['Account Type', safeText(bank.account_type)],
                  ['Account Number', safeText(bank.account_no_masked)],
                  ['Name on Cheque', safeText(bank.name_on_cheque)],
                  // Show BGV check result first (authoritative), then onboarding bank detail status as fallback
                  ['BGV Verification Status', (() => {
                    const bankBgvCheck = checkDetailMap.get('bank');
                    if (bankBgvCheck) return `${bankBgvCheck.status.toUpperCase().replace(/_/g,' ')} — via ${bankBgvCheck.provider_key || 'system'}`;
                    return safeText(bank.verification_status);
                  })()],
                  ['Account Match', (() => {
                    const bankBgvCheck = checkDetailMap.get('bank');
                    if (bankBgvCheck?.matched_name) return `${bankBgvCheck.matched_name}${bankBgvCheck.match_score != null ? ` (Score: ${bankBgvCheck.match_score}%)` : ''}`;
                    return report.bank_account_match || '-';
                  })()],
                  ['Provider', safeText(bank.provider_name)],
                  ['Verified At', bank.verified_at ? formatISTDate(new Date(bank.verified_at)) : '-'],
                ].map(([label, value], i) => (
                  <tr key={i} className="border-b border-slate-200">
                    <td className="py-2 px-3 font-semibold bg-slate-50 w-1/3">{label}</td>
                    <td className={`py-2 px-3 ${label === 'Account Number' ? 'font-mono text-xs' : ''}`}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Statutory Compliance */}
            <h3 className="text-lg font-bold text-slate-700 mb-3">Statutory Compliance</h3>
            <table className="w-full text-sm border-collapse border border-slate-300 mb-6">
              <tbody>
                {[
                  ['Previous PF Member', boolText(profile.previous_pf_member)],
                  ['EPS Member', boolText(profile.eps_member)],
                  ['International Worker', boolText(profile.international_worker)],
                  ['UAN Number', safeText(profile.uan_number)],
                  ['EPF Number', safeText(profile.epf_number)],
                  ['ESIC Number', safeText(profile.esic_number)],
                ].map(([label, value], i) => (
                  <tr key={i} className="border-b border-slate-200">
                    <td className="py-2 px-3 font-semibold bg-slate-50 w-1/3">{label}</td>
                    <td className="py-2 px-3">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Nominees */}
            <h3 className="text-lg font-bold text-slate-700 mb-3">Nominees</h3>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="py-2 px-3 text-left">Nominee</th>
                  <th className="py-2 px-3 text-left">Name</th>
                  <th className="py-2 px-3 text-left">Relation</th>
                  <th className="py-2 px-3 text-left">DOB</th>
                  <th className="py-2 px-3 text-left">Share %</th>
                </tr>
              </thead>
              <tbody>
                {profile.nominee_name ? (
                  <tr className="border-b border-slate-200">
                    <td className="py-2 px-3 font-semibold">Nominee 1</td>
                    <td className="py-2 px-3">{safeText(profile.nominee_name)}</td>
                    <td className="py-2 px-3">{safeText(profile.nominee_relation)}</td>
                    <td className="py-2 px-3">{profile.nominee_date_of_birth ? formatISTDate(new Date(profile.nominee_date_of_birth)) : '-'}</td>
                    <td className="py-2 px-3">{safeText(profile.nominee1_share_pct || '100')}%</td>
                  </tr>
                ) : null}
                {profile.nominee2_name ? (
                  <tr>
                    <td className="py-2 px-3 font-semibold">Nominee 2</td>
                    <td className="py-2 px-3">{safeText(profile.nominee2_name)}</td>
                    <td className="py-2 px-3">{safeText(profile.nominee2_relation)}</td>
                    <td className="py-2 px-3">{profile.nominee2_dob ? formatISTDate(new Date(profile.nominee2_dob)) : '-'}</td>
                    <td className="py-2 px-3">{safeText(profile.nominee2_share_pct)}%</td>
                  </tr>
                ) : null}
                {!profile.nominee_name && !profile.nominee2_name ? (
                  <tr><td colSpan={5} className="py-4 px-3 text-center text-slate-500">No nominees recorded</td></tr>
                ) : null}
              </tbody>
            </table>
            </div>
          </div>

          {/* PAGE 5: DOCUMENT CHECKLIST */}
          <div className="p-12 print:p-8 page-break-after">
            <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b-2 border-slate-300 pb-2" style={{ fontFamily: 'EB Garamond, serif' }}>
              DOCUMENT CHECKLIST
            </h2>

            <h3 className="text-lg font-bold text-slate-700 mb-3">Documents Received (Physical/Digital)</h3>
            <div className="overflow-x-auto mb-6">
            <table className="w-full min-w-[34rem] text-sm border-collapse border border-slate-300">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="py-2 px-3 text-left">Document Type</th>
                  <th className="py-2 px-3 text-center">Received</th>
                  <th className="py-2 px-3 text-left">Uploaded On</th>
                  <th className="py-2 px-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Photo', report.photo_received],
                  // DigiLocker KYC delivers Aadhaar and PAN digitally — treat them as received
                  // even if the HR hasn't ticked the physical-receipt checkbox on the report form.
                  ['Aadhaar Card', report.aadhaar_received || digilockerClear],
                  ['PAN Card', report.pan_received || digilockerClear],
                  ['Passport', report.passport_received],
                  ['Driving License', report.driving_license_received],
                  ['Education Certificate', report.edu_cert_received],
                  ['Experience Letter', report.prev_exp_received],
                  ['Bank Proof / Cancelled Cheque', report.bank_proof_received],
                  ['Offer Letter', report.offer_letter_received],
                ].map(([docType, received], i) => {
                  const doc = documents.find((d: any) => d.doc_type?.toLowerCase().includes((docType as string).toLowerCase().split(' ')[0]));
                  const isDigilocker = digilockerClear && (docType === 'Aadhaar Card' || docType === 'PAN Card');
                  return (
                    <tr key={i} className="border-b border-slate-200">
                      <td className="py-2 px-3">{docType}{isDigilocker && !report.aadhaar_received && !report.pan_received ? <span className="ml-1 text-xs text-blue-600">(DigiLocker)</span> : null}</td>
                      <td className="py-2 px-3 text-center text-base">{received ? '✓' : '✗'}</td>
                      <td className="py-2 px-3">{doc?.uploaded_at ? formatISTDate(new Date(doc.uploaded_at)) : (isDigilocker ? 'Via DigiLocker KYC' : '-')}</td>
                      <td className="py-2 px-3">{doc?.document_status ? safeText(doc.document_status) : (isDigilocker ? 'verified' : '-')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>

            {report.box_file_no && (
              <div className="text-sm">
                <span className="font-bold">Physical Box File No:</span> {report.box_file_no}
              </div>
            )}
          </div>

          {/* PAGE 6-7: VERIFICATION RESULTS */}
          <div className="p-12 print:p-8 page-break-after">
            <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b-2 border-slate-300 pb-2" style={{ fontFamily: 'EB Garamond, serif' }}>
              BACKGROUND VERIFICATION RESULTS
            </h2>

            {verificationChecks.map((check, idx) => {
              const apiCheck = checkDetailMap.get(check.type) ?? null;
              return (
                <div key={idx} className="mb-6 pb-4 border-b border-slate-200 last:border-0">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-bold text-slate-700">{check.name}</h3>
                    <StatusBadge status={check.status} />
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-slate-100">
                        <td className="py-1 pr-4 font-semibold w-1/4">Status</td>
                        <td className="py-1">{check.status.toUpperCase()}</td>
                      </tr>
                      {check.match && (
                        <tr className="border-b border-slate-100">
                          <td className="py-1 pr-4 font-semibold">Name / Account Match</td>
                          <td className="py-1">{safeText(check.match)}</td>
                        </tr>
                      )}
                      {apiCheck?.match_score != null && apiCheck.match_score > 0 && (
                        <tr className="border-b border-slate-100">
                          <td className="py-1 pr-4 font-semibold">Match Score</td>
                          <td className="py-1">
                            <span className={`font-bold ${apiCheck.match_score >= 80 ? 'text-emerald-700' : apiCheck.match_score >= 50 ? 'text-amber-700' : 'text-red-700'}`}>
                              {apiCheck.match_score}%
                            </span>
                          </td>
                        </tr>
                      )}
                      {apiCheck?.provider_key && (
                        <tr className="border-b border-slate-100">
                          <td className="py-1 pr-4 font-semibold">Provider</td>
                          <td className="py-1">{safeText(apiCheck.provider_key)}</td>
                        </tr>
                      )}
                      {apiCheck?.provider_reference_id && (
                        <tr className="border-b border-slate-100">
                          <td className="py-1 pr-4 font-semibold">Reference ID</td>
                          <td className="py-1 font-mono text-xs">{safeText(apiCheck.provider_reference_id)}</td>
                        </tr>
                      )}
                      {apiCheck?.verified_at && (
                        <tr className="border-b border-slate-100">
                          <td className="py-1 pr-4 font-semibold">Verified At</td>
                          <td className="py-1">{formatISTDate(new Date(apiCheck.verified_at))}</td>
                        </tr>
                      )}
                      {check.remarks && (
                        <tr>
                          <td className="py-1 pr-4 font-semibold align-top">Remarks</td>
                          <td className="py-1">{safeText(check.remarks)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>

          {/* PAGE 8: OVERALL ASSESSMENT */}
          <div className="p-12 print:p-8">
            <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b-2 border-slate-300 pb-2" style={{ fontFamily: 'EB Garamond, serif' }}>
              OVERALL ASSESSMENT
            </h2>

            {/* BGV Score Card */}
            <h3 className="text-lg font-bold text-slate-700 mb-3">BGV Score</h3>
            <div className={`p-6 rounded-lg mb-4 ${report.bgv_score >= 80 ? 'bg-emerald-500' : report.bgv_score >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}>
              <p className="text-4xl font-bold text-white text-center">{report.bgv_score} / 100</p>
            </div>

            {/* Score breakdown — shows exactly which categories contributed and which are pending */}
            <h3 className="text-base font-bold text-slate-700 mb-2">Score Breakdown</h3>
            <table className="w-full text-sm border-collapse border border-slate-300 mb-6">
              <thead>
                <tr className="bg-slate-100">
                  <th className="py-2 px-3 text-left border-b border-slate-300">Category</th>
                  <th className="py-2 px-3 text-center border-b border-slate-300">Weight</th>
                  <th className="py-2 px-3 text-center border-b border-slate-300">Status</th>
                  <th className="py-2 px-3 text-center border-b border-slate-300">Points</th>
                </tr>
              </thead>
              <tbody>
                {scoreRows.map((row) => {
                  // Normalize weight to /100 scale so totals always read as /100
                  const normWeight = row.applicable ? Math.round(row.weight / denominator * 100 * 10) / 10 : 0;
                  const normEarned = row.applicable ? Math.round(row.earned / denominator * 100 * 10) / 10 : 0;
                  return (
                  <tr key={row.label} className={`border-b border-slate-200 ${!row.applicable ? 'text-slate-400' : ''}`}>
                    <td className="py-2 px-3">{row.label}{!row.applicable && <span className="ml-2 text-xs text-slate-400">(N/A)</span>}</td>
                    <td className="py-2 px-3 text-center">{row.applicable ? normWeight : '—'}</td>
                    <td className="py-2 px-3 text-center">
                      {!row.applicable ? '—' : (
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          row.status.startsWith('verified') || row.status === 'waived' ? 'bg-emerald-100 text-emerald-800' :
                          row.status === 'partial' ? 'bg-amber-100 text-amber-800' :
                          row.status === 'not_run' ? 'bg-slate-100 text-slate-600' :
                          'bg-red-100 text-red-800'
                        }`}>{row.status}</span>
                      )}
                    </td>
                    <td className={`py-2 px-3 text-center font-semibold ${row.applicable && normEarned === 0 && row.status !== 'not_run' ? 'text-red-600' : row.applicable && normEarned === 0 ? 'text-slate-400' : 'text-emerald-700'}`}>
                      {row.applicable ? `${normEarned}/${normWeight}` : '—'}
                    </td>
                  </tr>
                  );
                })}
                <tr className="bg-slate-50 font-bold">
                  <td className="py-2 px-3">Total</td>
                  <td className="py-2 px-3 text-center">100</td>
                  <td className="py-2 px-3 text-center">—</td>
                  <td className="py-2 px-3 text-center text-slate-800">
                    {report.bgv_score} / 100
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="mb-6">
              <span className="text-base font-bold mr-3">Overall Status:</span>
              <StatusBadge status={report.overall_status} />
            </div>

            {/* Address Geo-Selfie Verification Panel (screen only — not printed) */}
            <div className="print:hidden mb-8">
              <h3 className="text-lg font-bold text-slate-700 mb-3 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-blue-500" /> Address Verification (Geo-Selfie)
              </h3>

              {/* Send link */}
              <div className="mb-4 flex items-center gap-3 flex-wrap">
                {addrMeta && (
                  <span className="text-sm text-slate-600">
                    Attempts used: <strong>{addrMeta.totalAttempts}/{addrMeta.maxAttempts}</strong>
                    {addrMeta.attemptsLeft > 0
                      ? <span className="ml-2 text-slate-500">({addrMeta.attemptsLeft} left)</span>
                      : <span className="ml-2 text-red-600 font-semibold"> — Max reached</span>}
                  </span>
                )}
                <Button
                  size="sm"
                  disabled={sendingLink || (addrMeta?.attemptsLeft === 0 && addrMeta?.totalAttempts >= (addrMeta?.maxAttempts ?? 3))}
                  onClick={async () => {
                    setSendingLink(true);
                    try {
                      const r = await hrmsApi.post<any>('/api/bgv/address-verification/initiate', { candidateId, forceUnblock: addrMeta?.attemptsLeft === 0 });
                      const link = r.data?.data?.link;
                      if (link) {
                        await navigator.clipboard.writeText(link).catch(() => {});
                        alert(`Link generated and copied to clipboard:\n\n${link}\n\nSend this to the candidate via WhatsApp or SMS.`);
                      }
                      await loadAddrVerif();
                    } catch (e: any) {
                      alert(e?.response?.data?.message || 'Failed to generate link');
                    } finally { setSendingLink(false); }
                  }}
                  className="flex items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  {sendingLink ? 'Generating…' : addrMeta?.attemptsLeft === 0 ? 'Force New Link (HR Override)' : 'Generate & Copy Verification Link'}
                </Button>
              </div>

              {/* Results */}
              {addrVerif.length === 0 ? (
                <p className="text-sm text-slate-400 italic">No address verification requests sent yet.</p>
              ) : (
                <div className="space-y-3">
                  {addrVerif.map((v: any) => (
                    <div key={v.id} className={`border rounded-xl p-4 text-sm ${v.status === 'verified' ? 'bg-emerald-50 border-emerald-200' : v.status === 'failed' || v.status === 'expired' ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                        <span className="font-semibold">Attempt {v.attempt_number}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                          v.status === 'verified' ? 'bg-emerald-500 text-white' :
                          v.status === 'submitted' ? 'bg-blue-500 text-white' :
                          v.status === 'pending' ? 'bg-amber-400 text-white' :
                          'bg-red-500 text-white'
                        }`}>{v.status.toUpperCase()}</span>
                        {v.auto_verified === 1 && <span className="text-xs text-emerald-600 font-semibold">✓ Auto-verified ≤10m</span>}
                      </div>

                      {v.submitted_at && (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600 mb-2">
                          <span><strong>Submitted:</strong> {formatISTDate(new Date(v.submitted_at))} {formatISTTime(new Date(v.submitted_at))}</span>
                          {v.gps_distance_m !== null && <span><strong>GPS Distance:</strong> {Number(v.gps_distance_m).toFixed(1)} m from declared address</span>}
                          {v.gps_latitude && <span><strong>Coordinates:</strong> <a href={`https://maps.google.com/?q=${v.gps_latitude},${v.gps_longitude}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{Number(v.gps_latitude).toFixed(5)}, {Number(v.gps_longitude).toFixed(5)}</a></span>}
                          {v.gps_accuracy_m && <span><strong>GPS Accuracy:</strong> ±{Number(v.gps_accuracy_m).toFixed(0)} m</span>}
                        </div>
                      )}

                      {/* HR decision controls */}
                      {v.status === 'submitted' && !v.hr_decision && (
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={async () => {
                              await hrmsApi.patch(`/api/bgv/address-verification/decide/${v.id}`, { decision: 'pass', notes: 'HR reviewed and approved' });
                              await loadAddrVerif();
                            }}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg font-semibold flex items-center gap-1"
                          >
                            <CheckCircle className="w-3.5 h-3.5" /> Pass
                          </button>
                          <button
                            onClick={async () => {
                              const notes = prompt('Reason for failing this attempt?');
                              if (notes === null) return;
                              await hrmsApi.patch(`/api/bgv/address-verification/decide/${v.id}`, { decision: 'fail', notes });
                              await loadAddrVerif();
                            }}
                            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg font-semibold flex items-center gap-1"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Fail
                          </button>
                          <button
                            onClick={async () => {
                              await hrmsApi.patch(`/api/bgv/address-verification/decide/${v.id}`, { decision: 'review' });
                              await loadAddrVerif();
                            }}
                            className="px-3 py-1 bg-slate-500 hover:bg-slate-600 text-white text-xs rounded-lg font-semibold flex items-center gap-1"
                          >
                            <Clock className="w-3.5 h-3.5" /> Need Review
                          </button>
                        </div>
                      )}

                      {v.hr_decision && (
                        <p className="text-xs text-slate-500 mt-1">HR: {v.hr_decision?.toUpperCase()} by {v.decided_by_name ?? 'HR'} {v.hr_decided_at ? `on ${formatISTDate(new Date(v.hr_decided_at))}` : ''}</p>
                      )}
                      {v.hr_notes && <p className="text-xs text-slate-500 italic mt-0.5">"{v.hr_notes}"</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* HR Final Remarks */}
            <h3 className="text-lg font-bold text-slate-700 mb-3">HR Final Remarks</h3>
            <div className="text-sm text-slate-700 bg-slate-50 p-4 rounded-md border border-slate-200 mb-6">
              {report.hr_remarks || 'No remarks provided.'}
            </div>

            {/* Audit Trail */}
            <h3 className="text-lg font-bold text-slate-700 mb-3">Audit Trail</h3>
            <table className="w-full text-sm border-collapse border border-slate-300">
              <tbody>
                <tr className="border-b border-slate-200">
                  <td className="py-2 px-3 font-semibold bg-slate-50 w-1/3">Completed By</td>
                  <td className="py-2 px-3">{completedByName || safeText(report.completed_by) || <span className="text-slate-400 italic">Not yet finalized</span>}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-2 px-3 font-semibold bg-slate-50">Completed At</td>
                  <td className="py-2 px-3">
                    {report.completed_at
                      ? `${formatISTDate(new Date(report.completed_at))} ${formatISTTime(new Date(report.completed_at))}`
                      : <span className="text-slate-400 italic">Not yet finalized — BGV still in progress</span>}
                  </td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-2 px-3 font-semibold bg-slate-50">Locked</td>
                  <td className="py-2 px-3">{report.locked ? 'Yes - Immutable Audit Evidence' : 'No'}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-2 px-3 font-semibold bg-slate-50">Report Generated At</td>
                  <td className="py-2 px-3">{formatISTDate(new Date())} {formatISTTime(new Date())}</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-semibold bg-slate-50">Generated By</td>
                  <td className="py-2 px-3">HRMS System</td>
                </tr>
              </tbody>
            </table>

            {/* Footer */}
            <div className="mt-8 pt-4 text-xs text-slate-500 flex justify-between border-t">
              <span>MAS Callnet Private Limited | BGV Report | Confidential</span>
              <span>{reportId}</span>
            </div>
          </div>

        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400;500;600;700&family=Lato:wght@300;400;700&display=swap');

        @media print {
          body {
            background: white !important;
          }
          .page-break-after {
            page-break-after: always;
          }
          @page {
            margin: 1cm;
            size: A4 portrait;
          }
        }
      `}</style>
    </>
  );
}
