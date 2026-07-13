import { useState, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, Users } from "lucide-react";
import { normalizeMediaUrl } from "@/lib/mediaUrl";
import type { OrgTreeNode } from "@/types/orgChart";

// MCN brand-aligned level styles
const LEVEL_STYLES: Record<number, { strip: string; badge: string; text: string; avatarBg: string }> = {
  0: { strip: "bg-amber-500",   badge: "bg-amber-50 text-amber-700 border-amber-200",   text: "text-amber-700",   avatarBg: "bg-gradient-to-br from-amber-400 to-orange-500" },
  1: { strip: "bg-[#1B3A5C]",   badge: "bg-blue-50 text-[#1B3A5C] border-blue-200",     text: "text-[#1B3A5C]",   avatarBg: "bg-gradient-to-br from-[#1B3A5C] to-[#2d5a8a]" },
  2: { strip: "bg-[#4CAF50]",   badge: "bg-emerald-50 text-emerald-700 border-emerald-200", text: "text-emerald-700", avatarBg: "bg-gradient-to-br from-[#4CAF50] to-emerald-600" },
  3: { strip: "bg-slate-400",   badge: "bg-slate-50 text-slate-600 border-slate-200",    text: "text-slate-600",   avatarBg: "bg-gradient-to-br from-slate-400 to-slate-500" },
};

function getStyle(depth: number) {
  return LEVEL_STYLES[Math.min(depth, 3)];
}

function getInitials(name: string): string {
  return name.split(" ").filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

interface OrgChartNodeProps {
  node: OrgTreeNode;
  depth?: number;
  currentEmployeeId?: string | null;
  isLast?: boolean;
  searchQuery?: string;
}

export const OrgChartNodeCard = memo(function OrgChartNodeCard({
  node,
  depth = 0,
  currentEmployeeId,
  searchQuery = "",
}: OrgChartNodeProps) {
  const [expanded, setExpanded] = useState(depth < 3);
  const hasChildren = node.children && node.children.length > 0;
  const style = getStyle(depth);
  const isMe = node.id === currentEmployeeId;
  const photoUrl = normalizeMediaUrl(node.avatar_url ?? undefined);

  // Search dimming
  const q = searchQuery.trim().toLowerCase();
  const isMatch = !q || node.name.toLowerCase().includes(q) || (node.designation ?? "").toLowerCase().includes(q);
  const dimmed = !!q && !isMatch;

  return (
    <div className="flex flex-col items-center">
      {/* ── The Card ─────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: dimmed ? 0.25 : 1, scale: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={[
          "relative w-[210px] rounded-2xl border overflow-hidden",
          "shadow-[0_2px_12px_rgba(0,0,0,0.06)]",
          "transition-all duration-200 hover:shadow-[0_6px_24px_rgba(0,0,0,0.1)] hover:-translate-y-0.5",
          "bg-white",
          isMe ? "ring-2 ring-[#1B3A5C] ring-offset-2" : "border-slate-200/80",
        ].join(" ")}
      >
        {/* Coloured top strip */}
        <div className={`h-[5px] w-full ${style.strip}`} />

        <div className="px-4 py-3.5 flex flex-col items-center text-center gap-2">
          {/* Avatar */}
          <div className="relative">
            <div
              className={[
                "w-[52px] h-[52px] rounded-full overflow-hidden border-[2.5px] shadow-sm",
                isMe ? "border-[#1B3A5C]" : "border-white",
              ].join(" ")}
              style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
            >
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={node.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  draggable={false}
                />
              ) : (
                <div className={`w-full h-full flex items-center justify-center ${style.avatarBg}`}>
                  <span className="text-white font-bold text-[15px] select-none">
                    {getInitials(node.name)}
                  </span>
                </div>
              )}
            </div>
            {isMe && (
              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-white" />
            )}
          </div>

          {/* Name */}
          <div className="w-full">
            <p className="text-[13px] font-bold text-slate-900 leading-snug truncate" title={node.name}>
              {node.name}
            </p>
            <p className="text-[11px] text-slate-500 leading-snug truncate mt-0.5" title={node.designation ?? ""}>
              {node.designation || "—"}
            </p>
          </div>

          {/* Process / Branch pill */}
          {(node.process_name || node.branch_name) && (
            <div className="flex flex-wrap items-center justify-center gap-1">
              {node.process_name && (
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border truncate max-w-[95px] ${style.badge}`} title={node.process_name}>
                  {node.process_name}
                </span>
              )}
              {node.branch_name && (
                <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 truncate max-w-[85px]" title={node.branch_name}>
                  {node.branch_name}
                </span>
              )}
            </div>
          )}

          {/* Collapse/expand button */}
          {hasChildren && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 mt-0.5 px-2.5 py-1 rounded-full bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-all cursor-pointer border border-slate-200/60"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3 transition-transform" />
              ) : (
                <ChevronRight className="h-3 w-3 transition-transform" />
              )}
              <Users className="h-3 w-3" />
              <span className="text-[10px] font-semibold">{node.children.length}</span>
            </button>
          )}
        </div>
      </motion.div>

      {/* ── Children tree with connectors ────────────────────────── */}
      <AnimatePresence>
        {hasChildren && expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col items-center overflow-visible"
          >
            {/* Vertical line from card down to horizontal bar */}
            <div className="w-px h-7 bg-slate-300" />

            {/* Children wrapper with horizontal connector */}
            <div className="relative flex items-start">
              {/* Horizontal connector bar — spans from first child center to last child center */}
              {node.children.length > 1 && (
                <div className="absolute top-0 left-[calc(50%/var(--child-count))] right-[calc(50%/var(--child-count))] h-px bg-slate-300"
                  style={{ left: `calc(100% / ${node.children.length} / 2)`, right: `calc(100% / ${node.children.length} / 2)` }}
                />
              )}

              {node.children.map((child) => (
                <div key={child.id} className="flex flex-col items-center px-2">
                  {/* Vertical connector from horizontal bar down to child card */}
                  <div className="w-px h-5 bg-slate-300" />
                  <OrgChartNodeCard
                    node={child}
                    depth={depth + 1}
                    currentEmployeeId={currentEmployeeId}
                    searchQuery={searchQuery}
                  />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
