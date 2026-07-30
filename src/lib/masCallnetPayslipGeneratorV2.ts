import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { buildPayslipQrData, buildQrCodeUrl } from "@/integrations/apis/qrCode.api";

// MCN brand colors
const MCN_NAVY: [number, number, number] = [7, 63, 120];
const MCN_RED: [number, number, number] = [227, 30, 37];
const MCN_BLUE: [number, number, number] = [10, 77, 144];
const MCN_LIGHT_BLUE: [number, number, number] = [232, 242, 255];
const WHITE: [number, number, number] = [255, 255, 255];
const LIGHT_GRAY: [number, number, number] = [245, 245, 245];

interface MasCallnetPayslipData {
  companyName: string;
  monthYear: string;
  empName: string;
  empCode: string;
  esiNo?: string;
  designation: string;
  department: string;
  epfNo?: string;
  uanNo?: string;
  panNo?: string;
  bankAccount?: string;
  location: string;
  wDays: number;
  earnedDays: number;
  lwpDays?: number;
  totalDaysInMonth?: number;
  basic: number;
  hra: number;
  bonus: number;
  conv: number;
  pa: number;
  ma: number;
  sa: number;
  oa: number;
  arrear: number;
  incentive: number;
  pf: number;
  esic: number;
  pt: number;
  tds: number;
  lwpDeduction: number;
  loan: number;
  adDed: number;
  otherDed: number;
  employerPf?: number;
  employerEsic?: number;
  grossSalary?: number;
  exemptionUs10?: number;
  balance?: number;
  deductionUs24?: number;
  grossTotalIncome?: number;
  aggOffChapVi?: number;
  totalIncome?: number;
  taxOnTotal?: number;
  taxPayableEduCess?: number;
  incomeTax?: number;
  chequeNo?: string;
  paymentMode?: string;
  paymentDate?: string;
  netSalary: number;
  netSalaryWords: string;
}

const formatINR = (amount: number): string => {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(amount);
};

// jsPDF's built-in helvetica is WinAnsi-encoded and has no glyph for the rupee sign
// (U+20B9) or the em dash (U+2014) — they rendered as stray characters on the slip.
// "Rs." is what the rest of this document already uses.
const RUPEE = "Rs.";

/** "June - 2026" → "June 2026" for display; the raw form is kept for the QR URL. */
const displayPeriod = (monthYear: string): string => monthYear.replace(/\s*-\s*/, " ").trim();

// Page geometry — every table is pinned to these so column widths are deterministic
// rather than depending on jspdf-autotable's default margin.
const MARGIN_X = 14;
const CONTENT_W = 210 - MARGIN_X * 2; // 182mm usable on A4 portrait
// Every table's column widths must sum to exactly CONTENT_W. jspdf-autotable logs
// "could not fit page" for any mismatch in either direction, and a short sum leaves
// a ragged right edge against the full-width header and net-salary bands.
const TABLE_MARGIN = { left: MARGIN_X, right: MARGIN_X };

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
  } catch {
    return null;
  }
}

