import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, isAfter, isBefore, isWithinInterval, parseISO } from "date-fns";
import { formatISTDate, normalizeDate } from "@/lib/utils";
import type { LeaveRequest } from "@/hooks/useLeaves";
import { normalizeLeaveStatus, statusLabel } from "./leaveStatus";

/** Keep only requests whose START date falls inside the (optional) range. */
export function filterByStartRange(items: LeaveRequest[], startDate?: Date, endDate?: Date): LeaveRequest[] {
  if (!startDate && !endDate) return items;
  return items.filter((request) => {
    const start = parseISO(normalizeDate(request.startDate));
    if (startDate && endDate) return isWithinInterval(start, { start: startDate, end: endDate });
    if (startDate) return isAfter(start, startDate) || start.getTime() === startDate.getTime();
    return isBefore(start, endDate!) || start.getTime() === endDate!.getTime();
  });
}

const stamp = (startDate?: Date, endDate?: Date) => {
  const range = startDate || endDate
    ? `-${startDate ? format(startDate, "yyyy-MM-dd") : "start"}-to-${endDate ? format(endDate, "yyyy-MM-dd") : "end"}`
    : "";
  return `leave-requests${range}-${new Date().toISOString().split("T")[0]}`;
};

const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

/** CSV text for the rows. Quotes are escaped so a name or reason containing one cannot break columns. */
export function buildLeaveCsv(rows: LeaveRequest[]): string {
  const headers = ["Employee", "Department", "Branch", "Process", "Type", "Start Date", "End Date", "Days", "Status", "Reason"];
  return [
    headers.join(","),
    ...rows.map((r) =>
      [r.employee.name, r.employee.department, r.branch, r.process, r.type, r.startDate, r.endDate, r.days,
        statusLabel(normalizeLeaveStatus(r.status)), r.reason].map(csvCell).join(","),
    ),
  ].join("\n");
}

export function downloadLeaveCsv(rows: LeaveRequest[], startDate?: Date, endDate?: Date): void {
  const blob = new Blob([buildLeaveCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${stamp(startDate, endDate)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function downloadLeavePdf(rows: LeaveRequest[], startDate?: Date, endDate?: Date): void {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text("Leave Requests Report", 14, 22);
  doc.setFontSize(10);
  doc.text(`Generated on ${formatISTDate(new Date())}`, 14, 30);
  if (startDate || endDate) {
    doc.text(`Date Range: ${startDate ? format(startDate, "PP") : "Start"} - ${endDate ? format(endDate, "PP") : "End"}`, 14, 36);
    doc.text(`Total Requests: ${rows.length}`, 14, 42);
  } else {
    doc.text(`Total Requests: ${rows.length}`, 14, 36);
  }
  autoTable(doc, {
    startY: startDate || endDate ? 50 : 44,
    head: [["Employee", "Department", "Type", "Start Date", "End Date", "Days", "Status"]],
    body: rows.map((r) => [r.employee.name, r.employee.department, r.type, r.startDate, r.endDate, String(r.days), statusLabel(normalizeLeaveStatus(r.status))]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [27, 106, 181] },
  });
  doc.save(`${stamp(startDate, endDate)}.pdf`);
}
