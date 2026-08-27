import { memo, useState } from "react";
import { ChevronDown, ChevronRight, Building2, CameraOff, AlertTriangle, MapPin } from "lucide-react";
import { normalizeMediaUrl } from "@/lib/mediaUrl";
import type { OrgTreeNode } from "@/types/orgChart";

/**
 * How many direct reports render inline before the rest collapse behind a "show all" chip.
 *
 * One manager in the live data has 129 direct reports. Rendering that as a single row makes
 * the row ~28,000px wide, which is the main reason the chart reads as unusable however far
 * you zoom out. Beyond this cap the overflow is hidden until asked for.
 */
const INLINE_CHILD_LIMIT = 12;

/** Card accent by depth, using the existing MCN palette. */
const LEVEL = [
  { bar: "bg-gradient-to-r from-amber-400 to-orange-500", ring: "ring-amber-200", avatar: "from-amber-400 to-orange-500", pill: "bg-amber-50 text-amber-700 border-amber-200" },
  { bar: "bg-gradient-to-r from-[#1B3A5C] to-[#2d5a8a]", ring: "ring-blue-200", avatar: "from-[#1B3A5C] to-[#2d5a8a]", pill: "bg-blue-50 text-[#1B3A5C] border-blue-200" },
  { bar: "bg-gradient-to-r from-[#4CAF50] to-emerald-600", ring: "ring-emerald-200", avatar: "from-[#4CAF50] to-emerald-600", pill: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { bar: "bg-gradient-to-r from-violet-400 to-violet-600", ring: "ring-violet-200", avatar: "from-violet-400 to-violet-600", pill: "bg-violet-50 text-violet-700 border-violet-200" },
  { bar: "bg-gradient-to-r from-slate-300 to-slate-400", ring: "ring-slate-200", avatar: "from-slate-400 to-slate-500", pill: "bg-slate-50 text-slate-600 border-slate-200" },
];

const levelOf = (depth: number) => LEVEL[Math.min(depth, LEVEL.length - 1)];

function initialsOf(name: string): string {
  return name.split(" ").filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export interface OrgChartNodeProps {
  node: OrgTreeNode;
  depth?: number;
  selfEmployeeId?: string | null;
  /** Ids whose children are shown. Held by the page so "jump to person" can open a whole path. */
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  /** Ids matching the current search — matches stay lit, everything else dims. */
  matchIds: Set<string> | null;
  onSelect?: (node: OrgTreeNode) => void;
  /** Set on the viewer's own card so the page can scroll it into view. */
  selfRef?: (el: HTMLDivElement | null) => void;
}

export const OrgChartNodeCard = memo(function OrgChartNodeCard({
  node,
  depth = 0,
  selfEmployeeId,
  expandedIds,
  onToggle,
  matchIds,
  onSelect,
  selfRef,
}: OrgChartNodeProps) {
  const [showAllChildren, setShowAllChildren] = useState(false);

  const style = levelOf(depth);
  const isMe = !!selfEmployeeId && node.id === selfEmployeeId;
  const hasChildren = node.children.length > 0;
  const expanded = expandedIds.has(node.id);
  const photoUrl = normalizeMediaUrl(node.avatar_url ?? undefined);
  const dimmed = !!matchIds && !matchIds.has(node.id);

  const visibleChildren = showAllChildren
    ? node.children
    : node.children.slice(0, INLINE_CHILD_LIMIT);
  const hiddenCount = node.children.length - visibleChildren.length;

  return (
    <div className="flex flex-col items-center">
      <div
        ref={isMe ? selfRef : undefined}
        data-node-id={node.id}
        onClick={() => onSelect?.(node)}
        className={[
          "relative w-[216px] shrink-0 rounded-2xl bg-white overflow-hidden select-none",
          "border transition-[box-shadow,transform,opacity] duration-200",
          "shadow-[0_1px_3px_rgba(15,23,42,0.06),0_8px_24px_-12px_rgba(15,23,42,0.18)]",
          "hover:shadow-[0_2px_6px_rgba(15,23,42,0.08),0_16px_40px_-16px_rgba(15,23,42,0.28)]",
          "hover:-translate-y-0.5",
          onSelect ? "cursor-pointer" : "",
          isMe
            ? "border-[#1B3A5C] ring-2 ring-[#1B3A5C]/25 ring-offset-2 ring-offset-slate-50"
            : "border-slate-200/80",
          dimmed ? "opacity-25" : "opacity-100",
        ].join(" ")}
      >
        <div className={`h-1.5 w-full ${style.bar}`} />

        {isMe && (
          <span className="absolute right-2.5 top-3.5 rounded-full bg-[#1B3A5C] px-2 py-[3px] text-[9px] font-bold uppercase tracking-wide text-white shadow-sm">
            You
          </span>
        )}

        <div className="flex flex-col items-center gap-2 px-4 pb-3.5 pt-4 text-center">
          <div className="relative">
            <div
              className={[
                "h-14 w-14 overflow-hidden rounded-full ring-4 ring-offset-0",
                isMe ? "ring-[#1B3A5C]/20" : style.ring,
              ].join(" ")}
            >
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={node.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  draggable={false}
                />
              ) : (
                <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${style.avatar}`}>
                  <span className="text-base font-bold text-white">{initialsOf(node.name)}</span>
                </div>
              )}
            </div>
            {/* Photo is mandatory on the card but only 22 of 1,090 active employees have one on
                file. Rather than let an initials circle pass as a photo, mark the gap so it can
                be chased. */}
            {!photoUrl && (
              <span
                className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-slate-200"
                title="No photo on file"
              >
                <CameraOff className="h-2.5 w-2.5 text-slate-500" />
              </span>
            )}
          </div>

          <div className="w-full">
            <p className="truncate text-[13px] font-bold leading-tight text-slate-900" title={node.name}>
              {node.name}
            </p>

            {node.designation ? (
              <p
                className="mt-0.5 truncate text-[11px] font-medium leading-tight text-slate-500"
                title={node.designation}
              >
                {node.designation}
              </p>
            ) : (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-[2px] text-[9px] font-semibold text-amber-700">
                <AlertTriangle className="h-2.5 w-2.5" />
                Designation not set
              </span>
            )}

            <p
              className="mt-1 flex items-center justify-center gap-1 truncate text-[10px] text-slate-400"
              title={node.department_name ?? "No department"}
            >
              <Building2 className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{node.department_name || "No department"}</span>
            </p>
          </div>

          {(node.process_name || node.branch_name) && (
            <div className="flex w-full flex-wrap items-center justify-center gap-1">
              {node.process_name && (
                <span
                  className={`max-w-[110px] truncate rounded-full border px-2 py-[2px] text-[9px] font-semibold ${style.pill}`}
                  title={node.process_name}
                >
                  {node.process_name}
                </span>
              )}
              {node.branch_name && (
                <span
                  className="inline-flex max-w-[95px] items-center gap-0.5 truncate rounded-full bg-slate-100 px-2 py-[2px] text-[9px] font-medium text-slate-500"
                  title={node.branch_name}
                >
                  <MapPin className="h-2 w-2 shrink-0" />
                  <span className="truncate">{node.branch_name}</span>
                </span>
              )}
            </div>
          )}

          {hasChildren && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(node.id);
              }}
              className={[
                "mt-0.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors",
                expanded
                  ? "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100"
                  : "border-[#1B3A5C]/20 bg-[#1B3A5C]/5 text-[#1B3A5C] hover:bg-[#1B3A5C]/10",
              ].join(" ")}
              title={expanded ? "Collapse this team" : "Expand this team"}
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {node.children.length} direct
              {(node.total_reports ?? 0) > node.children.length && (
                <span className="text-slate-400">· {node.total_reports} total</span>
              )}
            </button>
          )}
        </div>
      </div>

      {hasChildren && expanded && (
        <div className="flex flex-col items-center">
          <div className="h-7 w-px bg-slate-300" />

          <div className="relative flex items-start">
            {visibleChildren.length > 1 && (
              <div
                className="absolute top-0 h-px bg-slate-300"
                style={{
                  left: `calc(100% / ${visibleChildren.length} / 2)`,
                  right: `calc(100% / ${visibleChildren.length} / 2)`,
                }}
              />
            )}

            {visibleChildren.map((child) => (
              <div key={child.id} className="flex flex-col items-center px-3">
                <div className="h-5 w-px bg-slate-300" />
                <OrgChartNodeCard
                  node={child}
                  depth={depth + 1}
                  selfEmployeeId={selfEmployeeId}
                  expandedIds={expandedIds}
                  onToggle={onToggle}
                  matchIds={matchIds}
                  onSelect={onSelect}
                  selfRef={selfRef}
                />
              </div>
            ))}
          </div>

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllChildren(true)}
              className="mt-3 rounded-full border border-dashed border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-500 shadow-sm transition-colors hover:border-[#1B3A5C]/40 hover:text-[#1B3A5C]"
            >
              Show {hiddenCount} more direct report{hiddenCount === 1 ? "" : "s"}
            </button>
          )}
          {showAllChildren && node.children.length > INLINE_CHILD_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAllChildren(false)}
              className="mt-3 rounded-full border border-dashed border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-500 shadow-sm transition-colors hover:border-[#1B3A5C]/40 hover:text-[#1B3A5C]"
            >
              Show only first {INLINE_CHILD_LIMIT}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
