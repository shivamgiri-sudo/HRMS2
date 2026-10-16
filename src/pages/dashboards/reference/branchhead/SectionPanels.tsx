import { AlertCircle } from "lucide-react";

/** Inline error for one section, naming it, so a failing section never blanks the page. */
export function SectionError({ name, message }: { name: string; message?: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-[13px] text-rose-900">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span><strong>{name} could not be loaded.</strong> {message ?? "Try again shortly."}</span>
    </div>
  );
}
