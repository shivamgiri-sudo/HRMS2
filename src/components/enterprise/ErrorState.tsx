import type { ReactNode } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-[var(--r-lg)] border border-[var(--status-absent-border)] bg-[var(--status-absent-bg)] px-4 py-10 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-[var(--status-absent)]" />
      <h3 className="mt-3 text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      {description && <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-secondary)]">{description}</p>}
      {onRetry && (
        <Button variant="outline" className="mt-5 rounded-[var(--r-md)] bg-[var(--surface-0)]" onClick={onRetry}>
          <RefreshCcw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      )}
    </div>
  );
}
