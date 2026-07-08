import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";

export interface ActionItem {
  label: string;
  count: number | string;
  href: string;
  urgency: "critical" | "warning" | "info";
  subtitle?: string;
}

interface ImmediateActionsBarProps {
  items: ActionItem[];
  title?: string;
}

const URGENCY_STYLES: Record<ActionItem["urgency"], { dot: string; badge: string; text: string }> = {
  critical: { dot: "bg-red-500",    badge: "bg-red-500 text-white",         text: "text-red-600" },
  warning:  { dot: "bg-amber-400",  badge: "bg-amber-500 text-white",       text: "text-amber-700" },
  info:     { dot: "bg-blue-400",   badge: "bg-blue-500 text-white",        text: "text-blue-700" },
};

export function ImmediateActionsBar({ items, title = "Today's Operations — Immediate Actions" }: ImmediateActionsBarProps) {
  if (items.length === 0) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-amber-500" />
        <p className="text-sm font-bold text-slate-900">{title}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item, i) => {
          const s = URGENCY_STYLES[item.urgency];
          return (
            <Link
              key={i}
              to={item.href}
              className="flex items-center gap-2 bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl px-3.5 py-2.5 transition-colors group"
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 leading-none">{item.label}</p>
                {item.subtitle && <p className="text-[10px] text-slate-400 mt-0.5">{item.subtitle}</p>}
              </div>
              <span className={`min-w-[28px] h-5 flex items-center justify-center rounded-full text-[11px] font-bold px-1.5 flex-shrink-0 ${s.badge}`}>
                {item.count}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
