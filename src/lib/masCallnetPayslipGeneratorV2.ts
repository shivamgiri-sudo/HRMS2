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
  let currentY = 12;

  // === MAS LOGO (Top Left) ===
  const logoBase64 = await loadLogoBase64();
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', 14, currentY - 2, 28, 10);
    } catch (e) {
      console.error('Error adding logo:', e);
    }
  }

  // === COMPANY NAME (Centered, Bold) ===
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text(data.companyName, pageWidth / 2, currentY + 4, { align: "center" });

  currentY += 10;

  // === MONTH SUBTITLE (Centered, Gray) ===
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);
  doc.text(`Month For : ${data.monthYear}`, pageWidth / 2, currentY, { align: "center" });

  currentY += 8;

  // === EMPLOYEE DETAILS TABLE ===
  // Strict label/value pairs avoid spacer cells and keep Designation/Department aligned.
  const labelCell = (content: string) => ({
    content,
    styles: { fontStyle: "bold" as const, fillColor: [245, 245, 245] as [number, number, number] },
  });

  autoTable(doc, {
    startY: currentY,
    head: [],
    body: [
      [
        labelCell("Emp Name"), data.empName,
        labelCell("Designation"), data.designation || "",
        labelCell("Department"), data.department || "",
      ],
      [
        labelCell("Emp Code"), data.empCode,
        labelCell("EPF No"), data.epfNo || "",
        labelCell("Location"), data.location || "",
      ],
      [
        labelCell("ESI No"), data.esiNo || "",
        labelCell("W Days"), String(data.wDays),
        labelCell("Earned Days"), String(data.earnedDays),
      ],
    ],
    theme: "grid",
    styles: {
      fontSize: 8.5,
      cellPadding: 2,
      lineColor: [170, 170, 170],
      lineWidth: 0.15,
      textColor: [0, 0, 0],
      halign: "left",
      valign: "middle",
      minCellHeight: 7,
      overflow: "linebreak",
    },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 40 },
      2: { cellWidth: 24 },
      3: { cellWidth: 34 },
      4: { cellWidth: 24 },
      5: { cellWidth: 38 },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 2;

  // === EARNINGS SECTION (Single Table) ===
  const totalEarnings = data.basic + data.hra + data.bonus + data.conv + data.pa + data.ma + data.sa + data.oa + data.arrear + data.incentive;

  autoTable(doc, {
    startY: currentY,
    head: [],
    body: [
      [
        "",
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
        { content: "Earnings", styles: { fontStyle: "bold", fillColor: [245, 245, 245] } },
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
    ],
    theme: "grid",
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
      halign: "center",
    },
    columnStyles: {
      0: { cellWidth: 20, halign: "left" },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 1;

  // === DEDUCTIONS SECTION ===
  const totalDeductions = data.pf + data.esic + data.loan + data.adDed + data.otherDed;

  autoTable(doc, {
    startY: currentY,
    head: [],
    body: [
      [
        { content: "Deductions", styles: { fontStyle: "bold", fillColor: [245, 245, 245] } },
        { content: "PF", styles: { fontStyle: "bold", halign: "center" } },
        { content: "ESIC", styles: { fontStyle: "bold", halign: "center" } },
        { content: "Loan", styles: { fontStyle: "bold", halign: "center" } },
        { content: "Ad.Ded", styles: { fontStyle: "bold", halign: "center" } },
        { content: "Other Ded", styles: { fontStyle: "bold", halign: "center" } },
        "",
        "",
        "",
        "",
        "",
        { content: "Total Ded", styles: { fontStyle: "bold", halign: "center" } },
      ],
      [
        "",
        formatINR(data.pf),
        formatINR(data.esic),
        formatINR(data.loan),
        formatINR(data.adDed),
        formatINR(data.otherDed),
        "",
        "",
        "",
        "",
        "",
        formatINR(totalDeductions),
      ],
    ],
    theme: "grid",
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
      halign: "center",
    },
    columnStyles: {
      0: { cellWidth: 20, halign: "left" },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 2;

  // === FORM 16 SUMMARY ===
  autoTable(doc, {
    startY: currentY,
    head: [],
    body: [
      [
        { content: "Form 16\nSummary", styles: { fontStyle: "bold", fillColor: [245, 245, 245], valign: "middle" }, rowSpan: 2 },
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
        null, // rowSpan cell
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        String(data.incomeTax || 0),
      ],
    ],
    theme: "grid",
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
      halign: "center",
      minCellHeight: 10,
    },
    columnStyles: {
      0: { cellWidth: 20 },
    },
  });

  currentY = (doc as any).lastAutoTable.finalY + 8;

  // === CHEQUE NO & NET SALARY (Single Line) ===
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text(`Cheque No : ${data.chequeNo || ""}`, 14, currentY);
  doc.text(`Net Salary : ${formatINR(data.netSalary)}`, pageWidth - 14, currentY, { align: "right" });

  currentY += 6;

  // === NET SALARY IN WORDS (Centered) ===
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text(data.netSalaryWords, pageWidth / 2, currentY, { align: "center" });

  currentY += 10;

  // === FOOTER ===
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 80);
  doc.text("This is a computer generated statement, hence not signature required", pageWidth / 2, currentY, { align: "center" });

  currentY += 2;
  doc.setDrawColor(0, 0, 0);
  doc.setLineDash([1, 1], 0);
  doc.line(14, currentY, pageWidth - 14, currentY);

  return doc;
}

export async function downloadMasCallnetPayslip(data: MasCallnetPayslipData, filename: string) {
  const doc = await generateMasCallnetPayslip(data);
  doc.save(filename);
}
