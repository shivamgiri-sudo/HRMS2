import React from "react";
import { Link } from "react-router-dom";

interface QuickStat {
  label: string;
  value: string | number;
}

interface ActionItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

interface HeroBannerProps {
  userName: string;
  roleLabel: string;
  roleBadgeColor: string;
  quickStats: QuickStat[];
  primaryAction?: ActionItem;
  secondaryAction?: ActionItem;
}

function getHourGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function HeroBanner({
  userName,
  roleLabel,
  roleBadgeColor,
  quickStats,
  primaryAction,
  secondaryAction,
}: HeroBannerProps) {
  const greeting = getHourGreeting();
  const displayStats = quickStats.slice(0, 4);

  return (
    <div className="w-full rounded-2xl overflow-hidden bg-gradient-to-r from-[#1B6AB5] to-[#0d4f8a] px-6 py-6 md:px-10 md:py-8">
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        {/* Left: Greeting + Actions */}
        <div className="flex flex-col gap-3 min-w-0">
          <div className="flex flex-col gap-1">
            <p className="text-white/70 text-sm font-medium tracking-wide uppercase">
              {greeting}
            </p>
            <h1 className="text-white text-2xl font-bold leading-tight truncate">
              {userName}
            </h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold text-white ${roleBadgeColor} bg-opacity-80`}
              >
                {roleLabel}
              </span>
            </div>
            <p className="text-white/60 text-sm mt-1">
              Your {roleLabel} workspace is ready.
            </p>
          </div>

          {(primaryAction || secondaryAction) && (
            <div className="flex flex-wrap gap-2 mt-1">
              {primaryAction && (
                <Link
                  to={primaryAction.href}
                  className="inline-flex items-center gap-1.5 bg-white text-[#1B6AB5] text-sm font-semibold px-4 py-2 rounded-xl shadow-sm hover:bg-blue-50 transition-colors"
                >
                  {primaryAction.icon}
                  {primaryAction.label}
                </Link>
              )}
              {secondaryAction && (
                <Link
                  to={secondaryAction.href}
                  className="inline-flex items-center gap-1.5 bg-white/15 text-white text-sm font-semibold px-4 py-2 rounded-xl border border-white/25 hover:bg-white/25 transition-colors"
                >
                  {secondaryAction.icon}
                  {secondaryAction.label}
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Right: QuickStats 2x2 grid */}
        {displayStats.length > 0 && (
          <div className="grid grid-cols-2 gap-2 md:gap-3 flex-shrink-0 md:min-w-[260px]">
            {displayStats.map((stat, i) => (
              <div
                key={i}
                className="bg-white rounded-xl px-3 py-2.5 flex flex-col gap-0.5 shadow-sm"
              >
                <span
                  className="text-xl font-black text-slate-900 leading-tight"
                  style={{ fontFamily: "'Fira Code', monospace" }}
                >
                  {stat.value}
                </span>
                <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wide leading-tight">
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default HeroBanner;
