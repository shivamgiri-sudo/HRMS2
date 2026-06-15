import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Clock, AlertTriangle, Timer, Loader2, Search } from "lucide-react";
import { useAttendanceReportData } from "@/hooks/useAttendanceReport";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const MONTHS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => ({
  value: String(currentYear - i),
  label: String(currentYear - i),
}));

const formatDuration = (minutes: number) => {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

const formatHours = (hours: number) => {
  return `${hours.toFixed(1)}h`;
};

const PAGE_SIZE = 50;

export function AttendanceReport() {
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(currentDate.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(currentDate.getFullYear()));
  const [isExporting, setIsExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const { data: summary, isLoading } = useAttendanceReportData(
    parseInt(selectedMonth),
    parseInt(selectedYear)
  );

  const filteredRecords = useMemo(() => {
    if (!summary) return [];
    const q = search.toLowerCase().trim();
    if (!q) return summary.records;
    return summary.records.filter(
      (r) =>
        r.employeeName.toLowerCase().includes(q) ||
        (r.employeeCode ?? "").toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q)
    );
  }, [summary, search]);

  const totalPages = Math.ceil(filteredRecords.length / PAGE_SIZE);
  const pagedRecords = filteredRecords.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const exportToPDF = async () => {
    if (!summary) return;

    setIsExporting(true);

    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();

      // Header
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("Attendance Report", pageWidth / 2, 20, { align: "center" });

      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.text(`Late Arrivals & Overtime - ${summary.monthName}`, pageWidth / 2, 30, { align: "center" });

      // Summary stats
      doc.setFontSize(10);
      doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 45);
      doc.text(`Total Employees: ${summary.totalEmployees}`, 14, 52);
      doc.text(`Total Late Arrivals: ${summary.totalLateArrivals}`, 14, 59);
      doc.text(`Total Overtime: ${formatHours(summary.totalOvertimeHours)}`, 14, 66);
      doc.text(`Average Late Time: ${formatDuration(summary.avgLateMinutes)}`, 14, 73);

      // Employee details table
      autoTable(doc, {
        startY: 85,
        head: [["Employee", "Code", "Department", "Days Worked", "Total Hours", "Late Arrivals", "Late Time", "Overtime"]],
        body: summary.records.map((record) => [
          record.employeeName,
          record.employeeCode,
          record.department,
          record.totalDays.toString(),
          formatHours(record.totalHours),
          record.lateArrivals.toString(),
          formatDuration(record.totalLateMinutes),
          formatHours(record.totalOvertimeHours),
        ]),
        foot: [[
          "TOTAL",
          "",
          "",
          summary.records.reduce((sum, r) => sum + r.totalDays, 0).toString(),
          formatHours(summary.records.reduce((sum, r) => sum + r.totalHours, 0)),
          summary.totalLateArrivals.toString(),
          formatDuration(summary.records.reduce((sum, r) => sum + r.totalLateMinutes, 0)),
          formatHours(summary.totalOvertimeHours),
        ]],
        theme: "striped",
        headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        footStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 30 },
          1: { cellWidth: 20 },
          2: { cellWidth: 25 },
          3: { cellWidth: 20, halign: "center" },
          4: { cellWidth: 22, halign: "right" },
          5: { cellWidth: 22, halign: "center" },
          6: { cellWidth: 22, halign: "right" },
          7: { cellWidth: 22, halign: "right" },
        },
      });

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text(
          `Page ${i} of ${pageCount}`,
          pageWidth / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: "center" }
        );
      }

      doc.save(`Attendance_Report_${summary.monthName.replace(" ", "_")}.pdf`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Attendance Report
            </CardTitle>
            <CardDescription>Late arrivals and overtime tracking</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Month" />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((month) => (
                  <SelectItem key={month.value} value={month.value}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-[100px]">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((year) => (
                  <SelectItem key={year.value} value={year.value}>
                    {year.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={exportToPDF} disabled={isExporting || !summary?.records.length}>
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Export PDF
            </Button>
          </div>
        </div>
        {summary && summary.records.length > 0 && (
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, code or department..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
              className="pl-9 max-w-sm"
            />
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-20" />
              ))}
            </div>
            <Skeleton className="h-64" />
          </div>
        ) : summary ? (
          <div className="space-y-6">
            {/* Summary Stats */}
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-lg border bg-muted/50 p-4">
                <p className="text-sm text-muted-foreground">Total Employees</p>
                <p className="text-2xl font-bold">{summary.totalEmployees}</p>
              </div>
              <div className="rounded-lg border bg-red-500/10 p-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <p className="text-sm text-red-600">Late Arrivals</p>
                </div>
                <p className="mt-1 text-2xl font-bold text-red-600">{summary.totalLateArrivals}</p>
                <p className="text-xs text-muted-foreground">Avg: {formatDuration(summary.avgLateMinutes)}</p>
              </div>
              <div className="rounded-lg border bg-orange-500/10 p-4">
                <div className="flex items-center gap-2">
                  <Timer className="h-4 w-4 text-orange-600" />
                  <p className="text-sm text-orange-600">Total Overtime</p>
                </div>
                <p className="mt-1 text-2xl font-bold text-orange-600">{formatHours(summary.totalOvertimeHours)}</p>
              </div>
              <div className="rounded-lg border bg-primary/10 p-4">
                <p className="text-sm text-muted-foreground">Report Period</p>
                <p className="text-2xl font-bold text-primary">{summary.monthName}</p>
              </div>
            </div>

            {/* Employee Table */}
            {summary.records.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Showing {filteredRecords.length === summary.records.length
                    ? `all ${summary.records.length}`
                    : `${filteredRecords.length} of ${summary.records.length}`} employees
                  {totalPages > 1 && ` — page ${currentPage} of ${totalPages}`}
                </p>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead className="text-center">Days Worked</TableHead>
                        <TableHead className="text-right">Total Hours</TableHead>
                        <TableHead className="text-center">Late Arrivals</TableHead>
                        <TableHead className="text-right">Late Time</TableHead>
                        <TableHead className="text-right">Overtime</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedRecords.map((record) => (
                        <TableRow key={record.employeeId}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{record.employeeName}</p>
                              <p className="text-xs text-muted-foreground">{record.employeeCode}</p>
                            </div>
                          </TableCell>
                          <TableCell>{record.department}</TableCell>
                          <TableCell className="text-center">{record.totalDays}</TableCell>
                          <TableCell className="text-right">{formatHours(record.totalHours)}</TableCell>
                          <TableCell className="text-center">
                            {record.lateArrivals > 0 ? (
                              <Badge variant="destructive" className="bg-red-500/10 text-red-600 hover:bg-red-500/20">
                                {record.lateArrivals}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-green-500/10 text-green-600">0</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {record.totalLateMinutes > 0 ? (
                              <span className="text-red-600">{formatDuration(record.totalLateMinutes)}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {record.totalOvertimeHours > 0 ? (
                              <Badge className="bg-orange-500/10 text-orange-600 hover:bg-orange-500/20">
                                {formatHours(record.totalOvertimeHours)}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {pagedRecords.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                            No records match your search
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={2} className="font-bold">
                          Total ({summary.totalEmployees} employees)
                        </TableCell>
                        <TableCell className="text-center font-bold">
                          {summary.records.reduce((sum, r) => sum + r.totalDays, 0)}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {formatHours(summary.records.reduce((sum, r) => sum + r.totalHours, 0))}
                        </TableCell>
                        <TableCell className="text-center font-bold text-red-600">
                          {summary.totalLateArrivals}
                        </TableCell>
                        <TableCell className="text-right font-bold text-red-600">
                          {formatDuration(summary.records.reduce((sum, r) => sum + r.totalLateMinutes, 0))}
                        </TableCell>
                        <TableCell className="text-right font-bold text-orange-600">
                          {formatHours(summary.totalOvertimeHours)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>
                      Previous
                    </Button>
                    <span className="text-sm text-muted-foreground">Page {currentPage} / {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}>
                      Next
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">No attendance records found</p>
                <p className="text-sm text-muted-foreground">
                  There are no attendance records for {summary.monthName}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
