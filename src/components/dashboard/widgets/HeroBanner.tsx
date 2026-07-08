import React from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";

interface QuickStat {
  label: string;
  value: string | number;
}

interface ActionItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  variant?: "primary" | "secondary";
}

interface HeroBannerProps {
  title: string;           // "Good morning, SHIVAM" or role title like "HR Dashboard"
  subtitle?: string;       // subtitle line
  roleChip?: string;       // e.g. "HR View", "CEO View", "Self Service"
  chipColor?: string;      // Tailwind classes for chip color
  quickStats?: QuickStat[];
  actions?: ActionItem[];
  updatedAt?: string;      // "Updated just now" or timestamp
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function HeroBanner({
  title,
  subtitle,
  roleChip,
  chipColor = "bg-blue-50 text-blue-700 border-blue-200",
  quickStats = [],
  actions = [],
  updatedAt,
}: HeroBannerProps) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
      {/* Left: title + chip + subtitle + actions */}
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-[22px] font-bold text-slate-900 leading-tight">{title}</h1>
          {roleChip && (
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${chipColor}`}>
              <Sparkles className="w-3 h-3" />
              {roleChip}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-sm text-slate-500">{subtitle}</p>
        )}
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {actions.map((a, i) => (
              <Link
                key={i}
                to={a.href}
                className={`inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-1.5 rounded-xl transition-colors ${
                  a.variant === "secondary"
                    ? "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
                    : "bg-slate-900 text-white hover:bg-slate-800"
                }`}
              >
                {a.icon}
                {a.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Right: quick stat chips */}
      {quickStats.length > 0 && (
        <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
          {quickStats.map((s, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-center min-w-[80px] shadow-sm">
              <p
                className="text-xl font-bold text-slate-900 leading-none"
                style={{ fontFamily: "'Fira Code', monospace" }}
              >
                {s.value}
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mt-1">{s.label}</p>
            </div>
          ))}
          {updatedAt && (
            <p className="text-[11px] text-slate-400 whitespace-nowrap">↺ {updatedAt}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default HeroBanner;
