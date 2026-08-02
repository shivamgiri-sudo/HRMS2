import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, CircleSlash, Database, Loader2, PauseCircle,
  Settings2, ShieldAlert, Sparkles, ChevronDown, ChevronRight,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";

/**
 * Why is the quality pipeline quiet?
 *
 * There are eight different answers and they used to look identical. dialer_1
 * failed 1,047 consecutive times over 36 days while the dashboards showed
 * nothing; the weekly coaching evaluation looked at 73 quality rows across 41
 * agents and raised nothing, because not one of them had a target. Both read as
 * a calm screen.
 *
 * So this page never aggregates. Each state gets its own card, its own count and
 * its own drill-down, and the two that matter most are the ones that are easiest
 * to confuse:
 *
 *   "Nothing triggered"  — data arrived, people met their targets. Good news.
 *   "Nothing to trigger" — no target is configured, so nobody CAN be coached.
 *
 * A single "0 coaching sessions" tile cannot tell those apart, which is exactly
 * how the second went unnoticed.
 */

type Health = {
  generatedAt: string;
  successfulRuns: Array<{ integration_key: string; runs: number; latest: string; promoted: number }>;
  failedRuns: Array<{ integration_key: string; runs: number; latest: string }>;
  disabledSchedules: Array<{ integrationKey: string; cron: string; lastRunAt: string | null }>;
  missingConfiguration: {
    processesWithoutQualityTarget: Array<{ processId: string; processName: string; employeesWithQuality: number }>;
    employeesAffected: number;
  };
  dataStreams: Array<{ stream: string; rows_: number; latest_date: string | null; last_write: string | null }>;
  dataReceivedNoTrigger: boolean;
  triggersRaised: { total: number; byStatus: Array<{ status: string; n: number; latest: string }> };
  openMappingExceptions: Array<{ source_system: string; exception_type: string; n: number }>;
};

type Tone = "ok" | "warn" | "bad" | "idle";

const TONE: Record<Tone, string> = {
  ok:   "border-emerald-200 bg-emerald-50",
  warn: "border-amber-200 bg-amber-50",
  bad:  "border-rose-200 bg-rose-50",
  idle: "border-slate-200 bg-slate-50",
};

const staleDays = (iso: string | null): number | null => {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
};

