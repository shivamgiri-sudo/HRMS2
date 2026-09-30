import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  Building2,
  FileText,
  Printer,
  Search,
  User,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { useToast } from "@/hooks/use-toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmployeeSearchResult {
  id: string;
  employee_code: string;
  first_name: string;
  last_name?: string;
  designation?: string;
  branch_name?: string;
  department_name?: string;
  date_of_joining?: string;
}

interface CertificateData {
  template: "salary" | "employment" | "ctc";
  employee_name: string;
  designation: string | null;
  branch_name: string | null;
  department_name: string | null;
  date_of_joining: string;
  employment_status: string | null;
  gross_salary: number | null;
  net_salary: number | null;
  basic_salary: number | null;
  annual_ctc: number | null;
  period_from: string | null;
  period_to: string | null;
  period_month_count: number | null;
  addressee: string;
  purpose: string;
  body_text: string;
  issue_date: string;
  company_name: string;
}

interface GenerateResponse {
  success: boolean;
  data: {
    id: string;
    employee_name: string;
    template: string;
    certificate_data: CertificateData;
  };
}

interface HistoryRecord {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  template: "salary" | "employment" | "ctc";
  period_from: string | null;
  period_to: string | null;
  addressee: string | null;
  purpose: string | null;
  generated_at: string;
}

