import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { hrmsApi } from "@/lib/hrmsApi";
import { CheckCircle2, XCircle, Loader, ShieldCheck } from "lucide-react";

interface VerifyResult {
  verified: boolean;
  employee_name?: string;
  employee_code?: string;
  run_month?: string;
  net_salary?: number;
  gross_salary?: number;
  payslip_ref?: string;
  generated_at?: string;
  message?: string;
}

const formatINR = (amount: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);

const formatMonth = (runMonth: string) => {
  const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const [year, month] = runMonth.split("-");
  return `${MONTHS[Number(month)] ?? runMonth} ${year}`;
};

export default function VerifyPayslip() {
  const { empCode, monthYear } = useParams<{ empCode: string; monthYear: string }>();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!empCode || !monthYear) {
      setResult({ verified: false, message: "Invalid verification link." });
      setLoading(false);
      return;
    }
    hrmsApi
      .get<VerifyResult>(`/api/payroll/verify/payslip/${encodeURIComponent(empCode)}/${encodeURIComponent(monthYear)}`)
      .then((data) => setResult(data as unknown as VerifyResult))
      .catch(() => setResult({ verified: false, message: "Verification service unavailable. Please try again." }))
      .finally(() => setLoading(false));
  }, [empCode, monthYear]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#073f78] to-[#0a4d90] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-center mb-8 gap-3">
          <img src="/mcn-logo.png" alt="MAS Callnet" className="h-12" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <div className="text-white">
            <p className="text-xs font-semibold tracking-widest uppercase opacity-80">MAS Callnet India Pvt. Ltd.</p>
            <p className="text-sm font-bold">Payslip Verification</p>
          </div>
        </div>

        <div className="rounded-3xl bg-white shadow-2xl overflow-hidden">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 px-6">
              <Loader className="h-10 w-10 animate-spin text-[#073f78] mb-4" />
              <p className="text-sm font-semibold text-slate-600">Verifying payslip…</p>
            </div>
          ) : result?.verified ? (
            <>
              <div className="bg-emerald-600 px-6 py-5 text-white text-center">
                <CheckCircle2 className="mx-auto mb-2 h-10 w-10" />
                <h1 className="text-xl font-black">Payslip Verified</h1>
                <p className="text-emerald-100 text-sm mt-1">This is an authentic salary statement</p>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Employee</p>
                    <p className="mt-1 font-black text-slate-900">{result.employee_name}</p>
                    <p className="font-mono text-xs text-slate-500">{result.employee_code}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Pay Period</p>
                    <p className="mt-1 font-black text-slate-900">{result.run_month ? formatMonth(result.run_month) : "—"}</p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-3">
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Net Salary</p>
                    <p className="mt-1 font-black text-emerald-900">{result.net_salary ? formatINR(result.net_salary) : "—"}</p>
                  </div>
                  <div className="rounded-2xl bg-blue-50 p-3">
                    <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Gross Salary</p>
                    <p className="mt-1 font-black text-blue-900">{result.gross_salary ? formatINR(result.gross_salary) : "—"}</p>
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 text-xs text-slate-500 space-y-1">
                  <p><span className="font-semibold">Reference:</span> {result.payslip_ref}</p>
                  {result.generated_at && (
                    <p><span className="font-semibold">Generated:</span> {new Date(result.generated_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                  <span>Verified against MAS Callnet HR Management System</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="bg-red-600 px-6 py-5 text-white text-center">
                <XCircle className="mx-auto mb-2 h-10 w-10" />
                <h1 className="text-xl font-black">Verification Failed</h1>
                <p className="text-red-100 text-sm mt-1">Could not authenticate this payslip</p>
              </div>
              <div className="p-6">
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  {result?.message ?? "No payslip found for this employee and period. The QR code may be outdated or invalid."}
                </div>
                <p className="mt-4 text-xs text-slate-500 text-center">
                  If you believe this is an error, please contact HR at <strong>hr@mascallnet.com</strong>
                </p>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-blue-200 text-xs mt-6 opacity-70">
          © MAS Callnet India Pvt. Ltd. — Payroll Management System
        </p>
      </div>
    </div>
  );
}
