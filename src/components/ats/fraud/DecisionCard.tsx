import { useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { decisionGroups, type DecisionChoice, type ResolutionOption } from "@/lib/fraudResolutions";
import { CHECKLIST_BY_KIND, needsChecklist, type AlertKind, type Verdict } from "@/lib/fraudReview";

interface Props {
  alertId: string;
  title: string;
  alertType: string;
  kind: AlertKind;
  verdict: Verdict;
  saving: boolean;
  onSave: (option: ResolutionOption, note: string) => Promise<void>;
}

const CHOICES: { key: DecisionChoice; label: string; help: string; on: string }[] = [
  { key: "ok", label: "False alarm", help: "These are fine. Clear the alert.", on: "border-emerald-500 bg-emerald-50" },
  { key: "bad", label: "Real problem", help: "Something is wrong. Record it.", on: "border-red-500 bg-red-50" },
  { key: "info", label: "Need more information", help: "Keep it open and note what you asked for.", on: "border-blue-500 bg-blue-50" },
];

const CONSEQUENCE: Record<DecisionChoice, string> = {
  ok: "The alert closes. Approval can continue if nothing else is blocking it.",
  bad: "The alert is recorded as a real problem and stays on the candidate's file.",
  info: "The alert stays open, marked under review. Approval stays blocked until you decide.",
};

/** One alert, one decision: three plain choices, a reason from a list, and a note. */
export function DecisionCard({ alertId, title, alertType, kind, verdict, saving, onSave }: Props) {
  const groups = useMemo(() => decisionGroups(alertType), [alertType]);
  const [choice, setChoice] = useState<DecisionChoice | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [reasonIdx, setReasonIdx] = useState(0);
  const [note, setNote] = useState("");
  const [checks, setChecks] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const options: ResolutionOption[] = dismissing && groups.dismiss ? [groups.dismiss] : choice ? groups[choice] : [];
  const option = options[Math.min(reasonIdx, Math.max(options.length - 1, 0))];
  const gated = !dismissing && needsChecklist(verdict, choice);
  const noteRequired = dismissing || choice === "ok" || choice === "bad";
  const canSave =
    !!option && !saving && (!noteRequired || note.trim().length > 0) && (!gated || checks.size > 0);

  const pick = (c: DecisionChoice) => {
    setChoice(c);
    setDismissing(false);
    setReasonIdx(0);
    setChecks(new Set());
    setError(null);
  };

  const save = async () => {
    if (!option) return;
    setError(null);
    try {
      await onSave(option, note);
    } catch {
      setError("Could not save your decision. Nothing was changed.");
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-label={`Decision for ${title}`}>
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Your decision</h3>
        <p className="mt-0.5 text-sm font-semibold text-slate-900">{title}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        {CHOICES.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={choice === c.key && !dismissing}
            onClick={() => pick(c.key)}
            className={`cursor-pointer rounded-xl border-2 p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
              choice === c.key && !dismissing ? c.on : "border-slate-200 bg-white hover:border-slate-400"
            }`}
          >
            <span className="block text-sm font-bold text-slate-900">{c.label}</span>
            <span className="block text-xs text-slate-500">{c.help}</span>
          </button>
        ))}
      </div>

      {(choice || dismissing) && option && (
        <div className="space-y-3">
          <div>
            <label htmlFor={`reason-${alertId}`} className="mb-1 block text-xs font-semibold text-slate-500">Reason</label>
            <select
              id={`reason-${alertId}`}
              value={Math.min(reasonIdx, options.length - 1)}
              onChange={(e) => setReasonIdx(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {options.map((o, i) => (
                <option key={o.code} value={i}>{o.label}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">{option.hint}</p>
          </div>

          {gated && (
            <fieldset className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <legend className="px-1 text-xs font-semibold text-amber-800">
                The system found these are different people. Before calling this a false alarm, confirm what you checked:
              </legend>
              {CHECKLIST_BY_KIND[kind].map((text, i) => (
                <label key={text} className="flex cursor-pointer items-start gap-2 text-sm text-slate-800">
                  <input
                    type="checkbox"
                    checked={checks.has(i)}
                    onChange={(e) =>
                      setChecks((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(i);
                        else next.delete(i);
                        return next;
                      })
                    }
                    className="mt-0.5 h-4 w-4 accent-blue-600"
                  />
                  {text}
                </label>
              ))}
            </fieldset>
          )}

          <div>
            <label htmlFor={`note-${alertId}`} className="mb-1 block text-xs font-semibold text-slate-500">
              What did you check and what did it show?{noteRequired ? "" : " (optional)"}
            </label>
            <textarea
              id={`note-${alertId}`}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="This becomes the audit record"
              className="w-full resize-none rounded-lg border border-slate-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          {error && (
            <p className="flex items-start gap-1.5 text-xs text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void save()} disabled={!canSave} className="min-h-[40px] bg-blue-600 hover:bg-blue-700">
              {saving ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Saving…</> : "Save decision"}
            </Button>
            <p className="text-xs text-slate-500">{dismissing ? "The alert closes as raised in error." : choice ? CONSEQUENCE[choice] : ""}</p>
          </div>
        </div>
      )}

      {!dismissing && groups.dismiss && (
        <button
          type="button"
          onClick={() => { setDismissing(true); setChoice(null); setReasonIdx(0); setChecks(new Set()); }}
          className="cursor-pointer text-xs text-slate-500 underline hover:text-slate-800"
        >
          This alert was raised in error
        </button>
      )}
    </section>
  );
}