export default function NativeQualityPipelineHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await hrmsApi.get<{ data: Health }>("/api/quality-governance/health");
      setHealth(r?.data ?? null);
    } catch (e) {
      // Deliberately surfaced. A health page that fails silently is the exact
      // failure it exists to catch.
      setError((e as { message?: string })?.message ?? "Could not load pipeline health");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Reading pipeline state…
    </div>;
  }

  if (error || !health) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <p className="font-medium">Pipeline health is unavailable.</p>
          <p className="mt-1">{error}</p>
          <p className="mt-1 text-rose-800">
            This is itself a finding: it means nothing on this page can be trusted to be quiet
            for a good reason.
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void load()}>Retry</Button>
        </div>
      </div>
    );
  }

  const h = health;
  const failedCount = h.failedRuns.reduce((n, r) => n + Number(r.runs), 0);
  const promoted = h.successfulRuns.reduce((n, r) => n + Number(r.promoted ?? 0), 0);
  const missingCount = h.missingConfiguration.processesWithoutQualityTarget.length;
  const exceptionCount = h.openMappingExceptions.reduce((n, e) => n + Number(e.n), 0);
  const qualityStream = h.dataStreams.find((s) => s.stream === "quality");
  const qualityStale = staleDays(qualityStream?.latest_date ?? null);
  const noDataArriving = !qualityStream || Number(qualityStream.rows_) === 0 || (qualityStale ?? 0) > 7;

  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Quality pipeline health</h1>
          <p className="text-sm text-muted-foreground">
            Eight reasons the pipeline can be quiet, kept apart. A calm screen is only
            good news if it is calm for the right reason.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {new Date(h.generatedAt).toLocaleString()}
          </span>
          <Button size="sm" variant="outline" onClick={() => void load()}>Refresh</Button>
        </div>
      </header>

      {/* The banner the whole effort exists for. */}
      {missingCount > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <Settings2 className="h-4 w-4 mt-0.5 text-amber-700 shrink-0" />
            <div className="text-sm text-amber-900">
              <p className="font-medium">
                {missingCount} process(es) are measured and cannot be coached
              </p>
              <p className="mt-0.5">
                {h.missingConfiguration.employeesAffected} employees have quality data with no
                approved target. The evaluator declines rather than inventing a bar, so this
                looks exactly like a quiet week and is not one.
              </p>
              <a href="/quality/targets" className="mt-2 inline-block text-amber-900 underline underline-offset-2">
                Set a target →
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {/* 1 — jobs that ran and worked */}
        <StateCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          title="Connectors succeeding"
          tone={h.successfulRuns.length ? "ok" : "idle"}
          headline={h.successfulRuns.length ? `${h.successfulRuns.length} connector(s), ${promoted} rows promoted` : "No successful runs in 24h"}
          meaning="Data is being pulled and written. This is the only card that means the plumbing works."
          openKey="ok" open={open} toggle={toggle}
          rows={h.successfulRuns.map((r) => ({
            key: r.integration_key,
            left: r.integration_key,
            right: `${r.runs} run(s) · ${r.promoted ?? 0} rows · ${String(r.latest ?? "").slice(0, 19)}`,
          }))}
        />

        {/* 2 — jobs that ran and failed */}
        <StateCard
          icon={<AlertTriangle className="h-4 w-4" />}
          title="Connectors failing"
          tone={failedCount ? "bad" : "ok"}
          headline={failedCount ? `${failedCount} failed run(s) in 24h` : "No failures in 24h"}
          meaning="A failing connector looks identical to a quiet one downstream. dialer_1 failed 1,047 times over 36 days without this card existing."
          openKey="fail" open={open} toggle={toggle}
          rows={h.failedRuns.map((r) => ({
            key: r.integration_key,
            left: r.integration_key,
            right: `${r.runs} failure(s) · last ${String(r.latest ?? "").slice(0, 19)}`,
          }))}
        />

        {/* 3 — jobs that never ran at all */}
        <StateCard
          icon={<PauseCircle className="h-4 w-4" />}
          title="Schedules disabled"
          tone={h.disabledSchedules.length ? "warn" : "ok"}
          headline={h.disabledSchedules.length ? `${h.disabledSchedules.length} disabled` : "All schedules enabled"}
          meaning="Disabled is not failed. These produce no runs, no errors and no data — the quietest failure mode there is."
          openKey="disabled" open={open} toggle={toggle}
          rows={h.disabledSchedules.map((s) => ({
            key: s.integrationKey,
            left: s.integrationKey,
            right: `${s.cron} · last ran ${s.lastRunAt ? String(s.lastRunAt).slice(0, 10) : "never"}`,
          }))}
        />

        {/* 4 — configuration missing */}
        <StateCard
          icon={<Settings2 className="h-4 w-4" />}
          title="Missing configuration"
          tone={missingCount ? "warn" : "ok"}
          headline={missingCount
            ? `${missingCount} process(es), ${h.missingConfiguration.employeesAffected} employees`
            : "Every measured process has a target"}
          meaning="Data arrives and is scored, but there is no bar to judge it against, so nobody can be coached."
          openKey="missing" open={open} toggle={toggle}
          rows={h.missingConfiguration.processesWithoutQualityTarget.map((p) => ({
            key: p.processId,
            left: p.processName,
            right: `${p.employeesWithQuality} employee(s) with quality`,
            href: "/quality/targets",
          }))}
        />

        {/* 5 — is anything arriving */}
        <StateCard
          icon={<Database className="h-4 w-4" />}
          title="Data arriving"
          tone={noDataArriving ? "bad" : "ok"}
          headline={noDataArriving ? "Quality data is stale or absent" : `Quality current to ${qualityStream?.latest_date ?? "—"}`}
          meaning="Whether anything reached HRMS at all. Distinct from a connector succeeding: a run can complete and promote nothing."
          openKey="streams" open={open} toggle={toggle}
          rows={h.dataStreams.map((s) => {
            const d = staleDays(s.latest_date);
            return {
              key: s.stream,
              left: s.stream,
              right: `${Number(s.rows_).toLocaleString()} rows · latest ${s.latest_date ?? "never"}${d !== null && d > 7 ? ` · ${d}d stale` : ""}`,
            };
          })}
        />

        {/* 6 — arrived but unattributable */}
        <StateCard
          icon={<ShieldAlert className="h-4 w-4" />}
          title="Arrived but unmapped"
          tone={exceptionCount ? "warn" : "ok"}
          headline={exceptionCount ? `${exceptionCount} open exception(s)` : "Nothing unmapped"}
          meaning="Rows reached HRMS but could not be attributed to an employee or process. They are queued, never silently dropped."
          openKey="exceptions" open={open} toggle={toggle}
          rows={h.openMappingExceptions.map((e) => ({
            key: `${e.source_system}-${e.exception_type}`,
            left: `${e.source_system} · ${e.exception_type}`,
            right: `${e.n}`,
          }))}
        />

        {/* 7 — the good kind of quiet */}
        <StateCard
          icon={<Sparkles className="h-4 w-4" />}
          title="Evaluated, nothing to raise"
          tone={h.dataReceivedNoTrigger ? "ok" : "idle"}
          headline={h.dataReceivedNoTrigger
            ? "Data arrived, targets exist, nobody fell short"
            : "Not the current state"}
          meaning="The ONLY quiet that is good news: everything ran, every process had a target, and people met it. Shown separately so it can never be confused with the cards above."
          openKey="quiet" open={open} toggle={toggle}
          rows={[]}
        />

        {/* 8 — action actually taken */}
        <StateCard
          icon={h.triggersRaised.total ? <CheckCircle2 className="h-4 w-4" /> : <CircleSlash className="h-4 w-4" />}
          title="Coaching raised"
          tone={h.triggersRaised.total ? "ok" : "idle"}
          headline={h.triggersRaised.total ? `${h.triggersRaised.total} session(s)` : "None raised"}
          meaning="The end of the chain. Zero here is only meaningful once the seven cards above are accounted for."
          openKey="coaching" open={open} toggle={toggle}
          rows={h.triggersRaised.byStatus.map((c) => ({
            key: c.status,
            left: c.status,
            right: `${c.n} · latest ${String(c.latest ?? "").slice(0, 19)}`,
          }))}
        />
      </div>
    </div>
  );
}

