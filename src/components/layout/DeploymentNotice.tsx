import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiBaseUrl } from "@/lib/apiBase";

/** Fired by hrmsApi when a request gets a gateway error or no answer at all. */
export const SERVER_TROUBLE_EVENT = "hrms:server-trouble";

const POLL_MS = 5000;
const LONG_OUTAGE_MS = 10 * 60 * 1000;

type Phase = "hidden" | "updating" | "back";

/**
 * True when the backend itself answers /api/health. A JSON reply counts even if it says "degraded" (503):
 * the app is running. An HTML error page (nginx) or no answer at all means it is down.
 */
async function backendIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${apiBaseUrl()}/api/health`, { cache: "no-store" });
    return res.ok || (res.headers.get("content-type") ?? "").includes("application/json");
  } catch {
    return false;
  }
}

/**
 * Tells people a release is going out, so a failed screen is not read as a broken feature.
 * Idle until an API call fails with 502/503/504 or no answer; it then checks /api/health itself and
 * only shows the notice when the backend really is down, then polls until it is back.
 */
export function DeploymentNotice() {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [longOutage, setLongOutage] = useState(false);
  const probing = useRef(false);
  const dismissed = useRef(false);

  const watchUntilBack = useCallback(async () => {
    const startedAt = Date.now();
    while (!(await backendIsUp())) {
      if (Date.now() - startedAt > LONG_OUTAGE_MS) setLongOutage(true);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    setLongOutage(false);
    setPhase(dismissed.current ? "hidden" : "back");
    dismissed.current = false;
    probing.current = false;
  }, []);

  useEffect(() => {
    const onTrouble = async () => {
      if (probing.current) return;
      probing.current = true;
      if (await backendIsUp()) {
        probing.current = false; // one bad request, not an outage
        return;
      }
      setPhase("updating");
      void watchUntilBack();
    };
    window.addEventListener(SERVER_TROUBLE_EVENT, onTrouble);
    return () => window.removeEventListener(SERVER_TROUBLE_EVENT, onTrouble);
  }, [watchUntilBack]);

  if (phase === "hidden") return null;

  const close = () => {
    if (phase === "updating") dismissed.current = true;
    setPhase("hidden");
  };

  return (
    <div role="alertdialog" aria-live="polite" aria-labelledby="deploy-notice-title"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md space-y-4 rounded-xl border bg-card p-6 text-center shadow-xl">
        {phase === "updating" ? (
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
        ) : (
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
        )}
        <h2 id="deploy-notice-title" className="text-xl font-semibold text-foreground">
          {phase === "updating" ? "We're updating HRMS" : "Update complete"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {phase === "updating"
            ? longOutage
              ? "This is taking longer than usual. Your data is safe. Please try again in a few minutes, or contact support if it continues."
              : "A new version is being installed. Nothing is wrong with your account or your data. This takes about a minute, and this message closes when we're ready."
            : "HRMS is ready. Reload to pick up the latest version. Finish anything you're typing first."}
        </p>
        <div className="flex justify-center gap-2">
          {phase === "back" && (
            <Button onClick={() => window.location.reload()} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Reload now
            </Button>
          )}
          <Button variant="outline" onClick={close}>{phase === "updating" ? "Hide" : "Later"}</Button>
        </div>
      </div>
    </div>
  );
}
