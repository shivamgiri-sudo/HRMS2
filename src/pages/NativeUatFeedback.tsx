/**
 * UAT feedback submission.
 *
 * Two things here are deliberate and load-bearing:
 *
 * 1. THE SCAN VERDICT COMES BACK INLINE. The backend runs its deterministic risk scan
 *    synchronously, so a payroll or auth request is explained on THIS screen rather than
 *    disappearing into a queue and being rejected days later. A control users can see is a
 *    control they work with; one that silently swallows their report is one they route around.
 *
 * 2. THE OUT-OF-SCOPE STRIP IS SHOWN BEFORE SUBMISSION, not after a rejection. Setting the
 *    expectation up front is the difference between "that's fair" and "this thing is broken".
 *
 * Build and environment context is captured silently — reproducibility should not depend on
 * a reporter remembering to mention their browser.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Info, Loader, Send, ShieldAlert,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

type Kind = "bug" | "correction" | "feature" | "question";
type Severity = "low" | "medium" | "high" | "blocker";

interface CapabilityHit {
  key: string;
  name: string;
  class: string;
  signal: string;
  matched: string;
}

interface SubmitResult {
  id: string;
  feedbackCode: string;
  status: string;
  blocked: boolean;
  blockedReason: string | null;
  risk: {
    effectiveRisk: string;
    pathTier: string;
    capabilityClass: string;
    capabilities: CapabilityHit[];
    requiredApproverRoles: string[];
  } | null;
  /** Set when the user joined an existing report instead of filing a new one. */
  meTooCount?: number;
}

interface SimilarItem {
  id: string;
  feedbackCode: string;
  title: string;
  status: string;
  affectedUserCount: number;
  score: number;
  samePage: boolean;
}

const KINDS: Array<{ value: Kind; label: string; hint: string }> = [
  { value: "bug", label: "Something is broken", hint: "It errors, crashes or does nothing" },
  { value: "correction", label: "Something is wrong", hint: "It works, but the result is incorrect" },
  { value: "feature", label: "Something is missing", hint: "A capability that does not exist yet" },
  { value: "question", label: "I have a question", hint: "Not sure whether this is a defect" },
];

const SEVERITIES: Array<{ value: Severity; label: string; hint: string }> = [
  { value: "blocker", label: "Blocker", hint: "Cannot continue UAT at all" },
  { value: "high", label: "High", hint: "A core task cannot be completed" },
  { value: "medium", label: "Medium", hint: "Workable, but wrong or awkward" },
  { value: "low", label: "Low", hint: "Cosmetic or minor" },
];

/** Mirrors the deny-tier domains in uat/capability-registry.json, in plain language. */
const OUT_OF_SCOPE = [
  "Payroll calculations, payslips, PF/ESIC/TDS and full-and-final",
  "Attendance classification and biometric punch rules",
  "Login, roles and permissions",
  "Payments, disbursal and finance",
  "Database changes and scheduled jobs",
];

