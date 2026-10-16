import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Inbox } from "lucide-react";
import type { DrillTarget } from "../drill";
import { SectionError } from "../SectionPanels";
import { linksFor } from "./links";

/** A titled block inside a drawer. */
export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[14px] font-bold text-slate-900">{title}</h3>
      {children}
    </section>
  );
}

/** The honest empty line a drawer block shows when its section has nothing for this view. */
export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="flex items-center gap-2 text-[13px] text-slate-700"><Inbox className="h-4 w-4 shrink-0" aria-hidden="true" />{children}</p>;
}

/** ok -> body; error -> inline error naming the section; empty or missing -> the empty line. */
export function SectionGate<T>({ name, section, empty, children }: {
  name: string; section: { status: string; data: unknown; message?: string } | undefined; empty: string; children: (data: T) => ReactNode;
}) {
  if (section?.status === "error") return <SectionError name={name} message={section.message} />;
  if (!section || section.status !== "ok" || section.data == null) return <EmptyLine>{empty}</EmptyLine>;
  return <>{children(section.data as T)}</>;
}

/** Related pages for the view: ordinary in-app links (same tab), text label always shown. */
export function DrillLinks({ target }: { target: DrillTarget }) {
  const links = linksFor(target);
  if (links.length === 0) return null;
  return (
    <nav aria-label="Related pages" className="border-t border-slate-200 pt-3">
      <ul className="flex list-none flex-wrap gap-2 p-0">
        {links.map((l) => (
          <li key={l.href}>
            <Link to={l.href} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-[13px] font-semibold text-blue-900 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              {l.label}<ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
