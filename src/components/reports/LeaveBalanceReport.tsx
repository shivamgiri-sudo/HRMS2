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
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Calendar, Loader2, Search, FileSpreadsheet } from "lucide-react";
import { useLeaveBalanceReport } from "@/hooks/useLeaveBalanceReport";
import { useReportMasters } from "@/hooks/useReportMasters";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => ({
  value: String(currentYear - i),
  label: String(currentYear - i),
}));

const PAGE_SIZE_OPTIONS = [
  { value: "50", label: "50 rows" },
  { value: "100", label: "100 rows" },
  { value: "250", label: "250 rows" },
  { value: "500", label: "500 rows" },
  { value: "0", label: "Show all" },
];

function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function LeaveBalanceReport() {
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [selectedProcess, setSelectedProcess] = useState<string>("all");
  const [isExporting, setIsExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data: masters } = useReportMasters();
  const { data: report, isLoading } = useLeaveBalanceReport(
    parseInt(selectedYear),
    selectedBranch !== "all" ? selectedBranch : undefined,
    selectedProcess !== "all" ? selectedProcess : undefined,
  );

  const filteredRecords = useMemo(() => {
    if (!report) return [];
    const q = search.toLowerCase().trim();
    if (!q) return report.records;
    return report.records.filter(
      (r) =>
        r.employeeName.toLowerCase().includes(q) ||
        (r.employeeCode ?? "").toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q)
    );
  }, [report, search]);

  const totalPages = pageSize === 0 ? 1 : Math.ceil(filteredRecords.length / pageSize);
  const pagedRecords = pageSize === 0 ? filteredRecords : filteredRecords.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const exportToCSV = () => {
    if (!report || !report.records.length) return;
    const headers = ["Employee", "Code", "Department", ...report.leaveTypes.flatMap((lt) => [`${lt} Total`, `${lt} Used`, `${lt} Remaining`])];
    const rows = report.records.map((r) => [
      r.employeeName, r.employeeCode ?? "", r.department,
      ...r.balances.flatMap((b) => [b.total, b.used, b.remaining]),
    ]);
    exportCSV(`Leave_Balance_Report_${report.year}.csv`, headers, rows);
  };

  const exportToPDF = async () => {
    if (!report || report.records.length === 0) return;

    setIsExporting(true);

    try {
      const doc = new jsPDF({ orientation: "landscape" });
      const pageWidth = doc.internal.pageSize.getWidth();

      // Header
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("Leave Balance Report", pageWidth / 2, 20, { align: "center" });

      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.text(`Year: ${report.year}`, pageWidth / 2, 30, { align: "center" });

      // Summary info
      doc.setFontSize(10);
      doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 45);
      doc.text(`Total Employees: ${report.records.length}`, 14, 52);

      // Build table headers
      const headers = ["Employee", "Department"];
      report.leaveTypes.forEach((lt) => {
        headers.push(`${lt} (T)`, `${lt} (U)`, `${lt} (R)`);
      });

      // Build table body
      const body = report.records.map((record) => {
        const row: (string | number)[] = [record.employeeName, record.department];
        record.balances.forEach((bal) => {
          row.push(bal.total, bal.used, bal.remaining);
        });
        return row;
      });

      // Calculate totals
      const totals: (string | number)[] = ["TOTAL", ""];
      report.leaveTypes.forEach((_, index) => {
        const totalT = report.records.reduce((sum, r) => sum + r.balances[index].total, 0);
        const totalU = report.records.reduce((sum, r) => sum + r.balances[index].used, 0);
        const totalR = report.records.reduce((sum, r) => sum + r.balances[index].remaining, 0);
        totals.push(totalT, totalU, totalR);
      });

      autoTable(doc, {
        startY: 60,
        head: [headers],
        body: body,
        foot: [totals],
        theme: "striped",
        headStyles: { fillColor: [59, 130, 246], fontSize: 7, cellPadding: 2 },
        bodyStyles: { fontSize: 7, cellPadding: 2 },
        footStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 7 },
        columnStyles: {
          0: { cellWidth: 35 },
          1: { cellWidth: 30 },
        },
        didDrawPage: () => {
          // Legend
          doc.setFontSize(8);
          doc.text("T = Total Days | U = Used Days | R = Remaining Days", 14, doc.internal.pageSize.getHeight() - 15);
        },
      });

      // Footer with page numbers
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(
          `Page ${i} of ${pageCount}`,
          pageWidth / 2,
          doc.internal.pageSize.getHeight() - 10,
          { align: "center" }
        );
      }

      doc.save(`Leave_Balance_Report_${report.year}.pdf`);
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
              <Calendar className="h-5 w-5" />
              Leave Balance Report
            </CardTitle>
            <CardDescription>Employee leave balances by type</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedYear} onValueChange={(v) => { setSelectedYear(v); setCurrentPage(1); }}>
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
            {masters && masters.branches.length > 0 && (
              <Select value={selectedBranch} onValueChange={(v) => { setSelectedBranch(v); setCurrentPage(1); }}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {masters.branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {masters && masters.processes.length > 0 && (
              <Select value={selectedProcess} onValueChange={(v) => { setSelectedProcess(v); setCurrentPage(1); }}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="All Processes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Processes</SelectItem>
                  {masters.processes.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" onClick={exportToCSV} disabled={!report?.records.length}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              CSV
            </Button>
            <Button onClick={exportToPDF} disabled={isExporting || !report?.records.length}>
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              PDF
            </Button>
          </div>
        </div>
        {report && report.records.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, code or department..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
                className="pl-9"
              />
            </div>
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-64" />
          </div>
        ) : report ? (
          <div className="space-y-4">
            {report.records.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Showing {filteredRecords.length === report.records.length
                    ? `all ${report.records.length}`
                    : `${filteredRecords.length} of ${report.records.length}`} employees
                  {totalPages > 1 && ` — page ${currentPage} of ${totalPages}`}
                </p>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background">Employee</TableHead>
                        <TableHead>Department</TableHead>
                        {report.leaveTypes.map((lt) => (
                          <TableHead key={lt} colSpan={3} className="text-center border-l">
                            {lt}
                          </TableHead>
                        ))}
                      </TableRow>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background"></TableHead>
                        <TableHead></TableHead>
                        {report.leaveTypes.map((lt) => (
                          <>
                            <TableHead key={`${lt}-t`} className="text-center text-xs border-l">Total</TableHead>
                            <TableHead key={`${lt}-u`} className="text-center text-xs">Used</TableHead>
                            <TableHead key={`${lt}-r`} className="text-center text-xs">Left</TableHead>
                          </>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedRecords.map((record) => (
                        <TableRow key={record.employeeId}>
                          <TableCell className="sticky left-0 bg-background">
                            <div>
                              <p className="font-medium">{record.employeeName}</p>
                              <p className="text-xs text-muted-foreground">{record.employeeCode}</p>
                            </div>
                          </TableCell>
                          <TableCell>{record.department}</TableCell>
                          {record.balances.map((bal, i) => (
                            <>
                              <TableCell key={`${record.employeeId}-${i}-t`} className="text-center border-l">
                                {bal.total}
                              </TableCell>
                              <TableCell key={`${record.employeeId}-${i}-u`} className="text-center text-orange-600">
                                {bal.used}
                              </TableCell>
                              <TableCell key={`${record.employeeId}-${i}-r`} className="text-center font-medium text-green-600">
                                {bal.remaining}
                              </TableCell>
                            </>
                          ))}
                        </TableRow>
                      ))}
                      {pagedRecords.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={2 + report.leaveTypes.length * 3} className="text-center text-muted-foreground py-8">
                            No records match your search
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
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
                <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">No leave balance records</p>
                <p className="text-sm text-muted-foreground">
                  There are no leave balance records for {report.year}
                </p>
              </div>
            )}

            {/* Legend */}
            {report.records.length > 0 && (
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>Total = Allocated days</span>
                <span className="text-orange-600">Used = Days taken</span>
                <span className="text-green-600">Left = Remaining balance</span>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
