import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { buildPayslipQrData, buildQrCodeUrl } from "@/integrations/apis/qrCode.api";

// MCN brand colors — same palette as masCallnetPayslipGeneratorV2.ts
const MCN_NAVY: [number, number, number] = [7, 63, 120];
const MCN_RED: [number, number, number] = [227, 30, 37];
const MCN_LIGHT_BLUE: [number, number, number] = [232, 242, 255];
const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

/**
 * Data for the "Form IV B"-style payslip — the layout used by the reference
 * Astral Limited payslip (grid of employee details, plain earnings/deductions
 * list, boxed net-pay line, prior-month leave table) re-skinned with MCN
 * branding and colors. Kept as a distinct file/export from
 * masCallnetPayslipGeneratorV2.ts (the existing MCN-styled payslip) so the
 * currently-live generator is never touched.
 */
export interface MasCallnetPayslipV2FormatData {
  companyName: string;
  monthYear: string;
  empName: string;
  empCode: string;
  designation: string;
  department: string;
  location: string;
  employeeGroup?: string;
  epfNo?: string;
  uanNo?: string;
  esiNo?: string;
  panNo?: string;
  bankName?: string;
  bankAccount?: string;
  paymentDate?: string;
  chequeNo?: string;
  paymentMode?: string;
  wDays: number;
  /** Salary paid days — week-offs and paid holidays included. */
  earnedDays: number;
  /** Calendar days of the payroll month (31 for August). */
  calendarDays?: number;
  weekOffDays?: number;
  paidHolidays?: number;
  lwpDays?: number;
  /** Employer-side cost — employer PF, employer ESI. Not deducted from the
   *  employee; shown as an informational note, same as the existing
   *  masCallnetPayslipGeneratorV2.ts generator. */
  employerPf?: number;
  employerEsic?: number;
  basic: number;
  hra: number;
  conv: number;
  pa: number;
  ma: number;
  sa: number;
  oa: number;
  arrear: number;
  bonus: number;
  incentive: number;
  pf: number;
  esic: number;
  tds: number;
  lwpDeduction: number;
  loan: number;
  adDed: number;
  otherDed: number;
  netSalary: number;
  netSalaryWords: string;
  /** Financial-year-to-date total per line item, aligned to the same slots as
   *  the current-month amounts above. Omit a key (or the whole object) when
   *  the figure is not available — the column then prints "-" rather than a
   *  fabricated number. */
  ytd?: Partial<{
    basic: number; hra: number; conv: number; pa: number; ma: number; sa: number;
    oa: number; arrear: number; bonus: number; incentive: number;
    pf: number; esic: number; tds: number; lwpDeduction: number; loan: number;
    adDed: number; otherDed: number;
  }>;
  // Form 16 compact summary — same optional fields as masCallnetPayslipGeneratorV2.ts.
  // The section only renders when at least one of these is present.
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
}

const formatINR = (amount: number): string =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(amount);

// jsPDF's built-in helvetica has no glyph for the rupee sign (U+20B9).
const RUPEE = "Rs.";

const MARGIN_X = 12;
const CONTENT_W = 210 - MARGIN_X * 2;
const TABLE_MARGIN = { left: MARGIN_X, right: MARGIN_X };

