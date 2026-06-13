import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
  netSalary: number;
  netSalaryWords: string;
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
  let currentY = 12;

  // === MAS LOGO (Top Left) ===
  // Draw Mas logo with colored circles
  doc.setFillColor(231, 76, 60); // Red circle
  doc.circle(18, currentY + 3, 2.5, 'F');
  doc.setFillColor(46, 204, 113); // Green circle
  doc.circle(23, currentY + 3, 2.5, 'F');
  doc.setFillColor(52, 152, 219); // Blue circle
  doc.circle(28, currentY + 3, 2.5, 'F');

  // "Mas" text next to logo
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(50, 50, 50);
  doc.text("Mas", 31, currentY + 4.5);

  // === COMPANY NAME (Centered) ===
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text(data.companyName, pageWidth / 2, currentY + 4, { align: "center" });

  currentY += 10;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);
  doc.text(`Month For : ${data.monthYear}`, pageWidth / 2, currentY, { align: "center" });

  currentY += 6;

  // === EMPLOYEE DETAILS TABLE ===
  autoTable(doc, {
    startY: currentY,
    head: [],
    body: [
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
    ],
    theme: "grid",
    styles: {
      fontSize: 9,
      cellPadding: 2.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
      halign: "left",
    },
    columnStyles: {
      0: { cellWidth: 20, fillColor: [250, 250, 250] },
      1: { cellWidth: 35 },
      2: { cellWidth: 15, fillColor: [250, 250, 250] },
      3: { cellWidth: 42 },
      4: { cellWidth: 20, fillColor: [250, 250, 250] },
      5: { cellWidth: 28 },
      6: { cellWidth: 21 },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 1;

  // === EARNINGS & DEDUCTIONS TABLES ===
  const totalEarnings = data.basic + data.hra + data.bonus + data.conv + data.pa + data.ma + data.sa + data.oa + data.arrear + data.incentive;
  const totalDeductions = data.pf + data.esic + data.loan + data.adDed + data.otherDed;

  // Earnings Header + Data
  autoTable(doc, {
    startY: currentY,
    head: [[
      "",
      { content: "Basic", styles: { halign: "center" } },
      { content: "HRA", styles: { halign: "center" } },
      { content: "Bonus", styles: { halign: "center" } },
      { content: "Conv", styles: { halign: "center" } },
      { content: "PA", styles: { halign: "center" } },
      { content: "MA", styles: { halign: "center" } },
      { content: "SA", styles: { halign: "center" } },
      { content: "OA", styles: { halign: "center" } },
      { content: "Arrear", styles: { halign: "center" } },
      { content: "Incentive", styles: { halign: "center" } },
      { content: "Total Earn", styles: { halign: "center" } },
    ]],
    body: [[
      { content: "Earnings", styles: { fontStyle: "bold" } },
      data.basic,
      data.hra,
      data.bonus,
      data.conv,
      data.pa,
      data.ma,
      data.sa,
      data.oa,
      data.arrear,
      data.incentive,
      formatINR(totalEarnings),
    ]],
    theme: "grid",
    styles: {
      fontSize: 9,
      cellPadding: 2.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      halign: "right",
      textColor: [0, 0, 0],
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: 8,
    },
    columnStyles: {
      0: { cellWidth: 16, halign: "center", fillColor: [250, 250, 250], fontStyle: "bold" },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY;

  // Deductions Header + Data
  autoTable(doc, {
    startY: currentY,
    head: [[
      "",
      { content: "PF", styles: { halign: "center" } },
      { content: "ESIC", styles: { halign: "center" } },
      { content: "Loan", styles: { halign: "center" } },
      { content: "Ad.Ded", styles: { halign: "center" } },
      { content: "Other Ded", styles: { halign: "center", colSpan: 6 } },
      null, null, null, null, null,
      { content: "Total Ded", styles: { halign: "center" } },
    ]],
    body: [[
      { content: "Deductions", styles: { fontStyle: "bold" } },
      data.pf,
      data.esic,
      data.loan,
      data.adDed,
      { content: data.otherDed, styles: { colSpan: 6 } },
      null, null, null, null, null,
      formatINR(totalDeductions),
    ]],
    theme: "grid",
    styles: {
      fontSize: 9,
      cellPadding: 2.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      halign: "right",
      textColor: [0, 0, 0],
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: 8,
    },
    columnStyles: {
      0: { cellWidth: 16, halign: "center", fillColor: [250, 250, 250], fontStyle: "bold" },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 1;

  // === FORM 16 SUMMARY ===
  autoTable(doc, {
    startY: currentY,
    head: [[
      "",
      { content: "Gross\nSalary", styles: { halign: "center" } },
      { content: "Exemption\nU/S 10", styles: { halign: "center" } },
      { content: "Balance", styles: { halign: "center" } },
      { content: "Deduction\nU/S 24", styles: { halign: "center" } },
      { content: "Gross\nTotal\nIncome", styles: { halign: "center" } },
      { content: "Agg Off\nChap VI", styles: { halign: "center" } },
      { content: "Total\nIncome", styles: { halign: "center" } },
      { content: "Tax On\nTotal", styles: { halign: "center" } },
      { content: "Tax\nPayable &\nEdu Cess", styles: { halign: "center" } },
      { content: "Income\nTax", styles: { halign: "center" } },
    ]],
    body: [[
      { content: "Form 16\nSummary", styles: { fontStyle: "bold", valign: "middle" } },
      data.grossSalary || "",
      data.exemptionUs10 || "",
      data.balance || "",
      data.deductionUs24 || "",
      data.grossTotalIncome || "",
      data.aggOffChapVi || "",
      data.totalIncome || "",
      data.taxOnTotal || "",
      data.taxPayableEduCess || "",
      data.incomeTax || 0,
    ]],
    theme: "grid",
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      halign: "center",
      textColor: [0, 0, 0],
      minCellHeight: 10,
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: 7,
    },
    columnStyles: {
      0: { cellWidth: 16, fillColor: [250, 250, 250] },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 5;

  // === NET SALARY ===
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0, 0, 0);
  doc.text(`Cheque No : ${data.chequeNo || ""}`, 15, currentY);
  doc.text(`Net Salary : ${formatINR(data.netSalary)}`, pageWidth - 15, currentY, { align: "right" });

  currentY += 5;
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(data.netSalaryWords, pageWidth / 2, currentY, { align: "center" });

  currentY += 8;

  // === FOOTER ===
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(100, 100, 100);
  doc.text("This is a computer generated statement, hence not signature required", pageWidth / 2, currentY, { align: "center" });

  currentY += 2;
  doc.setDrawColor(0, 0, 0);
  doc.setLineDash([1, 1], 0);
  doc.line(15, currentY, pageWidth - 15, currentY);

  return doc;
}

export function downloadMasCallnetPayslip(data: MasCallnetPayslipData, filename: string) {
  const doc = generateMasCallnetPayslip(data);
  doc.save(filename);
}
