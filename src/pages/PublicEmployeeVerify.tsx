import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2, ShieldCheck, Building2, Briefcase, Calendar } from "lucide-react";
import { normalizeMediaUrl } from "@/lib/mediaUrl";

interface VerifyData {
  employee_code: string;
  full_name: string;
  designation: string | null;
  branch_name: string | null;
  employment_status: string;
  employment_type: string | null;
  date_of_joining: string | null;
  avatar_url: string | null;
  verified_at: string;
}

interface PayslipVerifyData {
  employee_code: string;
  full_name: string;
  designation?: string | null;
  branch_name?: string | null;
  month: number;
  year: number;
  status?: string;
  net_pay?: number;
  net_salary?: number;
  payslip_ref?: string;
  generated_at?: string;
  verified_at?: string;
}

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const INR = (v: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v);

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function PublicEmployeeVerify() {
  const { employeeCode } = useParams<{ employeeCode: string }>();
  const [data, setData]   = useState<VerifyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!employeeCode) { setError("No employee code provided."); setLoading(false); return; }
    fetch(`/api/public/verify/emp/${encodeURIComponent(employeeCode)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setData(json.data);
        else setError(json.message ?? "Employee not found.");
      })
      .catch(() => setError("Unable to reach verification server."))
      .finally(() => setLoading(false));
  }, [employeeCode]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-6 text-center">
          <img src="/mcn-logo.png" alt="MAS Callnet" className="h-10 mx-auto mb-3" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Mas Callnet India Pvt. Ltd.</p>
          <p className="mt-1 text-xs text-slate-400">Employee ID Verification</p>
        </div>

        {loading && (
          <div className="rounded-3xl bg-white shadow-xl border border-slate-100 p-10 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto mb-4" />
            <p className="text-sm text-slate-500 font-medium">Verifying identity…</p>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-3xl bg-white shadow-xl border border-red-100 p-8 text-center">
            <XCircle className="h-14 w-14 text-red-400 mx-auto mb-4" />
            <h2 className="text-lg font-black text-slate-900 mb-2">Verification Failed</h2>
            <p className="text-sm text-red-600">{error}</p>
            <p className="mt-4 text-xs text-slate-400">If this is a valid ID card, contact HR.</p>
          </div>
        )}

        {!loading && data && (
          <div className="rounded-3xl bg-white shadow-xl border border-emerald-100 overflow-hidden">
            {/* Green verification banner */}
            <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-4 flex items-center gap-3">
              <ShieldCheck className="h-6 w-6 text-white shrink-0" />
              <div>
                <p className="text-sm font-black text-white">Identity Verified</p>
                <p className="text-xs text-emerald-100">
                  {new Date(data.verified_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            </div>

            {/* Employee info */}
            <div className="p-6 space-y-5">
              {/* Photo + name */}
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-2xl bg-slate-100 overflow-hidden shrink-0 border-2 border-slate-200">
                  {data.avatar_url ? (
                    <img src={normalizeMediaUrl(data.avatar_url)} alt={data.full_name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-slate-400 text-2xl font-black">
                      {data.full_name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900 leading-tight">{data.full_name}</h2>
                  <p className="text-sm font-mono font-bold text-blue-600 mt-0.5">{data.employee_code}</p>
                  <span className={`mt-1 inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    data.employment_status?.toLowerCase() === "active"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-700"
                  }`}>
                    {data.employment_status}
                  </span>
                </div>
              </div>

              {/* Detail rows */}
              <div className="space-y-3">
                {data.designation && (
                  <div className="flex items-center gap-3 text-sm">
                    <div className="h-8 w-8 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                      <Briefcase className="h-4 w-4 text-blue-500" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 font-medium">Designation</p>
                      <p className="font-semibold text-slate-800">{data.designation}</p>
                    </div>
                  </div>
                )}
                {data.branch_name && (
                  <div className="flex items-center gap-3 text-sm">
                    <div className="h-8 w-8 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
                      <Building2 className="h-4 w-4 text-violet-500" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 font-medium">Branch</p>
                      <p className="font-semibold text-slate-800">{data.branch_name}</p>
                    </div>
                  </div>
                )}
                {data.date_of_joining && (
                  <div className="flex items-center gap-3 text-sm">
                    <div className="h-8 w-8 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                      <Calendar className="h-4 w-4 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400 font-medium">Date of Joining</p>
                      <p className="font-semibold text-slate-800">{fmtDate(data.date_of_joining)}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <p className="text-xs text-slate-500">This ID card was issued by Mas Callnet India Pvt. Ltd. and is valid.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <p className="mt-4 text-center text-xs text-slate-400">
          Powered by MAS Callnet PeopleOS
        </p>
      </div>
    </div>
  );
}

export function PublicPayslipVerify() {
  const { employeeCode, monthYear } = useParams<{ employeeCode: string; monthYear: string }>();
  const [data, setData]   = useState<PayslipVerifyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!employeeCode || !monthYear) { setError("Invalid parameters."); setLoading(false); return; }
    fetch(`/api/payroll/verify/payslip/${encodeURIComponent(employeeCode)}/${encodeURIComponent(monthYear)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.verified) {
          // Map new flat response shape to the existing PayslipVerifyData shape
          setData({
            full_name: json.employee_name ?? "",
            employee_code: json.employee_code ?? "",
            month: Number((json.run_month ?? "").split("-")[1] ?? 0),
            year: Number((json.run_month ?? "").split("-")[0] ?? 0),
            net_salary: json.net_salary ?? 0,
            payslip_ref: json.payslip_ref ?? "",
            generated_at: json.generated_at ?? "",
          } as PayslipVerifyData);
        } else {
          setError(json.message ?? "Payslip not found.");
        }
      })
      .catch(() => setError("Unable to reach verification server."))
      .finally(() => setLoading(false));
  }, [employeeCode, monthYear]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/mcn-logo.png" alt="MAS Callnet" className="h-10 mx-auto mb-3" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Mas Callnet India Pvt. Ltd.</p>
          <p className="mt-1 text-xs text-slate-400">Payslip Verification</p>
        </div>

        {loading && (
          <div className="rounded-3xl bg-white shadow-xl border border-slate-100 p-10 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto mb-4" />
            <p className="text-sm text-slate-500 font-medium">Verifying payslip…</p>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-3xl bg-white shadow-xl border border-red-100 p-8 text-center">
            <XCircle className="h-14 w-14 text-red-400 mx-auto mb-4" />
            <h2 className="text-lg font-black text-slate-900 mb-2">Payslip Not Found</h2>
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {!loading && data && (
          <div className="rounded-3xl bg-white shadow-xl border border-emerald-100 overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-4 flex items-center gap-3">
              <ShieldCheck className="h-6 w-6 text-white shrink-0" />
              <div>
                <p className="text-sm font-black text-white">Payslip Verified</p>
                <p className="text-xs text-emerald-100">
                  {MONTH_NAMES[data.month]} {data.year}
                </p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-lg font-black text-slate-900">{data.full_name}</p>
                <p className="text-sm font-mono font-bold text-blue-600">{data.employee_code}</p>
                {data.designation && <p className="text-sm text-slate-500 mt-0.5">{data.designation}</p>}
                {data.branch_name && <p className="text-sm text-slate-400">{data.branch_name}</p>}
              </div>
              <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 flex justify-between items-center">
                <div>
                  <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Net Pay</p>
                  <p className="text-2xl font-black text-slate-900 mt-0.5">{INR(data.net_pay ?? data.net_salary ?? 0)}</p>
                </div>
                <span className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase ${
                  data.status === "acknowledged" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                }`}>{data.status}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                <p className="text-xs text-slate-500">This payslip is authentic and was issued by Mas Callnet India Pvt. Ltd.</p>
              </div>
            </div>
          </div>
        )}

        <p className="mt-4 text-center text-xs text-slate-400">Powered by MAS Callnet PeopleOS</p>
      </div>
    </div>
  );
}
