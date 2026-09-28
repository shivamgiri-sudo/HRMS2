import { useState } from "react";
import { ExternalLink, Loader2, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

export default function LMSModuleLaunch() {
  const [status, setStatus] = useState<"idle" | "loading" | "launched" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lmsUserType, setLmsUserType] = useState<string | null>(null);

  const handleLaunch = async () => {
    setStatus("loading");
    setError(null);
    try {
      const res = await hrmsApi.get<{
        success: boolean;
        lmsToken: string;
        lmsUserType: string;
        launchUrl: string;
        message?: string;
      }>("/api/lms/sso-session");

      if (!res.success || !res.lmsToken || !res.launchUrl) {
        throw new Error(res.message ?? "SSO session failed");
      }

      setLmsUserType(res.lmsUserType ?? null);

      // Build URL and open immediately — token never stored in state
      const url = new URL(res.launchUrl);
      url.searchParams.set("hrms_lms_token", res.lmsToken);
      if (res.lmsUserType) url.searchParams.set("lms_user_type", res.lmsUserType);
      window.open(url.toString(), "_blank", "noopener,noreferrer");

      setStatus("launched");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "LMS session unavailable");
      setStatus("error");
    }
  };

  return (
    <DashboardLayout>
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6 px-4">
        {/* Header card */}
        <div className="w-full max-w-md rounded-3xl bg-slate-950 p-8 text-center text-white shadow-lg">
          <p className="text-xs font-black uppercase tracking-[.22em] text-blue-300">MCN LMS</p>
          <h1 className="mt-3 text-3xl font-black">Learning Management System</h1>
          <p className="mt-2 text-sm text-slate-300">
            Launch the MCN LMS with your HRMS credentials
          </p>
        </div>

        {/* State card */}
        <div className="w-full max-w-md rounded-3xl border bg-white p-8 shadow-sm">
          {status === "idle" && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-blue-100 p-4">
                <ExternalLink className="h-8 w-8 text-blue-600" />
              </div>
              <div>
                <p className="font-bold text-slate-950">Ready to launch</p>
                <p className="mt-1 text-sm text-slate-500">A one-time secure session will be generated when you click Launch</p>
              </div>
              <button
                onClick={() => void handleLaunch()}
                className="flex items-center gap-2 rounded-2xl bg-slate-950 px-8 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                Launch LMS
              </button>
            </div>
          )}

          {status === "loading" && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-blue-100 p-4">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
              <div>
                <p className="font-bold text-slate-950">Authenticating…</p>
                <p className="mt-1 text-sm text-slate-500">Generating secure one-time session</p>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-red-100 p-4">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <p className="font-bold text-slate-950">Could not start LMS session</p>
                <p className="mt-1 text-sm text-slate-500">{error}</p>
              </div>
              <button
                onClick={() => { setStatus("idle"); setError(null); }}
                className="flex items-center gap-2 rounded-2xl bg-slate-950 px-6 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Try Again
              </button>
            </div>
          )}

          {status === "launched" && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-emerald-100 p-4">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <div>
                <p className="font-bold text-slate-950">LMS opened in a new tab</p>
                <p className="mt-1 text-sm text-slate-500">
                  Signed in as{" "}
                  <span className="font-semibold capitalize">{lmsUserType ?? "learner"}</span>
                </p>
              </div>
              <button
                onClick={() => void handleLaunch()}
                className="flex items-center gap-2 rounded-2xl border border-slate-200 px-6 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                Open Again
              </button>
            </div>
          )}
        </div>

        {/* Info note */}
        <p className="max-w-md text-center text-xs text-slate-400">
          Your session is secured via HRMS SSO. A fresh one-time code is generated on each launch.
          No password needed in the LMS.
        </p>
      </div>
    </DashboardLayout>
  );
}
