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

// Load logo as base64 from public folder
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

export async function generateMasCallnetPayslip(data: MasCallnetPayslipData): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let currentY = 15;

  // === MAS LOGO (Top Left) ===
  const logoBase64 = await loadLogoBase64();
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', 14, currentY, 30, 10);
    } catch (e) {
      console.error('Error adding logo:', e);
    }
  }

  // === COMPANY NAME (Centered) ===
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text(data.companyName, pageWidth / 2, currentY + 3, { align: "center" });

  currentY += 8;

  // === MONTH SUBTITLE (Centered) ===
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
      0: { cellWidth: 25, fillColor: [240, 240, 240], fontStyle: 'bold' },
      1: { cellWidth: 40 },
      2: { cellWidth: 20, fillColor: [240, 240, 240], fontStyle: 'bold' },
      3: { cellWidth: 40 },
      4: { cellWidth: 25, fillColor: [240, 240, 240], fontStyle: 'bold' },
      5: { cellWidth: 30 },
      6: { cellWidth: 20 },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 1;

  // === EARNINGS & DEDUCTIONS TABLES (SIDE BY SIDE) ===
  const totalEarnings = data.basic + data.hra + data.bonus + data.conv + data.pa + data.ma + data.sa + data.oa + data.arrear + data.incentive;
  const totalDeductions = data.pf + data.esic + data.loan + data.adDed + data.otherDed;

  // Combined Earnings and Deductions Table
  autoTable(doc, {
    startY: currentY,
    head: [[
      { content: 'EARNINGS', colSpan: 2, styles: { halign: 'center', fillColor: [27, 106, 181], textColor: [255, 255, 255], fontStyle: 'bold' } },
      null,
      { content: 'DEDUCTIONS', colSpan: 2, styles: { halign: 'center', fillColor: [220, 53, 69], textColor: [255, 255, 255], fontStyle: 'bold' } },
      null,
    ]],
    body: [
      [
        { content: 'Particulars', styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
        { content: 'Amount (₹)', styles: { fontStyle: 'bold', fillColor: [240, 240, 240], halign: 'right' } },
        { content: 'Particulars', styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
        { content: 'Amount (₹)', styles: { fontStyle: 'bold', fillColor: [240, 240, 240], halign: 'right' } },
      ],
      ['Basic Salary', formatINR(data.basic), 'PF', formatINR(data.pf)],
      ['HRA', formatINR(data.hra), 'ESIC', formatINR(data.esic)],
      ['Bonus', formatINR(data.bonus), 'Loan', formatINR(data.loan)],
      ['Conveyance', formatINR(data.conv), 'Advance Deduction', formatINR(data.adDed)],
      ['Performance Allowance', formatINR(data.pa), 'Other Deductions', formatINR(data.otherDed)],
      ['Medical Allowance', formatINR(data.ma), '', ''],
      ['Special Allowance', formatINR(data.sa), '', ''],
      ['Other Allowance', formatINR(data.oa), '', ''],
      ['Arrear', formatINR(data.arrear), '', ''],
      ['Incentive', formatINR(data.incentive), '', ''],
      [
        { content: 'GROSS EARNINGS', styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
        { content: formatINR(totalEarnings), styles: { fontStyle: 'bold', fillColor: [240, 240, 240], halign: 'right' } },
        { content: 'TOTAL DEDUCTIONS', styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
        { content: formatINR(totalDeductions), styles: { fontStyle: 'bold', fillColor: [240, 240, 240], halign: 'right' } },
      ],
    ],
    theme: "grid",
    styles: {
      fontSize: 9,
      cellPadding: 2.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
    },
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 45, halign: 'right' },
      2: { cellWidth: 50 },
      3: { cellWidth: 45, halign: 'right' },
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

  currentY = (doc as any).lastAutoTable.finalY + 6;

  // === NET SALARY (Prominent Box) ===
  doc.setFillColor(27, 106, 181); // MAS Blue
  doc.rect(15, currentY - 2, pageWidth - 30, 12, 'F');

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text(`NET SALARY: ${formatINR(data.netSalary)}`, pageWidth / 2, currentY + 5, { align: "center" });

  currentY += 14;

  // Net Salary in Words
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text(`In Words: ${data.netSalaryWords}`, pageWidth / 2, currentY, { align: "center" });

  currentY += 8;

  // Cheque Number (if provided)
  if (data.chequeNo) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Cheque No: ${data.chequeNo}`, 15, currentY);
    currentY += 5;
  }

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

export async function downloadMasCallnetPayslip(data: MasCallnetPayslipData, filename: string) {
  const doc = await generateMasCallnetPayslip(data);
  doc.save(filename);
}