export default function NativeUatFeedback() {
  const [kind, setKind] = useState<Kind>("bug");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [steps, setSteps] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  /**
   * Captured, not asked for. The route recorded is the page the reporter came FROM, which is
   * the one they are reporting about — this form's own route would be useless.
   */
  const context = useMemo(() => {
    let fromRoute: string | null = null;
    try {
      const ref = document.referrer;
      if (ref) fromRoute = new URL(ref).pathname;
    } catch {
      /* a missing or opaque referrer is not worth failing over */
    }
    const env = (import.meta as { env?: Record<string, string> }).env ?? {};
    return {
      pageRoute: fromRoute,
      appVersion: env.VITE_APP_VERSION ?? null,
      frontendSha: env.VITE_COMMIT_SHA ?? null,
      environment: env.MODE ?? null,
      browser: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : null,
      device:
        typeof window !== "undefined" ? `${window.screen?.width}x${window.screen?.height}` : null,
      correlationId:
        typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null,
      occurredAt: new Date().toISOString(),
    };
  }, []);

  const [pageRoute, setPageRoute] = useState<string>(context.pageRoute ?? "");
  useEffect(() => {
    if (context.pageRoute) setPageRoute(context.pageRoute);
  }, [context.pageRoute]);

  /**
   * Look for existing reports of the same thing while the reporter is still typing the title.
   * Shown BEFORE submission on purpose: telling somebody afterwards that their report was a
   * duplicate wastes the effort they already spent writing it.
   */
  const [similar, setSimilar] = useState<SimilarItem[]>([]);
  const [meTooFor, setMeTooFor] = useState<string | null>(null);
  useEffect(() => {
    const t = title.trim();
    if (t.length < 6) {
      setSimilar([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ title: t });
        if (pageRoute) params.set("pageRoute", pageRoute);
        const res = await hrmsApi.get<{ data: SimilarItem[] }>(
          `/api/uat/feedback/similar?${params.toString()}`
        );
        if (!cancelled) setSimilar(res.data ?? []);
      } catch {
        // A failed similarity lookup must never block someone reporting a defect.
        if (!cancelled) setSimilar([]);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [title, pageRoute]);

  async function meToo(item: SimilarItem) {
    setMeTooFor(item.id);
    try {
      const res = await hrmsApi.post<{ data: { affectedUserCount: number } }>(
        `/api/uat/feedback/${item.id}/me-too`,
        {}
      );
      setResult({
        id: item.id,
        feedbackCode: item.feedbackCode,
        status: item.status,
        blocked: false,
        blockedReason: null,
        risk: null,
        meTooCount: res.data?.affectedUserCount ?? item.affectedUserCount + 1,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record that.");
    } finally {
      setMeTooFor(null);
    }
  }

  const charsLeft = 4000 - body.length;
  const canSubmit = title.trim().length > 3 && body.trim().length > 10 && !submitting;

  /**
   * The screenshot is uploaded AFTER the item exists, because it attaches to an id. Chosen
   * here and held in memory so the reporter picks it once, in the natural place, rather than
   * being sent to a second screen after submitting.
   */
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);

  const MAX_UPLOAD = 5 * 1024 * 1024;
  const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

  function pickScreenshot(file: File | null) {
    setUploadWarning(null);
    if (!file) {
      setScreenshot(null);
      return;
    }
    if (!ACCEPTED.includes(file.type)) {
      setUploadWarning("Screenshots only, please — PNG, JPEG, WebP or GIF.");
      return;
    }
    if (file.size > MAX_UPLOAD) {
      setUploadWarning(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`);
      return;
    }
    setScreenshot(file);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await hrmsApi.post<{ data: SubmitResult }>("/api/uat/feedback", {
        kind,
        severity,
        title: title.trim(),
        body: body.trim(),
        expectedBehaviour: expected.trim() || null,
        actualBehaviour: actual.trim() || null,
        stepsToReproduce: steps.trim() || null,
        ...context,
        // After the spread on purpose: the field is editable, so the user's correction must
        // win over the auto-captured referrer rather than being silently overwritten by it.
        pageRoute: pageRoute || context.pageRoute,
      });

      // Upload after the item exists. A failed upload must NOT lose the report the person
      // just wrote — they are told the screenshot did not attach and the feedback still stands.
      if (screenshot && res.data?.id) {
        try {
          const form = new FormData();
          form.append("file", screenshot);
          await hrmsApi.postForm(`/api/uat/feedback/${res.data.id}/attachments`, form);
        } catch {
          setUploadWarning(
            "Your report was saved, but the screenshot could not be attached. You can add it " +
              "from the item afterwards."
          );
        }
      }

      setResult(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit your feedback.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setResult(null);
    setTitle("");
    setBody("");
    setExpected("");
    setActual("");
    setSteps("");
  }

  // ── Result ────────────────────────────────────────────────────────────────
  if (result) {
    const blocked = result.blocked;
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-3xl p-6">
          <div
            className={`rounded-lg border p-6 ${
              blocked ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"
            }`}
          >
            <div className="flex items-start gap-3">
              {blocked ? (
                <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
              )}
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-slate-900">
                  {result.meTooCount
                    ? "Added to an existing report"
                    : blocked
                      ? "Recorded — this one needs a person"
                      : "Thank you, this is recorded"}
                </h2>
                <p className="mt-1 text-sm text-slate-700">
                  Reference <span className="font-mono font-semibold">{result.feedbackCode}</span>
                </p>
                {result.meTooCount ? (
                  <p className="mt-3 text-sm text-slate-700">
                    {result.meTooCount} people have now reported this. You did not need to write
                    it out again — that count is what moves it up the queue.
                  </p>
                ) : null}

                {blocked && result.blockedReason && (
                  <div className="mt-4 rounded border border-amber-200 bg-white p-3 text-sm text-slate-800">
                    <p className="font-medium text-amber-900">Why it will not be automated</p>
                    <p className="mt-1">{result.blockedReason}</p>
                    <p className="mt-2 text-slate-600">
                      This does not mean it will be ignored. It means an engineer will handle it
                      directly rather than any automated change being generated for it.
                    </p>
                  </div>
                )}

                {!blocked && (
                  <p className="mt-3 text-sm text-slate-700">
                    It has been triaged automatically and is now in the queue. You will be asked
                    to retest once a fix is deployed.
                  </p>
                )}

                {result.risk && result.risk.capabilities.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Areas this appears to touch
                    </p>
                    <ul className="mt-2 space-y-1">
                      {result.risk.capabilities.map((c) => (
                        <li key={`${c.key}-${c.signal}`} className="text-sm text-slate-700">
                          <span className="font-medium">{c.name}</span>
                          <span className="text-slate-500">
                            {" "}
                            — matched on {c.signal} &ldquo;{c.matched}&rdquo;
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={reset}
            className="mt-4 rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Report something else
          </button>
        </div>
      </DashboardLayout>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-semibold text-slate-900">Report UAT feedback</h1>
        <p className="mt-1 text-sm text-slate-600">
          Tell us what you saw. The page you came from and your browser details are captured
          automatically, so you do not need to describe them.
        </p>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <div className="text-sm text-slate-700">
              <p className="font-medium text-slate-900">What happens next</p>
              <p className="mt-1">
                Your report is checked automatically against the areas of the system that are
                too sensitive to change without an engineer. Reports touching these are still
                acted on — they are just routed straight to a person:
              </p>
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-slate-600">
                {OUT_OF_SCOPE.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-800">What kind of issue?</label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKind(k.value)}
                  className={`rounded border p-3 text-left text-sm ${
                    kind === k.value
                      ? "border-slate-800 bg-slate-800 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="block font-medium">{k.label}</span>
                  <span className={`block text-xs ${kind === k.value ? "text-slate-300" : "text-slate-500"}`}>
                    {k.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-800">How badly does it block you?</label>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              {SEVERITIES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSeverity(s.value)}
                  title={s.hint}
                  className={`rounded border px-3 py-2 text-sm ${
                    severity === s.value
                      ? "border-slate-800 bg-slate-800 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="uat-title" className="block text-sm font-medium text-slate-800">
              One-line summary
            </label>
            <input
              id="uat-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              placeholder="Leave balance shows the wrong carry forward"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />

            {similar.length > 0 && (
              <div className="mt-3 rounded border border-sky-200 bg-sky-50 p-3">
                <p className="text-sm font-medium text-sky-900">
                  Someone may have reported this already
                </p>
                <p className="mt-0.5 text-xs text-sky-800">
                  Joining an existing report tells us how many people are affected, which moves
                  it up the queue faster than a separate report would.
                </p>
                <ul className="mt-2 space-y-1.5">
                  {similar.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-3 rounded border border-sky-200 bg-white p-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-800">{s.title}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          <span className="font-mono">{s.feedbackCode}</span> · {s.status}
                          {s.affectedUserCount > 1 && ` · ${s.affectedUserCount} people affected`}
                          {s.samePage && " · same page"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void meToo(s)}
                        disabled={meTooFor === s.id}
                        className="shrink-0 rounded border border-sky-600 bg-white px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                      >
                        {meTooFor === s.id ? "…" : "This is mine too"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="uat-body" className="block text-sm font-medium text-slate-800">
              What happened?
            </label>
            <textarea
              id="uat-body"
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, 4000))}
              rows={5}
              placeholder="Describe what you were doing and what went wrong."
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
            <p className={`mt-1 text-xs ${charsLeft < 200 ? "text-amber-600" : "text-slate-500"}`}>
              {charsLeft} characters remaining
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="uat-expected" className="block text-sm font-medium text-slate-800">
                What did you expect? <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <textarea
                id="uat-expected"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="uat-actual" className="block text-sm font-medium text-slate-800">
                What happened instead? <span className="font-normal text-slate-500">(optional)</span>
              </label>
              <textarea
                id="uat-actual"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="uat-steps" className="block text-sm font-medium text-slate-800">
              Steps to reproduce <span className="font-normal text-slate-500">(optional, but it speeds up the fix)</span>
            </label>
            <textarea
              id="uat-steps"
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              rows={3}
              placeholder={"1. Open the roster page\n2. Click publish\n3. Nothing happens"}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="uat-route" className="block text-sm font-medium text-slate-800">
              Which page? <span className="font-normal text-slate-500">(captured automatically — correct it if wrong)</span>
            </label>
            <input
              id="uat-route"
              value={pageRoute}
              onChange={(e) => setPageRoute(e.target.value)}
              placeholder="/leave/balance"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="uat-shot" className="block text-sm font-medium text-slate-800">
              Screenshot <span className="font-normal text-slate-500">(optional, 5 MB max)</span>
            </label>
            <input
              id="uat-shot"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => pickScreenshot(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
            {screenshot && (
              <p className="mt-1 text-xs text-slate-600">
                {screenshot.name} ({(screenshot.size / 1024).toFixed(0)} KB)
              </p>
            )}
            <p className="mt-1 text-xs text-slate-500">
              Screenshots are stored encrypted and are only visible to you and the triage team.
              They are never sent to any external service.
            </p>
            {uploadWarning && (
              <p className="mt-1 text-xs text-amber-700">{uploadWarning}</p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={submit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {submitting ? <Loader className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? "Checking…" : "Submit feedback"}
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
