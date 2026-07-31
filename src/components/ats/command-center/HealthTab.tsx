import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Plug, RefreshCcw, Shield, Bell } from "lucide-react";
import { toast } from "sonner";

import { hrmsApi } from "@/lib/hrmsApi";
import {
  ChartCard,
  ChartSkeleton,
  EmptyState,
  StatTile,
  num,
  pct,
  ratio,
} from "@/components/analytics/analytics-kit";

interface HealthCheck {
  name?: string;
  type?: string;
  ok?: boolean;
  count?: number;
  detail?: string;
}

interface HealthTabProps {
  /** Optional hook so the parent can react when checks are (re)run. */
  onLoadHealth?: () => void;
}

/**
 * The four check categories, declared once.
 *
 * The previous implementation repeated a near-identical card block per category,
 * so a fix to one (an icon, a label, an empty state) silently missed the other
 * three. `countLabel` also differs per category — "issues" for integrity is not
 * the same statement as "breaches" for SLA.
 */
const CATEGORIES = [
  {
    key: "data_integrity",
    title: "Data Integrity",
    icon: Shield,
    okLabel: "OK",
    failLabel: "Fix needed",
    countLabel: (ok: boolean, n: number) => (ok ? `${num(n)} records verified` : `${num(n)} issues found`),
  },
  {
    key: "sla",
    title: "SLA Compliance",
    icon: Activity,
    okLabel: "Within target",
    failLabel: "Attention",
    countLabel: (ok: boolean, n: number) => (ok ? `${num(n)} compliant` : `${num(n)} breaches`),
  },
  {
    key: "notification",
    title: "Notifications",
    icon: Bell,
    okLabel: "Delivering",
    failLabel: "Review",
    countLabel: (ok: boolean, n: number) => (ok ? `${num(n)} delivered` : `${num(n)} pending or failed`),
  },
  {
    key: "integration",
    title: "Integrations",
    icon: Plug,
    okLabel: "Connected",
    failLabel: "Disconnected",
    countLabel: (_ok: boolean, n: number) => (n > 0 ? `${num(n)} endpoints` : ""),
  },
] as const;

