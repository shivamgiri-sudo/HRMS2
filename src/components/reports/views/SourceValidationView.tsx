import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Database,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { HrmsModernShell } from "@/components/ui/hrms-modern";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";
import { currentBusinessMonth } from "@/lib/report-catalog";

interface ValidationRow {
  reportCode: string;
  reportName: string;
  sourceState: "available" | "unavailable" | "failed";
  validationStatus: "PASS" | "WARNING" | "FAIL";
  sourceTable: string | null;
  sourceRowCount: number;
  distinctGrainCount: number;
  duplicateGrainCount: number;
  coveragePercentage: number;
  exactMappedFieldCount: number;
  derivedMappedFieldCount: number;
  unavailableFieldCount: number;
  runtimeSchemaVerified: boolean;
  sourceAccuracyStatus: string;
  uatStatus: "PENDING";
  error: string | null;
}

interface ValidationResponse {
  generatedAt: string;
  filters: Record<string, unknown>;
  summary: {
    totalReports: number;
    passed: number;
    warnings: number;
    failed: number;
    sourceAvailable: number;
    duplicateGrainReports: number;
    runtimeQueryFailures: number;
    allRuntimeChecksPassed: boolean;
    valueAccuracyCertified: boolean;
    certificationReason: string;
  };
  results: ValidationRow[];
  mandatoryNextStep: string;
}

// Shared business-timezone helper. The local copy used a UTC substring of toISOString(),
// which in IST resolves to the PREVIOUS month between 00:00 and 05:29 — so validation run
// early in the morning silently reported on the wrong month.
const currentMonth = currentBusinessMonth;

function number(value: number) {
  return new Intl.NumberFormat("en-IN").format(value ?? 0);
}

function statusBadge(status: ValidationRow["validationStatus"]) {
  if (status === "PASS") return <Badge className="gap-1 bg-emerald-600"><CheckCircle2 className="h-3 w-3" /> PASS</Badge>;
  if (status === "WARNING") return <Badge className="gap-1 bg-amber-500"><AlertTriangle className="h-3 w-3" /> WARNING</Badge>;
  return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> FAIL</Badge>;
}

function summaryCard(
  title: string,
  value: number,
  icon: React.ReactNode,
  detail: string,
) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-semibold">{number(value)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className="rounded-xl border bg-muted/40 p-3">{icon}</div>
      </CardContent>
    </Card>
  );
}

