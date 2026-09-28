import type { ReactNode } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  /** Support reference ID — shown per MAS Design Guidelines §13.3 error formula */
  refId?: string;
  /** Whether the user's data is safe (show "Your entries are still here." when true) */
  dataSafe?: boolean;
  className?: string;
}

// Colors from MAS Design Guidelines §3.3 — #B91C1C on #FEF2F2, border #FECACA
export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  refId,
  dataSafe,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={[
        "rounded-[var(--radius-card)] border border-[#FECACA] bg-[#FEF2F2] px-4 py-10 text-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <AlertTriangle className="mx-auto h-8 w-8 text-[#B91C1C]" aria-hidden />
      <h3 className="mt-3 text-base font-semibold text-[var(--text-primary)]">{title}</h3>

      {description && (
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-secondary)]">
          {description}
        </p>
      )}

      {dataSafe && (
        <p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-muted)]">
          Your entries are still here.
        </p>
      )}

      {refId && (
        <p className="mt-2 font-mono text-xs text-[var(--text-muted)]">
          Reference: {refId}
        </p>
      )}

      {onRetry && (
        <Button
          variant="outline"
          className="mt-5 rounded-[var(--radius-input)] bg-[var(--color-surface)]"
          onClick={onRetry}
        >
          <RefreshCcw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      )}
    </div>
  );
}
