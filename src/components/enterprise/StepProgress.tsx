import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function StepProgress({
  steps,
  currentStep,
}: {
  steps: Array<{ id: string; label: ReactNode }>;
  currentStep: string;
}) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === currentStep));

  return (
    <ol className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
      {steps.map((step, index) => {
        const complete = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step.id} className="flex items-center gap-2">
            <span className={cn("flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold", complete || active ? "border-[var(--brand-500)] bg-[var(--brand-50)] text-[var(--brand-700)]" : "border-[var(--border-default)] bg-[var(--surface-1)] text-[var(--text-muted)]")}>
              {complete ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className="text-xs font-semibold text-[var(--text-secondary)]">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
