import type { ComponentType } from "react";
import { Activity, CalendarRange, Users2 } from "lucide-react";

export interface OnfidoHeroTab<K extends string> {
  key: K;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const isoToShort = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
};

/**
 * Gradient hero banner in the Process Performance V2 style: brand-blue gradient with the soft
 * radial texture, an icon badge, eyebrow/title, chips for the active date range and TL/AM
 * filters, and the tab switcher as a frosted pill rail inside the banner. It only presents
 * state the dashboard already owns -- every tab, filter and handler is passed in unchanged.
 */
export default function OnfidoHero<K extends string>({
  tabs,
  view,
  onChange,
  range,
  tlFilter,
  amFilter,
  showFilters,
}: {
  tabs: readonly OnfidoHeroTab<K>[];
  view: K;
  onChange: (key: K) => void;
  range: { from: string; to: string };
  tlFilter: string;
  amFilter: string;
  /** False on views that ignore the executive filters (Live, Analyst, Utilization, Name Mapping). */
  showFilters: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#1b6ab5] via-[#2a7fd0] to-indigo-700 p-5 text-white shadow-lg sm:p-6">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.15]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 12% 20%, white, transparent 45%), radial-gradient(circle at 88% 90%, white, transparent 40%)",
        }}
      />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
            <Activity className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80">
              Quality &amp; Operations
            </p>
            <h1 className="text-xl font-bold sm:text-2xl">
              Onfido Process Dashboard
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/80 sm:text-[13px]">
              DOC and POA queue volume, AHT, quality audits and client
              escalations — built from the report files uploaded through Bulk
              Upload Hub.
            </p>
          </div>
        </div>
        {showFilters && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 backdrop-blur-sm">
              <CalendarRange className="h-3.5 w-3.5" /> {isoToShort(range.from)}{" "}
              → {isoToShort(range.to)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 backdrop-blur-sm">
              <Users2 className="h-3.5 w-3.5" /> TL: {tlFilter || "All"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 backdrop-blur-sm">
              <Users2 className="h-3.5 w-3.5" /> AM: {amFilter || "All"}
            </span>
          </div>
        )}
      </div>

      <div
        role="tablist"
        aria-label="Onfido dashboard views"
        className="relative mt-4 flex flex-wrap gap-1 rounded-2xl bg-white/10 p-1 backdrop-blur-sm"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === view}
            data-onfido-tab={t.key}
            onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
              t.key === view
                ? "bg-white text-slate-800 shadow-sm"
                : "text-white/90 hover:bg-white/15"
            }`}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
