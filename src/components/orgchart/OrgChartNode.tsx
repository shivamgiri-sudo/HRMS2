import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { normalizeMediaUrl } from "@/lib/mediaUrl";
import type { OrgTreeNode } from "@/types/orgChart";

const DEPTH_COLORS: Record<number, string> = {
  0: "#F59E0B",
  1: "#6366F1",
  2: "#8B5CF6",
};
const DEFAULT_DEPTH_COLOR = "#94A3B8";

const GRADIENT_CLASSES = [
  "from-amber-400 to-orange-500",
  "from-indigo-400 to-violet-500",
  "from-violet-400 to-purple-500",
  "from-slate-400 to-slate-500",
];

function depthColor(depth: number): string {
  return DEPTH_COLORS[depth] ?? DEFAULT_DEPTH_COLOR;
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export interface OrgNodeData extends OrgTreeNode {
  depth: number;
  isCurrentUser?: boolean;
}

export const OrgChartNode = memo(function OrgChartNode({ data }: NodeProps) {
  const d = data as unknown as OrgNodeData;
  const color = depthColor(d.depth);
  const gradClass = GRADIENT_CLASSES[Math.min(d.depth, 3)];
  const photoUrl = normalizeMediaUrl(d.avatar_url ?? undefined);

  return (
    <div
      style={{ width: 130, height: 170 }}
      className={[
        "relative flex flex-col overflow-hidden rounded-xl bg-white",
        "border border-slate-100/80 shadow-md",
        "transition-all duration-200 ease-out",
        "hover:shadow-xl hover:scale-[1.03] hover:border-slate-200",
        d.isCurrentUser
          ? "ring-2 ring-indigo-500 shadow-indigo-200/70 shadow-lg"
          : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Depth-coded left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] z-10 rounded-l-xl"
        style={{ backgroundColor: color }}
      />

      {/* Photo zone — top 55% */}
      <div className="relative overflow-hidden" style={{ height: "55%" }}>
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={d.name}
            className="w-full h-full object-cover object-top"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div
            className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${gradClass}`}
          >
            <span className="text-white font-extrabold text-xl tracking-wide select-none">
              {initials(d.name)}
            </span>
          </div>
        )}

        {/* Process colour dot (bottom-right of photo) */}
        {d.process_name && (
          <div
            className="absolute bottom-1.5 right-1.5 w-2.5 h-2.5 rounded-full border-[1.5px] border-white shadow-sm"
            style={{ backgroundColor: color }}
            title={d.process_name}
          />
        )}
      </div>

      {/* Info panel — bottom 45% */}
      <div className="flex-1 px-2.5 py-1.5 bg-white/95 flex flex-col justify-center gap-px">
        <p
          className="text-[10.5px] font-bold text-slate-900 truncate leading-snug"
          title={d.name}
        >
          {d.name}
        </p>
        <p
          className="text-[9px] text-slate-500 truncate leading-tight"
          title={d.designation ?? ""}
        >
          {d.designation || "—"}
        </p>
        {d.branch_name && (
          <p className="text-[8px] text-slate-400 truncate mt-0.5 leading-tight">
            {d.branch_name}
          </p>
        )}
      </div>

      {/* React Flow connection handles */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !bg-indigo-300 !border-white !border"
        style={{ top: -4 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !bg-indigo-300 !border-white !border"
        style={{ bottom: -4 }}
      />
    </div>
  );
});
