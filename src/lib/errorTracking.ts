/**
 * Browser error tracking (GlitchTip, Sentry-protocol compatible).
 *
 * OFF unless the build sets VITE_ERROR_TRACKING_DSN. When off, the SDK is never downloaded: it is
 * a separate chunk, loaded by a dynamic import only after a DSN is found.
 *
 * Reports go to the HRMS backend at /api/error-tunnel (same origin), which checks, re-scrubs and
 * relays them. GlitchTip itself stays on the private network.
 *
 * What is collected: the error, its stack, the page route, the last few clicks/navigations/API
 * calls (URLs without query values), the browser, the release, and the user's internal id and
 * role. What is never collected: request or response bodies, form values, console output,
 * cookies, tokens, names, emails, phone numbers, PAN, Aadhaar, bank or salary data (see
 * lib/piiScrub.ts, applied to every event and breadcrumb).
 */
import { apiUrl } from "@/lib/apiBase";
import { scrubBreadcrumb, scrubEvent, scrubUrl, type ScrubbableEvent } from "@/lib/piiScrub";

type SentryReact = typeof import("@sentry/react");

let sentry: SentryReact | null = null;
let initPromise: Promise<boolean> | null = null;
const pending: Array<(s: SentryReact) => void> = [];

export function frontendDsn(env: Record<string, unknown> = import.meta.env): string | null {
  const raw = String(env.VITE_ERROR_TRACKING_DSN ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol) || !u.username || !/\/\d+$/.test(u.pathname)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Errors that are noise, already handled, or caused by the user's browser rather than HRMS. */
export const IGNORED_ERRORS: Array<string | RegExp> = [
  "ResizeObserver loop limit exceeded",
  "ResizeObserver loop completed with undelivered notifications",
  // Stale chunk after a deploy: main.tsx and ErrorBoundary already reload the page once.
  // ErrorBoundary reports it only if the reload did not fix it.
  /Failed to fetch dynamically imported module/,
  /Importing a module script failed/,
  /error loading dynamically imported module/,
  // Browser extensions and translation plug-ins.
  /^Script error\.?$/,
  /chrome-extension:\/\//,
  /moz-extension:\/\//,
];

export function isErrorTrackingEnabled(): boolean {
  return sentry !== null;
}

export function initErrorTracking(): Promise<boolean> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const dsn = frontendDsn();
    if (!dsn) return false;
    try {
      const S = (await import("@sentry/react")) as SentryReact;
      S.init({
        dsn,
        tunnel: apiUrl("/api/error-tunnel"),
        release: (import.meta.env.VITE_APP_RELEASE as string | undefined) || undefined,
        environment: (import.meta.env.VITE_ERROR_TRACKING_ENVIRONMENT as string | undefined) || import.meta.env.MODE,
        sendDefaultPii: false,
        defaultIntegrations: false,
        integrations: [
          S.globalHandlersIntegration(),
          S.browserApiErrorsIntegration(),
          S.linkedErrorsIntegration(),
          S.dedupeIntegration(),
          S.httpContextIntegration(),
          // No console breadcrumbs: console lines often carry API payloads.
          S.breadcrumbsIntegration({ console: false, dom: true, fetch: true, xhr: true, history: true, sentry: false }),
        ],
        ignoreErrors: IGNORED_ERRORS,
        denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-extension:\/\//],
        maxBreadcrumbs: 30,
        sampleRate: Number(import.meta.env.VITE_ERROR_TRACKING_SAMPLE_RATE ?? 1),
        beforeSend: (event) => {
          // The tunnel's own failures must not report themselves in a loop.
          const crumbs = event.breadcrumbs?.filter((b) => !String(b.data?.url ?? "").includes("/api/error-tunnel"));
          if (crumbs) event.breadcrumbs = crumbs;
          return scrubEvent(event as unknown as ScrubbableEvent) as unknown as typeof event;
        },
        beforeBreadcrumb: (crumb) => {
          if (String(crumb.data?.url ?? "").includes("/api/error-tunnel")) return null;
          return scrubBreadcrumb(crumb as Record<string, unknown>) as typeof crumb;
        },
      });
      sentry = S;
      while (pending.length) pending.shift()!(S);
      return true;
    } catch (e) {
      console.warn("[error-tracking] could not start; continuing without it:", e);
      return false;
    }
  })();
  return initPromise;
}

/** Run now if the SDK is ready; queue (bounded) if it is still loading; drop if disabled. */
function withSentry(fn: (s: SentryReact) => void): void {
  if (sentry) {
    try { fn(sentry); } catch { /* reporting must never break the page */ }
    return;
  }
  if (initPromise && pending.length < 20) pending.push((s) => { try { fn(s); } catch { /* ignore */ } });
}

/** Identify the signed-in user by internal id and role only. Pass null on sign-out. */
export function setErrorTrackingUser(user: { id: string; role?: string | null } | null): void {
  withSentry((S) => {
    if (!user) {
      S.setUser(null);
      S.setTag("role", undefined);
      return;
    }
    S.setUser({ id: user.id });
    if (user.role) S.setTag("role", user.role);
  });
}

/**
 * Report an error caught by a React error boundary. Returns the event id (shown to the user as a
 * reference) or undefined when error tracking is off.
 */
export function captureBoundaryError(error: unknown, componentStack?: string | null, extraTags?: Record<string, string>): string | undefined {
  if (!sentry) return undefined;
  try {
    return sentry.withScope((scope) => {
      scope.setTag("boundary", "app");
      scope.setTag("route", scrubUrl(window.location.pathname));
      for (const [k, v] of Object.entries(extraTags ?? {})) scope.setTag(k, v);
      if (componentStack) scope.setContext("react", { componentStack: componentStack.slice(0, 4000) });
      return sentry!.captureException(error);
    });
  } catch {
    return undefined;
  }
}

/** Replace ids in an API path so calls to the same endpoint group together. */
export function apiPathTemplate(path: string): string {
  const bare = path.split("?")[0].split("#")[0];
  return bare
    .split("/")
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) || /^[A-Z]{2,5}\d{3,}[A-Z]?$/.test(seg) || seg.length > 40 ? ":id" : seg))
    .join("/");
}

/**
 * Record an API refusal (403) or server failure (5xx) seen by the browser, grouped by endpoint,
 * method, status and role. These are the silent failures users hit without telling anyone:
 * a page that opens for a role whose API then refuses it, or a button whose call fails.
 * 5xx events carry the backend's `reference`, which matches the backend's own event.
 */
export function captureApiFailure(method: string, path: string, status: number, reference?: string | null): void {
  if (!sentry || !(status === 403 || status >= 500)) return;
  if (path.includes("/api/error-tunnel")) return;
  const tpl = apiPathTemplate(path);
  withSentry((S) => {
    S.withScope((scope) => {
      scope.setLevel(status === 403 ? "warning" : "error");
      scope.setTag("api_status", String(status));
      scope.setTag("api_route", `${method.toUpperCase()} ${tpl}`);
      if (reference) scope.setTag("reference", reference);
      scope.setFingerprint(["api-failure", method.toUpperCase(), tpl, String(status)]);
      S.captureMessage(status === 403 ? `API refused (403): ${method.toUpperCase()} ${tpl}` : `API failed (${status}): ${method.toUpperCase()} ${tpl}`);
    });
  });
}

export async function flushErrorTracking(timeoutMs = 2000): Promise<void> {
  if (!sentry) return;
  try { await sentry.flush(timeoutMs); } catch { /* ignore */ }
}
