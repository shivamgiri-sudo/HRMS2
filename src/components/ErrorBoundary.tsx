import React, { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

const CHUNK_RELOAD_KEY = "chunk_reload";

function isChunkLoadError(error: Error | null): boolean {
  if (!error) return false;
  return (
    error.message.includes("Failed to fetch dynamically imported module") ||
    error.message.includes("Importing a module script failed") ||
    error.name === "ChunkLoadError"
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);

    // Chunk-load failure after a new deployment — the cached index.html references
    // a JS chunk that no longer exists on the server. A hard reload fetches the new
    // index.html and resolves the hash mismatch automatically. One attempt only.
    if (isChunkLoadError(error) && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
      window.location.reload();
    }
  }

  handleReset = () => {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    window.location.href = "/dashboard";
  };

  render() {
    if (this.state.hasError) {
      const alreadyTriedReload = !!sessionStorage.getItem(CHUNK_RELOAD_KEY);

      // Show spinner only while the reload is in flight (flag set, page hasn't
      // navigated away yet). If reload already happened and the error persists,
      // fall through to the normal crash UI so the user has an escape hatch.
      if (isChunkLoadError(this.state.error) && !alreadyTriedReload) {
        return (
          <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
            <div className="text-center">
              <RefreshCw className="mx-auto h-8 w-8 animate-spin text-slate-400" />
              <p className="mt-3 text-sm text-slate-500">Loading updated version…</p>
            </div>
          </div>
        );
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-lg">
            <AlertTriangle className="mx-auto h-12 w-12 text-rose-600" />
            <h1 className="mt-4 text-2xl font-black text-slate-950">Something went wrong</h1>
            <p className="mt-3 text-sm text-slate-600">
              The page encountered an error and could not render. This has been logged.
            </p>
            {this.state.error?.message && (
              <div className="mt-4 rounded-xl bg-slate-50 p-3 text-left">
                <p className="font-mono text-xs text-slate-700">{this.state.error.message}</p>
              </div>
            )}
            <Button
              onClick={this.handleReset}
              className="mt-6 w-full"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Return to Dashboard
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
