import { useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useLMSSession } from "@/hooks/useLMSSession";

export default function LMSModuleLaunch() {
  const { lmsToken, lmsUserType, storageKey, launchUrl, isLoading, error, refresh } = useLMSSession();
  const [launched, setLaunched] = useState(false);
  const launchAttempted = useRef(false);

  useEffect(() => {
    if (isLoading || launched || launchAttempted.current) return;
    if (!lmsToken || !launchUrl) return;

    launchAttempted.current = true;

    const timer = setTimeout(() => {
      const url = new URL(launchUrl);
      url.searchParams.set("hrms_lms_token", lmsToken);
      if (lmsUserType) url.searchParams.set("lms_user_type", lmsUserType);

      window.open(url.toString(), "_blank", "noopener,noreferrer");
      setLaunched(true);
    }, 800);

    return () => clearTimeout(timer);
  }, [lmsToken, lmsUserType, launchUrl, isLoading, launched]);

  function handleManualLaunch() {
    if (!lmsToken || !launchUrl) return;
    const url = new URL(launchUrl);
    url.searchParams.set("hrms_lms_token", lmsToken);
    if (lmsUserType) url.searchParams.set("lms_user_type", lmsUserType);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }

  return (
    <DashboardLayout>
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6 px-4">
        {/* Header card */}
        <div className="w-full max-w-md rounded-3xl bg-slate-950 p-8 text-center text-white shadow-lg">
          <p className="text-xs font-black uppercase tracking-[.22em] text-blue-300">MCN LMS</p>
          <h1 className="mt-3 text-3xl font-black">Launching LMS</h1>
          <p className="mt-2 text-sm text-slate-300">
            Opening the MCN Learning Management System with your HRMS credentials
          </p>
        </div>

        {/* State card */}
        <div className="w-full max-w-md rounded-3xl border bg-white p-8 shadow-sm">
          {isLoading && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-blue-100 p-4">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
              <div>
                <p className="font-bold text-slate-950">Authenticating…</p>
                <p className="mt-1 text-sm text-slate-500">Generating secure LMS session token</p>
              </div>
            </div>
          )}

          {error && !isLoading && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-red-100 p-4">
                <AlertCircle className="h-8 w-8 text-red-600" />
              </div>
              <div>
                <p className="font-bold text-slate-950">Could not start LMS session</p>
                <p className="mt-1 text-sm text-slate-500">{error}</p>
              </div>
              <button
                onClick={() => { launchAttempted.current = false; refresh(); }}
                className="flex items-center gap-2 rounded-2xl bg-slate-950 px-6 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            </div>
          )}

          {!isLoading && !error && !launched && lmsToken && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-blue-100 p-4">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
              <div>
                <p className="font-bold text-slate-950">Opening LMS…</p>
                <p className="mt-1 text-sm text-slate-500">The LMS will open in a new tab shortly</p>
              </div>
            </div>
          )}

          {launched && !error && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-emerald-100 p-4">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <div>
                <p className="font-bold text-slate-950">LMS opened in a new tab</p>
                <p className="mt-1 text-sm text-slate-500">
                  Signed in as{" "}
                  <span className="font-semibold capitalize">
                    {lmsUserType ?? "learner"}
                  </span>
                </p>
              </div>
              <button
                onClick={handleManualLaunch}
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
          Your session is secured via HRMS SSO. No password needed in the LMS.
          If the tab was blocked by your browser, use the button above.
        </p>
      </div>
    </DashboardLayout>
  );
}
