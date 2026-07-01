import React from "react";
import { CheckCircle2, Loader2, X, AlertCircle } from "lucide-react";

interface OnboardingMobileShellProps {
  children: React.ReactNode;
  currentStep: number;
  totalSteps: number;
  candidateName: string;
  branchProcess?: string;
  completion: number;
  stepLabels: string[];
  onStepClick: (n: number) => void;
  saving: boolean;
  error: string;
  onDismissError: () => void;
  footerLeft?: React.ReactNode;
  footerRight?: React.ReactNode;
}

const STEP_ICONS: Record<number, string> = {
  1: "👋", 2: "👤", 3: "📍", 4: "📄", 5: "🛡️",
  6: "🏦", 7: "🎓", 8: "💼", 9: "👨‍👩‍👧", 10: "✅",
};

const ACCENT_COLORS: Record<number, string> = {
  1: "border-t-blue-500", 2: "border-t-slate-500", 3: "border-t-purple-500",
  4: "border-t-amber-500", 5: "border-t-indigo-500", 6: "border-t-green-500",
  7: "border-t-cyan-500", 8: "border-t-pink-500", 9: "border-t-teal-500", 10: "border-t-emerald-500",
};

export default function OnboardingMobileShell({
  children,
  currentStep,
  totalSteps,
  candidateName,
  branchProcess,
  completion,
  stepLabels,
  onStepClick,
  saving,
  error,
  onDismissError,
  footerLeft,
  footerRight,
}: OnboardingMobileShellProps) {
  const pct = Math.max(0, Math.min(100, completion));
  const currentLabel = stepLabels[currentStep - 1] ?? "";
  const headerAccent = ACCENT_COLORS[currentStep] ?? "border-t-blue-500";

  return (
    <div
      className="flex flex-col bg-gradient-to-b from-slate-50 to-white"
      style={{ height: "100dvh", maxHeight: "100dvh", overflow: "hidden" }}
    >
      {/* ── Fixed Top Header ─────────────────────────────────────────────────── */}
      <div className={`flex-shrink-0 bg-white border-b border-slate-100 ${headerAccent}`} style={{ zIndex: 30 }}>
        {/* Brand bar */}
        <div className="bg-white px-4 py-2 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm">
              <span className="text-white text-xs font-black">M</span>
            </div>
            <div>
              <span className="text-slate-800 text-xs font-black uppercase tracking-wider leading-none block">
                MAS Callnet
              </span>
              <span className="text-[9px] text-slate-400 font-semibold tracking-wider leading-none block">
                Employee Onboarding
              </span>
            </div>
          </div>
          <span className="text-blue-600 text-[10px] font-bold bg-blue-50 rounded-full px-2.5 py-1">
            Step {currentStep}/{totalSteps}
          </span>
        </div>

        {/* Candidate + progress row */}
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold text-slate-900 leading-tight truncate">
              {candidateName || "Candidate"}
            </h1>
            {branchProcess && (
              <p className="text-[11px] text-slate-400 truncate mt-0.5">{branchProcess}</p>
            )}
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-xs text-slate-600 font-semibold">
                {STEP_ICONS[currentStep]} {currentLabel}
              </span>
            </div>
          </div>

          {/* Circular progress ring */}
          <div className="relative flex-shrink-0">
            <svg width="44" height="44" viewBox="0 0 44 44" className="transform -rotate-90">
              <circle cx="22" cy="22" r="18" fill="none" stroke="#e2e8f0" strokeWidth="3.5" />
              <circle
                cx="22" cy="22" r="18" fill="none" stroke="#2563eb" strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 18}`}
                strokeDashoffset={`${2 * Math.PI * 18 * (1 - pct / 100)}`}
                className="transition-all duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] font-bold text-blue-700 leading-none">{pct}%</span>
            </div>
          </div>
        </div>

        {/* Linear progress */}
        <div className="px-4 pb-2">
          <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${(currentStep / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        {/* ── Scrollable step chips ────────────────────────────────────────── */}
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-3 scrollbar-none">
          {stepLabels.map((label, idx) => {
            const num = idx + 1;
            const isActive = num === currentStep;
            const isDone = num < currentStep;
            return (
              <button
                key={num}
                type="button"
                onClick={() => onStepClick(num)}
                aria-label={`Go to step ${num}: ${label}`}
                className={[
                  "flex-shrink-0 flex items-center gap-1 rounded-full px-3 py-1.5 text-[10px] font-bold whitespace-nowrap border transition-all duration-200 min-h-[30px] select-none active:scale-95",
                  isActive
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm scale-[1.04]"
                    : isDone
                    ? "bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100"
                    : "bg-white text-slate-400 border-slate-200 hover:border-slate-300 hover:text-slate-600",
                ].join(" ")}
              >
                {isDone ? (
                  <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                ) : (
                  <span className={`flex-shrink-0 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center ${isActive ? "bg-white/20 text-white" : "bg-slate-200 text-slate-500"}`}>
                    {num}
                  </span>
                )}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Scrollable body ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto w-full max-w-2xl px-4 py-4 space-y-4">
          {/* Saving indicator */}
          {saving && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
              Saving your progress…
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 shadow-sm">
              <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="flex-1 text-sm font-semibold text-red-700">{error}</span>
              <button
                type="button"
                onClick={onDismissError}
                className="text-red-400 hover:text-red-600 flex-shrink-0 p-0.5"
                aria-label="Dismiss error"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Step content */}
          {children}

          {/* Spacer so footer never overlaps content */}
          <div className="h-2" />
        </div>
      </div>

      {/* ── Fixed Bottom Footer ──────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white border-t border-slate-100 px-4 py-3 shadow-[0_-2px_12px_rgba(0,0,0,0.04)]" style={{ zIndex: 30 }}>
        <div className="mx-auto w-full max-w-2xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {footerLeft ?? <span />}
          </div>
          <div className="flex items-center gap-2">
            {footerRight ?? <span />}
          </div>
        </div>
      </div>
    </div>
  );
}
