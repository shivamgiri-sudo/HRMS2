import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer } from "../Drawer";
import { ErrorBox } from "../ui";
import { alertsKey, backtestRule, createRule, updateRule, type AlertRule, type Backtest, type Comparator, type MetricChoice, type RuleInput, type Severity } from "./api";
import { COOLDOWNS, CMP_LABEL, SEV_TEXT, errMsg, field, isAnomaly, primaryBtn, unitHint } from "./alertUi";
import { RecipientPicker } from "./RecipientPicker";
import { formatValue } from "../format";

interface Props { processId: string; rule: AlertRule | null; metrics: MetricChoice[]; tlOptions: string[]; lobOptions: string[]; onClose: () => void }

const blank = (metrics: MetricChoice[]): RuleInput => ({
  name: "", metricKey: metrics.find((m) => m.kind === "kpi" && m.available)?.key ?? "", comparator: "lt", threshold: 0, windowDays: 1, consecutiveDays: 1, scopeTl: null, scopeLob: null,
  severity: "warn", recipients: { roles: [], tls: [], employeeIds: [] }, channels: ["in_app"], cooldownMinutes: 1440, enabled: true,
});
const fromRule = (r: AlertRule): RuleInput => ({ name: r.name, metricKey: r.metricKey, comparator: r.comparator, threshold: r.threshold, windowDays: r.windowDays, consecutiveDays: r.consecutiveDays, scopeTl: r.scopeTl, scopeLob: r.scopeLob,
  severity: r.severity, recipients: r.recipients, channels: r.channels, cooldownMinutes: r.cooldownMinutes, enabled: r.enabled });

function Lbl({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor: string }) {
  return <div><label htmlFor={htmlFor} className="mb-1 block text-xs font-bold text-slate-800">{label}</label>{children}{hint && <p className="mt-1 text-[11px] text-slate-600">{hint}</p>}</div>;
}

