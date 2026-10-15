import { AlertCircle, Inbox } from "lucide-react";
import { Panel } from "../../kit";
import type { LeaderboardRow, SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";

function humanize(k: string): string {
  let out = "";
  for (const ch of k) {
    const upper = ch >= "A" && ch <= "Z";
    if (ch === "_") out += " ";
    else out += upper && out.length > 0 ? ` ${ch}` : ch;
  }
  return out.length > 0 ? out[0].toUpperCase() + out.slice(1) : out;
}
function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toFixed(1);
  return String(v);
}

function scalarEntries(data: unknown): Array<[string, unknown]> {
  if (data == null || typeof data !== "object") return [];
  return Object.entries(data as Record<string, unknown>).filter(([, v]) => typeof v !== "object" || v === null);
}

export function SectionError({ name, message }: { name: string; message?: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-[13px] text-rose-900">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span><strong>{name} could not be loaded.</strong> {message ?? "Try again shortly."}</span>
    </div>
  );
}

/** One section: ok -> labelled values (a definition list is its own table alternative); empty/error -> honest state. */
export function SectionPanel({ title, section }: { title: string; section: SectionResult<unknown> }) {
  let body;
  if (section.status === "error") body = <SectionError name={title} message={section.message} />;
  else if (section.status === "empty" || section.data == null || scalarEntries(section.data).length === 0) {
    body = <p className="flex items-center gap-2 text-[13px] text-slate-700"><Inbox className="h-4 w-4" aria-hidden="true" />{section.message ?? "No data for this date"}</p>;
  } else {
    const entries = scalarEntries(section.data);
    body = (
      <dl className="grid grid-cols-2 gap-3">
        {entries.map(([k, v]) => (
          <div key={k} className="min-h-[44px]">
            <dt className="text-[12px] text-slate-700">{humanize(k)}</dt>
            <dd className="text-[18px] font-bold text-slate-900">{fmt(v)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <Panel title={title} subtitle={section.status === "ok" ? `As of ${section.asOf}` : undefined}>{body}</Panel>;
}

/** Managers are shown as ranked "Team n" labels only; real names stay behind the process drill-down. */
export function LeaderboardPanel({ section }: { section: SectionResult<LeaderboardRow[]> }) {
  if (section.status !== "ok" || !section.data?.length) return <SectionPanel title="Late arrivals by team" section={section as SectionResult<unknown>} />;
  return (
    <Panel title="Late arrivals by team" subtitle={`As of ${section.asOf}`}>
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">Late arrivals by team, highest first</caption>
        <thead><tr className="text-slate-700"><th className="py-1 pr-2">Team</th><th className="py-1 text-right">Late</th></tr></thead>
        <tbody>
          {section.data.slice(0, 10).map((r, i) => (
            <tr key={i} className="border-t border-slate-100"><td className="min-h-[44px] py-2 pr-2">Team {i + 1}</td><td className="py-2 text-right font-semibold">{r.late}</td></tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
