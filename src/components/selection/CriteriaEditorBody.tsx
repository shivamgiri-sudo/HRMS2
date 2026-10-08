/** The criteria editor's content (S16), presentational: the container (RequisitionCriteriaEditor) owns data and calls. */
import { useId, type ReactNode } from "react";
import { AlertTriangle, Info, Lock, ShieldCheck } from "lucide-react";
import { CompletenessBadge } from "./CriteriaSummary";
import CriteriaValueEditor from "./CriteriaValueEditor";
import RuleRow, { FIELD, SMALL_BTN } from "./RuleRow";
import { bannerItems, canSave, decideNoRequirement, isLocked, previewDelta, setEnrolment, setMissing, setMode, setWeight, type Draft } from "./criteriaEditorModel";
import { GROUP_ORDER, GROUP_TITLE, RULE_INFO } from "./ruleInfo";
import type { CriteriaIssue, CriteriaResponse, PreviewResult } from "./selectionTypes";

export const PRIMARY = "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-blue-800 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-500 dark:text-slate-950 dark:hover:bg-blue-400 sm:min-h-9";
export const SYSTEM_RULES = "Never contacted, whatever the criteria: legacy employee and test records, current employees and people who joined, opted out, wrong numbers, under 18, hard rejections, a cooling-off period in this process, the no-show cap, the 30-day contact cap, people in another requisition's follow-up or already booked, and invalid mobiles.";

export interface EditorBodyProps {
  resp: CriteriaResponse; draft: Draft; initial: Draft; onDraft: (d: Draft) => void;
  issues: CriteriaIssue[]; checking: boolean; reason: string; onReason: (s: string) => void; ack: boolean; onAck: (b: boolean) => void;
  saved: PreviewResult | null; whatIf: PreviewResult | null; busy: boolean; message: string | null;
  onSave: () => void; onPreviewDraft: () => void; tools?: ReactNode;
}

