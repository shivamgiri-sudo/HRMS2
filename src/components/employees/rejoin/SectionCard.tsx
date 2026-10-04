import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TONE_CLASS } from "./rejoinReviewFormat";
import type { SectionResult, Tone } from "./rejoinTypes";

/**
 * One dossier section. The backend settles each section on its own, so a failed query arrives as
 * `{status:'error'}` next to sections that loaded: show a compact inline error for that card only and
 * nothing else from it. `isEmpty` decides when loaded data still has nothing to show.
 */
export function SectionCard<T>({
  id,
  title,
  icon: Icon,
  result,
  isEmpty,
  emptyText = "No data for this period.",
  description,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  result: SectionResult<T>;
  isEmpty?: (data: T) => boolean;
  emptyText?: string;
  description?: string;
  children: (data: T) => ReactNode;
}) {
  const headingId = `rejoin-${id}-title`;
  let body: ReactNode;
  if (result.status === "error") {
    body = (
      <p role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">
          <span className="font-semibold">Could not load {title.toLowerCase()}.</span> {result.error}
        </span>
      </p>
    );
  } else if (result.data === null || result.data === undefined || (isEmpty && isEmpty(result.data))) {
    body = <NoData text={emptyText} />;
  } else {
    body = children(result.data);
  }

  return (
    <Card role="region" aria-labelledby={headingId} className="min-w-0">
      <CardHeader className="space-y-1 p-4 pb-2 sm:p-5 sm:pb-2">
        <CardTitle id={headingId} className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          {title}
        </CardTitle>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-2 sm:p-5 sm:pt-2">{body}</CardContent>
    </Card>
  );
}

export function NoData({ text = "No data." }: { text?: string }) {
  return <p className="text-xs italic text-muted-foreground">{text}</p>;
}

/** Small labelled figure. `tone` adds colour AND an icon so the meaning survives without colour. */
export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone | "warn" }) {
  const ToneIcon = tone === "good" ? CheckCircle2 : tone === "bad" ? XCircle : tone === "warn" ? AlertTriangle : null;
  return (
    <div className={cn("min-w-0 rounded-lg border px-3 py-2.5", tone ? TONE_CLASS[tone] : "border-border bg-muted/40")}>
      <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 flex items-center gap-1 text-lg font-semibold tabular-nums leading-tight">
        {ToneIcon && <ToneIcon className="h-4 w-4 shrink-0" aria-hidden />}
        <span className="truncate">{value}</span>
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A pill with text (and optional icon); colour is decoration on top of the words. */
export function Chip({ tone = "neutral", icon: Icon, children, className }: { tone?: Tone | "warn"; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", TONE_CLASS[tone], className)}>
      {Icon && <Icon className="h-3 w-3 shrink-0" aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Label / value row for definition-style facts. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/60 py-1.5 text-sm last:border-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{children}</dd>
    </div>
  );
}

/**
 * The chart's numbers for screen readers; the chart itself is aria-hidden behind a summary label.
 * `sr-only` sits on a wrapping div, not the table: a table cannot be narrower than its content, so a
 * 1px sr-only table still laid out ~580px wide and gave the page a horizontal scroll at 390px.
 */
export function ChartTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((v, j) => (j === 0 ? <th key={j} scope="row">{v}</th> : <td key={j}>{v}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
