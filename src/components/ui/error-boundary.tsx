/**
 * ErrorBoundary + ErrorFallback
 *
 * Catches render-time JS errors anywhere in the subtree and renders a recovery UI
 * instead of a blank screen. Logs to console in dev; can be wired to Sentry later.
 *
 * Usage (wrap any route or panel):
 *   <ErrorBoundary>
 *     <SomeDangerousComponent />
 *   </ErrorBoundary>
 *
 * Custom fallback:
 *   <ErrorBoundary fallback={<p>Custom error message</p>}>
 *     ...
 *   </ErrorBoundary>
 *
 * With reset callback (e.g. on route change):
 *   <ErrorBoundary onReset={() => queryClient.clear()}>
 *     ...
 *   </ErrorBoundary>
 */

import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── ErrorFallback (standalone) ───────────────────────────────────────────────

export interface ErrorFallbackProps {
  error?: Error | null;
  onReset?: () => void;
  /** "page" fills the viewport; "card" fits inside any container. */
  size?: "page" | "card";
  className?: string;
}

export function ErrorFallback({
  error,
  onReset,
  size = "card",
  className,
}: ErrorFallbackProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-12 text-center",
        size === "page" && "min-h-[60vh]",
        className
      )}
    >
      <div
        aria-hidden
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"
      >
        <AlertTriangle className="h-8 w-8" />
      </div>

      <div className="max-w-sm space-y-1.5">
        <p className="text-base font-semibold text-foreground">
          Something went wrong
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {error?.message
            ? `Error: ${error.message}`
            : "An unexpected error occurred. Please try refreshing the page."}
        </p>
      </div>

      {onReset && (
        <Button
          variant="outline"
          size="sm"
          onClick={onReset}
          className="gap-2"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Try again
        </Button>
      )}
    </div>
  );
}

// ─── ErrorBoundary (class component — required by React) ──────────────────────

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Override the default fallback UI entirely. */
  fallback?: React.ReactNode;
  /** Called after the "Try again" button resets the boundary. */
  onReset?: () => void;
  /** Passed to ErrorFallback when using default UI. */
  size?: "page" | "card";
  className?: string;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Replace with Sentry.captureException(error, { extra: info }) when ready
    console.error("[ErrorBoundary] Caught render error:", error, info.componentStack);
  }

  handleReset() {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <ErrorFallback
        error={this.state.error}
        onReset={this.handleReset}
        size={this.props.size}
        className={this.props.className}
      />
    );
  }
}