export default function CriteriaEditorBody(p: EditorBodyProps) {
  const reasonId = useId();
  const ro = !p.draft.canEdit;
  const banner = bannerItems(p.draft, p.saved);
  const verdict = canSave(p.draft, p.initial, { reason: p.reason, issues: p.issues, ackWarnings: p.ack });
  const errors = p.issues.filter((i) => i.level === "error"), warnings = p.issues.filter((i) => i.level === "warning");
  const cfg = p.resp.row.screeningConfig ?? {};
  const approved = p.draft.approvalStatus === "approved";
  return (
    <div className="space-y-4 text-slate-900 dark:text-slate-100">
      <div className="flex flex-wrap items-center gap-2">
        <CompletenessBadge completeness={p.resp.completeness} />
        <span className="text-xs text-slate-600 dark:text-slate-300">{p.resp.row.code} · {p.resp.row.branchName} · {p.resp.row.approvalStatus ?? "unknown status"}</span>
      </div>
      {ro && <p className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"><Lock className="h-4 w-4 shrink-0" aria-hidden="true" />You can read these criteria; only HR can change them.</p>}
      {p.draft.legacy && !ro && <p className="flex items-start gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Today's screening rules apply until criteria are saved here. After the first save, any rule left undecided that has a value acts as MUST, so decide each one.</p>}
      {banner.length > 0 && (
        <section aria-labelledby={`${reasonId}-banner`} className="space-y-2 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 dark:border-amber-600 dark:bg-amber-950">
          <h3 id={`${reasonId}-banner`} className="flex items-center gap-1.5 text-sm font-bold text-amber-900 dark:text-amber-100"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Undecided rules currently act as MUST: most people will go to review</h3>
          <p className="text-xs text-amber-900 dark:text-amber-100">These come from values stored on the requisition that nobody has decided here. Until you decide, anyone we know nothing about is held for HR review.</p>
          <ul className="space-y-1">
            {banner.map((b) => (
              <li key={b.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{b.label}: {b.review} to review, {b.fail} rejected now</span>
                {!ro && <button type="button" className={SMALL_BTN} aria-label={`Decide: no requirement for ${b.label}`} onClick={() => p.onDraft(decideNoRequirement(p.draft, b.key))}>Decide: no requirement</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {!ro && p.tools}
      <section aria-label="System rules" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
        <p className="flex items-start gap-1.5"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span><span className="font-semibold">System rules (cannot be changed):</span> {SYSTEM_RULES}</span></p>
      </section>
      {GROUP_ORDER.map((g) => {
        const keys = Object.keys(RULE_INFO).filter((k) => RULE_INFO[k].group === g && k !== "relocation_ok");
        return (
          <section key={g} aria-label={GROUP_TITLE[g]} className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">{GROUP_TITLE[g]}</h3>
            <ul className="space-y-2">
              {keys.map((k) => (
                <RuleRow key={k} ruleKey={k} label={RULE_INFO[k].label} row={p.draft.rows[k]} readOnly={ro} lock={isLocked(k, p.draft.approvalStatus)}
                  onMode={(m) => p.onDraft(setMode(p.draft, k, m))} onWeight={(w) => p.onDraft(setWeight(p.draft, k, w))} onMissing={(m, s) => p.onDraft(setMissing(p.draft, k, m, s))}>
                  <CriteriaValueEditor ruleKey={k} draft={p.draft} readOnly={ro || !!isLocked(k, p.draft.approvalStatus)} onDraft={p.onDraft} salaryMax={p.resp.row.salaryMax}
                    customRules={(cfg.custom_field_rules as Array<{ label?: string; field?: string }>) ?? []} />
                </RuleRow>
              ))}
              {g === "where" && (
                <RuleRow ruleKey="relocation_ok" label={RULE_INFO.relocation_ok.label} row={p.draft.rows.relocation_ok} readOnly={ro} lock={null}
                  onMode={(m) => p.onDraft(setMode(p.draft, "relocation_ok", m))} onWeight={() => undefined} onMissing={() => undefined} />
              )}
            </ul>
          </section>
        );
      })}
      {!ro && (
        <section aria-label="Enrolment" className="space-y-1">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
            <input type="checkbox" checked={p.draft.enrolmentMode === "hr_approves"} onChange={(e) => p.onDraft(setEnrolment(p.draft, e.target.checked ? "hr_approves" : "off"))} className="h-5 w-5 cursor-pointer rounded" />
            HR approves each shortlist before anyone is contacted
          </label>
        </section>
      )}
      <div aria-live="polite" className="space-y-1">
        {p.checking && <p className="text-xs text-slate-600 dark:text-slate-300">Checking the rules…</p>}
        {errors.length > 0 && <ul role="alert" className="space-y-0.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100">{errors.map((e, i) => <li key={i} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Error: {e.text}</li>)}</ul>}
        {warnings.length > 0 && (
          <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            <ul className="space-y-0.5">{warnings.map((w, i) => <li key={i} className="flex gap-1.5"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Warning: {w.text}</li>)}</ul>
            {!ro && <label className="flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-9"><input type="checkbox" checked={p.ack} onChange={(e) => p.onAck(e.target.checked)} className="h-5 w-5 cursor-pointer rounded" />I have read the warnings</label>}
          </div>
        )}
      </div>
      {p.whatIf && p.saved && (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-max text-left text-sm">
            <caption className="mb-1 text-left text-xs text-slate-600 dark:text-slate-300">Draft against saved criteria ({p.whatIf.source.replace("_", " ")}, {p.whatIf.start} people). Nothing is saved yet.</caption>
            <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th scope="col" className="px-2 py-1">Outcome</th><th scope="col" className="px-2 py-1">Saved</th><th scope="col" className="px-2 py-1">Draft</th><th scope="col" className="px-2 py-1">Change</th></tr></thead>
            <tbody>{previewDelta(p.saved, p.whatIf).map((r) => <tr key={r.label} className="border-b border-slate-100 dark:border-slate-800"><th scope="row" className="px-2 py-1 font-medium">{r.label}</th><td className="px-2 py-1 tabular-nums">{r.saved}</td><td className="px-2 py-1 tabular-nums">{r.draft}</td><td className="px-2 py-1 tabular-nums">{r.change}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {!ro && (
        <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
          <label htmlFor={reasonId} className="block text-sm font-semibold">Reason{approved ? " (required: this requisition is approved)" : " (optional)"}</label>
          <textarea id={reasonId} value={p.reason} maxLength={300} onChange={(e) => p.onReason(e.target.value)} rows={2} className={`${FIELD} py-2`} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={PRIMARY} disabled={!verdict.ok || p.busy} onClick={p.onSave}>Save criteria</button>
            <button type="button" className={SMALL_BTN} disabled={p.busy} onClick={p.onPreviewDraft}>Preview with these changes</button>
            {!verdict.ok && verdict.why && <span className="text-xs text-slate-700 dark:text-slate-200">{verdict.why}</span>}
          </div>
        </div>
      )}
      {p.message && <p role="status" className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">{p.message}</p>}
    </div>
  );
}
