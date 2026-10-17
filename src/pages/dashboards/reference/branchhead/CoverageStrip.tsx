import { ChevronRight } from "lucide-react";
import { AccentCard } from "./look";

export interface ReportSection { n: number; title: string; tab: string; sub?: string; where: string }

/** The emailed Branch Health report's 11 sections (template.ts order) and where each lives on this page. */
export const REPORT_SECTIONS: ReportSection[] = [
  { n: 1, title: "Budget vs consumption", tab: "finance", sub: "budget", where: "Finance · Budget" },
  { n: 2, title: "GRN summary", tab: "finance", sub: "grn", where: "Finance · GRNs" },
  { n: 3, title: "Recent GRNs (latest 15)", tab: "finance", sub: "recent", where: "Finance · Recent GRNs" },
  { n: 4, title: "ATS today", tab: "hiring", where: "Hiring" },
  { n: 5, title: "Attendance and late arrivals", tab: "attendance", where: "Attendance" },
  { n: 6, title: "Headcount and pending actions", tab: "people", where: "People" },
  { n: 7, title: "Offer-to-join and consecutive absence", tab: "people", where: "People" },
  { n: 8, title: "Open hiring batches", tab: "hiring", where: "Hiring" },
  { n: 9, title: "Running P&L", tab: "finance", sub: "pnl", where: "Finance · Running P&L" },
  { n: 10, title: "Attrition and retention risk", tab: "attrition", where: "Attrition" },
  { n: 11, title: "Critical points and achievements", tab: "overview", where: "Overview · Attention" },
];

/** Compact strip linking every emailed-report section to its tab, so the owner can see nothing is missing. */
export function CoverageStrip({ onGo }: { onGo: (tab: string, sub?: string) => void }) {
  return (
    <AccentCard title="Report coverage" chip="11 of 11 email sections" accent="cyan">
      <ul aria-label="Emailed report sections on this page" className="bhl-cover">
        {REPORT_SECTIONS.map((s) => (
          <li key={s.n}>
            <button type="button" className="bhl-cover-btn" onClick={() => onGo(s.tab, s.sub)}>
              <span className="bhl-cover-n" aria-hidden="true">{s.n}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-bold leading-snug">{s.title}</span>
                <span className="block text-[11px] text-slate-700">{s.where}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-700" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </AccentCard>
  );
}
