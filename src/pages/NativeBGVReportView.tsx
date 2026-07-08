import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { hrmsApi } from '@/lib/hrmsApi';
import { Button } from '@/components/ui/button';
import { Printer, Download } from 'lucide-react';
import { formatISTDate, formatISTTime } from '@/lib/utils';
import QRCode from 'qrcode';
import { downloadBGVReportPDF } from '@/lib/bgvReportPdfGenerator';

export default function NativeBGVReportView() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!candidateId) return;
    const load = async () => {
      try {
        const res = await hrmsApi.get<any>(`/api/ats/bgv/report/full?candidateId=${candidateId}`);
        setData(res.data);

        // Generate QR code
        if (res.data?.report) {
          const qrData = `BGV-${res.data.report.candidate_id}-${res.data.report.completed_at || new Date().toISOString()}`;
          const qr = await QRCode.toDataURL(qrData, { width: 200, margin: 1 });
          setQrCodeUrl(qr);
        }
      } catch (e: any) {
        alert(e?.message || 'Failed to load BGV report data');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [candidateId]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await downloadBGVReportPDF(data);
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

  const safeText = (value: any) => value || '-';
  const boolText = (value: any) => (value ? 'Yes' : 'No');

  const statusColors: Record<string, string> = {
    passed: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    failed: 'bg-red-100 text-red-800 border-red-300',
    partial: 'bg-amber-100 text-amber-800 border-amber-300',
    not_run: 'bg-slate-100 text-slate-600 border-slate-300',
    clear: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    refer: 'bg-amber-100 text-amber-800 border-amber-300',
    negative: 'bg-red-100 text-red-800 border-red-300',
    pending: 'bg-slate-100 text-slate-600 border-slate-300',
    in_progress: 'bg-blue-100 text-blue-800 border-blue-300',
    validated: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    not_done: 'bg-slate-100 text-slate-600 border-slate-300',
    invalid: 'bg-red-100 text-red-800 border-red-300',
  };

  const StatusBadge = ({ status }: { status: string }) => (
    <span className={`inline-block px-3 py-1 rounded-md text-xs font-bold border ${statusColors[status] || statusColors.not_run}`}>
      {status.toUpperCase().replace(/_/g, ' ')}
    </span>
  );

  const verificationChecks = [
    { name: 'Aadhaar Verification', status: report.aadhaar_status, match: report.aadhaar_name_match, remarks: report.aadhaar_remarks, type: 'aadhaar' },
    { name: 'PAN Verification', status: report.pan_status, match: report.pan_name_match, remarks: report.pan_remarks, type: 'pan' },
    { name: 'Bank Account Verification', status: report.bank_status, match: report.bank_account_match, remarks: report.bank_remarks, type: 'bank' },
    { name: 'Education Verification', status: report.education_status, match: null, remarks: report.education_remarks, type: 'education' },
    { name: 'Employment Verification', status: report.employment_status, match: null, remarks: report.employment_remarks, type: 'employment' },
    { name: 'Address Verification', status: report.address_status, match: null, remarks: report.address_remarks, type: 'address' },
    { name: 'Criminal / Court Records Check', status: report.criminal_status || report.court_status || 'not_run', match: null, remarks: report.criminal_remarks || report.court_remarks, type: 'court' },
    { name: 'E-Signature Verification', status: report.esignature_status, match: null, remarks: report.esignature_remarks, type: 'esignature' },
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
            <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b-2 border-slate-300 pb-2" style={{ fontFamily: 'EB Garamond, serif' }}>
              CANDIDATE INFORMATION
            </h2>

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
            <table className="w-full text-sm border-collapse border border-slate-300 mb-6">
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
            <table className="w-full text-sm border-collapse border border-slate-300 mb-6">
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
                {qualifications.length > 0 ? qualifications.map((q: any, i: number) => (
                  <tr key={i} className="border-b border-slate-200">
                    <td className="py-2 px-3">{safeText(q.degree_type)}</td>
                    <td className="py-2 px-3">{safeText(q.institution_name)}</td>
                    <td className="py-2 px-3">{safeText(q.board_university)}</td>
                    <td className="py-2 px-3">{safeText(q.field_of_study)}</td>
                    <td className="py-2 px-3">{safeText(q.year_of_passing)}</td>
                    <td className="py-2 px-3">{safeText(q.marks_percentage || q.marks_cgpa)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="py-4 px-3 text-center text-slate-500">No qualifications recorded</td></tr>
                )}
              </tbody>
            </table>

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
                  ['Verification Status', safeText(bank.verification_status)],
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
            <table className="w-full text-sm border-collapse border border-slate-300">
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

          {/* PAGE 5: DOCUMENT CHECKLIST */}
          <div className="p-12 print:p-8 page-break-after">
            <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b-2 border-slate-300 pb-2" style={{ fontFamily: 'EB Garamond, serif' }}>
              DOCUMENT CHECKLIST
            </h2>

            <h3 className="text-lg font-bold text-slate-700 mb-3">Documents Received (Physical/Digital)</h3>
            <table className="w-full text-sm border-collapse border border-slate-300 mb-6">
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
                  ['Aadhaar Card', report.aadhaar_received],
                  ['PAN Card', report.pan_received],
                  ['Passport', report.passport_received],
                  ['Driving License', report.driving_license_received],
                  ['Education Certificate', report.edu_cert_received],
                  ['Experience Letter', report.prev_exp_received],
                  ['Bank Proof / Cancelled Cheque', report.bank_proof_received],
                  ['Offer Letter', report.offer_letter_received],
                ].map(([docType, received], i) => {
                  const doc = documents.find((d: any) => d.doc_type?.toLowerCase().includes((docType as string).toLowerCase().split(' ')[0]));
                  return (
                    <tr key={i} className="border-b border-slate-200">
                      <td className="py-2 px-3">{docType}</td>
                      <td className="py-2 px-3 text-center">{received ? '✓' : '✗'}</td>
                      <td className="py-2 px-3">{doc?.uploaded_at ? formatISTDate(new Date(doc.uploaded_at)) : '-'}</td>
                      <td className="py-2 px-3">{safeText(doc?.document_status)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

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
              const apiCheck = Array.isArray(bgvChecks) ? bgvChecks.find((c: any) => c.check_type === check.type) : null;
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
                          <td className="py-1 pr-4 font-semibold">Name/Account Match</td>
                          <td className="py-1">{safeText(check.match)}</td>
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
            <div className={`p-6 rounded-lg mb-6 ${report.bgv_score >= 80 ? 'bg-emerald-500' : report.bgv_score >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}>
              <p className="text-4xl font-bold text-white text-center">{report.bgv_score} / 100</p>
            </div>

            <div className="mb-6">
              <span className="text-base font-bold mr-3">Overall Status:</span>
              <StatusBadge status={report.overall_status} />
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
                  <td className="py-2 px-3">{completedByName || safeText(report.completed_by)}</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <td className="py-2 px-3 font-semibold bg-slate-50">Completed At</td>
                  <td className="py-2 px-3">
                    {report.completed_at ? `${formatISTDate(new Date(report.completed_at))} ${formatISTTime(new Date(report.completed_at))}` : '-'}
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