/** Live "would have fired N times" preview: posts the draft (debounced) to the backtest endpoint, which replays the same evaluator the worker runs. */
function BacktestPreview({ processId, draft, valid }: { processId: string; draft: RuleInput; valid: boolean }) {
  const key = JSON.stringify({ m: draft.metricKey, c: draft.comparator, t: draft.threshold, w: draft.windowDays, n: draft.consecutiveDays, tl: draft.scopeTl, lob: draft.scopeLob, cd: draft.cooldownMinutes });
  const [dk, setDk] = useState(key);
  useEffect(() => { const t = setTimeout(() => setDk(key), 500); return () => clearTimeout(t); }, [key]);
  const q = useQuery<Backtest>({ queryKey: alertsKey(processId, "backtest", dk), queryFn: () => backtestRule(processId, { ...draft, name: draft.name || "Preview" }), enabled: valid, staleTime: 60_000, retry: false });
  const b = q.data;
  return (
    <section aria-label="Backtest preview" className="rounded-xl border border-blue-200 bg-blue-50 p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-blue-900">Backtest, last {b?.days ?? 14} days</h3>
      <div role="status" aria-live="polite" className="mt-1 text-sm text-slate-900">
        {!valid ? "Choose a metric and a threshold to see the preview." : q.isFetching && !b ? "Replaying the last 14 days…" : q.isError ? <span className="text-red-800">{errMsg(q.error, "Could not run the preview.")}</span> : b && b.asOf === null ? "This process has no data yet, so nothing can be replayed." : b ? (
          <>
            <p className="text-base font-bold">Would have fired {b.fired} time{b.fired === 1 ? "" : "s"}<span className="text-sm font-normal text-slate-700"> in the last {b.days} days</span>{q.isFetching && <span className="ml-2 text-xs font-normal text-slate-600">updating…</span>}</p>
            <p className="text-xs text-slate-700">{b.evaluatedDays} of {b.days} days had data{b.suppressedByCooldown > 0 ? `; ${b.suppressedByCooldown} more breach${b.suppressedByCooldown === 1 ? "" : "es"} held back by the cooldown` : ""}. Days with no data never fire.</p>
          </>
        ) : null}
      </div>
      {b && b.timeline.length > 0 && (
        <ol className="mt-2 flex gap-1" aria-label="Day by day result">
          {b.timeline.map((d) => (
            <li key={d.date} title={`${d.date}: ${d.fired ? "would fire" : d.suppressedByCooldown ? "breach, held by cooldown" : d.value === null ? "no data" : "ok"}`}
              className={`h-6 flex-1 rounded ${d.fired ? "bg-red-600" : d.suppressedByCooldown ? "bg-amber-400" : d.value === null ? "bg-slate-200" : "bg-emerald-400"}`}>
              <span className="sr-only">{d.date}: {d.fired ? "would fire" : d.suppressedByCooldown ? "breach held by cooldown" : d.value === null ? "no data" : "no breach"}</span></li>
          ))}
        </ol>
      )}
      {b && b.timeline.length > 0 && <p className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-700"><span>{"■"} <span className="text-red-700">fires</span></span><span><span className="text-amber-600">{"■"}</span> cooldown</span><span><span className="text-emerald-600">{"■"}</span> ok</span><span><span className="text-slate-400">{"■"}</span> no data</span></p>}
      {b && b.sample.length > 0 && <ul className="mt-2 space-y-1 text-xs text-slate-800">{b.sample.map((s) => <li key={s.date}>{s.message}</li>)}</ul>}
    </section>
  );
}

export function RuleBuilder({ processId, rule, metrics, tlOptions, lobOptions, onClose }: Props) {
  const qc = useQueryClient();
  const [f, setF] = useState<RuleInput>(() => (rule ? fromRule(rule) : blank(metrics)));
  const [thr, setThr] = useState(() => String(rule?.threshold ?? 0));
  const set = <K extends keyof RuleInput>(k: K, v: RuleInput[K]) => setF((p) => ({ ...p, [k]: v }));
  const m = metrics.find((x) => x.key === f.metricKey);
  const anomaly = isAnomaly(f.metricKey);
  const thrNum = thr.trim() === "" ? NaN : Number(thr);
  const nameOk = f.name.trim().length > 0;
  const recipientsOk = f.recipients.roles.length + f.recipients.tls.length + f.recipients.employeeIds.length > 0;
  const valid = !!m?.available && Number.isFinite(thrNum);
  const draft = useMemo<RuleInput>(() => ({ ...f, threshold: Number.isFinite(thrNum) ? thrNum : 0, comparator: anomaly ? "gte" : f.comparator }), [f, thrNum, anomaly]);
  const save = useMutation({
    mutationFn: () => (rule ? updateRule(processId, rule.id, { ...draft, name: draft.name.trim() }) : createRule(processId, { ...draft, name: draft.name.trim() })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: alertsKey(processId) }); onClose(); },
  });
  const can = nameOk && valid && recipientsOk && f.channels.length > 0 && !save.isPending;
  const toggleChannel = (c: "in_app" | "email") => set("channels", f.channels.includes(c) ? f.channels.filter((x) => x !== c) : [...f.channels, c]);
  return (
    <Drawer title={rule ? "Edit alert rule" : "New alert rule"} subtitle="Fires when the dashboard's own numbers cross your threshold" onClose={onClose}>
      <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); if (can) save.mutate(); }} noValidate>
        <BacktestPreview processId={processId} draft={draft} valid={valid} />
        <Lbl label="Rule name" htmlFor="ar-name"><input id="ar-name" data-autofocus className={field} value={f.name} maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder="e.g. AHT above 7 minutes" required aria-required="true" /></Lbl>
        <Lbl label="Metric" htmlFor="ar-metric" hint={m?.target != null && !anomaly ? `Dashboard target: ${formatValue(m.target, m.unit)}` : anomaly ? "Uses the same anomaly detector as the Anomalies panel." : undefined}>
          <select id="ar-metric" className={`${field} cursor-pointer`} value={f.metricKey} onChange={(e) => { const nm = metrics.find((x) => x.key === e.target.value); setF((p) => ({ ...p, metricKey: e.target.value, comparator: nm?.direction === "lower" ? "gt" : "lt", consecutiveDays: isAnomaly(e.target.value) ? 1 : p.consecutiveDays, windowDays: isAnomaly(e.target.value) ? 1 : p.windowDays })); if (isAnomaly(e.target.value)) setThr("1"); }}>
            <optgroup label="KPIs">{metrics.filter((x) => x.kind === "kpi").map((x) => <option key={x.key} value={x.key} disabled={!x.available}>{x.label}{x.available ? "" : " (not mapped)"}</option>)}</optgroup>
            <optgroup label="Anomalies">{metrics.filter((x) => x.kind === "anomaly").map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>
          </select>
        </Lbl>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {!anomaly && <Lbl label="Condition" htmlFor="ar-cmp"><select id="ar-cmp" className={`${field} cursor-pointer`} value={f.comparator} onChange={(e) => set("comparator", e.target.value as Comparator)}>{(Object.keys(CMP_LABEL) as Comparator[]).map((c) => <option key={c} value={c}>{CMP_LABEL[c]}</option>)}</select></Lbl>}
          <Lbl label={anomaly ? "Minimum agents flagged" : `Threshold${unitHint(m?.unit) ? ` (${unitHint(m?.unit)})` : ""}`} htmlFor="ar-thr" hint={thr.trim() !== "" && !Number.isFinite(thrNum) ? "Enter a number" : undefined}>
            <input id="ar-thr" className={field} inputMode="decimal" value={thr} onChange={(e) => setThr(e.target.value)} aria-invalid={thr.trim() !== "" && !Number.isFinite(thrNum)} />
            {m?.target != null && !anomaly && <button type="button" onClick={() => setThr(String(m.target))} className="mt-1 min-h-[32px] cursor-pointer text-[11px] font-semibold text-blue-800 underline">Use dashboard target ({formatValue(m.target, m.unit)})</button>}
          </Lbl>
          {!anomaly && <Lbl label="Average over (days)" htmlFor="ar-win" hint="1 = judge each day on its own"><input id="ar-win" type="number" min={1} max={31} className={field} value={f.windowDays} onChange={(e) => set("windowDays", Math.max(1, Math.min(31, Number(e.target.value) || 1)))} /></Lbl>}
          {!anomaly && <Lbl label="Must hold for (days in a row)" htmlFor="ar-con" hint="Days with no data break the streak"><input id="ar-con" type="number" min={1} max={14} className={field} value={f.consecutiveDays} onChange={(e) => set("consecutiveDays", Math.max(1, Math.min(14, Number(e.target.value) || 1)))} /></Lbl>}
          <Lbl label="Team leader scope" htmlFor="ar-tl"><select id="ar-tl" className={`${field} cursor-pointer`} value={f.scopeTl ?? ""} onChange={(e) => set("scopeTl", e.target.value || null)}><option value="">Whole process</option>{tlOptions.map((t) => <option key={t} value={t}>{t}</option>)}</select></Lbl>
          <Lbl label="LOB scope" htmlFor="ar-lob"><select id="ar-lob" className={`${field} cursor-pointer`} value={f.scopeLob ?? ""} onChange={(e) => set("scopeLob", e.target.value || null)}><option value="">All LOBs</option>{lobOptions.map((t) => <option key={t} value={t}>{t}</option>)}</select></Lbl>
        </div>
        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-xs font-bold text-slate-800">Delivery</legend>
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Severity">
            {(["info", "warn", "critical"] as Severity[]).map((s) => (
              <label key={s} className={`inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ring-1 ${f.severity === s ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-800 ring-slate-300"}`}>
                <input type="radio" name="ar-sev" className="sr-only" checked={f.severity === s} onChange={() => set("severity", s)} />{SEV_TEXT[s]}</label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([["in_app", "In-app"], ["email", "E-mail"]] as const).map(([c, l]) => (
              <label key={c} className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ring-1 ring-slate-300"><input type="checkbox" checked={f.channels.includes(c)} onChange={() => toggleChannel(c)} />{l}</label>
            ))}
          </div>
        </fieldset>
        <Lbl label="Cooldown" htmlFor="ar-cd" hint="After it fires, the rule stays quiet for this long even if the condition still holds."><select id="ar-cd" className={`${field} cursor-pointer`} value={f.cooldownMinutes} onChange={(e) => set("cooldownMinutes", Number(e.target.value))}>{COOLDOWNS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}{!COOLDOWNS.some((c) => c.v === f.cooldownMinutes) && <option value={f.cooldownMinutes}>{f.cooldownMinutes} minutes</option>}</select></Lbl>
        <RecipientPicker processId={processId} value={f.recipients} onChange={(v) => set("recipients", v)} tlOptions={tlOptions} />
        <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm font-semibold text-slate-900"><input type="checkbox" role="switch" checked={f.enabled} onChange={(e) => set("enabled", e.target.checked)} className="h-4 w-4" />Rule enabled</label>
        {save.isError && <ErrorBox message={errMsg(save.error, "Could not save the rule.")} />}
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
          {!can && !save.isPending && <p className="mr-auto text-xs text-slate-700">{!nameOk ? "Name the rule. " : ""}{!valid ? "Pick an available metric and a numeric threshold. " : ""}{!recipientsOk ? "Add at least one recipient. " : ""}{f.channels.length === 0 ? "Choose a channel." : ""}</p>}
          <button type="button" onClick={onClose} className="min-h-[40px] cursor-pointer rounded-lg px-4 text-sm font-semibold text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Cancel</button>
          <button type="submit" disabled={!can} className={primaryBtn}>{save.isPending ? "Saving…" : rule ? "Save changes" : "Create rule"}</button>
        </div>
      </form>
    </Drawer>
  );
}
