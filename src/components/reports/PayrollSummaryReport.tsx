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
import { Download, FileText, Loader2, Search } from "lucide-react";
import { usePayrollSummary } from "@/hooks/usePayrollSummary";
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

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(amount);
};

const getStatusBadge = (status: string) => {
  switch (status) {
    case "paid":
      return <Badge className="bg-green-500/10 text-green-600">Paid</Badge>;
    case "processed":
      return <Badge className="bg-blue-500/10 text-blue-600">Processed</Badge>;
    default:
      return <Badge variant="secondary">Draft</Badge>;
  }
};

const PAGE_SIZE = 50;

export function PayrollSummaryReport() {
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(currentDate.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(currentDate.getFullYear()));
  const [isExporting, setIsExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const { data: summary, isLoading } = usePayrollSummary(
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
      doc.text("Monthly Payroll Summary Report", pageWidth / 2, 20, { align: "center" });

      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.text(summary.monthName, pageWidth / 2, 30, { align: "center" });

      // Summary stats
      doc.setFontSize(10);
      doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 45);
      doc.text(`Total Employees: ${summary.employeeCount}`, 14, 52);

      // Summary table
      autoTable(doc, {
        startY: 60,
        head: [["Category", "Amount"]],
        body: [
          ["Total Basic Salary", formatCurrency(summary.totalBasic)],
          ["Total Allowances", formatCurrency(summary.totalAllowances)],
          ["Total Deductions", formatCurrency(summary.totalDeductions)],
          ["Total Net Salary", formatCurrency(summary.totalNetSalary)],
        ],
        theme: "grid",
        headStyles: { fillColor: [59, 130, 246] },
        styles: { fontSize: 10 },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 60, halign: "right" },
        },
      });

      // Employee details table
      const finalY = (doc as any).lastAutoTable.finalY || 100;

      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("Employee Payroll Details", 14, finalY + 15);

      autoTable(doc, {
        startY: finalY + 20,
        head: [["Employee", "Department", "Basic", "Allowances", "Deductions", "Net Salary", "Status"]],
        body: summary.records.map((record) => [
          record.employeeName,
          record.department,
          formatCurrency(record.basicSalary),
          formatCurrency(record.allowances),
          formatCurrency(record.deductions),
          formatCurrency(record.netSalary),
          record.status.charAt(0).toUpperCase() + record.status.slice(1),
        ]),
        foot: [[
          "TOTAL",
          "",
          formatCurrency(summary.totalBasic),
          formatCurrency(summary.totalAllowances),
          formatCurrency(summary.totalDeductions),
          formatCurrency(summary.totalNetSalary),
          "",
        ]],
        theme: "striped",
        headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
        bodyStyles: { fontSize: 8 },
        footStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 35 },
          1: { cellWidth: 30 },
          2: { cellWidth: 25, halign: "right" },
          3: { cellWidth: 25, halign: "right" },
          4: { cellWidth: 25, halign: "right" },
          5: { cellWidth: 25, halign: "right" },
          6: { cellWidth: 20 },
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

      doc.save(`Payroll_Summary_${summary.monthName.replace(" ", "_")}.pdf`);
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
              <FileText className="h-5 w-5" />
              Monthly Payroll Summary
            </CardTitle>
            <CardDescription>View and export payroll data</CardDescription>
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
                <p className="text-sm text-muted-foreground">Total Basic</p>
                <p className="text-2xl font-bold">{formatCurrency(summary.totalBasic)}</p>
              </div>
              <div className="rounded-lg border bg-muted/50 p-4">
                <p className="text-sm text-muted-foreground">Total Allowances</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(summary.totalAllowances)}</p>
              </div>
              <div className="rounded-lg border bg-muted/50 p-4">
                <p className="text-sm text-muted-foreground">Total Deductions</p>
                <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.totalDeductions)}</p>
              </div>
              <div className="rounded-lg border bg-primary/10 p-4">
                <p className="text-sm text-muted-foreground">Net Payroll</p>
                <p className="text-2xl font-bold text-primary">{formatCurrency(summary.totalNetSalary)}</p>
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
                          <TableCell>
                            <div>
                              <p className="font-medium">{record.employeeName}</p>
                              <p className="text-xs text-muted-foreground">{record.employeeCode}</p>
                            </div>
                          </TableCell>
                          <TableCell>{record.department}</TableCell>
                          <TableCell className="text-right">{formatCurrency(record.basicSalary)}</TableCell>
                          <TableCell className="text-right text-green-600">{formatCurrency(record.allowances)}</TableCell>
                          <TableCell className="text-right text-red-600">{formatCurrency(record.deductions)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(record.netSalary)}</TableCell>
                          <TableCell>{getStatusBadge(record.status)}</TableCell>
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
                        <TableCell colSpan={2} className="font-bold">Total ({summary.employeeCount} employees)</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(summary.totalBasic)}</TableCell>
                        <TableCell className="text-right font-bold text-green-600">{formatCurrency(summary.totalAllowances)}</TableCell>
                        <TableCell className="text-right font-bold text-red-600">{formatCurrency(summary.totalDeductions)}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(summary.totalNetSalary)}</TableCell>
                        <TableCell></TableCell>
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
                <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium">No payroll records found</p>
                <p className="text-sm text-muted-foreground">
                  There are no payroll records for {summary.monthName}
                </p>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
