import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Loader, RefreshCcw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type LmsPortal = "trainee" | "coordinator" | "admin";

interface LaunchContext {
  portal: LmsPortal;
  portal_url: string;
  embed_url: string;
  lms_token: string | null;
  lms_user_type: string | null;
  bridge_error: string | null;
}

const PORTAL_COPY: Record<LmsPortal, { title: string; eyebrow: string }> = {
  trainee: { title: "My Learning", eyebrow: "MCN LMS" },
  coordinator: { title: "LMS Coordinator", eyebrow: "MCN LMS" },
  admin: { title: "LMS Admin", eyebrow: "MCN LMS" },
};

export function LmsPortalFrame({ portal }: { portal: LmsPortal }) {
  const [context, setContext] = useState<LaunchContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const copy = PORTAL_COPY[portal];

  const loadContext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: LaunchContext }>(
        `/api/lms/launch-context?portal=${portal}`,
      );
      setContext(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open LMS");
    } finally {
      setLoading(false);
    }
  }, [portal]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const iframeUrl = useMemo(() => context?.embed_url || context?.portal_url || "", [context?.embed_url, context?.portal_url]);

  return (
    <DashboardLayout>
      <div className="flex min-h-[calc(100vh-120px)] flex-col overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b bg-slate-950 px-5 py-4 text-white lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[.22em] text-cyan-300">{copy.eyebrow}</p>
            <h1 className="mt-1 text-xl font-black">{copy.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {context?.bridge_error && (
              <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-300/15 px-3 py-1.5 text-xs font-bold text-amber-100">
                <AlertTriangle className="h-3.5 w-3.5" />
                LMS sign-in needed
              </span>
            )}
            <button
              onClick={() => void loadContext()}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-xs font-bold text-white hover:bg-white/10"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Refresh
            </button>
            {context?.portal_url && (
              <a
                href={context.embed_url || context.portal_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-950 hover:bg-slate-100"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </a>
            )}
          </div>
        </div>

        {loading && (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            <Loader className="mr-2 h-5 w-5 animate-spin" />
            Opening LMS...
          </div>
        )}

        {!loading && error && (
          <div className="m-5 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-800">
            {error}
          </div>
        )}

        {!loading && !error && iframeUrl && (
          <iframe
            key={iframeUrl}
            title={copy.title}
            src={iframeUrl}
            className="min-h-[720px] flex-1 border-0 bg-white"
            allow="clipboard-read; clipboard-write; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
    </DashboardLayout>
  );
}
