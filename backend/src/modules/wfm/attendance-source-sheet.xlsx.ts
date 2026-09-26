// backend/src/modules/wfm/attendance-source-sheet.xlsx.ts
// Builds the Attendance Source Sheet workbook: identity columns, then per date a Status /
// Cosec / APR triplet under a merged date header. The duration that decided the day (the
// payroll source) is bold so the two readings can be compared at a glance.

import ExcelJS from "exceljs";
import {
  formatHours,
  type SheetEmployee,
} from "./attendance-source-sheet.service.js";

const IDENTITY_HEADERS = [
  "Month",
  "Employee name",
  "Emp Code",
  "Branch",
  "Cost Center",
  "Process Name",
  "LOB",
  "Attendance Source",
] as const;

const STATUS_FILLS: Readonly<Record<string, string>> = {
  P: "FF92D050",
  HD: "FFFFC000",
  A: "FFFF7C80",
  L: "FFB4A7D6",
  H: "FF9FC5E8",
  WO: "FFD9D9D9",
  WOW: "FF76D7C4",
  MP: "FFF4B183",
  UR: "FFFFE599",
};

const LEGEND: ReadonlyArray<[string, string]> = [
  ["P", "Present"],
  ["HD", "Half day"],
  ["A", "Absent"],
  ["L", "Approved leave"],
  ["H", "Holiday"],
  ["WO", "Week off"],
  ["WOW", "Week off worked"],
  ["MP", "Missing punch"],
  ["UR", "Unreconciled"],
];

const thin: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFBFBFBF" } },
  left: { style: "thin", color: { argb: "FFBFBFBF" } },
  bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
  right: { style: "thin", color: { argb: "FFBFBFBF" } },
};

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-09" -> "Sep'26" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_NAMES[Number(m) - 1]}'${y.slice(2)}`;
}

/** "2026-09-01" -> "01-Sep-26" */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}-${MONTH_NAMES[Number(m) - 1]}-${y.slice(2)}`;
}

function styleHeader(cell: ExcelJS.Cell): void {
  cell.font = { bold: true };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = thin;
}

export function buildAttendanceSourceWorkbook(
  month: string,
  days: readonly string[],
  employees: readonly SheetEmployee[],
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Attendance Source Sheet", {
    views: [{ state: "frozen", xSplit: 3, ySplit: 2 }],
  });

  const identityCount = IDENTITY_HEADERS.length;
  const dateRow = ws.getRow(1);
  const headerRow = ws.getRow(2);
  IDENTITY_HEADERS.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
    styleHeader(headerRow.getCell(i + 1));
    ws.getColumn(i + 1).width = i === 1 ? 26 : i === 4 || i === 5 ? 22 : 14;
  });
  days.forEach((date, i) => {
    const first = identityCount + i * 3 + 1;
    ws.mergeCells(1, first, 1, first + 2);
    dateRow.getCell(first).value = dayLabel(date);
    styleHeader(dateRow.getCell(first));
    ["Status", "Cosec", "APR"].forEach((label, j) => {
      headerRow.getCell(first + j).value = label;
      styleHeader(headerRow.getCell(first + j));
      ws.getColumn(first + j).width = j === 0 ? 8 : 11;
    });
  });

  const label = monthLabel(month);
  employees.forEach((emp, idx) => {
    const row = ws.getRow(idx + 3);
    [
      label,
      emp.employeeName,
      emp.employeeCode,
      emp.branch,
      emp.costCentre,
      emp.process,
      emp.lob,
      emp.attendanceSource,
    ].forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v ?? "";
      cell.border = thin;
    });
    days.forEach((date, i) => {
      const first = identityCount + i * 3 + 1;
      const day = emp.days[date];
      const cells = [
        row.getCell(first),
        row.getCell(first + 1),
        row.getCell(first + 2),
      ];
      cells.forEach((c) => {
        c.border = thin;
        c.alignment = { horizontal: "center" };
      });
      if (!day) return;
      cells[0].value = day.code;
      cells[0].font = { bold: true };
      const fill = STATUS_FILLS[day.code];
      if (fill)
        cells[0].fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: fill },
        };
      cells[1].value = formatHours(day.cosecMinutes);
      cells[2].value = formatHours(day.aprMinutes);
      if (day.payrollSource === "cosec") cells[1].font = { bold: true };
      if (day.payrollSource === "apr") cells[2].font = { bold: true };
    });
  });

  const legend = wb.addWorksheet("Legend");
  legend.addRow(["Code", "Meaning"]).font = { bold: true };
  LEGEND.forEach(([code, meaning]) => legend.addRow([code, meaning]));
  legend.addRow([]);
  legend.addRow([
    "Bold duration",
    "The reading that decided the day's status - the payroll attendance source.",
  ]);
  legend.addRow(["Cosec", "Biometric (COSEC) worked duration, H:MM."]);
  legend.addRow(["APR", "Dialler (APR) net login duration, H:MM."]);
  legend.addRow(["-", "No reading from that source on that day."]);
  legend.getColumn(1).width = 16;
  legend.getColumn(2).width = 80;
  return wb;
}
