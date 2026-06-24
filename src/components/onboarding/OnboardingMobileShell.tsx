import React from "react";
import { Loader2 } from "lucide-react";

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
  // Clamp completion to [0, 100] for conic-gradient
  const pct = Math.max(0, Math.min(100, completion));
  const deg = Math.round(pct * 3.6);

  return (
    <div
      className="flex flex-col bg-slate-50"
      style={{ height: "100dvh", maxHeight: "100dvh", overflow: "hidden" }}
    >
      {/* ── Fixed top bar ──────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white border-b shadow-sm z-10">
        <div className="px-4 pt-3 pb-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600 leading-none">
                MAS Callnet · Onboarding
              </p>
              <h1 className="text-base font-black text-slate-950 leading-tight truncate">
                {candidateName || "Candidate"}
              </h1>
              {branchProcess && (
                <p className="text-[11px] text-slate-500 truncate">{branchProcess}</p>
              )}
            </div>

            {/* Circular progress ring */}
            <div className="relative flex-shrink-0 h-11 w-11 flex items-center justify-center">
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: `conic-gradient(#16a34a ${deg}deg, #e2e8f0 0deg)`,
                }}
              />
              <div className="relative z-10 h-8 w-8 rounded-full bg-white flex items-center justify-center">
                <span className="text-[10px] font-black text-slate-900 leading-none">
                  {pct}%
                </span>
              </div>
            </div>
          </div>

          {/* ── Horizontal scrollable step chips ──────────────────────────── */}
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
            {stepLabels.map((label, idx) => {
              const num = idx + 1;
              const isActive = num === currentStep;
              const isDone = num < currentStep;
              return (
                <button
                  key={num}
                  type="button"
                  onClick={() => onStepClick(num)}
                  className={[
                    "flex-shrink-0 rounded-full px-3 py-1 text-[11px] font-bold whitespace-nowrap border transition-colors",
                    isActive
                      ? "bg-slate-950 text-white border-slate-950"
                      : isDone
                      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                      : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200",
                  ].join(" ")}
                >
                  {num}. {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto w-full max-w-2xl px-4 py-4 space-y-4">
          {/* Inline error banner */}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 flex items-center justify-between gap-2">
              <span>{error}</span>
              <button
                type="button"
                onClick={onDismissError}
                className="text-xs underline flex-shrink-0"
              >
                dismiss
              </button>
            </div>
          )}

          {/* Step content */}
          {children}

          {/* Spacer so footer does not overlap last card */}
          <div className="h-4" />
        </div>
      </div>

      {/* ── Fixed bottom footer ─────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white border-t px-4 py-3 z-10">
        <div className="mx-auto w-full max-w-2xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {saving && (
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            )}
            {footerLeft ?? <span />}
          </div>
          <div>{footerRight ?? <span />}</div>
        </div>
      </div>
    </div>
  );
}
