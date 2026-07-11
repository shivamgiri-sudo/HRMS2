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
  location: string;
  wDays: number;
  earnedDays: number;
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
  loan: number;
  adDed: number;
  otherDed: number;
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
  const headerH = 22;
  doc.setFillColor(...MCN_NAVY);
  doc.rect(0, 0, pageWidth, headerH, "F");

  // Logo (top-left inside band)
  const logoBase64 = await loadLogoBase64();
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', 4, 2, 32, 11);
    } catch { /* skip */ }
  }

  // QR code (top-right inside band)
  try {
    const qrData = buildPayslipQrData(data.empCode, data.monthYear);
    const qrUrl = await buildQrCodeUrl(qrData, 80);
    const qrSize = 14;
    const qrX = pageWidth - 4 - qrSize;
    doc.addImage(qrUrl, 'PNG', qrX, 2, qrSize, qrSize);
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(200, 220, 255);
    doc.text("Scan to verify", qrX + qrSize / 2, 17.5, { align: "center" });
  } catch { /* skip */ }

  // Company name centered in band
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...WHITE);
  doc.text("MAS CALLNET INDIA PVT. LTD.", pageWidth / 2, 10, { align: "center" });

  // Month subtitle
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(190, 215, 255);
  doc.text(`Payslip — ${data.monthYear}`, pageWidth / 2, 17, { align: "center" });

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
        lbl("EPF No"), data.epfNo || "",
        lbl("Location"), data.location || "",
      ],
      [
        lbl("ESI No"), data.esiNo || "",
        lbl("Working Days"), String(data.wDays),
        lbl("Earned Days"), String(data.earnedDays),
      ],
    ],
    theme: "grid",
    styles: {
      fontSize: 8.5,
      cellPadding: 2,
      lineColor: [180, 200, 230] as [number, number, number],
      lineWidth: 0.15,
      textColor: [0, 0, 0],
      halign: "left",
      valign: "middle",
      minCellHeight: 7,
      overflow: "linebreak",
    },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 36 },
      2: { cellWidth: 24 },
      3: { cellWidth: 32 },
      4: { cellWidth: 24 },
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
        { content: "", styles: { fillColor: [255, 245, 245] as [number, number, number] } },
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
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [210, 180, 180] as [number, number, number],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
    },
    columnStyles: { 0: { cellWidth: 18, halign: "left" } },
    headStyles: { minCellHeight: 7 },
    bodyStyles: { minCellHeight: 7 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 2;

  // ── DEDUCTIONS SECTION ────────────────────────────────────────────────────────
  const totalDeductions = data.pf + data.esic + data.loan + data.adDed + data.otherDed;

  const dedHeaderStyle = { fontStyle: "bold" as const, fillColor: MCN_BLUE, textColor: WHITE as [number, number, number], halign: "center" as const };
  const dedValueStyle = { fillColor: [240, 245, 255] as [number, number, number], halign: "center" as const };

  autoTable(doc, {
    startY: currentY,
    head: [
      [
        { content: "DEDUCTIONS", styles: { ...dedHeaderStyle, halign: "left" as const } },
        { content: "PF", styles: dedHeaderStyle },
        { content: "ESIC", styles: dedHeaderStyle },
        { content: "Loan", styles: dedHeaderStyle },
        { content: "Advance", styles: dedHeaderStyle },
        { content: "Other", styles: dedHeaderStyle },
        { content: "", styles: { fillColor: MCN_BLUE, textColor: WHITE as [number, number, number] } },
        { content: "", styles: { fillColor: MCN_BLUE, textColor: WHITE as [number, number, number] } },
        { content: "", styles: { fillColor: MCN_BLUE, textColor: WHITE as [number, number, number] } },
        { content: "", styles: { fillColor: MCN_BLUE, textColor: WHITE as [number, number, number] } },
        { content: "", styles: { fillColor: MCN_BLUE, textColor: WHITE as [number, number, number] } },
        { content: "Total", styles: { ...dedHeaderStyle, fillColor: [5, 50, 100] as [number, number, number] } },
      ],
    ],
    body: [
      [
        { content: "", styles: { fillColor: [240, 245, 255] as [number, number, number] } },
        { content: formatINR(data.pf), styles: dedValueStyle },
        { content: formatINR(data.esic), styles: dedValueStyle },
        { content: formatINR(data.loan), styles: dedValueStyle },
        { content: formatINR(data.adDed), styles: dedValueStyle },
        { content: formatINR(data.otherDed), styles: dedValueStyle },
        { content: "", styles: { fillColor: LIGHT_GRAY } },
        { content: "", styles: { fillColor: LIGHT_GRAY } },
        { content: "", styles: { fillColor: LIGHT_GRAY } },
        { content: "", styles: { fillColor: LIGHT_GRAY } },
        { content: "", styles: { fillColor: LIGHT_GRAY } },
        { content: formatINR(totalDeductions), styles: { fontStyle: "bold" as const, halign: "center" as const, fillColor: [220, 230, 255] as [number, number, number] } },
      ],
    ],
    theme: "grid",
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [180, 200, 230] as [number, number, number],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
    },
    columnStyles: { 0: { cellWidth: 18, halign: "left" } },
    headStyles: { minCellHeight: 7 },
    bodyStyles: { minCellHeight: 7 },
  });

  currentY = (doc as any).lastAutoTable.finalY + 3;

  // ── FORM 16 COMPACT SUMMARY ───────────────────────────────────────────────────
  const form16Entries: [string, string][] = [];
  if (data.grossSalary) form16Entries.push(["Gross Salary", formatINR(data.grossSalary)]);
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
      styles: {
        fontSize: 7.5,
        cellPadding: 1.8,
        lineColor: [180, 200, 230] as [number, number, number],
        lineWidth: 0.1,
        textColor: [0, 0, 0],
        halign: "center",
        minCellHeight: 6,
      },
      columnStyles: {
        0: { cellWidth: 42, halign: "left" },
        1: { cellWidth: 38, halign: "right" },
        2: { cellWidth: 42, halign: "left" },
        3: { cellWidth: 38, halign: "right" },
      },
    });
    currentY = (doc as any).lastAutoTable.finalY + 4;
  } else {
    currentY += 2;
  }

  // ── NET SALARY BAND ───────────────────────────────────────────────────────────
  const netBandH = 14;
  doc.setFillColor(...MCN_NAVY);
  doc.rect(14, currentY, pageWidth - 28, netBandH, "F");

  // Cheque/UTR info (left)
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...WHITE);
  const chequeLabel = data.chequeNo
    ? `Cheque/UTR: ${data.chequeNo}${data.paymentMode ? `  |  ${data.paymentMode}` : ""}${data.paymentDate ? `  |  ${data.paymentDate}` : ""}`
    : "Payment details not yet uploaded";
  doc.text(chequeLabel, 18, currentY + 6);

  // Net salary (right)
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...WHITE);
  doc.text(`Net Salary : ₹ ${formatINR(data.netSalary)}`, pageWidth - 18, currentY + 6, { align: "right" });

  currentY += netBandH + 3;

  // ── NET SALARY IN WORDS ───────────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...MCN_NAVY);
  doc.text(data.netSalaryWords, pageWidth / 2, currentY, { align: "center" });

  currentY += 8;

  // ── FOOTER ────────────────────────────────────────────────────────────────────
  doc.setDrawColor(...MCN_NAVY);
  doc.setLineDash([1.5, 1], 0);
  doc.line(14, currentY, pageWidth - 14, currentY);

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