export function HealthTab({ onLoadHealth }: HealthTabProps) {
  const [health, setHealth] = useState<{ ok?: boolean; checks?: HealthCheck[] } | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [error, setError] = useState("");

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: { ok?: boolean; checks?: HealthCheck[] } }>(
        `/api/ats-full-parity/health`
      );
      setHealth(res.data ?? null);
      onLoadHealth?.();

      if (res.data?.ok) toast.success("All health checks passed");
      else toast.warning("Some health checks need attention");
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message || "Health check failed";
      setError(message);
      setHealth(null);
      toast.error(message);
    } finally {
      setHealthLoading(false);
    }
  }, [onLoadHealth]);

  // Run on mount. The parent already activates this tab on demand, so requiring
  // a further button click just to see anything was an extra step for no gain.
  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  const model = useMemo(() => {
    const checks = health?.checks ?? [];
    const passed = checks.filter((c) => c.ok).length;
    const failed = checks.length - passed;
    return {
      checks,
      passed,
      failed,
      // ratio() returns null on a zero denominator rather than dividing. The old
      // expression computed passed/0 and rendered a literal "NaN%" whenever the
      // endpoint came back with an empty checks array.
      score: ratio(passed, checks.length),
      byCategory: CATEGORIES.map((category) => ({
        ...category,
        items: checks.filter((c) => c.type === category.key),
      })).filter((category) => category.items.length > 0),
      uncategorised: checks.filter((c) => !CATEGORIES.some((cat) => cat.key === c.type)),
    };
  }, [health]);

  const { checks, passed, failed, score, byCategory, uncategorised } = model;
  const allOk = health?.ok ?? (checks.length > 0 && failed === 0);

  return (
    <div className="space-y-4">
      {/* ── Status banner ───────────────────────────────────────────────── */}
      <header
        className={`flex flex-col gap-3 rounded-xl border-2 px-4 py-3.5 shadow-sm sm:flex-row sm:items-center sm:justify-between ${
          healthLoading || !health
            ? "border-slate-200 bg-white"
            : allOk
              ? "border-emerald-200 bg-emerald-50"
              : "border-rose-200 bg-rose-50"
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
              healthLoading || !health ? "bg-slate-100 text-slate-500" : allOk ? "bg-[#008300] text-white" : "bg-[#e34948] text-white"
            }`}
          >
            {healthLoading ? (
              <RefreshCcw className="h-5 w-5 animate-spin" />
            ) : !health ? (
              <Activity className="h-5 w-5" />
            ) : allOk ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <AlertTriangle className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0">
            {/* Status carries an icon and words, never colour alone. */}
            <h2 className="text-base font-bold text-slate-900">
              {healthLoading
                ? "Running health checks…"
                : !health
                  ? "System Health"
                  : allOk
                    ? "System healthy"
                    : `${num(failed)} check${failed === 1 ? "" : "s"} need attention`}
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              {health
                ? `${num(passed)} of ${num(checks.length)} checks passing across data integrity, SLA, notifications and integrations.`
                : "Data integrity, SLA compliance, notification delivery and integration connectivity."}
            </p>
          </div>
        </div>
        <button
          onClick={() => void loadHealth()}
          disabled={healthLoading}
          className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white transition-colors duration-150 hover:bg-slate-700 disabled:opacity-60"
        >
          <RefreshCcw className={`h-3.5 w-3.5 ${healthLoading ? "animate-spin" : ""}`} />
          {healthLoading ? "Running…" : "Re-run checks"}
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div className="text-xs text-rose-900">
              <p className="font-bold">Health check could not run</p>
              <p className="mt-1">{error}</p>
              <p className="mt-1 text-rose-700">
                A failed check run is not the same as a passing system — treat the status above as unknown.
              </p>
            </div>
          </div>
        </div>
      )}

      {healthLoading && !health && <ChartSkeleton height={220} />}

      {health && (
        <>
          {/* ── Scorecard ───────────────────────────────────────────────── */}
          <div className="grid gap-3 grid-cols-2 xl:grid-cols-4">
            <StatTile label="Total Checks" value={num(checks.length)} denominator="Run against the live system" />
            <StatTile
              label="Passed"
              value={num(passed)}
              denominator={score !== null ? `${pct(score)} of all checks` : "No checks returned"}
              intent="good"
            />
            <StatTile
              label="Failed"
              value={num(failed)}
              denominator={
                checks.length > 0 ? `${pct(ratio(failed, checks.length) ?? 0)} of all checks` : "No checks returned"
              }
              intent={failed > 0 ? "critical" : "neutral"}
            />
            <StatTile
              label="Health Score"
              // Explicitly "—" rather than NaN% when the endpoint returns no checks.
              value={score !== null ? pct(score, 0) : "—"}
              denominator={score !== null ? "Passing checks ÷ total checks" : "Nothing to score"}
              intent={score === null ? "neutral" : score === 100 ? "good" : score >= 80 ? "warning" : "critical"}
            />
          </div>

          {checks.length === 0 && (
            <ChartCard title="Check Results" subtitle="Nothing was returned by the health endpoint.">
              <EmptyState
                label="No checks returned"
                hint="The endpoint responded but reported zero checks — this is not the same as everything passing."
                height={140}
              />
            </ChartCard>
          )}

          {/* ── One block per category, rendered from a single definition ── */}
          {byCategory.map((category) => {
            const Icon = category.icon;
            const catFailed = category.items.filter((c) => !c.ok).length;
            return (
              <ChartCard
                key={category.key}
                title={category.title}
                subtitle={`${num(category.items.length - catFailed)} of ${num(category.items.length)} passing`}
                action={
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold ${
                      catFailed === 0 ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {catFailed === 0 ? "All clear" : `${num(catFailed)} failing`}
                  </span>
                }
              >
                <ul className="space-y-1.5">
                  {category.items.map((check, index) => (
                    <li
                      key={`${check.name ?? "check"}-${index}`}
                      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
                        check.ok ? "border-emerald-100 bg-emerald-50/50" : "border-rose-100 bg-rose-50/50"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        {check.ok ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#008300]" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 shrink-0 text-[#e34948]" />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-900">{check.name || "Unnamed check"}</p>
                          {Number(check.count ?? 0) > 0 && (
                            <p className={`mt-0.5 text-[11px] ${check.ok ? "text-slate-500" : "text-rose-700"}`}>
                              {category.countLabel(Boolean(check.ok), Number(check.count))}
                            </p>
                          )}
                          {check.detail && <p className="mt-0.5 truncate text-[11px] text-slate-500">{check.detail}</p>}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          check.ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        {check.ok ? category.okLabel : category.failLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              </ChartCard>
            );
          })}

          {/* Checks with an unrecognised type were previously dropped entirely. */}
          {uncategorised.length > 0 && (
            <ChartCard
              title="Other Checks"
              subtitle="Checks whose category is not one of the four known types — shown so none are silently dropped."
            >
              <ul className="space-y-1.5">
                {uncategorised.map((check, index) => (
                  <li
                    key={`${check.name ?? "other"}-${index}`}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
                      check.ok ? "border-emerald-100 bg-emerald-50/50" : "border-rose-100 bg-rose-50/50"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {check.ok ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-[#008300]" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-[#e34948]" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900">{check.name || "Unnamed check"}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">Type: {check.type || "unspecified"}</p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        check.ok ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                      }`}
                    >
                      {check.ok ? "OK" : "Review"}
                    </span>
                  </li>
                ))}
              </ul>
            </ChartCard>
          )}
        </>
      )}
    </div>
  );
}
