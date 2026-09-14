import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FileCheck2,
  FileX2,
  Loader2,
  Search,
  ShieldCheck,
  Upload,
  User,
} from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Payroll-side administration of TRACES Part A.
 *
 * Part A of a salary TDS certificate — tax deposited, challan and BSR codes,
 * TRACES verification — is issued by TRACES from the quarterly return. It cannot
 * be generated here, so this screen ingests it.
 *
 * Filing and verifying are two separate, deliberate acts, and the layout says so
 * rather than presenting a single "upload" button. An employee cannot tell a
 * misfiled certificate from their own: they would simply see another person's
 * PAN, salary and deposited tax presented as theirs. So a second, recorded
 * confirmation stands between a document arriving and an employee seeing it, and
 * until that happens the file is unreachable — not merely unadvertised.
 */

interface EmployeeSearchResult {
  id: string;
  employee_code: string;
  first_name: string;
  last_name?: string | null;
}

interface PartAStatus {
  financialYear: number;
  expectedFormNumber: string;
  present: boolean;
  verified: boolean;
  certificateNumber: string | null;
  coversQuarters: string | null;
  status: "verified" | "awaiting_verification" | "not_uploaded";
  message: string;
}

/** FY starting year for today — Jan–Mar belong to the FY that began last April. */
function currentFinancialYearStart(): number {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

const fyLabel = (start: number) => `FY ${start}–${String(start + 1).slice(2)}`;

export default function TdsCertificatePartA() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const thisFy = currentFinancialYearStart();
  // A certificate exists only after the year it covers has ended, so the
  // previous FY is the one payroll is normally filing.
  const [financialYear, setFinancialYear] = useState(thisFy - 1);

  const [empSearch, setEmpSearch] = useState("");
  const [selectedEmp, setSelectedEmp] = useState<EmployeeSearchResult | null>(null);
  const [empResults, setEmpResults] = useState<EmployeeSearchResult[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [certificateNumber, setCertificateNumber] = useState("");
  const [coversQuarters, setCoversQuarters] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Employee search ────────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!empSearch.trim() || selectedEmp) {
      setEmpResults([]);
      setDropdownOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await hrmsApi.get<
          { employees?: EmployeeSearchResult[]; data?: EmployeeSearchResult[] } | EmployeeSearchResult[]
        >(`/api/employees?search=${encodeURIComponent(empSearch.trim())}&limit=10`);
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
  }, [empSearch, selectedEmp]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectEmployee = useCallback((emp: EmployeeSearchResult) => {
    setSelectedEmp(emp);
    setEmpSearch(`${emp.first_name} ${emp.last_name ?? ""} (${emp.employee_code})`.replace(/\s+/g, " ").trim());
    setDropdownOpen(false);
    setEmpResults([]);
  }, []);

  const clearEmployee = useCallback(() => {
    setSelectedEmp(null);
    setEmpSearch("");
    setFile(null);
    setCertificateNumber("");
    setCoversQuarters("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── Status ─────────────────────────────────────────────────────────────────
  const statusKey = ["tds-part-a-admin", selectedEmp?.id, financialYear];
  const { data: status, isLoading: statusLoading } = useQuery<PartAStatus | null>({
    queryKey: statusKey,
    enabled: !!selectedEmp,
    queryFn: async () => {
      const res = await hrmsApi.get<{ success: boolean; data: PartAStatus }>(
        `/api/payroll/tds-certificate/part-a/${selectedEmp!.id}/${financialYear}`,
      );
      return res.data ?? null;
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tds-part-a-admin"] });

  // ── Upload ─────────────────────────────────────────────────────────────────
  const uploadMutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("file", file!);
      if (certificateNumber.trim()) form.append("certificate_number", certificateNumber.trim());
      if (coversQuarters.trim()) form.append("covers_quarters", coversQuarters.trim());
      return hrmsApi.postForm<{ success: boolean; message?: string }>(
        `/api/payroll/tds-certificate/part-a/${selectedEmp!.id}/${financialYear}`,
        form,
      );
    },
    onSuccess: (res) => {
      toast({
        title: "Part A filed",
        description: res.message ?? "It must be verified before the employee can see it.",
      });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      void refresh();
    },
    onError: (err: Error) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  // ── Verify ─────────────────────────────────────────────────────────────────
  const verifyMutation = useMutation({
    mutationFn: () =>
      hrmsApi.post<{ success: boolean }>(
        `/api/payroll/tds-certificate/part-a/${selectedEmp!.id}/${financialYear}/verify`,
      ),
    onSuccess: () => {
      toast({ title: "Verified", description: "The employee can now see and download this certificate." });
      void refresh();
    },
    onError: (err: Error) => toast({ title: "Verification failed", description: err.message, variant: "destructive" }),
  });

  // ── Download ───────────────────────────────────────────────────────────────
  const downloadMutation = useMutation({
    mutationFn: () =>
      hrmsApi.post<{ success: boolean; data: { download_url: string } }>(
        `/api/payroll/tds-certificate/part-a/${selectedEmp!.id}/${financialYear}/download-token`,
      ),
    onSuccess: (res) => {
      const url = res.data?.download_url;
      if (!url) {
        toast({ title: "No link issued", description: "The server did not return a download link.", variant: "destructive" });
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (err: Error) => toast({ title: "Could not open", description: err.message, variant: "destructive" }),
  });

  const years = [thisFy, thisFy - 1, thisFy - 2, thisFy - 3];
  const formName = status ? `Form ${status.expectedFormNumber}` : "Form 16 / 130";
  const busy = uploadMutation.isPending || verifyMutation.isPending;

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
        <header>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <ShieldCheck className="size-6 text-slate-700" />
            TDS Certificate — Part A
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Part A is issued by TRACES from the quarterly return and cannot be generated here. File the
            TRACES PDF against an employee and year, then verify it — only a verified certificate reaches
            the employee.
          </p>
        </header>

        {/* Employee + year */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Employee &amp; financial year</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[1fr_200px]">
              <div className="relative" ref={dropdownRef}>
                <Label htmlFor="emp-search">Employee</Label>
                <div className="relative mt-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="emp-search"
                    className="pl-9"
                    placeholder="Search by name or employee code"
                    value={empSearch}
                    onChange={(e) => {
                      setEmpSearch(e.target.value);
                      if (selectedEmp) setSelectedEmp(null);
                    }}
                    autoComplete="off"
                  />
                </div>
                {dropdownOpen && empResults.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
                    {empResults.map((emp) => (
                      <li key={emp.id}>
                        <button
                          type="button"
                          onClick={() => selectEmployee(emp)}
                          className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
                        >
                          <User className="size-4 shrink-0 text-slate-400" />
                          <span className="truncate">
                            {emp.first_name} {emp.last_name ?? ""}
                            <span className="ml-1 text-slate-500">({emp.employee_code})</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <Label htmlFor="fy">Financial year</Label>
                <select
                  id="fy"
                  className="mt-1 h-10 w-full cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm transition-colors duration-150 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  value={financialYear}
                  onChange={(e) => setFinancialYear(Number(e.target.value))}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>{fyLabel(y)}</option>
                  ))}
                </select>
              </div>
            </div>

            {selectedEmp && (
              <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                <span className="text-sm text-slate-700">
                  <strong>{selectedEmp.first_name} {selectedEmp.last_name ?? ""}</strong>{" "}
                  <span className="text-slate-500">({selectedEmp.employee_code})</span> · {fyLabel(financialYear)}
                </span>
                <Button variant="ghost" size="sm" onClick={clearEmployee} className="cursor-pointer">Change</Button>
              </div>
            )}
          </CardContent>
        </Card>

        {!selectedEmp ? (
          <p className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
            Search for an employee to file or verify their Part A.
          </p>
        ) : statusLoading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Checking current status…
          </p>
        ) : (
          <>
            {/* Chain of custody.
                Numbered because this genuinely is a sequence and the order
                carries information the operator needs: nothing can be verified
                before it is filed, and nothing reaches the employee before it is
                verified. The gate between 2 and 3 is the whole point of the
                screen, so it is drawn rather than described. */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Chain of custody</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="grid gap-3 sm:grid-cols-3">
                  {([
                    {
                      n: 1,
                      label: "Filed",
                      done: !!status?.present,
                      detail: status?.present ? "TRACES PDF on record" : "No document yet",
                    },
                    {
                      n: 2,
                      label: "Verified",
                      done: !!status?.verified,
                      detail: status?.verified
                        ? "Confirmed against this employee"
                        : status?.present
                          ? "Waiting on payroll"
                          : "Blocked until filed",
                    },
                    {
                      n: 3,
                      label: "Visible to employee",
                      done: !!status?.verified,
                      detail: status?.verified
                        ? "Downloadable from their payslip"
                        : "Withheld — file is unreachable",
                    },
                  ] as const).map((step) => (
                    <li
                      key={step.n}
                      className={`rounded-lg border p-3 transition-colors duration-200 ${
                        step.done ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                            step.done ? "bg-emerald-600 text-white" : "bg-slate-300 text-slate-700"
                          }`}
                          aria-hidden="true"
                        >
                          {step.done ? "✓" : step.n}
                        </span>
                        <span className={`text-sm font-semibold ${step.done ? "text-emerald-900" : "text-slate-700"}`}>
                          {step.label}
                        </span>
                      </div>
                      <p className={`mt-1 text-xs ${step.done ? "text-emerald-800" : "text-slate-500"}`}>
                        {step.detail}
                      </p>
                    </li>
                  ))}
                </ol>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 text-sm">
                  <div className="text-slate-600">
                    <span className="text-slate-500">Expected form:</span> <strong>{formName}</strong>
                    {status?.certificateNumber && <> · Certificate no. {status.certificateNumber}</>}
                    {status?.coversQuarters && <> · Covers {status.coversQuarters}</>}
                  </div>
                  {status?.status === "verified" && (
                    <Button
                      variant="outline"
                      onClick={() => downloadMutation.mutate()}
                      disabled={downloadMutation.isPending}
                      className="cursor-pointer"
                    >
                      {downloadMutation.isPending
                        ? <Loader2 className="mr-2 size-4 animate-spin" />
                        : <Download className="mr-2 size-4" />}
                      Download Part A
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Step 2 — verify. Placed before upload when something is waiting,
                because that is the action the certificate is blocked on. */}
            {status?.status === "awaiting_verification" && (
              <Card className="border-amber-300">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="size-5 text-amber-600" />
                    Verify this certificate
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <p>
                      Open the document and confirm the PAN, name and financial year are
                      <strong> this employee&apos;s</strong>. A misfiled certificate is undetectable to them —
                      they would see someone else&apos;s deposited tax as their own. Verification is recorded
                      against your account.
                    </p>
                  </div>
                  <Button
                    onClick={() => verifyMutation.mutate()}
                    disabled={busy}
                    className="cursor-pointer bg-emerald-600 hover:bg-emerald-700"
                  >
                    {verifyMutation.isPending
                      ? <Loader2 className="mr-2 size-4 animate-spin" />
                      : <CheckCircle2 className="mr-2 size-4" />}
                    Confirm this is the right document
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Step 1 — file the PDF */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Upload className="size-5 text-slate-600" />
                  {status?.present ? "Replace the filed certificate" : "File the TRACES PDF"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {status?.present && (
                  <div className="flex items-start gap-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-slate-500" />
                    <p>
                      A certificate is already on file for {fyLabel(financialYear)}. Uploading replaces it and
                      <strong> clears its verification</strong> — a new document has not been checked just
                      because its predecessor was.
                    </p>
                  </div>
                )}

                <div>
                  <Label htmlFor="file">TRACES PDF</Label>
                  <Input
                    id="file"
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="mt-1 cursor-pointer"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    PDF only, up to 15&nbsp;MB. An image of a screen cannot be checked against the digital
                    signature that makes the certificate verifiable.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="certno">Certificate number <span className="text-slate-400">(optional)</span></Label>
                    <Input
                      id="certno"
                      className="mt-1"
                      placeholder="As printed on the document"
                      value={certificateNumber}
                      onChange={(e) => setCertificateNumber(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="quarters">Quarters covered <span className="text-slate-400">(optional)</span></Label>
                    <Input
                      id="quarters"
                      className="mt-1"
                      placeholder="e.g. Q1-Q4"
                      value={coversQuarters}
                      onChange={(e) => setCoversQuarters(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      A part-year issue is legitimate but must be distinguishable from a complete one.
                    </p>
                  </div>
                </div>

                <Button
                  onClick={() => uploadMutation.mutate()}
                  disabled={!file || busy}
                  className="cursor-pointer"
                >
                  {uploadMutation.isPending
                    ? <Loader2 className="mr-2 size-4 animate-spin" />
                    : <FileCheck2 className="mr-2 size-4" />}
                  {status?.present ? "Replace certificate" : "File certificate"}
                </Button>
                {!file && (
                  <p className="text-xs text-slate-500">Choose a PDF to enable filing.</p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
