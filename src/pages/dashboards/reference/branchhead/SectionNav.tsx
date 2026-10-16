import { useEffect, useState } from "react";

export interface NavSection { id: string; label: string }

/** Anchor ids on the layout's section wrappers, in the same order the sections appear on the page. */
export const BH_SECTIONS: NavSection[] = [
  { id: "bh-overview", label: "Overview" },
  { id: "bh-people", label: "People" },
  { id: "bh-attendance", label: "Attendance" },
  { id: "bh-attrition", label: "Attrition" },
  { id: "bh-finance", label: "Finance" },
  { id: "bh-pnl", label: "P&L" },
  { id: "bh-hiring", label: "Hiring" },
  { id: "bh-backlog", label: "Backlogs" },
  { id: "bh-ops", label: "Operations" },
];

/** Class for anchor targets so a jump lands below the sticky TopBar (64px) and this bar (~52px). */
export const ANCHOR_OFFSET_CLASS = "scroll-mt-[128px]";

/**
 * Active section = the visible one nearest the top of the viewport (smallest top offset); equal
 * offsets resolve to the earlier id, and `ids` is in document order, so ties follow the page.
 * With nothing visible keep the current one so the highlight never flickers to empty.
 */
export function pickActive(ids: string[], visibleTops: Map<string, number>, current: string): string {
  let best: string | null = null;
  let bestTop = Number.POSITIVE_INFINITY;
  for (const id of ids) {
    const top = visibleTops.get(id);
    if (top != null && top < bestTop) { best = id; bestTop = top; }
  }
  return best ?? current;
}

/**
 * Sticky in-page anchor bar under the app TopBar (sticky z-30, --topbar-height). The host page's tab
 * bar is not sticky, so the TopBar is the only thing above it. aria-current follows scroll via an
 * IntersectionObserver when the browser has one; without it (static markup, old browsers) the first
 * link stays current and the anchors still work.
 */
export function SectionNav({ sections }: { sections: NavSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const key = sections.map((s) => s.id).join("|");

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined" || !("IntersectionObserver" in window)) return undefined;
    const ids = key ? key.split("|") : [];
    const tops = new Map<string, number>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) tops.set(e.target.id, e.boundingClientRect.top);
        else tops.delete(e.target.id);
      }
      setActive((cur) => pickActive(ids, tops, cur));
    }, { rootMargin: "-128px 0px -55% 0px", threshold: 0 });
    ids.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [key]);

  if (sections.length === 0) return null;
  return (
    <nav aria-label="Page sections" style={{ top: "var(--topbar-height, 64px)" }}
      className="sticky z-20 -mx-1 overflow-x-auto overflow-y-hidden border-b border-slate-200 bg-white/95 px-1 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95">
      <ul className="flex list-none gap-1 p-0">
        {sections.map((s) => {
          const on = s.id === active;
          return (
            <li key={s.id} className="shrink-0">
              <a href={`#${s.id}`} aria-current={on ? "location" : undefined} onClick={() => setActive(s.id)}
                className={`-mb-px inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-3 text-[13px] font-semibold transition-colors duration-150 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${on ? "border-blue-600 text-blue-800 dark:border-blue-400 dark:text-blue-300" : "border-transparent text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"}`}>
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
