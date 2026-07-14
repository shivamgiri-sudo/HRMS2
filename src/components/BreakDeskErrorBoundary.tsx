import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class BreakDeskErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Break Desk Error Boundary caught error:', error, errorInfo);
    this.setState({ errorInfo });

    // Optional: Log to error monitoring service
    // logErrorToService(error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-8">
          <div className="w-full max-w-md space-y-6 rounded-3xl bg-white p-8 text-center shadow-2xl">
            {/* Error Icon */}
            <div className="flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-rose-100">
                <AlertTriangle className="h-10 w-10 text-rose-600" />
              </div>
            </div>

            {/* Error Message */}
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900">Break Desk Unavailable</h2>
              <p className="text-slate-600">
                The break desk encountered an unexpected error. Please try refreshing the page or contact IT support if the problem persists.
              </p>
            </div>

            {/* Error Details (Collapsible) */}
            {this.state.error && (
              <details className="text-left">
                <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-700">Technical details</summary>
                <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
                  <pre className="overflow-auto text-xs text-slate-700">{this.state.error.toString()}</pre>
                  {this.state.errorInfo && (
                    <pre className="max-h-40 overflow-auto text-xs text-slate-600">{this.state.errorInfo.componentStack}</pre>
                  )}
                </div>
              </details>
            )}

            {/* Reload Button */}
            <button
              onClick={this.handleReset}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-teal-600 to-teal-700 px-6 text-base font-semibold text-white shadow-lg transition-all hover:shadow-xl active:scale-95"
            >
              <RefreshCw className="h-5 w-5" />
              Reload Break Desk
            </button>

            {/* Support Info */}
            <p className="text-xs text-slate-400">
              If this error persists, please note the timestamp:{' '}
              <span className="font-mono">{new Date().toISOString()}</span>
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