interface HistoryResponse {
  success: boolean;
  data: HistoryRecord[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function templateLabel(t: string): string {
  if (t === "salary") return "Salary Certificate";
  if (t === "employment") return "Employment Certificate";
  if (t === "ctc") return "CTC Certificate";
  return t;
}

function formatDt(val: string | undefined | null): string {
  if (!val) return "—";
  try { return new Date(val).toLocaleString(); } catch { return val; }
}

// ---------------------------------------------------------------------------
// Certificate Preview (printable)
// ---------------------------------------------------------------------------

function CertificatePreview({ data }: { data: CertificateData }) {
  // Check if this is a period-based (yearly) certificate
  const isPeriodCertificate = data.period_from && data.period_to && data.period_month_count;

  // For period certificates, basic_salary and gross_salary are already totals from backend
  // For monthly certificates, they are single month values
  const basicValue = data.basic_salary ?? 0;

  // Format salary breakdown (backend provides period totals when period_from/to specified)
  const salaryComponents = [
    { label: "Basic", value: basicValue },
    { label: "HRA", value: Math.round(basicValue * 0.44) }, // 44% of basic
    { label: "Conveyance", value: Math.round(basicValue * 0.10) }, // 10%
    { label: "Bonus", value: Math.round(basicValue * 0.083) }, // ~8.3%
    { label: "Portfolio Allowance", value: Math.round(basicValue * 0.083) },
    { label: "Incentive", value: 0 }, // Variable
  ];

  const totalGross = salaryComponents.reduce((sum, comp) => sum + comp.value, 0);

  return (
    <div
      id="cert-print-area"
      className="bg-white border border-slate-200 rounded-lg p-8 max-w-3xl mx-auto shadow-sm print:shadow-none print:border-0 print:p-12"
    >
      {/* MAS Letterhead */}
      <div className="border-b-2 border-slate-800 pb-4 mb-6">
        <div className="flex items-start gap-4">
          {/* Logo */}
          <img
            src="/mcn-logo.png"
            alt="MAS Callnet India"
            className="h-16 w-auto object-contain"
          />

          {/* Company Details */}
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900 mb-1">Mas Callnet India Pvt. Ltd.</h1>
            <p className="text-xs text-slate-700 leading-relaxed">
              <span className="font-semibold">CIN No.:</span> U74899DL1990PTC038798<br />
              <span className="font-semibold">Registered Office:</span> 102/C-1, Kanchan House, Karampura Commercial Complex,<br />
              Karampura New Delhi-110015, India<br />
              <span className="font-semibold">Tel.:</span> 011-91-61105550 |
              <span className="font-semibold"> E-mail:</span> care@teammas.in |
              <span className="font-semibold"> Web:</span> www.teammas.in
            </p>
          </div>
        </div>
      </div>

      {/* Date */}
      <div className="text-right text-sm text-slate-700 mb-6">
        <span className="font-semibold">Date:</span> {new Date(data.issue_date).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        })}
      </div>

      {/* Addressee */}
      <div className="mb-6">
        <p className="text-sm font-bold text-slate-900 uppercase tracking-wide">{data.addressee}</p>
      </div>

      {/* Certificate Body */}
      <div className="mb-6">
        <p className="text-sm leading-relaxed text-slate-800">
          This is to certify that <span className="font-semibold">{data.employee_name}</span>
          {data.designation && <>, {data.designation}</>}
          {data.branch_name && <>, working at {data.branch_name}</>}.
        </p>

        {/* Period-specific content */}
        {data.template === "salary" && data.period_from && data.period_to && (
          <div className="mt-4">
            <p className="text-sm text-slate-800 mb-3">
              Total Income for the period{" "}
              <span className="font-semibold">
                {new Date(data.period_from).toLocaleDateString('en-IN')} to {new Date(data.period_to).toLocaleDateString('en-IN')}
              </span>{" "}
              is <span className="font-semibold">Rs. {(data.gross_salary ?? totalGross).toLocaleString('en-IN')}/-</span>
              {" "}({numberToWords(data.gross_salary ?? totalGross)}).
            </p>

            {/* Salary Breakdown Table */}
            <div className="my-4 text-sm">
              <p className="font-semibold mb-2">Details as per below:</p>
              <table className="w-full border border-slate-300">
                <tbody>
                  {salaryComponents.map((comp, idx) => (
                    <tr key={idx} className="border-b border-slate-300 last:border-b-2 last:border-slate-800 last:font-bold">
                      <td className="px-3 py-1.5 border-r border-slate-300">{comp.label}</td>
                      <td className="px-3 py-1.5 text-right">{comp.value.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                  <tr className="font-bold border-t-2 border-slate-800">
                    <td className="px-3 py-1.5 border-r border-slate-300">Total</td>
                    <td className="px-3 py-1.5 text-right">{totalGross.toLocaleString('en-IN')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Employment/CTC body text */}
        {data.template !== "salary" && (
          <div className="mt-3 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
            {data.body_text}
          </div>
        )}

        {/* DOJ */}
        {data.date_of_joining && (
          <p className="text-sm text-slate-800 mt-3">
            <span className="font-semibold">Date of Joining:</span>{" "}
            {new Date(data.date_of_joining).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="mt-12 pt-6">
        <p className="text-sm text-slate-700 mb-1">
          <span className="font-semibold">Date:</span> {new Date(data.issue_date).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          })}
        </p>

        <div className="mt-12 flex justify-between items-end">
          <div>
            <div className="border-t-2 border-slate-800 pt-2 pr-20">
              <p className="text-sm font-semibold text-slate-900">Signature of the Employer/HOD/DDO</p>
              <p className="text-sm text-slate-700 mt-1">Name: Mr. Naresh Kumar Chauhan</p>
              <p className="text-sm text-slate-700">Designation: Deputy Manager HR</p>
            </div>
          </div>

          <div className="text-center">
            <p className="text-sm font-semibold text-slate-700 mb-1">Seal:</p>
            <div className="w-24 h-24 border-2 border-dashed border-slate-300 rounded-full flex items-center justify-center">
              <span className="text-xs text-slate-400">Company<br/>Seal</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper to convert number to words (Indian numbering)
function numberToWords(num: number): string {
  if (!num || num === 0) return "Zero";

  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];

  function convertHundreds(n: number): string {
    if (n === 0) return "";
    if (n < 10) return ones[n];
    if (n >= 10 && n < 20) return teens[n - 10];
    if (n >= 20 && n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? " " + ones[n % 10] : "");
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 !== 0 ? " " + convertHundreds(n % 100) : "");
  }

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const remainder = num % 1000;

  let result = "";
  if (crore > 0) result += convertHundreds(crore) + " Crore ";
  if (lakh > 0) result += convertHundreds(lakh) + " Lac ";
  if (thousand > 0) result += convertHundreds(thousand) + " Thousand ";
  if (remainder > 0) result += convertHundreds(remainder);

  return "Rs. " + result.trim() + " only";
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SalaryCertificate() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { roleKeys, isLoading: roleLoading, employeeId: myEmpId } = useWorkforceAccess();

  const isPayrollRole = roleKeys.some((r) =>
    ["admin", "hr", "payroll_head", "finance", "super_admin"].includes(r)
  );

  // ------ Employee search ------
  const [empSearch, setEmpSearch] = useState("");
  const [empResults, setEmpResults] = useState<EmployeeSearchResult[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<EmployeeSearchResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ------ Form ------
  const [template, setTemplate] = useState<"salary" | "employment" | "ctc">("salary");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [addressee, setAddressee] = useState("To Whom It May Concern");
  const [purpose, setPurpose] = useState("");

  // ------ Result ------
  const [certData, setCertData] = useState<CertificateData | null>(null);

  // ------ History tab employee id ------
  // For payroll roles: use selectedEmp; for employees: always use myEmpId
  const historyEmpId = isPayrollRole ? selectedEmp?.id : (myEmpId ?? undefined);

  // ---------------------------------------------------------------------------
  // Employee search debounce
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!isPayrollRole) {
      // Employees don't search; they only see their own
      return;
    }

    if (!empSearch.trim() || selectedEmp) {
      setEmpResults([]);
      setDropdownOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const data = await hrmsApi.get<{ employees?: EmployeeSearchResult[]; data?: EmployeeSearchResult[] } | EmployeeSearchResult[]>(
          `/api/employees?search=${encodeURIComponent(empSearch.trim())}&limit=10`
        );
        const list = Array.isArray(data)
          ? data
          : (data as { employees?: EmployeeSearchResult[] }).employees ??
            (data as { data?: EmployeeSearchResult[] }).data ??
            [];
        setEmpResults(list);
        setDropdownOpen(list.length > 0);
      } catch {
        setEmpResults([]);
        setDropdownOpen(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [empSearch, selectedEmp, isPayrollRole]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSelectEmployee = useCallback((emp: EmployeeSearchResult) => {
    setSelectedEmp(emp);
    setEmpSearch(`${emp.first_name} ${emp.last_name ?? ""} (${emp.employee_code})`);
    setDropdownOpen(false);
    setEmpResults([]);
    setCertData(null);
  }, []);

  // ---------------------------------------------------------------------------
  // History query
  // ---------------------------------------------------------------------------
  const { data: historyData, refetch: refetchHistory } = useQuery<HistoryResponse>({
    queryKey: ["cert-history", historyEmpId],
    queryFn: () =>
      hrmsApi.get<HistoryResponse>(`/api/payroll/salary-certificates/employee/${historyEmpId}`),
    enabled: !!historyEmpId,
  });

  const historyList = historyData?.data ?? [];

  // ---------------------------------------------------------------------------
  // Generate mutation
  // ---------------------------------------------------------------------------
  const generateMutation = useMutation<GenerateResponse, Error, Record<string, unknown>>({
    mutationFn: (payload) =>
      hrmsApi.post<GenerateResponse>("/api/payroll/salary-certificates/generate", payload),
    onSuccess: (res) => {
      setCertData(res.data.certificate_data);
      toast({ title: "Certificate generated", description: `${templateLabel(res.data.template)} ready to print.` });
      void refetchHistory();
      void queryClient.invalidateQueries({ queryKey: ["cert-history"] });
    },
    onError: (err) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const handleGenerate = () => {
    const empId = isPayrollRole ? selectedEmp?.id : myEmpId;
    if (!empId) {
      toast({ title: "Select an employee", variant: "destructive" });
      return;
    }
    generateMutation.mutate({
      employee_id: empId,
      template,
      period_from: periodFrom || undefined,
      period_to: periodTo || undefined,
      addressee: addressee || undefined,
      purpose: purpose || undefined,
    });
  };

  const handlePrint = () => {
    window.print();
  };

  // ---------------------------------------------------------------------------
  // Loading / access guard
  // ---------------------------------------------------------------------------
  if (roleLoading) {
    return (
      <DashboardLayout>
        <div className="p-8 text-slate-500">Loading access…</div>
      </DashboardLayout>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <DashboardLayout>
      {/* Print-only styles */}
      <style>{`
        @media print {
          body > *:not(#cert-print-area) { display: none !important; }
          #cert-print-area { display: block !important; }
        }
      `}</style>

      <div className="p-6 space-y-6 print:hidden">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Award className="h-7 w-7 text-blue-700" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Salary Certificate Generator</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              Generate salary, employment, or CTC certificates for employees
            </p>
          </div>
        </div>

        <Tabs defaultValue="generate">
          <TabsList>
            <TabsTrigger value="generate">Generate Certificate</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          {/* ---------------------------------------------------------------- */}
          {/* Tab 1 — Generate                                                 */}
          {/* ---------------------------------------------------------------- */}
          <TabsContent value="generate" className="space-y-5 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Form Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="h-4 w-4 text-slate-500" />
                    Certificate Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Employee search — payroll roles only */}
                  {isPayrollRole && (
                    <div className="space-y-1">
                      <Label>Search Employee</Label>
                      <div className="relative" ref={dropdownRef}>
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                        <Input
                          className="pl-9"
                          placeholder="Search by name or employee code…"
                          value={empSearch}
                          onChange={(e) => {
                            setEmpSearch(e.target.value);
                            if (selectedEmp) { setSelectedEmp(null); setCertData(null); }
                          }}
                        />
                        {dropdownOpen && empResults.length > 0 && (
                          <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-md shadow-lg max-h-56 overflow-y-auto">
                            {empResults.map((emp) => (
                              <button
                                key={emp.id}
                                type="button"
                                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm"
                                onMouseDown={() => handleSelectEmployee(emp)}
                              >
                                <span className="font-medium">{emp.first_name} {emp.last_name}</span>
                                <span className="ml-2 text-slate-500 text-xs">{emp.employee_code}</span>
                                {emp.designation && <span className="ml-2 text-slate-400 text-xs">· {emp.designation}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Selected employee info */}
                      {selectedEmp && (
                        <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-2 text-sm text-blue-800 flex flex-wrap gap-x-4 gap-y-1 mt-1">
                          <span><span className="font-medium">Name:</span> {selectedEmp.first_name} {selectedEmp.last_name}</span>
                          <span><span className="font-medium">Code:</span> {selectedEmp.employee_code}</span>
                          {selectedEmp.designation && <span><span className="font-medium">Designation:</span> {selectedEmp.designation}</span>}
                          {selectedEmp.branch_name && <span><span className="font-medium">Branch:</span> {selectedEmp.branch_name}</span>}
                          {selectedEmp.date_of_joining && <span><span className="font-medium">DOJ:</span> {new Date(selectedEmp.date_of_joining).toLocaleDateString("en-IN")}</span>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Employee info for self-service */}
                  {!isPayrollRole && myEmpId && (
                    <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-2 text-sm text-blue-800">
                      Certificate will be generated for your own employee record.
                    </div>
                  )}

                  {/* Template */}
                  <div className="space-y-1">
                    <Label>Certificate Type</Label>
                    <Select
                      value={template}
                      onValueChange={(v) => {
                        setTemplate(v as "salary" | "employment" | "ctc");
                        setCertData(null);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select template" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="salary">Salary Certificate</SelectItem>
                        <SelectItem value="employment">Employment Certificate</SelectItem>
                        <SelectItem value="ctc">CTC Certificate</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Period — only for salary/ctc */}
                  {template !== "employment" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Period From</Label>
                        <Input
                          type="month"
                          value={periodFrom}
                          onChange={(e) => setPeriodFrom(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Period To</Label>
                        <Input
                          type="month"
                          value={periodTo}
                          onChange={(e) => setPeriodTo(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {/* Addressee */}
                  <div className="space-y-1">
                    <Label>Addressee</Label>
                    <Input
                      placeholder="To Whom It May Concern"
                      value={addressee}
                      onChange={(e) => setAddressee(e.target.value)}
                    />
                  </div>

                  {/* Purpose */}
                  <div className="space-y-1">
                    <Label>Purpose</Label>
                    <Input
                      placeholder="e.g. Bank Loan Application, Visa Application"
                      value={purpose}
                      onChange={(e) => setPurpose(e.target.value)}
                    />
                  </div>

                  <Button
                    className="w-full mt-2"
                    onClick={handleGenerate}
                    disabled={generateMutation.isPending || (!isPayrollRole && !myEmpId) || (isPayrollRole && !selectedEmp)}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    {generateMutation.isPending ? "Generating…" : "Generate Certificate"}
                  </Button>
                </CardContent>
              </Card>

              {/* Preview Card */}
              <div>
                {certData ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-slate-700">Preview</h3>
                      <Button variant="outline" size="sm" onClick={handlePrint}>
                        <Printer className="h-4 w-4 mr-1.5" />
                        Print
                      </Button>
                    </div>
                    <CertificatePreview data={certData} />
                  </div>
                ) : (
                  <Card className="h-full flex items-center justify-center min-h-64">
                    <CardContent className="text-center text-slate-400 pt-8">
                      <Award className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">Certificate preview will appear here after generation</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ---------------------------------------------------------------- */}
          {/* Tab 2 — History                                                  */}
          {/* ---------------------------------------------------------------- */}
          <TabsContent value="history" className="mt-4">
            {!historyEmpId ? (
              <div className="text-sm text-slate-400 py-8 text-center">
                {isPayrollRole ? "Select an employee first to view their certificate history." : "No employee record found."}
              </div>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Template</TableHead>
                      <TableHead>Period From</TableHead>
                      <TableHead>Period To</TableHead>
                      <TableHead>Addressee</TableHead>
                      <TableHead>Purpose</TableHead>
                      <TableHead>Generated At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyList.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-slate-400 py-8">
                          No certificate requests found.
                        </TableCell>
                      </TableRow>
                    )}
                    {historyList.map((rec) => (
                      <TableRow key={rec.id}>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {templateLabel(rec.template)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{rec.period_from ?? "—"}</TableCell>
                        <TableCell className="text-sm">{rec.period_to ?? "—"}</TableCell>
                        <TableCell className="text-sm">{rec.addressee ?? "—"}</TableCell>
                        <TableCell className="text-sm">{rec.purpose ?? "—"}</TableCell>
                        <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                          {formatDt(rec.generated_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Print-only: render cert outside dashboard chrome */}
      {certData && (
        <div className="hidden print:block p-8">
          <CertificatePreview data={certData} />
        </div>
      )}
    </DashboardLayout>
  );
}