export async function generateMasCallnetPayslip(data: MasCallnetPayslipData): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  // ── NAVY HEADER BAND ──────────────────────────────────────────────────────────
  // 26mm rather than 22mm so the QR can be drawn large enough to scan reliably
  // and still leave room for its caption inside the band.
  const headerH = 26;
  doc.setFillColor(...MCN_NAVY);
  doc.rect(0, 0, pageWidth, headerH, "F");

  // Logo (top-left inside band)
  const logoBase64 = await loadLogoBase64();
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', 4, 5, 32, 11);
    } catch { /* skip */ }
  }

  // QR code (top-right inside band). Rendered at 512px so it stays sharp in print,
  // and sized 18mm: at the previous 15mm the modules fell below what a phone camera
  // resolves off a screen, so the code only decoded from a 300dpi printout.
  try {
    const qrData = buildPayslipQrData(data.empCode, data.monthYear);
    const qrUrl = await buildQrCodeUrl(qrData, 512);
    const qrSize = 18;
    const qrX = pageWidth - 4 - qrSize;
    doc.addImage(qrUrl, 'PNG', qrX, 3, qrSize, qrSize);
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(200, 220, 255);
    doc.text("Scan to verify", qrX + qrSize / 2, 24, { align: "center" });
  } catch { /* skip */ }

  // Company name centered in band
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...WHITE);
  doc.text("MAS CALLNET INDIA PVT. LTD.", pageWidth / 2, 12, { align: "center" });

  // Month subtitle
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(190, 215, 255);
  doc.text(`Payslip for ${displayPeriod(data.monthYear)}`, pageWidth / 2, 20, { align: "center" });

  let currentY = headerH + 3;

  // ── EMPLOYEE DETAILS TABLE ─────────────────────────────────────────────────────
  const lbl = (content: string) => ({
    content,
    styles: { fontStyle: "bold" as const, fillColor: MCN_LIGHT_BLUE, textColor: MCN_NAVY as [number, number, number] },
  });

  autoTable(doc, {
    startY: currentY,
    head: [],
    body: [
      [
        lbl("Employee Name"), data.empName,
        lbl("Designation"), data.designation || "",
        lbl("Department"), data.department || "",
      ],
      [
        lbl("Emp Code"), data.empCode,
        lbl("UAN / EPF No"), data.uanNo || data.epfNo || "",
        lbl("Location"), data.location || "",
      ],
      [
        lbl("ESI No"), data.esiNo || "",
        lbl("PAN"), data.panNo || "",
        lbl("Bank A/c"), data.bankAccount || "",
      ],
      [
        lbl("Days in Month"), String(data.totalDaysInMonth ?? data.wDays),
        lbl("Paid Days"), String(data.earnedDays),
        lbl("LWP Days"), String(data.lwpDays ?? 0),
      ],
    ],
    theme: "grid",
    margin: TABLE_MARGIN,
    styles: {
      fontSize: 8,
      cellPadding: 1.6,
      lineColor: [180, 200, 230] as [number, number, number],
      lineWidth: 0.15,
      textColor: [0, 0, 0],
      halign: "left",
      valign: "middle",
      minCellHeight: 7,
      overflow: "linebreak",
    },
    // 26 + 38 + 24 + 36 + 22 + 36 = 182 = CONTENT_W
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 38 },
      2: { cellWidth: 24 },
      3: { cellWidth: 36 },
      4: { cellWidth: 22 },
      5: { cellWidth: 36 },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 3;

  // ── EARNINGS SECTION ──────────────────────────────────────────────────────────
  const totalEarnings = data.basic + data.hra + data.bonus + data.conv + data.pa + data.ma + data.sa + data.oa + data.arrear + data.incentive;

  const earningsHeaderStyle = { fontStyle: "bold" as const, fillColor: MCN_RED, textColor: WHITE as [number, number, number], halign: "center" as const };
  const earningsValueStyle = { fillColor: [255, 245, 245] as [number, number, number], halign: "center" as const };

  autoTable(doc, {
    startY: currentY,
    head: [
      [
        { content: "EARNINGS", styles: { ...earningsHeaderStyle, halign: "left" as const } },
        { content: "Basic", styles: earningsHeaderStyle },
        { content: "HRA", styles: earningsHeaderStyle },
        { content: "Bonus", styles: earningsHeaderStyle },
        { content: "Conv", styles: earningsHeaderStyle },
        { content: "PA", styles: earningsHeaderStyle },
        { content: "MA", styles: earningsHeaderStyle },
        { content: "SA", styles: earningsHeaderStyle },
        { content: "OA", styles: earningsHeaderStyle },
        { content: "Arrear", styles: earningsHeaderStyle },
        { content: "Incentive", styles: earningsHeaderStyle },
        { content: "Total", styles: { ...earningsHeaderStyle, fillColor: [180, 20, 25] as [number, number, number] } },
      ],
    ],
    body: [
      [
        { content: "Amount (Rs.)", styles: { fillColor: [255, 245, 245] as [number, number, number], fontStyle: "bold" as const, textColor: [120, 20, 25] as [number, number, number], fontSize: 7 } },
        { content: formatINR(data.basic), styles: earningsValueStyle },
        { content: formatINR(data.hra), styles: earningsValueStyle },
        { content: formatINR(data.bonus), styles: earningsValueStyle },
        { content: formatINR(data.conv), styles: earningsValueStyle },
        { content: formatINR(data.pa), styles: earningsValueStyle },
        { content: formatINR(data.ma), styles: earningsValueStyle },
        { content: formatINR(data.sa), styles: earningsValueStyle },
        { content: formatINR(data.oa), styles: earningsValueStyle },
        { content: formatINR(data.arrear), styles: earningsValueStyle },
        { content: formatINR(data.incentive), styles: earningsValueStyle },
        { content: formatINR(totalEarnings), styles: { fontStyle: "bold" as const, halign: "center" as const, fillColor: [255, 235, 235] as [number, number, number] } },
      ],
    ],
    theme: "grid",
    margin: TABLE_MARGIN,
    styles: {
      // 12 currency columns on A4 portrait only fit at this size — at 8pt every
      // amount wrapped, splitting figures like "1,25,000.50" across two lines.
      fontSize: 6.5,
      cellPadding: 0.8,
      lineColor: [210, 180, 180] as [number, number, number],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
      valign: "middle",
    },
    // 20 + (10 x 14.2) + 20 = 182 = CONTENT_W
    columnStyles: {
      0: { cellWidth: 20, halign: "left", fontSize: 7 },
      1: { cellWidth: 14.2 }, 2: { cellWidth: 14.2 }, 3: { cellWidth: 14.2 },
      4: { cellWidth: 14.2 }, 5: { cellWidth: 14.2 }, 6: { cellWidth: 14.2 },
      7: { cellWidth: 14.2 }, 8: { cellWidth: 14.2 }, 9: { cellWidth: 14.2 },
      10: { cellWidth: 14.2 },
      11: { cellWidth: 20 },
    },
    headStyles: { minCellHeight: 7 },
    bodyStyles: { minCellHeight: 7 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 2;

  // ── DEDUCTIONS SECTION ────────────────────────────────────────────────────────
  // Use the authoritative net/gross from payroll rather than recomputing,
  // since LWP is already reflected in reduced gross (not a cash deduction from net)
  const computedDeductions = data.pf + data.esic + data.pt + data.tds + data.loan + data.adDed + data.otherDed;
  const totalDeductions = (data.grossSalary && data.netSalary)
    ? (data.grossSalary - data.netSalary)
    : computedDeductions;

  const dedHeaderStyle = { fontStyle: "bold" as const, fillColor: MCN_BLUE, textColor: WHITE as [number, number, number], halign: "center" as const };
  const dedValueStyle = { fillColor: [240, 245, 255] as [number, number, number], halign: "center" as const };

  autoTable(doc, {
    startY: currentY,
    head: [
      [
        { content: "DEDUCTIONS", styles: { ...dedHeaderStyle, halign: "left" as const } },
        { content: "PF", styles: dedHeaderStyle },
        { content: "ESIC", styles: dedHeaderStyle },
        { content: "PT", styles: dedHeaderStyle },
        { content: "TDS", styles: dedHeaderStyle },
        { content: "Loan", styles: dedHeaderStyle },
        { content: "Advance", styles: dedHeaderStyle },
        { content: "Other", styles: dedHeaderStyle },
        { content: "Total", styles: { ...dedHeaderStyle, fillColor: [5, 50, 100] as [number, number, number] } },
      ],
    ],
    body: [
      [
        { content: "Amount (Rs.)", styles: { fillColor: [240, 245, 255] as [number, number, number], fontStyle: "bold" as const, textColor: MCN_NAVY as [number, number, number], fontSize: 7 } },
        { content: formatINR(data.pf), styles: dedValueStyle },
        { content: formatINR(data.esic), styles: dedValueStyle },
        { content: formatINR(data.pt), styles: dedValueStyle },
        { content: formatINR(data.tds), styles: dedValueStyle },
        { content: formatINR(data.loan), styles: dedValueStyle },
        { content: formatINR(data.adDed), styles: dedValueStyle },
        { content: formatINR(data.otherDed), styles: dedValueStyle },
        { content: formatINR(totalDeductions), styles: { fontStyle: "bold" as const, halign: "center" as const, fillColor: [220, 230, 255] as [number, number, number] } },
      ],
    ],
    theme: "grid",
    margin: TABLE_MARGIN,
    styles: {
      fontSize: 7.5,
      cellPadding: 1.2,
      lineColor: [180, 200, 230] as [number, number, number],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
      valign: "middle",
    },
    // 24 + (7 x 19.6) + 20.8 = 182 = CONTENT_W. The label column needs ~24mm so
    // "DEDUCTIONS" stays on one line instead of breaking into "DEDUCTI / ONS".
    columnStyles: {
      0: { cellWidth: 24, halign: "left", fontSize: 7 },
      1: { cellWidth: 19.6 }, 2: { cellWidth: 19.6 }, 3: { cellWidth: 19.6 },
      4: { cellWidth: 19.6 }, 5: { cellWidth: 19.6 }, 6: { cellWidth: 19.6 },
      7: { cellWidth: 19.6 },
      8: { cellWidth: 20.8 },
    },
    headStyles: { minCellHeight: 7 },
    bodyStyles: { minCellHeight: 7 },
  });

  // ── EMPLOYER CONTRIBUTION (informational) ─────────────────────────────────────
  if (data.employerPf || data.employerEsic) {
    currentY = (doc as any).lastAutoTable.finalY + 2;
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    const parts: string[] = [];
    if (data.employerPf) parts.push(`Employer PF: Rs.${formatINR(data.employerPf)}`);
    if (data.employerEsic) parts.push(`Employer ESI: Rs.${formatINR(data.employerEsic)}`);
    doc.text(`Employer Contributions (not deducted from salary):  ${parts.join("  |  ")}`, 14, currentY + 3);
    currentY += 6;
  } else {
    currentY = (doc as any).lastAutoTable.finalY + 3;
  }

  // ── FORM 16 COMPACT SUMMARY (only show if meaningful tax data exists) ────────
  const form16Entries: [string, string][] = [];
  if (data.exemptionUs10) form16Entries.push(["Exemption U/S 10", formatINR(data.exemptionUs10)]);
  if (data.balance) form16Entries.push(["Balance", formatINR(data.balance)]);
  if (data.deductionUs24) form16Entries.push(["Deduction U/S 24", formatINR(data.deductionUs24)]);
  if (data.grossTotalIncome) form16Entries.push(["Gross Total Income", formatINR(data.grossTotalIncome)]);
  if (data.aggOffChapVi) form16Entries.push(["Agg Off Chap VI", formatINR(data.aggOffChapVi)]);
  if (data.totalIncome) form16Entries.push(["Total Income", formatINR(data.totalIncome)]);
  if (data.taxOnTotal) form16Entries.push(["Tax on Total", formatINR(data.taxOnTotal)]);
  if (data.taxPayableEduCess) form16Entries.push(["Tax + Edu Cess", formatINR(data.taxPayableEduCess)]);
  if (data.incomeTax) form16Entries.push(["Income Tax (TDS)", formatINR(data.incomeTax)]);

  if (form16Entries.length > 0) {
    // Split into two columns for compact display
    const mid = Math.ceil(form16Entries.length / 2);
    const col1 = form16Entries.slice(0, mid);
    const col2 = form16Entries.slice(mid);
    const maxRows = Math.max(col1.length, col2.length);
    const body: any[] = [];
    for (let i = 0; i < maxRows; i++) {
      body.push([
        col1[i] ? { content: col1[i][0], styles: { fontStyle: "bold" as const, fillColor: MCN_LIGHT_BLUE, textColor: MCN_NAVY as [number, number, number] } } : { content: "", styles: { fillColor: LIGHT_GRAY } },
        col1[i] ? col1[i][1] : "",
        col2[i] ? { content: col2[i][0], styles: { fontStyle: "bold" as const, fillColor: MCN_LIGHT_BLUE, textColor: MCN_NAVY as [number, number, number] } } : { content: "", styles: { fillColor: LIGHT_GRAY } },
        col2[i] ? col2[i][1] : "",
      ]);
    }

    autoTable(doc, {
      startY: currentY,
      head: [[
        { content: "Form 16 Summary", colSpan: 4, styles: { fontStyle: "bold" as const, fillColor: MCN_NAVY, textColor: WHITE as [number, number, number], halign: "center" as const } },
      ]],
      body,
      theme: "grid",
      margin: TABLE_MARGIN,
      styles: {
        fontSize: 7.5,
        cellPadding: 1.8,
        lineColor: [180, 200, 230] as [number, number, number],
        lineWidth: 0.1,
        textColor: [0, 0, 0],
        halign: "center",
        minCellHeight: 6,
      },
      // 48 + 43 + 48 + 43 = 182 = CONTENT_W
      columnStyles: {
        0: { cellWidth: 48, halign: "left" },
        1: { cellWidth: 43, halign: "right" },
        2: { cellWidth: 48, halign: "left" },
        3: { cellWidth: 43, halign: "right" },
      },
    });
    currentY = (doc as any).lastAutoTable.finalY + 4;
  } else {
    currentY += 2;
  }

  // ── NET SALARY BAND ───────────────────────────────────────────────────────────
  const netBandH = 14;

  // The band, the words line and the footer are drawn manually, so unlike the tables
  // they will not paginate themselves. Break first if the closing block cannot fit.
  const CLOSING_BLOCK_H = netBandH + 3 + 8 + 12;
  if (currentY + CLOSING_BLOCK_H > doc.internal.pageSize.getHeight() - MARGIN_X) {
    doc.addPage();
    currentY = MARGIN_X;
  }

  doc.setFillColor(...MCN_NAVY);
  doc.rect(MARGIN_X, currentY, CONTENT_W, netBandH, "F");

  // Cheque/UTR info (left) — only show when payment details exist
  if (data.chequeNo) {
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...WHITE);
    const chequeLabel = `Cheque/UTR: ${data.chequeNo}${data.paymentMode ? `  |  ${data.paymentMode}` : ""}${data.paymentDate ? `  |  ${data.paymentDate}` : ""}`;
    doc.text(chequeLabel, 18, currentY + 6);
  }

  // Net salary (right)
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...WHITE);
  doc.text(`Net Salary : ${RUPEE} ${formatINR(data.netSalary)}`, pageWidth - 18, currentY + 6, { align: "right" });

  currentY += netBandH + 3;

  // ── NET SALARY IN WORDS ───────────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...MCN_NAVY);
  doc.text(`In Words: ${data.netSalaryWords}`, pageWidth / 2, currentY, { align: "center" });

  currentY += 8;

  // ── FOOTER ────────────────────────────────────────────────────────────────────
  doc.setDrawColor(...MCN_NAVY);
  // setLineDash exists at runtime but is missing from jsPDF's type declarations.
  (doc as any).setLineDash([1.5, 1], 0);
  doc.line(MARGIN_X, currentY, pageWidth - MARGIN_X, currentY);
  // Reset, or the dash pattern leaks into anything drawn after this line.
  (doc as any).setLineDash([], 0);

  currentY += 4;
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);
  doc.text("This is a computer generated statement, no signature required.", pageWidth / 2, currentY, { align: "center" });

  return doc;
}

export async function downloadMasCallnetPayslip(data: MasCallnetPayslipData, filename: string) {
  const doc = await generateMasCallnetPayslip(data);
  doc.save(filename);
}