export default function BpoReportSourceValidation() {
  const [month, setMonth] = useState(currentMonth());
  const [search, setSearch] = useState("");

  const validationQuery = useQuery({
    queryKey: ["bpo-report-source-validation", month],
    queryFn: async () => {
      // 5 minutes, not hrmsApi's 30s default.
      //
      // This endpoint runs validateAllBpoMasterReports, which executes EVERY BPO master
      // report in sequence and introspects each one's schema. Against live mas_hrms that
      // takes minutes, so on the 30s default the request was aborted every time and, with
      // retry disabled, the tab only ever rendered its error state — the validation itself
      // was fine and nobody could see it. The Library and Decision Center already pass an
      // explicit 120s for single reports; this one runs the whole suite, so it needs more.
      const response = await hrmsApi.get<{ success: boolean; data: ValidationResponse }>(
        `/api/reports/bpo-master/validation/source-accuracy?month=${encodeURIComponent(month)}`,
        300_000,
      );
      return response.data;
    },
    staleTime: 30_000,
    retry: false,
  });

  const filteredRows = useMemo(() => {
    const rows = validationQuery.data?.results ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) =>
      row.reportName.toLowerCase().includes(query)
      || row.reportCode.toLowerCase().includes(query)
      || String(row.sourceTable ?? "").toLowerCase().includes(query)
      || row.validationStatus.toLowerCase().includes(query),
    );
  }, [search, validationQuery.data]);

  const summary = validationQuery.data?.summary;

  return (
    <HrmsModernShell
      eyebrow="REPORTS"
      title="Source Validation"
      description="Schema coverage, data accuracy and source availability checks for all BPO master reports."
      icon={<ShieldCheck className="h-5 w-5" />}
    >
      <div className="space-y-4">
        <main className="space-y-4">
          {validationQuery.isLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
            </div>
          ) : validationQuery.isError ? (
            <Card className="border-destructive/30">
              <CardContent className="p-6">
                <div className="flex items-start gap-3">
                  <XCircle className="mt-0.5 h-5 w-5 text-destructive" />
                  <div>
                    <p className="font-semibold">Source validation could not run</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {validationQuery.error instanceof Error ? validationQuery.error.message : "The validation endpoint returned an error."}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : summary ? (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {summaryCard("Reports", summary.totalReports, <Database className="h-5 w-5" />, `${summary.sourceAvailable} source paths available`)}
                {summaryCard("Passed", summary.passed, <CheckCircle2 className="h-5 w-5 text-emerald-600" />, "No runtime or duplicate-grain failure")}
                {summaryCard("Warnings", summary.warnings, <AlertTriangle className="h-5 w-5 text-amber-600" />, "No data or incomplete field coverage")}
                {summaryCard("Failed", summary.failed, <XCircle className="h-5 w-5 text-destructive" />, `${summary.runtimeQueryFailures} runtime query failures`)}
              </div>

              <Card className={summary.valueAccuracyCertified ? "border-emerald-300" : "border-amber-300 bg-amber-50/40"}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className={`mt-0.5 h-5 w-5 ${summary.valueAccuracyCertified ? "text-emerald-600" : "text-amber-600"}`} />
                    <div>
                      <p className="font-semibold">
                        {summary.valueAccuracyCertified ? "Value accuracy certified" : "Value accuracy certification pending"}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{summary.certificationReason}</p>
                      {validationQuery.data?.mandatoryNextStep && (
                        <p className="mt-2 text-sm font-medium">{validationQuery.data.mandatoryNextStep}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="border-b pb-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <CardTitle className="text-base">Master Report Validation Matrix</CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Generated {validationQuery.data ? new Date(validationQuery.data.generatedAt).toLocaleString("en-IN") : "-"}
                      </p>
                    </div>
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search report, source or status"
                      className="md:w-80"
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1500px] text-sm">
                      <thead className="sticky top-0 bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                        <tr>
                          <th className="px-3 py-3">STATUS</th>
                          <th className="px-3 py-3">REPORT</th>
                          <th className="px-3 py-3">SOURCE</th>
                          <th className="px-3 py-3 text-right">SOURCE ROWS</th>
                          <th className="px-3 py-3 text-right">DISTINCT GRAIN</th>
                          <th className="px-3 py-3 text-right">DUPLICATES</th>
                          <th className="px-3 py-3">COVERAGE</th>
                          <th className="px-3 py-3 text-right">EXACT</th>
                          <th className="px-3 py-3 text-right">DERIVED</th>
                          <th className="px-3 py-3 text-right">UNAVAILABLE</th>
                          <th className="px-3 py-3">SOURCE ACCURACY</th>
                          <th className="px-3 py-3">UAT</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y bg-background">
                        {filteredRows.map((row) => (
                          <tr key={row.reportCode} className="align-top hover:bg-slate-50">
                            <td className="px-3 py-3">{statusBadge(row.validationStatus)}</td>
                            <td className="px-3 py-3">
                              <Link to={`/reports?report=${encodeURIComponent(row.reportCode)}`} className="font-medium hover:underline">
                                {row.reportName}
                              </Link>
                              <p className="mt-1 font-mono text-[11px] text-muted-foreground">{row.reportCode}</p>
                              {row.error && <p className="mt-2 max-w-md text-xs text-destructive">{row.error}</p>}
                            </td>
                            <td className="max-w-sm whitespace-normal break-words px-3 py-3 font-mono text-xs">{row.sourceTable ?? "NO VERIFIED SOURCE"}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{number(row.sourceRowCount)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{number(row.distinctGrainCount)}</td>
                            <td className={`px-3 py-3 text-right tabular-nums ${row.duplicateGrainCount > 0 ? "font-semibold text-destructive" : ""}`}>{number(row.duplicateGrainCount)}</td>
                            <td className="min-w-44 px-3 py-3">
                              <div className="flex items-center gap-2">
                                <Progress value={row.coveragePercentage} className="h-2" />
                                <span className="w-12 text-right text-xs tabular-nums">{row.coveragePercentage.toFixed(1)}%</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">{number(row.exactMappedFieldCount)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{number(row.derivedMappedFieldCount)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{number(row.unavailableFieldCount)}</td>
                            <td className="max-w-xs whitespace-normal px-3 py-3 text-xs">{row.sourceAccuracyStatus}</td>
                            <td className="px-3 py-3"><Badge variant="outline">{row.uatStatus}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredRows.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No reports match the search.</p>}
                </CardContent>
              </Card>
            </>
          ) : null}
        </main>
      </div>
    </HrmsModernShell>
  );
}
