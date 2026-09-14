import { CheckCircle2, Loader2, XCircle } from "lucide-react";

interface OnboardingAutosaveStatusProps {
  saving: boolean;
  lastSaved: Date | null;
  error: string | null;
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export default function OnboardingAutosaveStatus({
  saving,
  lastSaved,
  error,
}: OnboardingAutosaveStatusProps) {
  if (!saving && !lastSaved && !error) return null;

  let content: React.ReactNode;

  if (saving) {
    content = (
      <span className="flex items-center gap-1.5 text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Saving…
      </span>
    );
  } else if (error) {
    content = (
      <span className="flex items-center gap-1.5 text-red-600">
        <XCircle className="h-3.5 w-3.5" />
        Save failed
      </span>
    );
  } else if (lastSaved) {
    content = (
      <span className="flex items-center gap-1.5 text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Saved {formatRelative(lastSaved)}
      </span>
    );
  }

  return (
    <div
      className="fixed bottom-20 left-3 z-50 rounded-full bg-white/90 border border-slate-200 shadow-sm px-3 py-1.5 text-[11px] font-semibold backdrop-blur-sm"
      aria-live="polite"
      aria-atomic="true"
    >
      {content}
    </div>
  );
}
