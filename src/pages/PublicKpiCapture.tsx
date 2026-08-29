import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Target,
  Building2,
  Gauge,
  Database,
  Plus,
} from "lucide-react";

/**
 * Open KPI capture page — /kpi-capture. No login.
 *
 * One KPI per submission. After a save the cost centre and designation are deliberately KEPT and
 * only the KPI half of the form resets, because the real usage is "a team leader enters the eight
 * KPIs their Executives are measured on" — clearing the whole form each time would make them
 * re-pick the same two dropdowns eight times.
 */

type Master = { id: string; label: string };
type Metric = {
  id: string;
  code: string;
  name: string;
  family: string;
  unit: string;
  direction: string;
  aggregation: string;
};

const UNITS = [
  { v: "percent", l: "Percentage (%)" },
  { v: "count", l: "Count / number" },
  { v: "seconds", l: "Seconds (AHT, hold time)" },
  { v: "currency", l: "Rupees (₹)" },
  { v: "boolean", l: "Yes / No" },
];

const DIRECTIONS = [
  { v: "higher_is_better", l: "Higher is better" },
  { v: "lower_is_better", l: "Lower is better" },
];

const AGGREGATIONS = [
  { v: "average", l: "Average — mean of the days" },
  { v: "sum", l: "Sum — add the days up" },
  { v: "ratio", l: "Ratio — recompute from totals (correct for AHT, conversion %)" },
  { v: "latest", l: "Latest — most recent value" },
];

const FREQUENCIES = [
  { v: "daily", l: "Daily" },
  { v: "weekly", l: "Weekly" },
  { v: "monthly", l: "Monthly" },
  { v: "quarterly", l: "Quarterly" },
];

const DATA_SOURCES = [
  "HRMS (already in the system)",
  "Dialer / CRM report",
  "Client MIS or client portal",
  "Team Excel sheet",
  "Quality audit tool",
  "Manual — someone counts it",
];

const NEW_KPI = "__NEW__";

const emptyKpi = {
  metricId: "",
  newKpiName: "",
  newKpiFormula: "",
  unit: "",
  direction: "",
  aggregation: "",
  frequency: "monthly",
  targetValue: "",
  minThreshold: "",
  maxAchievement: "",
  weightage: "",
  dataSource: "",
  ownerName: "",
  notes: "",
};

const label = "block text-sm font-medium text-slate-700 mb-1.5";
const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 " +
  "shadow-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 " +
  "disabled:bg-slate-50 disabled:text-slate-400";
