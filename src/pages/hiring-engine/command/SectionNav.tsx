/** Sub-navigation of the Drive Command Center: a real tablist with roving tabindex. Arrow keys, Home and End move focus and select. */
import { SECTIONS, nextSectionByKey, type SectionId } from "./driveCommandModel";
import type { SourceType } from "./driveCommandTypes";

export const PANEL_ID = "drive-section-panel";
export const tabDomId = (id: SectionId): string => `drive-tab-${id}`;

export default function SectionNav({ current, onSelect, sections = SECTIONS }: { current: SectionId; onSelect: (s: SectionId) => void; sections?: ReadonlyArray<{ id: SectionId; label: string; sourceType: SourceType | null }> }) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // keep browser back/forward and shortcuts
    const next = nextSectionByKey(current, e.key, sections);
    if (!next) return;
    e.preventDefault();
    onSelect(next);
    document.getElementById(tabDomId(next))?.focus();
  };
  return (
    <div role="tablist" aria-label="Drive command sections" onKeyDown={onKeyDown}
      style={{ top: "var(--topbar-height, 64px)" }} // pins under the app TopBar (sticky z-30, min height 64px, TopBar.tsx)
      className="sticky z-20 flex gap-1 overflow-x-auto border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      {sections.map((s) => {
        const on = s.id === current;
        return (
          <button key={s.id} id={tabDomId(s.id)} type="button" role="tab" aria-selected={on} aria-controls={PANEL_ID} tabIndex={on ? 0 : -1} onClick={() => onSelect(s.id)}
            className={`-mb-px min-h-11 shrink-0 cursor-pointer whitespace-nowrap border-b-2 px-4 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${on ? "border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300" : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"}`}>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
