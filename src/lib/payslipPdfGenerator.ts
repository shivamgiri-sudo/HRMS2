import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface PayslipData {
  employeeName: string;
  employeeCode: string;
  employeeEmail: string;
  monthName: string;
  year: number;
  status: string;
  paidAt?: string;
  basicSalary: number;
  allowances: number;
  deductions: number;
  netSalary: number;
  salaryBreakdown?: {
    hra?: number;
    transport_allowance?: number;
    medical_allowance?: number;
    other_allowances?: number;
    tax_deduction?: number;
    other_deductions?: number;
  };
  companyName?: string;
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(amount);
};

// Colors
const COLORS = {
  primary: [79, 70, 229] as [number, number, number], // Indigo
  primaryLight: [238, 242, 255] as [number, number, number],
  success: [16, 185, 129] as [number, number, number], // Emerald
  successLight: [236, 253, 245] as [number, number, number],
  danger: [239, 68, 68] as [number, number, number], // Red
  dangerLight: [254, 242, 242] as [number, number, number],
  gray: [107, 114, 128] as [number, number, number],
  grayLight: [249, 250, 251] as [number, number, number],
  dark: [17, 24, 39] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

export function generatePayslipPDF(data: PayslipData): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;

  // === HEADER SECTION ===
  // Header background
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, pageWidth, 50, "F");

  // Company name
  doc.setTextColor(...COLORS.white);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.text(data.companyName || "MCN HRMS", margin, 25);

  // Payslip label
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text("PAYSLIP", margin, 38);

  // Month/Year on right side
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(`${data.monthName} ${data.year}`, pageWidth - margin, 25, { align: "right" });

  // Status badge
  const statusText = data.status.charAt(0).toUpperCase() + data.status.slice(1);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Status: ${statusText}`, pageWidth - margin, 38, { align: "right" });

  let currentY = 65;

  // === EMPLOYEE DETAILS SECTION ===
  doc.setFillColor(...COLORS.grayLight);
  doc.roundedRect(margin, currentY - 5, contentWidth, 45, 3, 3, "F");

  doc.setTextColor(...COLORS.dark);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Employee Details", margin + 10, currentY + 8);

  doc.setDrawColor(...COLORS.primary);
  doc.setLineWidth(0.5);
  doc.line(margin + 10, currentY + 12, margin + 70, currentY + 12);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.gray);

  const detailsY = currentY + 22;
  const col1X = margin + 10;
  const col2X = margin + contentWidth / 2;

  // Left column
  doc.text("Name", col1X, detailsY);
  doc.setTextColor(...COLORS.dark);
  doc.setFont("helvetica", "bold");
  doc.text(data.employeeName, col1X + 35, detailsY);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.gray);
  doc.text("Email", col1X, detailsY + 10);
  doc.setTextColor(...COLORS.dark);
  doc.text(data.employeeEmail, col1X + 35, detailsY + 10);

  // Right column
  doc.setTextColor(...COLORS.gray);
  doc.text("Employee ID", col2X, detailsY);
  doc.setTextColor(...COLORS.dark);
  doc.setFont("helvetica", "bold");
  doc.text(data.employeeCode, col2X + 35, detailsY);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...COLORS.gray);
  doc.text("Pay Period", col2X, detailsY + 10);
  doc.setTextColor(...COLORS.dark);
  doc.text(`${data.monthName} ${data.year}`, col2X + 35, detailsY + 10);

  currentY += 55;

  // === EARNINGS & DEDUCTIONS SIDE BY SIDE ===
  const halfWidth = (contentWidth - 10) / 2;

  // EARNINGS BOX
  doc.setFillColor(...COLORS.successLight);
  doc.roundedRect(margin, currentY, halfWidth, 10, 2, 2, "F");
  doc.setFillColor(...COLORS.success);
  doc.rect(margin, currentY, 4, 10, "F");

  doc.setTextColor(...COLORS.success);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("EARNINGS", margin + 10, currentY + 7);

  // Earnings table
  const earningsBody: [string, string][] = [
    ["Basic Salary", formatCurrency(data.basicSalary)],
  ];

  if (data.salaryBreakdown) {
    const sb = data.salaryBreakdown;
    if (sb.hra) earningsBody.push(["House Rent Allowance", formatCurrency(sb.hra)]);
    if (sb.transport_allowance) earningsBody.push(["Transport Allowance", formatCurrency(sb.transport_allowance)]);
    if (sb.medical_allowance) earningsBody.push(["Medical Allowance", formatCurrency(sb.medical_allowance)]);
    if (sb.other_allowances) earningsBody.push(["Other Allowances", formatCurrency(sb.other_allowances)]);
  } else if (data.allowances > 0) {
    earningsBody.push(["Allowances", formatCurrency(data.allowances)]);
  }

  const grossSalary = data.basicSalary + data.allowances;
  earningsBody.push(["Gross Salary", formatCurrency(grossSalary)]);

  autoTable(doc, {
    startY: currentY + 12,
    margin: { left: margin },
    tableWidth: halfWidth,
    head: [],
    body: earningsBody,
    theme: "plain",
    styles: {
      fontSize: 9,
      cellPadding: 4,
    },
    columnStyles: {
      0: { cellWidth: halfWidth - 50, textColor: COLORS.gray },
      1: { cellWidth: 50, halign: "right", textColor: COLORS.dark, fontStyle: "bold" },
    },
    didParseCell: (data) => {
      // Style the last row (Gross Salary) differently
      if (data.row.index === earningsBody.length - 1) {
        data.cell.styles.fillColor = COLORS.successLight;
        data.cell.styles.fontStyle = "bold";
        if (data.column.index === 1) {
          data.cell.styles.textColor = COLORS.success;
        }
      }
    },
  });

  // DEDUCTIONS BOX
  doc.setFillColor(...COLORS.dangerLight);
  doc.roundedRect(margin + halfWidth + 10, currentY, halfWidth, 10, 2, 2, "F");
  doc.setFillColor(...COLORS.danger);
  doc.rect(margin + halfWidth + 10, currentY, 4, 10, "F");

  doc.setTextColor(...COLORS.danger);
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("DEDUCTIONS", margin + halfWidth + 20, currentY + 7);

  // Deductions table
  const deductionsBody: [string, string][] = [];

  if (data.salaryBreakdown) {
    const sb = data.salaryBreakdown;
    if (sb.tax_deduction) deductionsBody.push(["Tax Deduction", formatCurrency(sb.tax_deduction)]);
    if (sb.other_deductions) deductionsBody.push(["Other Deductions", formatCurrency(sb.other_deductions)]);
  }

  if (deductionsBody.length === 0 && data.deductions === 0) {
    deductionsBody.push(["No Deductions", "₹ 0.00"]);
  }
  deductionsBody.push(["Total Deductions", formatCurrency(data.deductions)]);

  autoTable(doc, {
    startY: currentY + 12,
    margin: { left: margin + halfWidth + 10 },
    tableWidth: halfWidth,
    head: [],
    body: deductionsBody,
    theme: "plain",
    styles: {
      fontSize: 9,
      cellPadding: 4,
    },
    columnStyles: {
      0: { cellWidth: halfWidth - 50, textColor: COLORS.gray },
      1: { cellWidth: 50, halign: "right", textColor: COLORS.dark, fontStyle: "bold" },
    },
    didParseCell: (data) => {
      // Style the last row differently
      if (data.row.index === deductionsBody.length - 1) {
        data.cell.styles.fillColor = COLORS.dangerLight;
        data.cell.styles.fontStyle = "bold";
        if (data.column.index === 1) {
          data.cell.styles.textColor = COLORS.danger;
        }
      }
    },
  });

  // Get the bottom of the tables
  const earningsTableEnd = (doc as any).lastAutoTable?.finalY || currentY + 60;
  currentY = Math.max(earningsTableEnd, currentY + 60) + 15;

  // === NET PAY SECTION ===
  doc.setFillColor(...COLORS.primaryLight);
  doc.roundedRect(margin, currentY, contentWidth, 35, 3, 3, "F");

  doc.setDrawColor(...COLORS.primary);
  doc.setLineWidth(1);
  doc.roundedRect(margin, currentY, contentWidth, 35, 3, 3, "S");

  doc.setTextColor(...COLORS.gray);
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text("NET SALARY", margin + 15, currentY + 15);

  doc.setTextColor(...COLORS.primary);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text(formatCurrency(data.netSalary), pageWidth - margin - 15, currentY + 22, { align: "right" });

  // Payment date if paid
  if (data.paidAt && data.status === "paid") {
    doc.setTextColor(...COLORS.success);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Paid on: ${data.paidAt}`, margin + 15, currentY + 28);
  }

  currentY += 50;

  // === FOOTER ===
  // Decorative line
  doc.setDrawColor(...COLORS.grayLight);
  doc.setLineWidth(0.5);
  doc.line(margin, pageHeight - 35, pageWidth - margin, pageHeight - 35);

  doc.setTextColor(...COLORS.gray);
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text(
    "This is a computer-generated payslip and does not require a signature.",
    pageWidth / 2,
    pageHeight - 25,
    { align: "center" }
  );
  doc.text(
    `Generated on ${new Date().toLocaleDateString("en-IN", { 
      day: "numeric", 
      month: "long", 
      year: "numeric" 
    })}`,
    pageWidth / 2,
    pageHeight - 18,
    { align: "center" }
  );

  return doc;
}

export function downloadPayslip(data: PayslipData, filename: string) {
  const doc = generatePayslipPDF(data);
  doc.save(filename);
}