import { useId, useState, type ReactNode } from "react";
import { Inbox, type LucideIcon } from "lucide-react";
import type { SectionResult } from "../../../../../../backend/src/modules/branch-head-health/types";
import type { TableSpec } from "../viz";
import { SectionError } from "../SectionPanels";
import { SpecTable } from "./NavyTable";
import "./look.css";

/** Accent colours for the stripe and dot (series hues, not status). */
export const ACCENTS = {
  blue: "linear-gradient(180deg, #2f6fed, #10b8d4)", emerald: "linear-gradient(180deg, #047857, #10b981)",
  violet: "linear-gradient(180deg, #6d28d9, #8b5cf6)", orange: "linear-gradient(180deg, #c2410c, #f59e0b)",
  rose: "linear-gradient(180deg, #be123c, #f43f5e)", cyan: "linear-gradient(180deg, #0e7490, #22d3ee)",
} as const;
export type Accent = keyof typeof ACCENTS;

export interface AccentCardProps {
  title: string;
  /** Count chip on the right ("12 days", "10 agents"). */
  chip?: ReactNode;
  accent?: Accent;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** White card with a left accent stripe, coloured dot + title and a count chip (Process Operations Panel look). */
export function AccentCard({ title, chip, accent = "blue", actions, className = "", children }: AccentCardProps) {
  const id = useId();
  return (
    <section className={`bhl-card ${className}`} aria-labelledby={id} style={{ ["--bhl-accent" as string]: ACCENTS[accent] }}>
      <div className="bhl-card-head">
        <h3 id={id} className="bhl-card-title"><span className="bhl-dot" aria-hidden="true" />{title}</h3>
        {chip != null || actions ? <div className="bhl-card-actions">{chip != null ? <span className="bhl-count">{chip}</span> : null}{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A chart card with its "View as table" twin (the same TableSpec the chart is built from). */
export function ChartCard({ table, defaultShowTable = false, children, ...card }: Omit<AccentCardProps, "actions"> & { table: TableSpec; defaultShowTable?: boolean }) {
  const [showTable, setShowTable] = useState(defaultShowTable);
  return (
    <AccentCard {...card} actions={
      <button type="button" className="bhl-toggle" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>View as table</button>
    }>
      {showTable ? <SpecTable table={table} /> : children}
    </AccentCard>
  );
}

/** Honest empty state: icon + one line, never a blank card. */
export function EmptyLine({ text, icon: Icon = Inbox }: { text: string; icon?: LucideIcon }) {
  return <p className="bhl-empty"><Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{text}</p>;
}

/**
 * ok/empty/error handling for one payload section without wrapping the content in a card:
 * error and empty become one accent card with the message; ok runs the body (its own cards).
 */
export function SectionGate<T>({ title, section, emptyText, errorName, accent, children }: {
  title: string; section: SectionResult<unknown> | undefined; emptyText: string; errorName?: string; accent?: Accent;
  children: (data: T, asOf: string) => ReactNode;
}) {
  if (!section) return <AccentCard title={title} accent={accent}><EmptyLine text="Not available yet" /></AccentCard>;
  if (section.status === "error") return <AccentCard title={title} accent={accent}><SectionError name={errorName ?? title} message={section.message} /></AccentCard>;
  if (section.status !== "ok" || section.data == null) return <AccentCard title={title} accent={accent}><EmptyLine text={section.message ?? emptyText} /></AccentCard>;
  return <>{children(section.data as T, section.asOf)}</>;
}

/** Secondary pill tabs under the hero (toggle buttons; the hero holds the page tablist). */
export function SubTabs({ label, items, value, onChange }: { label: string; items: Array<{ id: string; label: string }>; value: string; onChange: (id: string) => void }) {
  return (
    <div role="group" aria-label={label} className="bhl-subtabs">
      {items.map((it) => (
        <button key={it.id} type="button" className="bhl-sub" aria-pressed={it.id === value} onClick={() => onChange(it.id)}>{it.label}</button>
      ))}
    </div>
  );
}
