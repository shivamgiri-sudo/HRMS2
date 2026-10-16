import { useState } from "react";
import { AlertOctagon, AlertTriangle, ThumbsUp } from "lucide-react";
import type { BranchOverview } from "../../../../../backend/src/modules/branch-head-health/types";
import { DrillDrawer } from "./viz";

type Item = BranchOverview["attention"][number];
type Win = BranchOverview["positives"][number];

export const MAX_CHIPS = 5;
const RANK = { critical: 0, warning: 1 } as const;
const SEVERITY = {
  critical: { word: "Critical", Icon: AlertOctagon, cls: "border-rose-300 bg-rose-50 text-rose-950", icon: "text-rose-700" },
  warning: { word: "Warning", Icon: AlertTriangle, cls: "border-amber-300 bg-amber-50 text-amber-950", icon: "text-amber-700" },
} as const;

const isDigit = (ch: string | undefined) => ch != null && ch >= "0" && ch <= "9";

/**
 * The count shown on a chip: the number the detail STARTS with ("40 employees...", "20% absent...",
 * "₹1,20,000 over budget"), kept with its % or rupee sign. None when the label already carries a
 * number ("29 GRNs pending more than 3 days") or the detail does not open with one, so a later number
 * in the sentence ("oldest is 60 days old") is never shown as the count. Scans characters: no regex.
 */
export function chipCount(detail: string, label = ""): string | null {
  if ([...String(label ?? "")].some((ch) => isDigit(ch))) return null;
  const s = String(detail ?? "").trimStart();
  const start = s[0] === "₹" ? 1 : 0;
  if (!isDigit(s[start])) return null;
  let j = start;
  while (j < s.length && (isDigit(s[j]) || ((s[j] === "," || s[j] === ".") && isDigit(s[j + 1])))) j += 1;
  return s.slice(0, j) + (s[j] === "%" ? "%" : "");
}

/** Critical first, then warning; payload order kept within a severity. Ids are the payload index. */
export function sortAttention(items: Item[]): Array<{ id: string; item: Item }> {
  return items
    .map((item, i) => ({ id: `attention-${i}`, item, i }))
    .sort((a, b) => (RANK[a.item.severity] ?? 1) - (RANK[b.item.severity] ?? 1) || a.i - b.i)
    .map(({ id, item }) => ({ id, item }));
}

function SeverityIcon({ severity }: { severity: Item["severity"] }) {
  const s = SEVERITY[severity] ?? SEVERITY.warning;
  return <s.Icon className={`h-4 w-4 shrink-0 ${s.icon}`} aria-hidden="true" />;
}

/** Full list with detail text, shown in the drawer. */
export function AttentionItems({ items }: { items: Array<{ id: string; item: Item }> }) {
  return (
    <ul className="space-y-2" aria-label="Needs attention">
      {items.map(({ id, item }) => (
        <li key={id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2.5">
          <span className="mt-0.5"><SeverityIcon severity={item.severity} /></span>
          <span className="min-w-0 text-[13px]">
            <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-700">{(SEVERITY[item.severity] ?? SEVERITY.warning).word}</span>
            <strong className="block text-slate-900">{item.label}</strong>
            <span className="block text-slate-700">{item.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface AttentionBoardProps {
  items: Item[];
  positives: Win[];
  /** Optional extra hook per chip click; the chip always opens this board's drawer itself. */
  onOpenItem?: (id: string) => void;
  /** Controlled drawer (the hero's "needs attention" button opens it too); uncontrolled when omitted. */
  drawerOpen?: boolean;
  onDrawerChange?: (open: boolean) => void;
  /** Render the drawer in place (static-markup tests only). */
  inlineDrawer?: boolean;
}

/**
 * Up to five severity chips (icon + severity word + short label + count), critical first; the full
 * list with details lives in a drawer behind "+N more" (or any chip). Wins are collapsed by default.
 */
export function AttentionBoard({ items, positives, onOpenItem, drawerOpen, onDrawerChange, inlineDrawer = false }: AttentionBoardProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = drawerOpen ?? ownOpen;
  const setOpen = (v: boolean) => { if (onDrawerChange) onDrawerChange(v); else setOwnOpen(v); };
  const sorted = sortAttention(items);
  const chips = sorted.slice(0, MAX_CHIPS);
  const more = sorted.length - chips.length;

  if (items.length === 0 && positives.length === 0) {
    return <p className="text-[13px] text-slate-700">Nothing needs attention right now.</p>;
  }
  return (
    <div className="space-y-3">
      {items.length === 0 ? <p className="text-[13px] text-slate-700">Nothing needs attention.</p> : (
        <ul className="flex list-none flex-wrap gap-2 p-0" aria-label="Needs attention, most severe first">
          {chips.map(({ id, item }) => {
            const s = SEVERITY[item.severity] ?? SEVERITY.warning;
            const count = chipCount(item.detail, item.label);
            return (
              <li key={id} className="min-w-0 max-w-full">
                <button type="button" data-chip={item.severity} onClick={() => { onOpenItem?.(id); setOpen(true); }}
                  className={`inline-flex min-h-[44px] max-w-full items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${s.cls}`}>
                  <SeverityIcon severity={item.severity} />
                  <span className="sr-only">{s.word}: </span>
                  <span className="truncate">{item.label}</span>
                  {count ? <span className="rounded-full bg-white/80 px-1.5 text-[12px] font-bold tabular-nums">{count}</span> : null}
                </button>
              </li>
            );
          })}
          {more > 0 ? (
            <li>
              <button type="button" onClick={() => setOpen(true)}
                className="inline-flex min-h-[44px] items-center rounded-full border border-slate-300 px-3 text-[13px] font-semibold text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                +{more} more
              </button>
            </li>
          ) : null}
        </ul>
      )}
      {positives.length > 0 ? (
        <details data-group="wins" className="rounded-lg border border-slate-200">
          <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 px-3 text-[13px] font-bold text-slate-900">
            <ThumbsUp className="h-4 w-4 text-emerald-700" aria-hidden="true" />Going well ({positives.length})
          </summary>
          <ul className="space-y-1 px-3 pb-3" aria-label="Going well">
            {positives.map((p, i) => (
              <li key={`${p.label}-${i}`} className="text-[13px] text-slate-900"><strong>{p.label}</strong> <span className="text-slate-700">{p.detail}</span></li>
            ))}
          </ul>
        </details>
      ) : null}
      <DrillDrawer open={open} onClose={() => setOpen(false)} title={`Needs attention (${items.length})`}
        subtitle="Most severe first" inline={inlineDrawer}>
        <AttentionItems items={sorted} />
      </DrillDrawer>
    </div>
  );
}
