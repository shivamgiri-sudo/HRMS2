import { HelpCircle } from "lucide-react";
import { FOCUS } from "../ui";

/** Small "Why?" entry point. Always a real button with a spoken label naming the metric. */
export function WhyButton({ label, onClick, className = "", text = "Why?" }: { label: string; onClick: () => void; className?: string; text?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={`Why did ${label} change?`} title={`Why did ${label} change?`}
      className={`inline-flex min-h-[28px] cursor-pointer items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 text-[11px] font-bold text-blue-900 hover:bg-blue-100 ${FOCUS} ${className}`}>
      <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />{text}
    </button>
  );
}
