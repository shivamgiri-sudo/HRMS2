import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { buildQrCodeUrl } from "@/integrations/apis/qrCode.api";
import { formatISTDate, formatISTTime } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface BGVReportData {
  report: {
    id?: string;
    candidate_id: string;
    photo_received: boolean;
    aadhaar_received: boolean;
    pan_received: boolean;
    passport_received: boolean;
    driving_license_received: boolean;
    edu_cert_received: boolean;
    prev_exp_received: boolean;
    bank_proof_received: boolean;
    offer_letter_received: boolean;
    box_file_no?: string;
    aadhaar_status: string;
    aadhaar_name_match?: string;
    aadhaar_remarks?: string;
    pan_status: string;
    pan_name_match?: string;
    pan_remarks?: string;
    bank_status: string;
    bank_account_match?: string;
    bank_remarks?: string;
    education_status: string;
    education_remarks?: string;
    employment_status: string;
    employment_remarks?: string;
    address_status: string;
    address_remarks?: string;
    criminal_status: string;
    criminal_remarks?: string;
    court_status?: string;
    court_remarks?: string;
    esignature_status: string;
    esignature_remarks?: string;
    overall_status: string;
    bgv_score: number;
    hr_remarks?: string;
    completed_by?: string;
    completed_at?: string;
    locked: boolean;
    candidate_name: string;
    candidate_code: string;
    mobile: string;
    email: string;
    branch_name?: string;
    process_name?: string;
  } | null;
  profile: any;
  bank: any;
  qualifications: any[];
  experience: any;
  family: any;
  documents: any[];
  bgvChecks: any[];
  candidate: any;
  completedByName?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const formatINR = (amount: number | string | null): string => {
  if (!amount) return "-";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(num);
};

const safeText = (value: any): string => {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
};

const boolText = (value: any): string => {
  return value ? "Yes" : "No";
};

// Load logo as base64
async function loadLogoBase64(): Promise<string | null> {
  try {
    const response = await fetch('/mcn-logo.png');
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Failed to load logo:', error);
    return null;
  }
}

// Draw status badge with colored background
function drawStatusBadge(doc: jsPDF, x: number, y: number, status: string, width = 25) {
  const statusMap: Record<string, { color: [number, number, number]; label: string }> = {
    passed: { color: [16, 185, 129], label: "PASSED" },
    failed: { color: [220, 38, 38], label: "FAILED" },
    partial: { color: [245, 158, 11], label: "PARTIAL" },
    not_run: { color: [148, 163, 184], label: "NOT RUN" },
    clear: { color: [16, 185, 129], label: "CLEAR" },
    refer: { color: [245, 158, 11], label: "REFER" },
    negative: { color: [220, 38, 38], label: "NEGATIVE" },
    pending: { color: [148, 163, 184], label: "PENDING" },
    in_progress: { color: [37, 99, 235], label: "IN PROGRESS" },
    validated: { color: [16, 185, 129], label: "VALIDATED" },
    not_done: { color: [148, 163, 184], label: "NOT DONE" },
    invalid: { color: [220, 38, 38], label: "INVALID" },
  };

  const info = statusMap[status] || { color: [148, 163, 184], label: status.toUpperCase() };
  const [r, g, b] = info.color;

  doc.setFillColor(r, g, b);
  doc.roundedRect(x, y, width, 6, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text(info.label, x + width / 2, y + 4.2, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
}

// Draw watermark on page
function drawWatermark(doc: jsPDF) {
  doc.saveGraphicsState();
  doc.setTextColor(230, 230, 230);
  doc.setFontSize(60);
  doc.setFont("helvetica", "bold");
  doc.text("CONFIDENTIAL", 105, 148, { align: 'center', angle: 45 });
  doc.restoreGraphicsState();
}

// Draw page footer
function drawFooter(doc: jsPDF, pageNum: number, totalPages: number, reportId: string) {
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text("MAS Callnet Private Limited | BGV Report | Confidential", 15, pageHeight - 10);
  doc.text(`Page ${pageNum} of ${totalPages}`, 105, pageHeight - 10, { align: 'center' });
  doc.text(reportId, 195, pageHeight - 10, { align: 'right' });
  doc.setTextColor(0, 0, 0);
}

// ── Main Generator ─────────────────────────────────────────────────────────────

export async function generateBGVReportPDF(data: BGVReportData): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  if (!data.report) {
    doc.text("BGV Report not found for this candidate.", 15, 50);
    return doc;
  }

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let currentY = 15;
  let pageNum = 1;
  const totalPages = 8; // Estimate for footer

  const report = data.report;
  const profile = data.profile || {};
  const bank = data.bank || {};
  const qualifications = data.qualifications || [];
  const experience = data.experience || {};
  const family = data.family || {};
  const documents = data.documents || [];
  const bgvChecks = data.bgvChecks || {};

  const reportDate = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const reportId = `BGV-${report.candidate_code}-${reportDate}`;

  // Load logo
  const logoBase64 = await loadLogoBase64();

  // Generate QR code
  const qrData = `BGV-${report.candidate_id}-${report.completed_at || new Date().toISOString()}`;
  let qrUrl: string | null = null;
  try {
    qrUrl = await buildQrCodeUrl(qrData);
  } catch (e) {
    console.warn("QR code generation failed:", e);
  }

  // ═══ PAGE 1: TITLE PAGE ═══════════════════════════════════════════════════════

  drawWatermark(doc);

  // Logo
  if (logoBase64) {
    doc.addImage(logoBase64, 'PNG', 15, 15, 40, 20);
  }

  // QR Code
  if (qrUrl) {
    doc.addImage(qrUrl, 'PNG', 170, 15, 25, 25);
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text("Scan to verify", 182.5, 42, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  }

  currentY = 50;

  // Title
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59); // slate-800
  doc.text("BACKGROUND VERIFICATION REPORT", pageWidth / 2, currentY, { align: 'center' });

  currentY += 10;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 100, 100);
  doc.text("Confidential - For Internal Use Only", pageWidth / 2, currentY, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  currentY += 15;

  // Report Metadata
  autoTable(doc, {
    startY: currentY,
    head: [],
    body: [
      ["Report ID:", reportId],
      ["Generated On:", `${formatISTDate(new Date())} ${formatISTTime(new Date())}`],
      ["Candidate Name:", safeText(report.candidate_name)],
      ["Candidate Code:", safeText(report.candidate_code)],
      ["Branch:", safeText(report.branch_name)],
      ["Process / LOB:", safeText(report.process_name)],
      ["Mobile:", safeText(report.mobile)],
      ["Email:", safeText(report.email)],
    ],
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 50 },
      1: { cellWidth: 130 },
    },
    margin: { left: 15, right: 15 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 10;

  // Status Badges
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Overall Status:", 15, currentY);
  drawStatusBadge(doc, 55, currentY - 4, report.overall_status, 35);

  doc.text("BGV Score:", 120, currentY);
  const scoreColor = report.bgv_score >= 80 ? [16, 185, 129] : report.bgv_score >= 60 ? [245, 158, 11] : [220, 38, 38];
  doc.setTextColor(...scoreColor);
  doc.setFontSize(14);
  doc.text(`${report.bgv_score}/100`, 155, currentY);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  currentY += 10;
  doc.text(`Locked: ${report.locked ? "Yes 🔒 Audit Evidence" : "No"}`, 15, currentY);

  drawFooter(doc, pageNum++, totalPages, reportId);

  // ═══ PAGE 2: CANDIDATE PROFILE ════════════════════════════════════════════════

  doc.addPage();
  currentY = 15;
  drawWatermark(doc);

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text("CANDIDATE INFORMATION", 15, currentY);
  doc.setTextColor(0, 0, 0);
  currentY += 8;

  // Personal Details
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Personal Details", 15, currentY);
  currentY += 2;

  autoTable(doc, {
    startY: currentY,
    head: [['Field', 'Value']],
    body: [
      ["Full Name", safeText(profile.employee_name || report.candidate_name)],
      ["Title", safeText(profile.title)],
      ["Gender", safeText(profile.gender)],
      ["Date of Birth", safeText(profile.date_of_birth ? formatISTDate(new Date(profile.date_of_birth)) : null)],
      ["Blood Group", safeText(profile.blood_group)],
      ["Marital Status", safeText(profile.marital_status)],
      ["Nationality", safeText(profile.nationality)],
      ["Religion", safeText(profile.religion)],
      ["Category", safeText(profile.category)],
      ["Father/Husband Name", safeText(profile.father_husband_name)],
      ["Relation", safeText(profile.relation)],
      ["Mother Name", safeText(profile.mother_name)],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 60 },
      1: { cellWidth: 120 },
    },
    margin: { left: 15, right: 15 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 6;

  // Contact Information
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Contact Information", 15, currentY);
  currentY += 2;

  autoTable(doc, {
    startY: currentY,
    head: [['Field', 'Value']],
    body: [
      ["Mobile", safeText(profile.mobile_number || report.mobile)],
      ["Alternate Mobile", safeText(profile.alt_mobile_number)],
      ["Personal Email", safeText(profile.personal_email_id || report.email)],
      ["Official Email", safeText(profile.official_email_id)],
      ["Emergency Contact Name", safeText(profile.emergency_contact_name)],
      ["Emergency Contact Relation", safeText(profile.emergency_contact_relation)],
      ["Emergency Contact Mobile", safeText(profile.emergency_contact_mobile)],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 60 },
      1: { cellWidth: 120 },
    },
    margin: { left: 15, right: 15 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 6;

  // Address
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Address", 15, currentY);
  currentY += 2;

  autoTable(doc, {
    startY: currentY,
    head: [['Type', 'Address', 'City', 'State', 'Pincode']],
    body: [
      [
        "Permanent",
        safeText(profile.permanent_address),
        safeText(profile.permanent_city),
        safeText(profile.permanent_state),
        safeText(profile.permanent_pincode),
      ],
      [
        "Present",
        safeText(profile.present_address),
        safeText(profile.present_city),
        safeText(profile.present_state),
        safeText(profile.present_pincode),
      ],
    ],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 80 },
      2: { cellWidth: 30 },
      3: { cellWidth: 30 },
      4: { cellWidth: 20 },
    },
    margin: { left: 15, right: 15 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 6;

  // KYC & Identification
  if (currentY > 240) {
    doc.addPage();
    currentY = 15;
    pageNum++;
    drawWatermark(doc);
  }

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("KYC & Identification", 15, currentY);
  currentY += 2;

  autoTable(doc, {
    startY: currentY,
    head: [['Field', 'Value']],
    body: [
      ["PAN Number", safeText(profile.pan_number_masked)],
      ["Aadhaar Number", safeText(profile.aadhaar_number_masked)],
      ["Passport No", safeText(profile.passport_no)],
      ["Driving License No", safeText(profile.driving_license_no)],
      ["UAN Number", safeText(profile.uan_number)],
      ["EPF Number", safeText(profile.epf_number)],
      ["ESIC Number", safeText(profile.esic_number)],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2, font: 'courier' },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', font: 'helvetica' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 60, font: 'helvetica' },
      1: { cellWidth: 120 },
    },
    margin: { left: 15, right: 15 },
  });

  drawFooter(doc, pageNum++, totalPages, reportId);

  // ═══ PAGE 3: QUALIFICATIONS & EXPERIENCE ══════════════════════════════════════

  doc.addPage();
  currentY = 15;
  drawWatermark(doc);

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text("EDUCATION & EXPERIENCE", 15, currentY);
  doc.setTextColor(0, 0, 0);
  currentY += 8;

  // Qualifications
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Educational Qualifications", 15, currentY);
  currentY += 2;

  const qualRows = qualifications.length > 0 ? qualifications.map((q: any) => [
    safeText(q.degree_type),
    safeText(q.institution_name),
    safeText(q.board_university),
    safeText(q.field_of_study),
    safeText(q.year_of_passing),
    safeText(q.marks_percentage || q.marks_cgpa),
  ]) : [["No qualifications recorded", "-", "-", "-", "-", "-"]];

  autoTable(doc, {
    startY: currentY,
    head: [['Degree', 'Institution', 'Board/University', 'Field', 'Year', 'Marks/CGPA']],
    body: qualRows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    margin: { left: 15, right: 15 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 6;

  // Employment History
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Employment History", 15, currentY);
  currentY += 2;

  const expRows = experience ? [
    ["Status", safeText(experience.working_experience)],
    ["Total Experience", safeText(experience.experience_year ? `${experience.experience_year} years` : "-")],
    ["Last Employer", safeText(experience.employer_name)],
    ["Last Designation", safeText(experience.last_designation)],
    ["Last CTC", experience.last_ctc ? formatINR(experience.last_ctc) : "-"],
    ["Employment Period", experience.from_date && experience.to_date ? `${formatISTDate(new Date(experience.from_date))} to ${formatISTDate(new Date(experience.to_date))}` : "-"],
    ["Reason for Leaving", safeText(experience.reason_for_leaving)],
  ] : [["No employment history recorded", "-"]];

  autoTable(doc, {
    startY: currentY,
    head: [],
    body: expRows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 60 },
      1: { cellWidth: 120 },
    },
    margin: { left: 15, right: 15 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 6;

  // Family Details
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Family Details", 15, currentY);
  currentY += 2;

  autoTable(doc, {
    startY: currentY,
    head: [],
    body: [
      ["Annual Family Income", family?.annual_income ? formatINR(family.annual_income) : "-"],
      ["Count of Dependents", safeText(family?.count_of_dependents)],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 60 },
      1: { cellWidth: 120 },
    },
    margin: { left: 15, right: 15 },
  });

  drawFooter(doc, pageNum++, totalPages, reportId);

  // ═══ PAGE 4: BANK & STATUTORY ═════════════════════════════════════════════════

  doc.addPage();
  currentY = 15;
  drawWatermark(doc);

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text("BANK & STATUTORY DETAILS", 15, currentY);
  doc.setTextColor(0, 0, 0);
  currentY += 8;

  // Bank Account
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Bank Account", 15, currentY);
  currentY += 2;

  autoTable(doc, {
    startY: currentY,
    head: [['Field', 'Value']],
    body: [
      ["Bank Name", safeText(bank.bank_name)],
      ["Branch Name", safeText(bank.branch_name)],
      ["IFSC Code", safeText(bank.ifsc_code)],
      ["Account Holder Name", safeText(bank.account_holder_name)],
      ["Account Type", safeText(bank.account_type)],
      ["Account Number", safeText(bank.account_no_masked)],
      ["Name on Cheque", safeText(bank.name_on_cheque)],
      ["Verification Status", safeText(bank.verification_status)],
      ["Provider", safeText(bank.provider_name)],
      ["Verified At", bank.verified_at ? formatISTDate(new Date(bank.verified_at)) : "-"],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    bodyStyles: { 5: { font: 'courier' } },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 60 },
      1: { cellWidth: 120 },
    },
    margin: { left: 15, right: 15 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 6;

  // Statutory Compliance
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Statutory Compliance", 15, currentY);
  currentY += 2;

  autoTable(doc, {
    startY: currentY,
    head: [['Field', 'Value']],
    body: [
      ["Previous PF Member", boolText(profile.previous_pf_member)],
      ["EPS Member", boolText(profile.eps_member)],
      ["International Worker", boolText(profile.international_worker)],
      ["UAN Number", safeText(profile.uan_number)],
      ["EPF Number", safeText(profile.epf_number)],
      ["ESIC Number", safeText(profile.esic_number)],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 60 },
      1: { cellWidth: 120 },
    },
    margin: { left: 15, right: 15 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 6;

  // Nominees
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Nominees", 15, currentY);
  currentY += 2;

  const nomineeRows = [];
  if (profile.nominee_name) {
    nomineeRows.push([
      "Nominee 1",
      safeText(profile.nominee_name),
      safeText(profile.nominee_relation),
      profile.nominee_date_of_birth ? formatISTDate(new Date(profile.nominee_date_of_birth)) : "-",
      safeText(profile.nominee1_share_pct ? `${profile.nominee1_share_pct}%` : "100%"),
    ]);
  }
  if (profile.nominee2_name) {
    nomineeRows.push([
      "Nominee 2",
      safeText(profile.nominee2_name),
      safeText(profile.nominee2_relation),
      profile.nominee2_dob ? formatISTDate(new Date(profile.nominee2_dob)) : "-",
      safeText(profile.nominee2_share_pct ? `${profile.nominee2_share_pct}%` : "-"),
    ]);
  }
  if (nomineeRows.length === 0) {
    nomineeRows.push(["No nominees recorded", "-", "-", "-", "-"]);
  }

  autoTable(doc, {
    startY: currentY,
    head: [['Nominee', 'Name', 'Relation', 'DOB', 'Share %']],
    body: nomineeRows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    margin: { left: 15, right: 15 },
  });

  drawFooter(doc, pageNum++, totalPages, reportId);

  // ═══ PAGE 5: DOCUMENT CHECKLIST ═══════════════════════════════════════════════

  doc.addPage();
  currentY = 15;
  drawWatermark(doc);

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text("DOCUMENT CHECKLIST", 15, currentY);
  doc.setTextColor(0, 0, 0);
  currentY += 8;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Documents Received (Physical/Digital)", 15, currentY);
  currentY += 2;

  const docChecklistRows = [
    ["Photo", boolText(report.photo_received), "-", "-"],
    ["Aadhaar Card", boolText(report.aadhaar_received), "-", "-"],
    ["PAN Card", boolText(report.pan_received), "-", "-"],
    ["Passport", boolText(report.passport_received), "-", "-"],
    ["Driving License", boolText(report.driving_license_received), "-", "-"],
    ["Education Certificate", boolText(report.edu_cert_received), "-", "-"],
    ["Experience Letter", boolText(report.prev_exp_received), "-", "-"],
    ["Bank Proof / Cancelled Cheque", boolText(report.bank_proof_received), "-", "-"],
    ["Offer Letter", boolText(report.offer_letter_received), "-", "-"],
  ];

  // Merge uploaded documents info
  documents.forEach((doc: any) => {
    const matchIdx = docChecklistRows.findIndex(r => r[0].toLowerCase().includes(doc.doc_type?.toLowerCase()));
    if (matchIdx >= 0) {
      docChecklistRows[matchIdx][2] = doc.uploaded_at ? formatISTDate(new Date(doc.uploaded_at)) : "-";
      docChecklistRows[matchIdx][3] = safeText(doc.document_status);
    }
  });

  autoTable(doc, {
    startY: currentY,
    head: [['Document Type', 'Received', 'Uploaded On', 'Status']],
    body: docChecklistRows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 30, halign: 'center' },
      2: { cellWidth: 40 },
      3: { cellWidth: 40 },
    },
    margin: { left: 15, right: 15 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 6;

  if (report.box_file_no) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`Physical Box File No: ${report.box_file_no}`, 15, currentY);
  }

  drawFooter(doc, pageNum++, totalPages, reportId);

  // ═══ PAGE 6-7: VERIFICATION RESULTS ═══════════════════════════════════════════

  doc.addPage();
  currentY = 15;
  drawWatermark(doc);

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text("BACKGROUND VERIFICATION RESULTS", 15, currentY);
  doc.setTextColor(0, 0, 0);
  currentY += 8;

  const verificationChecks = [
    { name: "Aadhaar Verification", status: report.aadhaar_status, match: report.aadhaar_name_match, remarks: report.aadhaar_remarks, type: 'aadhaar' },
    { name: "PAN Verification", status: report.pan_status, match: report.pan_name_match, remarks: report.pan_remarks, type: 'pan' },
    { name: "Bank Account Verification", status: report.bank_status, match: report.bank_account_match, remarks: report.bank_remarks, type: 'bank' },
    { name: "Education Verification", status: report.education_status, match: null, remarks: report.education_remarks, type: 'education' },
    { name: "Employment Verification", status: report.employment_status, match: null, remarks: report.employment_remarks, type: 'employment' },
    { name: "Address Verification", status: report.address_status, match: null, remarks: report.address_remarks, type: 'address' },
    { name: "Criminal / Court Records Check", status: report.criminal_status || report.court_status || 'not_run', match: null, remarks: report.criminal_remarks || report.court_remarks, type: 'court' },
    { name: "E-Signature Verification", status: report.esignature_status, match: null, remarks: report.esignature_remarks, type: 'esignature' },
  ];

  verificationChecks.forEach((check, idx) => {
    if (currentY > 250) {
      doc.addPage();
      currentY = 15;
      pageNum++;
      drawWatermark(doc);
    }

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(check.name, 15, currentY);

    drawStatusBadge(doc, 130, currentY - 4, check.status, 30);

    currentY += 6;

    // Find matching BGV check from API logs
    const apiCheck = Array.isArray(bgvChecks) ? bgvChecks.find((c: any) => c.check_type === check.type) : null;

    const checkRows = [
      ["Status", check.status.toUpperCase()],
    ];
    if (check.match) checkRows.push(["Name/Account Match", safeText(check.match)]);
    if (apiCheck?.provider_key) checkRows.push(["Provider", safeText(apiCheck.provider_key)]);
    if (apiCheck?.provider_reference_id) checkRows.push(["Reference ID", safeText(apiCheck.provider_reference_id)]);
    if (apiCheck?.verified_at) checkRows.push(["Verified At", formatISTDate(new Date(apiCheck.verified_at))]);
    if (check.remarks) checkRows.push(["Remarks", safeText(check.remarks)]);

    autoTable(doc, {
      startY: currentY,
      head: [],
      body: checkRows,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 50 },
        1: { cellWidth: 130 },
      },
      margin: { left: 20, right: 15 },
    });

    currentY = (doc as any).lastAutoTable.finalY + 4;

    // Divider
    if (idx < verificationChecks.length - 1) {
      doc.setDrawColor(228, 229, 231);
      doc.line(15, currentY, pageWidth - 15, currentY);
      currentY += 4;
    }
  });

  drawFooter(doc, pageNum++, totalPages, reportId);

  // ═══ PAGE 8: OVERALL ASSESSMENT ═══════════════════════════════════════════════

  doc.addPage();
  currentY = 15;
  drawWatermark(doc);

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text("OVERALL ASSESSMENT", 15, currentY);
  doc.setTextColor(0, 0, 0);
  currentY += 10;

  // BGV Score Card
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("BGV Score", 15, currentY);
  currentY += 2;

  const scoreColorFinal = report.bgv_score >= 80 ? [16, 185, 129] : report.bgv_score >= 60 ? [245, 158, 11] : [220, 38, 38];
  doc.setFillColor(...scoreColorFinal);
  doc.roundedRect(15, currentY, 180, 20, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text(`${report.bgv_score} / 100`, 105, currentY + 13, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  currentY += 25;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Overall Status:", 15, currentY);
  drawStatusBadge(doc, 60, currentY - 4, report.overall_status, 40);

  currentY += 10;

  // HR Final Remarks
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("HR Final Remarks", 15, currentY);
  currentY += 2;

  const remarksText = report.hr_remarks || "No remarks provided.";
  const splitRemarks = doc.splitTextToSize(remarksText, 180);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(splitRemarks, 15, currentY + 5);
  currentY += 5 + (splitRemarks.length * 5);

  currentY += 10;

  // Audit Trail
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Audit Trail", 15, currentY);
  currentY += 2;

  autoTable(doc, {
    startY: currentY,
    head: [],
    body: [
      ["Completed By", data.completedByName || safeText(report.completed_by)],
      ["Completed At", report.completed_at ? `${formatISTDate(new Date(report.completed_at))} ${formatISTTime(new Date(report.completed_at))}` : "-"],
      ["Locked", report.locked ? "Yes - Immutable Audit Evidence" : "No"],
      ["Report Generated At", `${formatISTDate(new Date())} ${formatISTTime(new Date())}`],
      ["Generated By", "HRMS System"],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 60 },
      1: { cellWidth: 120 },
    },
    margin: { left: 15, right: 15 },
  });

  drawFooter(doc, pageNum++, totalPages, reportId);

  return doc;
}

export async function downloadBGVReportPDF(data: BGVReportData, filename?: string): Promise<void> {
  const doc = await generateBGVReportPDF(data);
  const defaultFilename = filename || `BGV-Report-${data.report?.candidate_code || 'Unknown'}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(defaultFilename);
}
