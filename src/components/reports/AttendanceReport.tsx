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
import { Download, Clock, AlertTriangle, Timer, Loader2, Search, FileSpreadsheet } from "lucide-react";
import { useAttendanceReportData } from "@/hooks/useAttendanceReport";
import { useReportMasters } from "@/hooks/useReportMasters";
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
const YEARS = Array.from({ length: 5 }, (_, i) => ({ value: String(currentYear - i), label: String(currentYear - i) }));

const formatDuration = (minutes: number) => {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

const formatHours = (hours: number) => `${hours.toFixed(1)}h`;

export function AttendanceReport() {
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(currentDate.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(currentDate.getFullYear()));
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [selectedProcess, setSelectedProcess] = useState<string>("all");
  const [selectedCostCentre, setSelectedCostCentre] = useState<string>("all");
  const [pageSize, setPageSize] = useState<string>("100");
  const [isExporting, setIsExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const { data: masters } = useReportMasters();
  const { data: summary, isLoading } = useAttendanceReportData(
    parseInt(selectedMonth),
    parseInt(selectedYear),
    selectedBranch !== "all" ? selectedBranch : undefined,
    selectedProcess !== "all" ? selectedProcess : undefined,
    selectedCostCentre !== "all" ? selectedCostCentre : undefined,
  );

  const filteredRecords = useMemo(() => {
    if (!summary) return [];
    const q = search.toLowerCase().trim();
    if (!q) return summary.records;
    return summary.records.filter((r) =>
      r.employeeName.toLowerCase().includes(q) ||
      (r.employeeCode ?? "").toLowerCase().includes(q) ||
      r.department.toLowerCase().includes(q) ||
      r.branch.toLowerCase().includes(q) ||
      r.process.toLowerCase().includes(q) ||
      r.costCentre.toLowerCase().includes(q)
    );
  }, [summary, search]);

  const effectivePageSize = pageSize === "all" ? Math.max(filteredRecords.length, 1) : Number(pageSize);
  const totalPages = Math.ceil(filteredRecords.length / effectivePageSize);
  const pagedRecords = filteredRecords.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);

  const resetPage = () => setCurrentPage(1);

  const exportToCSV = () => {
    if (!summary) return;
    const headers = ["Employee", "Code", "Branch", "Process", "Cost Centre", "Department", "Days", "Hours", "Late Arrivals", "Late Minutes", "Overtime Hours"];
    const rows = filteredRecords.map((r) => [
      r.employeeName, r.employeeCode, r.branch, r.process, r.costCentre, r.department,
      r.totalDays, r.totalHours.toFixed(1), r.lateArrivals, r.totalLateMinutes, r.totalOvertimeHours.toFixed(1),
    ]);
    const escape = (v: string | number) => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Attendance_Report_${summary.monthName.replace(" ", "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportToPDF = async () => {
    if (!summary) return;
    setIsExporting(true);
    try {
      const doc = new jsPDF({ orientation: "landscape" });
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("Attendance Report", pageWidth / 2, 20, { align: "center" });
      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.text(`Late Arrivals & Overtime - ${summary.monthName}`, pageWidth / 2, 30, { align: "center" });
      doc.setFontSize(9);
      doc.text(`Generated on: ${formatISTDate()}`, 14, 45);
      doc.text(`Total Employees: ${summary.totalEmployees}`, 14, 51);
      doc.text(`Total Late Arrivals: ${summary.totalLateArrivals}`, 14, 57);
      doc.text(`Total Overtime: ${formatHours(summary.totalOvertimeHours)}`, 14, 63);
      autoTable(doc, {
        startY: 72,
        head: [["Employee", "Code", "Branch", "Process", "Cost Centre", "Department", "Days", "Hours", "Late", "Late Time", "Overtime"]],
        body: filteredRecords.map((record) => [
          record.employeeName,
          record.employeeCode,
          record.branch,
          record.process,
          record.costCentre,
          record.department,
          String(record.totalDays),
          formatHours(record.totalHours),
          String(record.lateArrivals),
          formatDuration(record.totalLateMinutes),
          formatHours(record.totalOvertimeHours),
        ]),
        theme: "striped",
        styles: { fontSize: 7 },
        headStyles: { fillColor: [59, 130, 246], fontSize: 7 },
      });
      doc.save(`Attendance_Report_${summary.monthName.replace(" ", "_")}.pdf`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Attendance Report
            </CardTitle>
            <CardDescription>Late arrivals, working hours, branch, process and cost-centre tracking</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedMonth} onValueChange={(v) => { setSelectedMonth(v); resetPage(); }}>
              <SelectTrigger className="w-[130px]"><SelectValue placeholder="Month" /></SelectTrigger>
              <SelectContent>{MONTHS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={selectedYear} onValueChange={(v) => { setSelectedYear(v); resetPage(); }}>
              <SelectTrigger className="w-[100px]"><SelectValue placeholder="Year" /></SelectTrigger>
              <SelectContent>{YEARS.map((y) => <SelectItem key={y.value} value={y.value}>{y.label}</SelectItem>)}</SelectContent>
            </Select>
            {masters && masters.branches.length > 0 && (
              <Select value={selectedBranch} onValueChange={(v) => { setSelectedBranch(v); resetPage(); }}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="All Branches" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {masters.branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {masters && masters.processes.length > 0 && (
              <Select value={selectedProcess} onValueChange={(v) => { setSelectedProcess(v); resetPage(); }}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Processes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Processes</SelectItem>
                  {masters.processes.map((p) => <SelectItem key={p.id} value={p.id}>{p.process_name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {masters && masters.costCentres.length > 0 && (
              <Select value={selectedCostCentre} onValueChange={(v) => { setSelectedCostCentre(v); resetPage(); }}>
                <SelectTrigger className="w-[170px]"><SelectValue placeholder="All Cost Centres" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Cost Centres</SelectItem>
                  {masters.costCentres.map((c) => <SelectItem key={c.id} value={c.id}>{c.cost_centre_name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" onClick={exportToCSV} disabled={!filteredRecords.length}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />CSV
            </Button>
            <Button onClick={exportToPDF} disabled={isExporting || !summary?.records.length}>
              {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              PDF
            </Button>
          </div>
        </div>
        {summary && summary.records.length > 0 && (
          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, code, branch, process, department..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); resetPage(); }}
                className="pl-9"
              />
            </div>
            <Select value={pageSize} onValueChange={(v) => { setPageSize(v); resetPage(); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Rows" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="50">50 rows</SelectItem>
                <SelectItem value="100">100 rows</SelectItem>
                <SelectItem value="250">250 rows</SelectItem>
                <SelectItem value="all">Show all</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}</div>
            <Skeleton className="h-64" />
          </div>
        ) : summary ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-lg border bg-muted/50 p-4"><p className="text-sm text-muted-foreground">Total Employees</p><p className="text-2xl font-bold">{summary.totalEmployees}</p></div>
              <div className="rounded-lg border bg-red-500/10 p-4"><div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-600" /><p className="text-sm text-red-600">Late Arrivals</p></div><p className="mt-1 text-2xl font-bold text-red-600">{summary.totalLateArrivals}</p><p className="text-xs text-muted-foreground">Avg: {formatDuration(summary.avgLateMinutes)}</p></div>
              <div className="rounded-lg border bg-orange-500/10 p-4"><div className="flex items-center gap-2"><Timer className="h-4 w-4 text-orange-600" /><p className="text-sm text-orange-600">Total Overtime</p></div><p className="mt-1 text-2xl font-bold text-orange-600">{formatHours(summary.totalOvertimeHours)}</p></div>
              <div className="rounded-lg border bg-primary/10 p-4"><p className="text-sm text-muted-foreground">Report Period</p><p className="text-2xl font-bold text-primary">{summary.monthName}</p></div>
            </div>

            {summary.records.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Showing {filteredRecords.length === summary.records.length ? `all ${summary.records.length}` : `${filteredRecords.length} of ${summary.records.length}`} employees
                  {totalPages > 1 && ` — page ${currentPage} of ${totalPages}`}
                </p>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead>Process</TableHead>
                        <TableHead>Cost Centre</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead className="text-center">Days</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="text-center">Late</TableHead>
                        <TableHead className="text-right">Late Time</TableHead>
                        <TableHead className="text-right">Overtime</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedRecords.map((record) => (
                        <TableRow key={record.employeeId}>
                          <TableCell><p className="font-medium">{record.employeeName}</p><p className="text-xs text-muted-foreground">{record.employeeCode}</p></TableCell>
                          <TableCell>{record.branch}</TableCell>
                          <TableCell>{record.process}</TableCell>
                          <TableCell>{record.costCentre}</TableCell>
                          <TableCell>{record.department}</TableCell>
                          <TableCell className="text-center">{record.totalDays}</TableCell>
                          <TableCell className="text-right">{formatHours(record.totalHours)}</TableCell>
                          <TableCell className="text-center">{record.lateArrivals > 0 ? <Badge variant="destructive" className="bg-red-500/10 text-red-600 hover:bg-red-500/20">{record.lateArrivals}</Badge> : <Badge variant="secondary" className="bg-green-500/10 text-green-600">0</Badge>}</TableCell>
                          <TableCell className="text-right">{record.totalLateMinutes > 0 ? <span className="text-red-600">{formatDuration(record.totalLateMinutes)}</span> : <span className="text-muted-foreground">-</span>}</TableCell>
                          <TableCell className="text-right">{record.totalOvertimeHours > 0 ? <Badge className="bg-orange-500/10 text-orange-600 hover:bg-orange-500/20">{formatHours(record.totalOvertimeHours)}</Badge> : <span className="text-muted-foreground">-</span>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={5} className="font-bold">Total ({filteredRecords.length} employees)</TableCell>
                        <TableCell className="text-center font-bold">{filteredRecords.reduce((sum, r) => sum + r.totalDays, 0)}</TableCell>
                        <TableCell className="text-right font-bold">{formatHours(filteredRecords.reduce((sum, r) => sum + r.totalHours, 0))}</TableCell>
                        <TableCell className="text-center font-bold text-red-600">{filteredRecords.reduce((sum, r) => sum + r.lateArrivals, 0)}</TableCell>
                        <TableCell className="text-right font-bold text-red-600">{formatDuration(filteredRecords.reduce((sum, r) => sum + r.totalLateMinutes, 0))}</TableCell>
                        <TableCell className="text-right font-bold text-orange-600">{formatHours(filteredRecords.reduce((sum, r) => sum + r.totalOvertimeHours, 0))}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>Previous</Button>
                    <span className="text-sm text-muted-foreground">Page {currentPage} / {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}>Next</Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">No attendance records found</p>
                <p className="text-sm text-muted-foreground">There are no attendance records for {summary.monthName}</p>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
