import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface MasCallnetPayslipData {
  // Header
  companyName: string;
  monthYear: string; // "Jun - 2025"

  // Employee details
  empName: string;
  empCode: string;
  esiNo?: string;
  designation: string;
  department: string;
  epfNo?: string;
  location: string;
  wDays: number;
  earnedDays: number;

  // Earnings
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

  // Deductions
  pf: number;
  esic: number;
  loan: number;
  adDed: number;
  otherDed: number;

  // Form 16 Summary (optional)
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

  // Net
  chequeNo?: string;
  netSalary: number;
  netSalaryWords: string; // "Seventy Nine Thousand Sixty Two Only"
}

const formatINR = (amount: number): string => {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(amount);
};

export function generateMasCallnetPayslip(data: MasCallnetPayslipData): jsPDF {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let currentY = 20;

  // === HEADER ===
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(data.companyName, pageWidth / 2, currentY, { align: "center" });

  currentY += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Month For : ${data.monthYear}`, pageWidth / 2, currentY, { align: "center" });

  currentY += 10;

  // === EMPLOYEE DETAILS TABLE ===
  const detailsData = [
    [
      { content: "Emp Name", styles: { fontStyle: "bold" } },
      { content: data.empName, styles: { colSpan: 2 } },
      null,
      { content: "Designation", styles: { fontStyle: "bold" } },
      data.designation,
      { content: "Department", styles: { fontStyle: "bold" } },
      data.department,
    ],
    [
      { content: "Emp Code", styles: { fontStyle: "bold" } },
      data.empCode,
      { content: "EPF No", styles: { fontStyle: "bold" } },
      data.epfNo || "",
      { content: "Location", styles: { fontStyle: "bold" } },
      { content: data.location, styles: { colSpan: 2 } },
      null,
    ],
    [
      { content: "ESI No", styles: { fontStyle: "bold" } },
      data.esiNo || "",
      { content: "W Days", styles: { fontStyle: "bold" } },
      String(data.wDays),
      { content: "Earned Days", styles: { fontStyle: "bold" } },
      { content: String(data.earnedDays), styles: { colSpan: 2 } },
      null,
    ],
  ];

  autoTable(doc, {
    startY: currentY,
    head: [],
    body: detailsData,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.1 },
    columnStyles: {
      0: { cellWidth: 20, fillColor: [240, 240, 240] },
      1: { cellWidth: 30 },
      2: { cellWidth: 20, fillColor: [240, 240, 240] },
      3: { cellWidth: 30 },
      4: { cellWidth: 20, fillColor: [240, 240, 240] },
      5: { cellWidth: 30 },
      6: { cellWidth: 30 },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 5;

  // === EARNINGS & DEDUCTIONS ===
  const totalEarnings = data.basic + data.hra + data.bonus + data.conv + data.pa + data.ma + data.sa + data.oa + data.arrear + data.incentive;
  const totalDeductions = data.pf + data.esic + data.loan + data.adDed + data.otherDed;

  const earningsDeductionsData = [
    [
      { content: "Earnings", styles: { fontStyle: "bold", halign: "center", fillColor: [220, 220, 220] } },
      { content: "Basic", styles: { fontStyle: "bold", halign: "center" } },
      { content: "HRA", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Bonus", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Conv", styles: { fontStyle: "bold", halign: "center" } },
      { content: "PA", styles: { fontStyle: "bold", halign: "center" } },
      { content: "MA", styles: { fontStyle: "bold", halign: "center" } },
      { content: "SA", styles: { fontStyle: "bold", halign: "center" } },
      { content: "OA", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Arrear", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Incentive", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Total Earn", styles: { fontStyle: "bold", halign: "center" } },
    ],
    [
      { content: "", styles: { fillColor: [220, 220, 220] } },
      formatINR(data.basic),
      formatINR(data.hra),
      formatINR(data.bonus),
      formatINR(data.conv),
      formatINR(data.pa),
      formatINR(data.ma),
      formatINR(data.sa),
      formatINR(data.oa),
      formatINR(data.arrear),
      formatINR(data.incentive),
      formatINR(totalEarnings),
    ],
    [
      { content: "Deductions", styles: { fontStyle: "bold", halign: "center", fillColor: [220, 220, 220] } },
      { content: "PF", styles: { fontStyle: "bold", halign: "center" } },
      { content: "ESIC", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Loan", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Ad.Ded", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Other Ded", styles: { fontStyle: "bold", halign: "center", colSpan: 6 } },
      null, null, null, null, null,
      { content: "Total Ded", styles: { fontStyle: "bold", halign: "center" } },
    ],
    [
      { content: "", styles: { fillColor: [220, 220, 220] } },
      formatINR(data.pf),
      formatINR(data.esic),
      formatINR(data.loan),
      formatINR(data.adDed),
      { content: formatINR(data.otherDed), styles: { colSpan: 6 } },
      null, null, null, null, null,
      formatINR(totalDeductions),
    ],
  ];

  autoTable(doc, {
    startY: currentY,
    head: [],
    body: earningsDeductionsData,
    theme: "grid",
    styles: { fontSize: 7, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.1, halign: "right" },
    columnStyles: {
      0: { cellWidth: 20, halign: "center" },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 5;

  // === FORM 16 SUMMARY ===
  const form16Data = [
    [
      { content: "Form 16\nSummary", styles: { fontStyle: "bold", halign: "center", fillColor: [220, 220, 220], valign: "middle" } },
      { content: "Gross\nSalary", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Exemption\nU/S 10", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Balance", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Deduction\nU/S 24", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Gross\nTotal\nIncome", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Agg Off\nChap VI", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Total\nIncome", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Tax On\nTotal", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Tax\nPayable &\nEdu Cess", styles: { fontStyle: "bold", halign: "center" } },
      { content: "Income\nTax", styles: { fontStyle: "bold", halign: "center" } },
    ],
    [
      { content: "", styles: { fillColor: [220, 220, 220] } },
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      formatINR(data.incomeTax || 0),
    ],
  ];

  autoTable(doc, {
    startY: currentY,
    head: [],
    body: form16Data,
    theme: "grid",
    styles: { fontSize: 7, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.1, halign: "center" },
    columnStyles: {
      0: { cellWidth: 20 },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 8;

  // === NET SALARY ===
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(`Cheque No : ${data.chequeNo || ""}`, 15, currentY);
  doc.text(`Net Salary : ${formatINR(data.netSalary)}`, pageWidth - 15, currentY, { align: "right" });

  currentY += 6;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(data.netSalaryWords, pageWidth / 2, currentY, { align: "center" });

  currentY += 10;

  // === FOOTER ===
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text("This is a computer generated statement, hence not signature required", pageWidth / 2, currentY, { align: "center" });

  // Dotted separator line
  currentY += 5;
  doc.setLineDash([1, 1], 0);
  doc.line(15, currentY, pageWidth - 15, currentY);

  return doc;
}

export function downloadMasCallnetPayslip(data: MasCallnetPayslipData, filename: string) {
  const doc = generateMasCallnetPayslip(data);
  doc.save(filename);
}
