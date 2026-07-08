import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

function fmt(n: number) {
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

const PF_PCT = 0.12;
const ESI_PCT = 0.0325;
const PT_FLAT = 200;

export function StatutorySummaryTable({ runMonth }: { runMonth?: string }) {
  const { data: ceoData } = useQuery<any>({
    queryKey: ["ceo-metrics-stat"],
    queryFn: () => hrmsApi.get("/api/management/ceo-metrics"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: runsData } = useQuery<any>({
    queryKey: ["payroll-runs"],
    queryFn: () => hrmsApi.get("/api/payroll/runs"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: compData, isLoading } = useQuery<any>({
    queryKey: ["payroll-compliance-stat"],
    queryFn: () => hrmsApi.get("/api/payroll/compliance"),
    staleTime: 1000 * 60 * 5,
  });

  const gross = ceoData?.data?.payroll_liability?.total_gross ?? 0;
  const month = ceoData?.data?.payroll_liability?.run_month ?? runMonth ?? "Latest";
  const runs: any[] = Array.isArray(runsData?.data) ? runsData.data : [];
  const latestRun = runs[0] ?? {};
  const compliance: any[] = Array.isArray(compData?.data) ? compData.data : [];
  const missingPan = compliance.filter((e) => !e.pan_verified).length;

  const items = [
    {
      label: "Provident Fund (PF)",
      amount: gross * PF_PCT,
      status: "Paid",
      statusColor: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "Employees' State Insurance (ESI)",
      amount: gross * ESI_PCT,
      status: "Paid",
      statusColor: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "Professional Tax (PT)",
      amount: PT_FLAT * (latestRun.total_employees ?? 0),
      status: "Paid",
      statusColor: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "TDS (Tax Deducted at Source)",
      amount: gross * 0.1,
      status: missingPan > 0 ? "Partially Paid" : "Paid",
      statusColor:
        missingPan > 0
          ? "bg-amber-100 text-amber-700"
          : "bg-emerald-100 text-emerald-700",
    },
  ];

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
        <CardTitle className="text-sm font-bold text-slate-900">
          Statutory Summary{" "}
          <span className="text-[#1B6AB5] font-normal">({month})</span>
        </CardTitle>
        <Link
          to="/statutory-compliance"
          className="text-xs font-semibold text-[#1B6AB5] hover:underline"
        >
          View Statutory Details →
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        ) : (
          items.map((row, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-5 py-3.5 border-b border-slate-50 last:border-0 hover:bg-slate-50"
            >
              <span className="text-sm text-slate-700">{row.label}</span>
              <div className="flex items-center gap-4">
                <span
                  className="text-sm font-bold text-slate-900"
                  style={{ fontFamily: "'Fira Code', monospace" }}
                >
                  {fmt(row.amount)}
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${row.statusColor}`}
                >
                  {row.status}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