async function loadLogoBase64(): Promise<string | null> {
  try {
    const response = await fetch("/mcn-logo.png");
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

export async function generateMasCallnetPayslipV2Format(data: MasCallnetPayslipV2FormatData): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  // ── HEADER: logo (left) + company name/title (center) + stat box (right) ──────
  const headerTop = 10;
  const logoBase64 = await loadLogoBase64();
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, "PNG", MARGIN_X, headerTop, 30, 11);
    } catch { /* skip */ }
  }

  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...MCN_NAVY);
  doc.text(data.companyName, pageWidth / 2, headerTop + 5, { align: "center" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 90, 90);
  doc.text(`Payslip for the month of ${data.monthYear}`, pageWidth / 2, headerTop + 11, { align: "center" });

  // QR code, top-right corner — same verification link the existing MCN
  // generator (masCallnetPayslipGeneratorV2.ts) prints; carried over here so
  // this format is not missing the one feature that actually matters for
  // authenticity checks. Non-fatal if the QR fails to build.
  const qrSize = 16;
  const qrX = pageWidth - MARGIN_X - qrSize;
  try {
    const qrData = buildPayslipQrData(data.empCode, data.monthYear);
    const qrUrl = await buildQrCodeUrl(qrData, 512);
    doc.addImage(qrUrl, "PNG", qrX, headerTop - 2, qrSize, qrSize);
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 120, 120);
    doc.text("Scan to verify", qrX + qrSize / 2, headerTop - 2 + qrSize + 3, { align: "center" });
  } catch { /* skip */ }

  // Calendar Days / Salary Paid Days / W.Off / P.H stat block — mirrors the reference slip's corner box,
  // shifted left of the QR code to make room for it.
  const statW = 40;
  const statX = qrX - 2 - statW;
  doc.setDrawColor(...MCN_NAVY);
  doc.setLineWidth(0.2);
  doc.rect(statX, headerTop - 2, statW, 20);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...MCN_NAVY);
  const statRow = (label: string, value: string, y: number) => {
    doc.text(label, statX + 2, y);
    doc.text(value, statX + statW - 2, y, { align: "right" });
  };
  statRow("Calendar Days:", (data.calendarDays ?? data.wDays).toFixed(2), headerTop + 2.5);
  statRow("Salary Paid Days:", data.earnedDays.toFixed(2), headerTop + 7);
  statRow("W. Off:", (data.weekOffDays ?? 0).toFixed(2), headerTop + 11.5);
  statRow("P.H:", (data.paidHolidays ?? 0).toFixed(2), headerTop + 16);

  let currentY = headerTop + 24;
  doc.setDrawColor(...MCN_NAVY);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, currentY, pageWidth - MARGIN_X, currentY);
  currentY += 3;

  // ── EMPLOYEE DETAILS GRID ───────────────────────────────────────────────────
  const lbl = (content: string) => ({
    content,
    styles: { fontStyle: "bold" as const, fillColor: MCN_LIGHT_BLUE, textColor: MCN_NAVY as [number, number, number] },
  });

  autoTable(doc, {
    startY: currentY,
    head: [],
    body: [
      [lbl("Employee Name"), data.empName, lbl("Employee No"), data.empCode],
      [lbl("Designation"), data.designation || "", lbl("Department"), data.department || ""],
      [lbl("Location"), data.location || "", lbl("Employee Group"), data.employeeGroup || "Staff"],
      [lbl("PF Account No"), data.epfNo || "N/A", lbl("UAN No"), data.uanNo || "N/A"],
      [lbl("Bank Name"), data.bankName || "N/A", lbl("Bank Account"), data.bankAccount || "N/A"],
      [lbl("Payment Date"), data.paymentDate || "N/A", lbl("ESI No"), data.esiNo || "N/A"],
      [lbl("PAN"), data.panNo || "N/A", lbl("LWP Days"), String(data.lwpDays ?? 0)],
    ],
    theme: "grid",
    margin: TABLE_MARGIN,
    styles: {
      fontSize: 8,
      cellPadding: 1.8,
      lineColor: [180, 200, 230] as [number, number, number],
      lineWidth: 0.15,
      textColor: BLACK,
      valign: "middle",
    },
    // 27 + 66 + 27 + 66 = 186 = CONTENT_W
    columnStyles: {
      0: { cellWidth: 27 },
      1: { cellWidth: 66 },
      2: { cellWidth: 27 },
      3: { cellWidth: 66 },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 3;

  // ── EARNINGS / DEDUCTIONS — one row per component, side by side ────────────
  // YTD column shows "-" rather than 0.00 when the caller has no figure for
  // that line, so an absent YTD reads as "not available", not "zero paid".
  type Line = [string, number, number | undefined];
  const ytd = data.ytd ?? {};
  const earnings: Line[] = [
    ["Basic", data.basic, ytd.basic],
    ["House Rent Allowance", data.hra, ytd.hra],
    ["Conveyance Allowance", data.conv, ytd.conv],
    ["Personal Allowance", data.pa, ytd.pa],
    ["Medical Allowance", data.ma, ytd.ma],
    ["Special Allowance", data.sa, ytd.sa],
    ["Other Allowance", data.oa, ytd.oa],
    ["Arrear", data.arrear, ytd.arrear],
    ["Bonus", data.bonus, ytd.bonus],
    ["Incentive", data.incentive, ytd.incentive],
  ].filter(([, amt]) => amt !== 0) as Line[];
  const deductions: Line[] = [
    ["Ee PF Contribution", data.pf, ytd.pf],
    ["ESIC", data.esic, ytd.esic],
    ["Income Tax (TDS)", data.tds, ytd.tds],
    ["LWP Deduction", data.lwpDeduction, ytd.lwpDeduction],
    ["Loan Recovery", data.loan, ytd.loan],
    ["Advance Deduction", data.adDed, ytd.adDed],
    ["Other Deduction", data.otherDed, ytd.otherDed],
  ].filter(([, amt]) => amt !== 0) as Line[];

  const totalEarnings = earnings.reduce((t, [, a]) => t + a, 0);
  const totalDeductions = deductions.reduce((t, [, a]) => t + a, 0);
  const hasEarningsYtd = earnings.some(([, , y]) => y !== undefined);
  const hasDeductionsYtd = deductions.some(([, , y]) => y !== undefined);
  const totalEarningsYtd = hasEarningsYtd
    ? earnings.reduce((t, [, , y]) => t + (y ?? 0), 0)
    : undefined;
  const totalDeductionsYtd = hasDeductionsYtd
    ? deductions.reduce((t, [, , y]) => t + (y ?? 0), 0)
    : undefined;

  const ytdCell = (y: number | undefined) => (y === undefined ? "-" : formatINR(y));

  const rowCount = Math.max(earnings.length, deductions.length, 1);
  const body: any[] = [];
  for (let i = 0; i < rowCount; i++) {
    body.push([
      earnings[i]?.[0] ?? "",
      earnings[i] ? formatINR(earnings[i][1]) : "",
      earnings[i] ? ytdCell(earnings[i][2]) : "",
      deductions[i]?.[0] ?? "",
      deductions[i] ? formatINR(deductions[i][1]) : "",
      deductions[i] ? ytdCell(deductions[i][2]) : "",
    ]);
  }
  body.push([
    { content: "Total Earnings", styles: { fontStyle: "bold" as const, fillColor: MCN_LIGHT_BLUE } },
    { content: formatINR(totalEarnings), styles: { fontStyle: "bold" as const, fillColor: MCN_LIGHT_BLUE, halign: "right" as const } },
    { content: ytdCell(totalEarningsYtd), styles: { fontStyle: "bold" as const, fillColor: MCN_LIGHT_BLUE, halign: "right" as const } },
    { content: "Total Deductions", styles: { fontStyle: "bold" as const, fillColor: [255, 235, 235] as [number, number, number] } },
    { content: formatINR(totalDeductions), styles: { fontStyle: "bold" as const, fillColor: [255, 235, 235] as [number, number, number], halign: "right" as const } },
    { content: ytdCell(totalDeductionsYtd), styles: { fontStyle: "bold" as const, fillColor: [255, 235, 235] as [number, number, number], halign: "right" as const } },
  ]);

  autoTable(doc, {
    startY: currentY,
    head: [[
      { content: "Earnings", styles: { fontStyle: "bold" as const, fillColor: MCN_NAVY, textColor: WHITE as [number, number, number] } },
      { content: "Amount (Rs.)", styles: { fontStyle: "bold" as const, fillColor: MCN_NAVY, textColor: WHITE as [number, number, number], halign: "right" as const } },
      { content: "YTD (Rs.)", styles: { fontStyle: "bold" as const, fillColor: MCN_NAVY, textColor: WHITE as [number, number, number], halign: "right" as const } },
      { content: "Deductions", styles: { fontStyle: "bold" as const, fillColor: MCN_RED, textColor: WHITE as [number, number, number] } },
      { content: "Amount (Rs.)", styles: { fontStyle: "bold" as const, fillColor: MCN_RED, textColor: WHITE as [number, number, number], halign: "right" as const } },
      { content: "YTD (Rs.)", styles: { fontStyle: "bold" as const, fillColor: MCN_RED, textColor: WHITE as [number, number, number], halign: "right" as const } },
    ]],
    body,
    theme: "grid",
    margin: TABLE_MARGIN,
    styles: {
      fontSize: 7.5,
      cellPadding: 1.4,
      lineColor: [200, 200, 200] as [number, number, number],
      lineWidth: 0.1,
      textColor: BLACK,
      valign: "middle",
    },
    // 41 + 26 + 26 + 41 + 26 + 26 = 186 = CONTENT_W
    columnStyles: {
      0: { cellWidth: 41 },
      1: { cellWidth: 26, halign: "right" },
      2: { cellWidth: 26, halign: "right" },
      3: { cellWidth: 41 },
      4: { cellWidth: 26, halign: "right" },
      5: { cellWidth: 26, halign: "right" },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 2;

  // ── EMPLOYER CONTRIBUTIONS (informational) ────────────────────────────────────
  if (data.employerPf || data.employerEsic) {
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    const parts: string[] = [];
    if (data.employerPf) parts.push(`Employer PF: ${RUPEE}${formatINR(data.employerPf)}`);
    if (data.employerEsic) parts.push(`Employer ESI: ${RUPEE}${formatINR(data.employerEsic)}`);
    doc.text(`Employer Contributions (not deducted from salary):  ${parts.join("  |  ")}`, MARGIN_X, currentY + 3);
    currentY += 6;
  } else {
    currentY += 2;
  }

  // ── FORM 16 COMPACT SUMMARY (only when meaningful tax data exists) ───────────
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
    const mid = Math.ceil(form16Entries.length / 2);
    const col1 = form16Entries.slice(0, mid);
    const col2 = form16Entries.slice(mid);
    const maxRows = Math.max(col1.length, col2.length);
    const form16Body: any[] = [];
    for (let i = 0; i < maxRows; i++) {
      form16Body.push([
        col1[i] ? { content: col1[i][0], styles: { fontStyle: "bold" as const, fillColor: MCN_LIGHT_BLUE, textColor: MCN_NAVY as [number, number, number] } } : "",
        col1[i] ? col1[i][1] : "",
        col2[i] ? { content: col2[i][0], styles: { fontStyle: "bold" as const, fillColor: MCN_LIGHT_BLUE, textColor: MCN_NAVY as [number, number, number] } } : "",
        col2[i] ? col2[i][1] : "",
      ]);
    }
    autoTable(doc, {
      startY: currentY,
      head: [[
        { content: "Form 16 Summary", colSpan: 4, styles: { fontStyle: "bold" as const, fillColor: MCN_NAVY, textColor: WHITE as [number, number, number], halign: "center" as const } },
      ]],
      body: form16Body,
      theme: "grid",
      margin: TABLE_MARGIN,
      styles: {
        fontSize: 7.5,
        cellPadding: 1.6,
        lineColor: [180, 200, 230] as [number, number, number],
        lineWidth: 0.1,
        textColor: BLACK,
        halign: "center",
        minCellHeight: 6,
      },
      // 48 + 45 + 48 + 45 = 186 = CONTENT_W
      columnStyles: {
        0: { cellWidth: 48, halign: "left" },
        1: { cellWidth: 45, halign: "right" },
        2: { cellWidth: 48, halign: "left" },
        3: { cellWidth: 45, halign: "right" },
      },
    });
    currentY = (doc as any).lastAutoTable.finalY + 4;
  }

  // ── NET PAY LINE ─────────────────────────────────────────────────────────────
  const netBandH = 10;
  if (currentY + netBandH + 20 > doc.internal.pageSize.getHeight() - MARGIN_X) {
    doc.addPage();
    currentY = MARGIN_X;
  }
  doc.setFillColor(...MCN_NAVY);
  doc.rect(MARGIN_X, currentY, CONTENT_W, netBandH, "F");

  // Cheque/UTR info (left) — only when payment details exist, same as the
  // existing masCallnetPayslipGeneratorV2.ts generator.
  if (data.chequeNo) {
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...WHITE);
    const chequeLabel = `Cheque/UTR: ${data.chequeNo}${data.paymentMode ? `  |  ${data.paymentMode}` : ""}`;
    doc.text(chequeLabel, MARGIN_X + 4, currentY + 6.5);
  }

  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...WHITE);
  doc.text(`Net Pay: ${RUPEE} ${formatINR(data.netSalary)}`, pageWidth - MARGIN_X - 4, currentY + 6.5, { align: "right" });
  currentY += netBandH + 5;

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...MCN_NAVY);
  // netSalaryWords (numberToWords()) already ends in "Only" — appending it again
  // here previously printed "... Only Only)".
  doc.text(`(Rupees ${data.netSalaryWords})`, MARGIN_X, currentY);
  currentY += 8;

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(90, 90, 90);
  doc.text("This is system generated document, hence no signature required.", MARGIN_X, currentY);
  currentY += 4;

  // No "Prior Month Adjusted Leave Data" section — that's an Astral-specific
  // concept (leave encashment/adjustment against pay). MCN does not adjust
  // leave for money, so this reference slip's bottom table does not apply here.

  // ── OUTER BORDER ─────────────────────────────────────────────────────────────
  // The reference Astral slip encloses the whole document in one continuous box.
  // Only drawn when everything fit on one page — spanning a box across a page
  // break would need per-page bottom/top edges this generator doesn't track.
  // getNumberOfPages() exists at runtime but is missing from jsPDF's type
  // declarations for `internal` — same gap masCallnetPayslipGeneratorV2.ts
  // already works around for setLineDash.
  if ((doc.internal as any).getNumberOfPages() === 1) {
    const boxTop = headerTop - 4;
    const boxBottom = currentY + 2;
    doc.setDrawColor(...MCN_NAVY);
    doc.setLineWidth(0.4);
    doc.rect(MARGIN_X - 2, boxTop, CONTENT_W + 4, boxBottom - boxTop);
  }

  return doc;
}

export async function downloadMasCallnetPayslipV2Format(data: MasCallnetPayslipV2FormatData, filename: string) {
  const doc = await generateMasCallnetPayslipV2Format(data);
  doc.save(filename);
}
