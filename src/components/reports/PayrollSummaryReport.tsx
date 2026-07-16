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
import { Download, FileText, Loader2, Search, FileSpreadsheet } from "lucide-react";
import { usePayrollSummary } from "@/hooks/usePayrollSummary";
import { useReportMasters } from "@/hooks/useReportMasters";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatISTDate } from "@/lib/utils";

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

const formatCurrency = (amount: number) => new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
}).format(amount);

const getStatusBadge = (status: string) => {
  switch (status) {
    case "paid": return <Badge className="bg-green-500/10 text-green-600">Paid</Badge>;
    case "processed": return <Badge className="bg-blue-500/10 text-blue-600">Processed</Badge>;
    default: return <Badge variant="secondary">Draft</Badge>;
  }
};

export function PayrollSummaryReport() {
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
  const { data: summary, isLoading } = usePayrollSummary(
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
    const headers = ["Employee", "Code", "Branch", "Process", "Cost Centre", "Department", "Basic", "Allowances", "Deductions", "Net Salary", "Status"];
    const rows = filteredRecords.map((r) => [
      r.employeeName, r.employeeCode, r.branch, r.process, r.costCentre, r.department,
      r.basicSalary, r.allowances, r.deductions, r.netSalary, r.status,
    ]);
    const escape = (v: string | number) => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Payroll_Summary_${summary.monthName.replace(" ", "_")}.csv`;
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
      doc.text("Monthly Payroll Summary Report", pageWidth / 2, 20, { align: "center" });
      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.text(summary.monthName, pageWidth / 2, 30, { align: "center" });
      doc.setFontSize(9);
      doc.text(`Generated on: ${formatISTDate()}`, 14, 45);
      doc.text(`Total Employees: ${filteredRecords.length}`, 14, 52);
      autoTable(doc, {
        startY: 62,
        head: [["Employee", "Code", "Branch", "Process", "Cost Centre", "Department", "Basic", "Allowances", "Deductions", "Net", "Status"]],
        body: filteredRecords.map((record) => [
          record.employeeName,
          record.employeeCode,
          record.branch,
          record.process,
          record.costCentre,
          record.department,
          formatCurrency(record.basicSalary),
          formatCurrency(record.allowances),
          formatCurrency(record.deductions),
          formatCurrency(record.netSalary),
          record.status,
        ]),
        theme: "striped",
        styles: { fontSize: 7 },
        headStyles: { fillColor: [59, 130, 246], fontSize: 7 },
      });
      doc.save(`Payroll_Summary_${summary.monthName.replace(" ", "_")}.pdf`);
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
              <FileText className="h-5 w-5" />
              Monthly Payroll Summary
            </CardTitle>
            <CardDescription>View and export payroll data by branch, process and cost centre</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedMonth} onValueChange={(v) => { setSelectedMonth(v); resetPage(); }}>
              <SelectTrigger className="w-[130px]"><SelectValue placeholder="Month" /></SelectTrigger>
              <SelectContent>{MONTHS.map((month) => <SelectItem key={month.value} value={month.value}>{month.label}</SelectItem>)}</SelectContent>
            </Select>
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
        {summary && summary.records.length > 0 && (
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
        ) : summary ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="rounded-lg border bg-muted/50 p-4"><p className="text-sm text-muted-foreground">Employees</p><p className="text-2xl font-bold">{filteredRecords.length}</p></div>
              <div className="rounded-lg border bg-muted/50 p-4"><p className="text-sm text-muted-foreground">Total Basic</p><p className="text-2xl font-bold">{formatCurrency(filteredRecords.reduce((s, r) => s + r.basicSalary, 0))}</p></div>
              <div className="rounded-lg border bg-muted/50 p-4"><p className="text-sm text-muted-foreground">Deductions</p><p className="text-2xl font-bold">{formatCurrency(filteredRecords.reduce((s, r) => s + r.deductions, 0))}</p></div>
              <div className="rounded-lg border bg-primary/10 p-4"><p className="text-sm text-muted-foreground">Net Salary</p><p className="text-2xl font-bold text-primary">{formatCurrency(filteredRecords.reduce((s, r) => s + r.netSalary, 0))}</p></div>
            </div>

            {summary.records.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Showing {filteredRecords.length === summary.records.length ? `all ${summary.records.length}` : `${filteredRecords.length} of ${summary.records.length}`} payroll records
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
                        <TableHead className="text-right">Basic</TableHead>
                        <TableHead className="text-right">Allowances</TableHead>
                        <TableHead className="text-right">Deductions</TableHead>
                        <TableHead className="text-right">Net Salary</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedRecords.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell><p className="font-medium">{record.employeeName}</p><p className="text-xs text-muted-foreground">{record.employeeCode}</p></TableCell>
                          <TableCell>{record.branch}</TableCell>
                          <TableCell>{record.process}</TableCell>
                          <TableCell>{record.costCentre}</TableCell>
                          <TableCell>{record.department}</TableCell>
                          <TableCell className="text-right">{formatCurrency(record.basicSalary)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(record.totalAllowances)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(record.totalDeductions)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(record.netSalary)}</TableCell>
                          <TableCell>{getStatusBadge(record.status)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={5} className="font-bold">Total</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(filteredRecords.reduce((s, r) => s + r.basicSalary, 0))}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(filteredRecords.reduce((s, r) => s + r.allowances, 0))}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(filteredRecords.reduce((s, r) => s + r.deductions, 0))}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(filteredRecords.reduce((s, r) => s + r.netSalary, 0))}</TableCell>
                        <TableCell></TableCell>
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
                <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">No payroll records found</p>
                <p className="text-sm text-muted-foreground">There are no payroll records for {summary.monthName}</p>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
