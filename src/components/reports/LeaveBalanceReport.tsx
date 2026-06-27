import { useState, useMemo, Fragment } from "react";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
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
const YEARS = Array.from({ length: 5 }, (_, i) => ({ value: String(currentYear - i), label: String(currentYear - i) }));

export function LeaveBalanceReport() {
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [selectedBranch, setSelectedBranch] = useState<string>("all");
  const [selectedProcess, setSelectedProcess] = useState<string>("all");
  const [selectedCostCentre, setSelectedCostCentre] = useState<string>("all");
  const [pageSize, setPageSize] = useState<string>("100");
  const [isExporting, setIsExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const { data: masters } = useReportMasters();
  const { data: report, isLoading } = useLeaveBalanceReport(
    parseInt(selectedYear),
    selectedBranch !== "all" ? selectedBranch : undefined,
    selectedProcess !== "all" ? selectedProcess : undefined,
    selectedCostCentre !== "all" ? selectedCostCentre : undefined,
  );

  const filteredRecords = useMemo(() => {
    if (!report) return [];
    const q = search.toLowerCase().trim();
    if (!q) return report.records;
    return report.records.filter((r) =>
      r.employeeName.toLowerCase().includes(q) ||
      (r.employeeCode ?? "").toLowerCase().includes(q) ||
      r.department.toLowerCase().includes(q) ||
      (r.branch ?? "").toLowerCase().includes(q) ||
      (r.process ?? "").toLowerCase().includes(q) ||
      (r.costCentre ?? "").toLowerCase().includes(q)
    );
  }, [report, search]);

  const effectivePageSize = pageSize === "all" ? Math.max(filteredRecords.length, 1) : Number(pageSize);
  const totalPages = Math.ceil(filteredRecords.length / effectivePageSize);
  const pagedRecords = filteredRecords.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);
  const resetPage = () => setCurrentPage(1);

  const exportToCSV = () => {
    if (!report || !filteredRecords.length) return;
    const headers = ["Employee", "Code", "Branch", "Process", "Cost Centre", "Department",
      ...report.leaveTypes.flatMap((lt) => [`${lt} Total`, `${lt} Used`, `${lt} Remaining`])];
    const rows = filteredRecords.map((r) => [
      r.employeeName, r.employeeCode ?? "", r.branch ?? "", r.process ?? "", r.costCentre ?? "", r.department,
      ...r.balances.flatMap((b) => [b.total, b.used, b.remaining]),
    ]);
    const escape = (v: string | number) => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Leave_Balance_Report_${report.year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportToPDF = async () => {
    if (!report || filteredRecords.length === 0) return;
    setIsExporting(true);
    try {
      const doc = new jsPDF({ orientation: "landscape" });
      const pageWidth = doc.internal.pageSize.getWidth();
      doc.setFontSize(20);
      doc.setFont("helvetica", "bold");
      doc.text("Leave Balance Report", pageWidth / 2, 20, { align: "center" });
      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.text(`Year: ${report.year}`, pageWidth / 2, 30, { align: "center" });
      doc.setFontSize(9);
      doc.text(`Generated on: ${formatISTDate()}`, 14, 45);
      doc.text(`Total Employees: ${filteredRecords.length}`, 14, 52);
      const headers = ["Employee", "Code", "Branch", "Process", "Cost Centre", "Department"];
      report.leaveTypes.forEach((lt) => headers.push(`${lt} Total`, `${lt} Used`, `${lt} Left`));
      const body = filteredRecords.map((record) => {
        const row: (string | number)[] = [
          record.employeeName,
          record.employeeCode,
          record.branch ?? "-",
          record.process ?? "-",
          record.costCentre ?? "-",
          record.department,
        ];
        record.balances.forEach((bal) => row.push(bal.total, bal.used, bal.remaining));
        return row;
      });
      autoTable(doc, {
        startY: 62,
        head: [headers],
        body,
        theme: "striped",
        styles: { fontSize: 6, cellPadding: 1.5 },
        headStyles: { fillColor: [59, 130, 246], fontSize: 6 },
      });
      doc.save(`Leave_Balance_Report_${report.year}.pdf`);
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
              <Calendar className="h-5 w-5" />
              Leave Balance Report
            </CardTitle>
            <CardDescription>Employee leave balances by branch, process, cost centre and leave type</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedYear} onValueChange={(v) => { setSelectedYear(v); resetPage(); }}>
              <SelectTrigger className="w-[100px]"><SelectValue placeholder="Year" /></SelectTrigger>
              <SelectContent>{YEARS.map((year) => <SelectItem key={year.value} value={year.value}>{year.label}</SelectItem>)}</SelectContent>
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
            <Button onClick={exportToPDF} disabled={isExporting || !filteredRecords.length}>
              {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              PDF
            </Button>
          </div>
        </div>
        {report && report.records.length > 0 && (
          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, code, branch, process, cost centre or department..."
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
                <SelectItem value="500">500 rows</SelectItem>
                <SelectItem value="all">Show all</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4"><Skeleton className="h-64" /></div>
        ) : report ? (
          <div className="space-y-4">
            {report.records.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Showing {filteredRecords.length === report.records.length ? `all ${report.records.length}` : `${filteredRecords.length} of ${report.records.length}`} employees
                  {totalPages > 1 && ` — page ${currentPage} of ${totalPages}`}
                </p>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background">Employee</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead>Process</TableHead>
                        <TableHead>Cost Centre</TableHead>
                        <TableHead>Department</TableHead>
                        {report.leaveTypes.map((lt) => <TableHead key={lt} colSpan={3} className="text-center border-l">{lt}</TableHead>)}
                      </TableRow>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background"></TableHead>
                        <TableHead></TableHead>
                        <TableHead></TableHead>
                        <TableHead></TableHead>
                        <TableHead></TableHead>
                        {report.leaveTypes.map((lt) => (
                          <Fragment key={`${lt}-headers`}>
                            <TableHead className="text-center text-xs border-l">Total</TableHead>
                            <TableHead className="text-center text-xs">Used</TableHead>
                            <TableHead className="text-center text-xs">Left</TableHead>
                          </Fragment>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedRecords.map((record) => (
                        <TableRow key={record.employeeId}>
                          <TableCell className="sticky left-0 bg-background">
                            <p className="font-medium whitespace-nowrap">{record.employeeName}</p>
                            <p className="text-xs text-muted-foreground">{record.employeeCode}</p>
                          </TableCell>
                          <TableCell>{record.branch ?? "-"}</TableCell>
                          <TableCell>{record.process ?? "-"}</TableCell>
                          <TableCell>{record.costCentre ?? "-"}</TableCell>
                          <TableCell>{record.department}</TableCell>
                          {record.balances.map((bal) => (
                            <Fragment key={`${record.employeeId}-${bal.leaveType}`}>
                              <TableCell className="text-center border-l">{bal.total}</TableCell>
                              <TableCell className="text-center">{bal.used}</TableCell>
                              <TableCell className="text-center font-medium">{bal.remaining}</TableCell>
                            </Fragment>
                          ))}
                        </TableRow>
                      ))}
                      {pagedRecords.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5 + report.leaveTypes.length * 3} className="text-center text-muted-foreground py-8">No records match your search</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
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
                <Calendar className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">No leave balances found</p>
                <p className="text-sm text-muted-foreground">There are no leave balance records for {report.year}</p>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
