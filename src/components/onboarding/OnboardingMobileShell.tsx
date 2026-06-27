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
  const deg = Math.round(pct * 3.6);
  const currentLabel = stepLabels[currentStep - 1] ?? "";

  return (
    <div
      className="flex flex-col bg-slate-50"
      style={{ height: "100dvh", maxHeight: "100dvh", overflow: "hidden" }}
    >
      {/* ── Fixed Top Header ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white border-b shadow-sm" style={{ zIndex: 30 }}>
        {/* Brand bar */}
        <div className="bg-gradient-to-r from-blue-700 to-blue-600 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-white/20 flex items-center justify-center">
              <span className="text-white text-xs font-black">M</span>
            </div>
            <span className="text-white text-[11px] font-black uppercase tracking-widest">
              MAS Callnet · PeopleOS
            </span>
          </div>
          <span className="text-blue-200 text-[10px] font-semibold">Employee Onboarding</span>
        </div>

        {/* Candidate + progress row */}
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-black text-slate-950 leading-tight truncate">
              {candidateName || "Candidate"}
            </h1>
            {branchProcess && (
              <p className="text-[11px] text-slate-500 truncate mt-0.5">{branchProcess}</p>
            )}
            {/* Step breadcrumb */}
            <div className="mt-1 flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 rounded px-2 py-0.5">
                Step {currentStep}/{totalSteps}
              </span>
              <span className="text-[11px] text-slate-600 font-semibold truncate">
                {STEP_ICONS[currentStep]} {currentLabel}
              </span>
            </div>
          </div>

          {/* Circular progress ring */}
          <div className="relative flex-shrink-0 h-12 w-12 flex items-center justify-center">
            <div
              className="absolute inset-0 rounded-full"
              style={{ background: `conic-gradient(#2563eb ${deg}deg, #e2e8f0 0deg)` }}
            />
            <div className="relative z-10 h-9 w-9 rounded-full bg-white flex items-center justify-center shadow-sm">
              <span className="text-[11px] font-black text-blue-700 leading-none">{pct}%</span>
            </div>
          </div>
        </div>

        {/* Linear progress bar */}
        <div className="px-4 pb-1">
          <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 rounded-full transition-all duration-500"
              style={{ width: `${(currentStep / totalSteps) * 100}%` }}
            />
          </div>
        </div>

        {/* ── Scrollable step chips ────────────────────────────────────────── */}
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-3 pt-1 scrollbar-none">
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
                  "flex-shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-bold whitespace-nowrap border-2 transition-all min-h-[32px]",
                  isActive
                    ? "bg-blue-600 text-white border-blue-600 shadow-md scale-105"
                    : isDone
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-white text-slate-500 border-slate-200 hover:border-slate-400",
                ].join(" ")}
              >
                {isDone ? (
                  <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                ) : (
                  <span className={`flex-shrink-0 w-4 h-4 rounded-full text-[9px] font-black flex items-center justify-center ${isActive ? "bg-white text-blue-600" : "bg-slate-200 text-slate-600"}`}>
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
        <div className="mx-auto w-full max-w-2xl px-3 py-3 space-y-3">
          {/* Saving indicator */}
          {saving && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700">
              <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
              Saving your progress…
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3">
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
      <div className="flex-shrink-0 bg-white border-t px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]" style={{ zIndex: 30 }}>
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
