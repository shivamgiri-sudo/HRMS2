import { AlertCircle, Clock3 } from "lucide-react";
import { isStillCalculating } from "./pending";

/** Neutral notice for a section whose first load is still running (not a failure). */
export function SectionCalculating({ name }: { name: string }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-50 p-3 text-[13px] text-slate-800">
      <Clock3 className="mt-0.5 h-4 w-4 shrink-0 motion-safe:animate-pulse" aria-hidden="true" />
      <span><strong>{name}:</strong> Calculating - this can take up to a minute on first load; updating automatically</span>
    </div>
  );
}

/** Inline error for one section, naming it, so a failing section never blanks the page. "Still calculating" is shown neutrally. */
export function SectionError({ name, message }: { name: string; message?: string }) {
  if (isStillCalculating(message)) return <SectionCalculating name={name} />;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-[13px] text-rose-900">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span><strong>{name} could not be loaded.</strong> {message ?? "Try again shortly."}</span>
    </div>
  );
}
