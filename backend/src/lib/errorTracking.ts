/**
 * Error tracking (GlitchTip, Sentry-protocol compatible).
 *
 * OFF unless a DSN is configured:
 *   API process      ERROR_TRACKING_DSN
 *   workers process  ERROR_TRACKING_WORKERS_DSN (falls back to ERROR_TRACKING_DSN)
 * With no DSN nothing is imported, nothing is patched and every function here is a no-op, so this
 * file is safe to ship before the GlitchTip server exists.
 *
 * Design choices, all to keep the blast radius small:
 *  - The SDK is imported lazily, only when a DSN is present.
 *  - defaultIntegrations: false and skipOpenTelemetrySetup: true. No http/express/mysql
 *    auto-instrumentation, no performance tracing. HRMS's own errorHandler decides what is an
 *    error; this module only records it.
 *  - Every event passes through scrubEvent() (lib/piiScrub.ts). The GlitchTip project also
 *    scrubs server-side, as a second layer.
 *  - Each 500 carries the same `reference` the user sees ("Please quote reference ab12cd34"),
 *    so a reference from a Helpdesk ticket finds the exact event in GlitchTip.
 */
import type { Request } from "express";
import { readBuildInfo } from "../shared/buildInfo.js";
import { scrubBreadcrumb, scrubEvent, type ScrubbableEvent } from "./piiScrub.js";

type SentryNode = typeof import("@sentry/node");
type Role = "api" | "workers";

let sentry: SentryNode | null = null;
let initPromise: Promise<boolean> | null = null;

export function errorTrackingDsn(role: Role, env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = role === "workers" ? env.ERROR_TRACKING_WORKERS_DSN || env.ERROR_TRACKING_DSN : env.ERROR_TRACKING_DSN;
  const dsn = (raw ?? "").trim();
  if (!dsn) return null;
  // Reject anything that is not an http(s) DSN with a key and a project id, rather than letting
  // the SDK fail later in a less obvious way.
  try {
    const u = new URL(dsn);
    if (!/^https?:$/.test(u.protocol) || !u.username || !/\/\d+$/.test(u.pathname)) return null;
  } catch {
    return null;
  }
  return dsn;
}

export function isErrorTrackingEnabled(): boolean {
  return sentry !== null;
}

/** Initialise once per process. Resolves true when error tracking is active. Never throws. */
export function initErrorTracking(role: Role): Promise<boolean> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const dsn = errorTrackingDsn(role);
    if (!dsn) return false;
    try {
      const S = (await import("@sentry/node")) as SentryNode;
      const build = readBuildInfo();
      S.init({
        dsn,
        release: build.commit && build.commit !== "unknown" ? build.commit : undefined,
        environment: process.env.ERROR_TRACKING_ENVIRONMENT || process.env.NODE_ENV || "development",
        // The host name of a server is not needed and can identify infrastructure.
        serverName: `hrms-${role}`,
        sendDefaultPii: false,
        defaultIntegrations: false,
        skipOpenTelemetrySetup: true,
        integrations: [
          S.onUncaughtExceptionIntegration(),
          S.onUnhandledRejectionIntegration({ mode: "warn" }),
          S.linkedErrorsIntegration(),
          S.dedupeIntegration(),
        ],
        maxBreadcrumbs: 30,
        sampleRate: Number(process.env.ERROR_TRACKING_SAMPLE_RATE ?? 1),
        beforeSend: (event) => scrubEvent(event as unknown as ScrubbableEvent) as unknown as typeof event,
        beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb as Record<string, unknown>) as typeof crumb,
      });
      S.setTag("process", role);
      sentry = S;
      console.log(`[error-tracking] enabled for ${role} (release ${build.commit ?? "unknown"})`);
      return true;
    } catch (e) {
      console.warn("[error-tracking] could not start; continuing without it:", e instanceof Error ? e.message : e);
      return false;
    }
  })();
  return initPromise;
}

function routeOf(req: Request): string {
  // The route TEMPLATE ("/api/employees/:id"), never the concrete URL, so events group by
  // endpoint and no id or name from the path reaches the report.
  const tpl = (req.route as { path?: string } | undefined)?.path;
  const base = req.baseUrl || "";
  if (tpl) return `${base}${typeof tpl === "string" ? tpl : ""}` || "/";
  return `${base}${(req.path || "").replace(/\/[0-9a-fA-F-]{8,}|\/\d+/g, "/:id")}`;
}

type CaptureOptions = { reference?: string; level?: "error" | "warning"; code?: string | null; status?: number };

/**
 * Record a server-side error from the Express error handler. No-op when disabled.
 *
 * Context is passed per event (captureContext), never set on a shared scope: with
 * auto-instrumentation off there is no async context isolation, so scope.setTag() inside
 * withScope() leaked one request's reference/route onto the next error. Verified end-to-end.
 */
export function captureServerError(error: unknown, req: Request | undefined, opts: CaptureOptions = {}): string | undefined {
  const S = sentry;
  if (!S) return undefined;
  try {
    const tags: Record<string, string> = {};
    if (opts.reference) tags.reference = opts.reference;
    if (opts.code) tags.error_code = opts.code;
    if (opts.status) tags.http_status = String(opts.status);
    let user: { id: string } | undefined;
    const contexts: Record<string, Record<string, unknown>> = {};
    if (req) {
      const route = routeOf(req);
      tags.route = `${req.method} ${route}`;
      contexts.request_info = { method: req.method, route };
      const authUser = (req as Request & { authUser?: { id?: string; role?: string } }).authUser;
      if (authUser?.id) user = { id: String(authUser.id) };
      if (authUser?.role) tags.role = authUser.role;
    }
    // Expected outages (a 5xx the code chose, a DB reconnect) group by their code, not by the
    // stack, so one outage is one issue rather than hundreds.
    const fingerprint = opts.level === "warning" && opts.code ? ["expected-5xx", opts.code] : undefined;
    return S.captureException(error, {
      level: opts.level ?? "error",
      tags,
      user,
      contexts,
      fingerprint,
    });
  } catch {
    return undefined;
  }
}

/** For workers and crons: record an error with a little context. No-op when disabled. */
export function captureJobError(error: unknown, job: string, extra?: Record<string, unknown>): void {
  const S = sentry;
  if (!S) return;
  try {
    S.captureException(error, { tags: { job }, contexts: extra ? { job: extra } : undefined });
  } catch {
    /* never let reporting break a job */
  }
}

/** Wait (bounded) for queued events to be sent, e.g. before the process exits. */
export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
  const S = sentry;
  if (!S) return;
  try {
    await S.flush(timeoutMs);
  } catch {
    /* ignore */
  }
}
