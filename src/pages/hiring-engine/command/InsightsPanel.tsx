/**
 * Ranked suggestions with evidence, estimated effect and one action each. Presentational: dismissal lives in the parent (memory only),
 * the action handler receives the pure target. Severity is icon + word; the drive type is its marker shape + name.
 */
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, RotateCcw, X, type LucideIcon } from "lucide-react";
import { useIsDark } from "./chartTheme";
import { ShapeGlyph } from "./charts/TypePatterns";
import type { ActionTarget, InsightCard } from "./insightsPanelModel";
import { panelView } from "./insightsPanelModel";
import type { DriveAnalytics, InsightSeverity } from "./driveCommandTypes";

export const INSIGHTS_HEADING_ID = "insights-heading";

const ICON: Record<InsightSeverity, LucideIcon> = { critical: AlertOctagon, warn: AlertTriangle, info: Info };
const TONE: Record<InsightSeverity, string> = {
  critical: "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-100",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
  info: "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100",
};
const BTN = "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:min-h-8";
const PRIMARY = `${BTN} border-blue-700 bg-blue-700 text-white hover:bg-blue-800 dark:border-blue-400 dark:bg-blue-500 dark:text-slate-950 dark:hover:bg-blue-400`;
const QUIET = `${BTN} border-slate-300 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800`;

function Card({ card, index, dark, onAction, onDismiss }: { card: InsightCard; index: number; dark: boolean; onAction: (t: ActionTarget) => void; onDismiss: (id: string) => void }) {
  const Icon = ICON[card.severity];
  const hid = `insight-${index}-${card.id.split("").map((ch) => (ch.toLowerCase() !== ch.toUpperCase() || (ch >= "0" && ch <= "9") ? ch : "-")).join("")}`;
  return (
    <li className="list-none">
      <article aria-labelledby={hid} data-insight-id={card.id} data-severity={card.severity}
        className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${TONE[card.severity]}`}>
            <Icon className="h-3.5 w-3.5" aria-hidden /> {card.severityLabel}
          </span>
          {card.sourceType && card.typeLabel && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-800 dark:border-slate-600 dark:text-slate-100">
              <ShapeGlyph type={card.sourceType} dark={dark} size={10} /> {card.typeLabel}
            </span>
          )}
        </div>
        <h4 id={hid} className="break-words text-sm font-bold text-slate-900 dark:text-slate-100">{card.title}</h4>
        {card.evidence.length > 0 && (
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 text-xs">
            {card.evidence.map((e, i) => (
              <div key={`${e.label}-${i}`} className="contents">
                <dt className="min-w-0 break-words text-slate-600 dark:text-slate-300">{e.label}</dt>
                <dd className="text-right font-semibold tabular-nums text-slate-900 dark:text-slate-100">{e.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {card.suggestion && <p className="break-words text-sm text-slate-800 dark:text-slate-100">{card.suggestion}</p>}
        {card.effect && <p className="break-words text-sm font-bold text-slate-900 dark:text-slate-100">Estimated effect: {card.effect}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          {card.action && (
            <button type="button" className={PRIMARY} aria-label={card.actionAriaLabel ?? card.action.label} onClick={() => onAction(card.action as ActionTarget)}>
              {card.action.label}
            </button>
          )}
          <button type="button" className={QUIET} aria-label={card.dismissAriaLabel} onClick={() => onDismiss(card.id)}>
            <X className="h-4 w-4" aria-hidden /> Dismiss
          </button>
        </div>
      </article>
    </li>
  );
}

export interface InsightsPanelProps {
  analytics: Pick<DriveAnalytics, "insights" | "partial"> | null;
  dismissed: ReadonlySet<string>;
  onDismiss: (id: string) => void;
  onRestore: () => void;
  onAction: (t: ActionTarget) => void;
  onRetry?: () => void;
}

export default function InsightsPanel({ analytics, dismissed, onDismiss, onRestore, onAction, onRetry }: InsightsPanelProps) {
  const dark = useIsDark();
  const v = panelView(analytics, dismissed);
  const dismissAndKeepFocus = (id: string) => {
    onDismiss(id);
    document.getElementById(INSIGHTS_HEADING_ID)?.focus(); // the card is gone: keep keyboard focus inside the panel
  };
  return (
    <section aria-labelledby={INSIGHTS_HEADING_ID} className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700" style={{ minHeight: 120 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 id={INSIGHTS_HEADING_ID} tabIndex={-1} className="text-base font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-100">Insights</h3>
          <p className="text-xs text-slate-700 dark:text-slate-200" data-testid="insights-counts">{v.heading}: {v.countsText}</p>
        </div>
        {v.dismissedCount > 0 && (
          <button type="button" className={QUIET} onClick={onRestore} aria-label={`Show ${v.dismissedCount} dismissed suggestions again`}>
            <RotateCcw className="h-4 w-4" aria-hidden /> {v.dismissedCount} dismissed, show again
          </button>
        )}
      </div>
      {v.message && (
        <p role={v.state === "unavailable" ? "alert" : "status"} className="flex flex-wrap items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
          {v.state === "empty" ? <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> : <Info className="h-4 w-4 shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1">{v.message}</span>
          {(v.state === "unavailable" || v.incomplete) && onRetry && <button type="button" className={QUIET} onClick={onRetry}>Retry</button>}
        </p>
      )}
      {v.cards.length > 0 && (
        <ul className="grid gap-3 lg:grid-cols-2" aria-label="Suggestions, most urgent first">
          {v.cards.map((c, i) => <Card key={c.id} card={c} index={i} dark={dark} onAction={onAction} onDismiss={dismissAndKeepFocus} />)}
        </ul>
      )}
    </section>
  );
}
