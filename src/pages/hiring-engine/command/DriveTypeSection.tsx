/** Rows of one drive type (or all types in compact mode), 25 at a time with "Show more", and the per-type empty state. */
import { useState } from "react";
import { Inbox } from "lucide-react";
import DriveGroupRow from "./DriveGroupRow";
import { PAGE_SIZE, SECTION_EMPTY, groupKey, groupsForSection, page } from "./driveGroupModel";
import type { DriveGroup, SourceType } from "./driveCommandTypes";

const MORE = "inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-100 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 sm:min-h-8";

export function EmptyRows({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 px-4 text-center dark:border-slate-600" style={{ minHeight: 120 }}>
      <Inbox className="h-5 w-5 text-slate-500 dark:text-slate-400" aria-hidden />
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{text}</p>
    </div>
  );
}

/** Already sorted groups as rows; `pages` is how many 25-row pages are showing. */
export function GroupList({ groups, today, compact, emptyText, shownPages = 1 }: { groups: DriveGroup[]; today: string; compact?: boolean; emptyText: string; shownPages?: number }) {
  const [pages, setPages] = useState(Math.max(1, shownPages));
  if (groups.length === 0) return <EmptyRows text={emptyText} />;
  const total = page(groups, 0).pages;
  const visible = groups.slice(0, pages * PAGE_SIZE);
  return (
    <div className="space-y-2">
      <ul className="space-y-2">{visible.map((g) => <DriveGroupRow key={groupKey(g)} group={g} today={today} compact={compact} />)}</ul>
      {pages < total && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setPages((p) => p + 1)} className={MORE}>Show more</button>
          <span className="text-xs text-slate-600 dark:text-slate-300">Showing {visible.length} of {groups.length}</span>
        </div>
      )}
    </div>
  );
}

export default function DriveTypeSection({ type, groups, today, title }: { type: SourceType; groups: DriveGroup[]; today: string; title: string }) {
  const mine = groupsForSection(groups, type);
  return (
    <section aria-label={title} className="space-y-2">
      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h3>
      <GroupList groups={mine} today={today} emptyText={SECTION_EMPTY[type]} />
    </section>
  );
}