const hint = "mt-1.5 text-xs text-slate-500";

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Target;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
          <Icon className="h-4.5 w-4.5" strokeWidth={2} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export default function PublicKpiCapture() {
  const [costCentres, setCostCentres] = useState<Master[]>([]);
  const [designations, setDesignations] = useState<Master[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loadingMasters, setLoadingMasters] = useState(true);
  const [masterError, setMasterError] = useState<string | null>(null);

  // Kept across submissions.
  const [submitterName, setSubmitterName] = useState("");
  const [submitterEmail, setSubmitterEmail] = useState("");
  const [costCentreId, setCostCentreId] = useState("");
  const [designationId, setDesignationId] = useState("");

  // Reset after each submission.
  const [kpi, setKpi] = useState({ ...emptyKpi });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [justSaved, setJustSaved] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/public/kpi-capture/masters")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.success) throw new Error(d?.message || "Could not load options");
        setCostCentres(d.costCentres ?? []);
        setDesignations(d.designations ?? []);
        setMetrics(d.metrics ?? []);
      })
      .catch((e) => setMasterError(e instanceof Error ? e.message : "Could not load options"))
      .finally(() => setLoadingMasters(false));
  }, []);

  const isNew = kpi.metricId === NEW_KPI;

  const grouped = useMemo(() => {
    const order = ["operations", "quality", "performance", "custom"];
    const by: Record<string, Metric[]> = {};
    for (const m of metrics) (by[m.family] ??= []).push(m);
    return order.filter((f) => by[f]?.length).map((f) => ({ family: f, items: by[f] }));
  }, [metrics]);

  /**
   * Picking an existing KPI pre-fills unit / direction / roll-up from the catalogue. These stay
   * editable — a cost centre may measure the same KPI on a different basis — but pre-filling means
   * the common case is three fewer decisions and, more importantly, three fewer chances to
   * contradict the catalogue definition for no reason.
   */
  function onPickKpi(value: string) {
    if (value === NEW_KPI || value === "") {
      setKpi((k) => ({ ...k, metricId: value, unit: "", direction: "", aggregation: "" }));
      return;
    }
    const m = metrics.find((x) => x.id === value);
    setKpi((k) => ({
      ...k,
      metricId: value,
      newKpiName: "",
      newKpiFormula: "",
      unit: m?.unit ?? "",
      direction: m?.direction ?? "",
      aggregation: m?.aggregation ?? "",
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setJustSaved(null);
    setSaving(true);

    const cc = costCentres.find((c) => c.id === costCentreId);
    const dg = designations.find((d) => d.id === designationId);
    const metric = metrics.find((m) => m.id === kpi.metricId);

    try {
      const res = await fetch("/api/public/kpi-capture/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submitterName,
          submitterEmail,
          costCentreId,
          costCentreLabel: cc?.label ?? "",
          designationId,
          designationLabel: dg?.label ?? "",
          isNewKpi: isNew,
          existingMetricId: isNew ? "" : kpi.metricId,
          newKpiName: kpi.newKpiName,
          newKpiFormula: kpi.newKpiFormula,
          unit: kpi.unit,
          direction: kpi.direction,
          aggregation: kpi.aggregation,
          frequency: kpi.frequency,
          targetValue: kpi.targetValue,
          minThreshold: kpi.minThreshold,
          maxAchievement: kpi.maxAchievement,
          weightage: kpi.weightage,
          dataSource: kpi.dataSource,
          ownerName: kpi.ownerName,
          notes: kpi.notes,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d?.success) throw new Error(d?.message || "Could not save.");

      setSavedCount((n) => n + 1);
      setJustSaved(isNew ? kpi.newKpiName : (metric?.name ?? "KPI"));
      setKpi({ ...emptyKpi, ownerName: kpi.ownerName, dataSource: kpi.dataSource });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  if (loadingMasters) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
      </div>
    );
  }

  if (masterError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-red-500" />
          <p className="text-sm font-medium text-slate-900">Could not load the form</p>
          <p className="mt-1 text-sm text-slate-500">{masterError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            MAS Callnet · HRMS
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            KPI capture
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Tell us which KPIs your team is actually measured on, so HRMS can build a live
            dashboard for every process. <strong className="font-medium text-slate-900">One KPI
            per submission</strong> — after you save, the form keeps your cost centre and
            designation so you can add the next one straight away.
          </p>
          <p className="mt-3 text-sm text-slate-600">
            If the KPI you use is not in the list, choose{" "}
            <span className="font-medium text-slate-900">“Not in this list”</span> and type it —
            that is exactly what we are trying to find.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
        {justSaved && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="text-sm">
              <p className="font-medium text-emerald-900">Saved “{justSaved}”.</p>
              <p className="mt-0.5 text-emerald-700">
                {savedCount} KPI{savedCount === 1 ? "" : "s"} submitted so far. Add the next one
                below.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-5">
          <Section
            icon={Building2}
            title="Which team is this KPI for?"
            subtitle="These lists come live from HRMS and show only teams that currently have staff."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="name">Your name</label>
                <input
                  id="name" className={field} value={submitterName} required
                  onChange={(e) => setSubmitterName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                />
              </div>
              <div>
                <label className={label} htmlFor="email">Your email (optional)</label>
                <input
                  id="email" type="email" className={field} value={submitterEmail}
                  onChange={(e) => setSubmitterEmail(e.target.value)}
                  placeholder="name@teammas.in"
                />
              </div>
            </div>

            <div>
              <label className={label} htmlFor="cc">Cost centre / process</label>
              <select id="cc" className={field} value={costCentreId} required
                      onChange={(e) => setCostCentreId(e.target.value)}>
                <option value="">Select a cost centre…</option>
                {costCentres.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={label} htmlFor="dg">Designation</label>
              <select id="dg" className={field} value={designationId} required
                      onChange={(e) => setDesignationId(e.target.value)}>
                <option value="">Select a designation…</option>
                {designations.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
              <p className={hint}>The role this KPI is measured on — not the person.</p>
            </div>
          </Section>

          <Section
            icon={Target}
            title="The KPI"
            subtitle="Every KPI already defined in HRMS is listed, grouped by family."
          >
            <div>
              <label className={label} htmlFor="kpi">KPI name</label>
              <select id="kpi" className={field} value={kpi.metricId} required
                      onChange={(e) => onPickKpi(e.target.value)}>
                <option value="">Select a KPI…</option>
                <option value={NEW_KPI}>➕ Not in this list — I am adding a new KPI</option>
                {grouped.map((g) => (
                  <optgroup key={g.family} label={g.family.toUpperCase()}>
                    {g.items.map((m) => (
                      <option key={m.id} value={m.id}>{m.name} — {m.code}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {isNew && (
              <div className="space-y-5 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                  <Plus className="h-4 w-4" /> New KPI — not yet in HRMS
                </div>
                <div>
                  <label className={label} htmlFor="newname">What is it called?</label>
                  <input
                    id="newname" className={field} value={kpi.newKpiName} required
                    onChange={(e) => setKpi((k) => ({ ...k, newKpiName: e.target.value }))}
                    placeholder="The name your team actually uses"
                  />
                </div>
                <div>
                  <label className={label} htmlFor="formula">How is it calculated?</label>
                  <textarea
                    id="formula" rows={3} className={field} value={kpi.newKpiFormula}
                    onChange={(e) => setKpi((k) => ({ ...k, newKpiFormula: e.target.value }))}
                    placeholder="In plain words, e.g. connected calls ÷ total dials × 100"
                  />
                  <p className={hint}>Without the formula we cannot automate it later.</p>
                </div>
              </div>
            )}
          </Section>

          <Section
            icon={Gauge}
            title="How it is measured"
            subtitle="These decide how the dashboard scores and charts the KPI."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="unit">Unit</label>
                <select id="unit" className={field} value={kpi.unit} required
                        onChange={(e) => setKpi((k) => ({ ...k, unit: e.target.value }))}>
                  <option value="">Select…</option>
                  {UNITS.map((u) => <option key={u.v} value={u.v}>{u.l}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="dir">Which direction is good?</label>
                <select id="dir" className={field} value={kpi.direction} required
                        onChange={(e) => setKpi((k) => ({ ...k, direction: e.target.value }))}>
                  <option value="">Select…</option>
                  {DIRECTIONS.map((d) => <option key={d.v} value={d.v}>{d.l}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className={label} htmlFor="agg">How should a month roll up from daily numbers?</label>
              <select id="agg" className={field} value={kpi.aggregation} required
                      onChange={(e) => setKpi((k) => ({ ...k, aggregation: e.target.value }))}>
                <option value="">Select…</option>
                {AGGREGATIONS.map((a) => <option key={a.v} value={a.v}>{a.l}</option>)}
              </select>
            </div>

            <div>
              <label className={label} htmlFor="freq">Measured how often?</label>
              <select id="freq" className={field} value={kpi.frequency} required
                      onChange={(e) => setKpi((k) => ({ ...k, frequency: e.target.value }))}>
                {FREQUENCIES.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
              </select>
            </div>
          </Section>

          <Section
            icon={Target}
            title="Target and weight"
            subtitle="Numbers only — enter 85, not “85%”."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="target">Target value</label>
                <input
                  id="target" type="number" step="any" className={field} required
                  value={kpi.targetValue}
                  onChange={(e) => setKpi((k) => ({ ...k, targetValue: e.target.value }))}
                />
                <p className={hint}>The number that counts as 100% achievement.</p>
              </div>
              <div>
                <label className={label} htmlFor="min">Minimum threshold (optional)</label>
                <input
                  id="min" type="number" step="any" className={field}
                  value={kpi.minThreshold}
                  onChange={(e) => setKpi((k) => ({ ...k, minThreshold: e.target.value }))}
                />
                <p className={hint}>Below this the score is zero.</p>
              </div>
              <div>
                <label className={label} htmlFor="max">Maximum achievement % (optional)</label>
                <input
                  id="max" type="number" step="any" className={field}
                  value={kpi.maxAchievement}
                  onChange={(e) => setKpi((k) => ({ ...k, maxAchievement: e.target.value }))}
                  placeholder="e.g. 120"
                />
                <p className={hint}>Cap on over-achievement. Blank means 100.</p>
              </div>
              <div>
                <label className={label} htmlFor="wt">Weightage %</label>
                <input
                  id="wt" type="number" step="any" min={0} max={100} className={field} required
                  value={kpi.weightage}
                  onChange={(e) => setKpi((k) => ({ ...k, weightage: e.target.value }))}
                />
                <p className={hint}>
                  All KPIs for this cost centre + designation must add up to 100.
                </p>
              </div>
            </div>
          </Section>

          <Section
            icon={Database}
            title="Where does the number come from today?"
            subtitle="This decides whether the dashboard can pull it automatically."
          >
            <div>
              <label className={label} htmlFor="src">Current data source</label>
              <select id="src" className={field} value={kpi.dataSource} required
                      onChange={(e) => setKpi((k) => ({ ...k, dataSource: e.target.value }))}>
                <option value="">Select…</option>
                {DATA_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="owner">Who owns this number?</label>
              <input
                id="owner" className={field} required value={kpi.ownerName}
                onChange={(e) => setKpi((k) => ({ ...k, ownerName: e.target.value }))}
                placeholder="Name or role of whoever produces it"
              />
            </div>
            <div>
              <label className={label} htmlFor="notes">Anything else we should know? (optional)</label>
              <textarea
                id="notes" rows={3} className={field} value={kpi.notes}
                onChange={(e) => setKpi((k) => ({ ...k, notes: e.target.value }))}
                placeholder="Missing cost centre or designation, seasonal targets, client-specific rules…"
              />
            </div>
          </Section>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Submissions are reviewed before anything changes in HRMS.
            </p>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-6 py-3
                         text-sm font-medium text-white shadow-sm transition hover:bg-slate-800
                         focus:outline-none focus:ring-2 focus:ring-slate-900/20 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {saving ? "Saving…" : "Submit this KPI"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
