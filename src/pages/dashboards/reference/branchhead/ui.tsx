import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Panel } from "../../kit";
import type { SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";
import { SectionError } from "./SectionPanels";

export interface Col { label: string; right?: boolean }

/** Table with a visually hidden caption, scoped headers and horizontal scroll inside its own container only. */
export function Table({ caption, cols, children, foot, minWidth = 480 }: { caption: string; cols: Col[]; children: ReactNode; foot?: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[13px]" style={{ minWidth }}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-slate-700">
            {cols.map((c) => <th key={c.label} scope="col" className={`py-1 pr-3 font-semibold ${c.right ? "text-right" : ""}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
        {foot ? <tfoot>{foot}</tfoot> : null}
      </table>
    </div>
  );
}

export const Td = ({ children, right, strong }: { children: ReactNode; right?: boolean; strong?: boolean }) => (
  <td className={`border-t border-slate-100 py-2 pr-3 ${right ? "text-right tabular-nums" : ""} ${strong ? "font-semibold text-slate-900" : ""}`}>{children}</td>
);

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-h-[44px]">
      <dt className="text-[12px] text-slate-700">{label}</dt>
      <dd className="text-[18px] font-bold tabular-nums text-slate-900">{value}</dd>
      {hint ? <dd className="text-[12px] text-slate-700">{hint}</dd> : null}
    </div>
  );
}

export const Stats = ({ children, label }: { children: ReactNode; label: string }) => (
  <dl aria-label={label} className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{children}</dl>
);

export const SubHead = ({ children }: { children: ReactNode }) => <h3 className="mb-1 mt-4 text-[13px] font-bold text-slate-900">{children}</h3>;

export const Note = ({ children }: { children: ReactNode }) => <p className="mt-2 text-[12px] text-slate-700">{children}</p>;

/** Shared ok/empty/error handling for one section; the body only runs for status ok with data. */
export function SectionShell<T>({ title, subtitle, section, emptyText, errorName, children }: {
  title: string; subtitle?: ReactNode; section: SectionResult<unknown> | undefined; emptyText: string; errorName?: string; children: (data: T) => ReactNode;
}) {
  if (!section) return <Panel title={title}><p className="flex items-center gap-2 text-[13px] text-slate-700"><Inbox className="h-4 w-4" aria-hidden="true" />Not available yet</p></Panel>;
  let body: ReactNode;
  if (section.status === "error") body = <SectionError name={errorName ?? title} message={section.message} />;
  else if (section.status !== "ok" || section.data == null) {
    body = <p className="flex items-center gap-2 text-[13px] text-slate-700"><Inbox className="h-4 w-4" aria-hidden="true" />{section.message ?? emptyText}</p>;
  } else body = children(section.data as T);
  return <Panel title={title} subtitle={subtitle ?? (section.status === "ok" ? `As of ${section.asOf}` : undefined)}>{body}</Panel>;
}