function StateCard(props: {
  icon: React.ReactNode;
  title: string;
  tone: Tone;
  headline: string;
  meaning: string;
  openKey: string;
  open: Record<string, boolean>;
  toggle: (k: string) => void;
  rows: Array<{ key: string; left: string; right: string; href?: string }>;
}) {
  const isOpen = !!props.open[props.openKey];
  return (
    <section className={`rounded-lg border p-4 ${TONE[props.tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            {props.icon}<span>{props.title}</span>
          </div>
          <p className="mt-1 text-sm font-semibold">{props.headline}</p>
          <p className="mt-1 text-xs text-muted-foreground">{props.meaning}</p>
        </div>
        {props.rows.length > 0 && (
          <button
            type="button"
            onClick={() => props.toggle(props.openKey)}
            className="shrink-0 text-xs inline-flex items-center gap-1 rounded border bg-white/70 px-2 py-1"
            aria-expanded={isOpen}
          >
            {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {props.rows.length}
          </button>
        )}
      </div>

      {isOpen && props.rows.length > 0 && (
        <ul className="mt-3 space-y-1 border-t pt-2">
          {props.rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              {r.href
                ? <a href={r.href} className="underline underline-offset-2">{r.left}</a>
                : <span className="font-medium">{r.left}</span>}
              <span className="text-muted-foreground">{r.right}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
