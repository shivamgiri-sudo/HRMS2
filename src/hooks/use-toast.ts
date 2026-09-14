/**
 * Thin compatibility shim — redirects legacy useToast() / toast() calls to
 * sonner so only one toast system runs in the DOM at a time. All callers
 * that import from this file continue to work without modification.
 */
import { toast as sonnerToast } from "sonner";

type ToastVariant = "default" | "destructive";

interface ToastInput {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  action?: { label: string; onClick: () => void };
  /** Forwarded to sonner. Callers were already passing this to tint success toasts; the shim
   *  dropped it silently, so the styling never applied. */
  className?: string;
}

function toast({ title, description, variant, duration, action, className }: ToastInput) {
  const message = title ?? "";
  const opts = {
    description,
    duration: duration ?? 4000,
    action,
    className,
  };
  if (variant === "destructive") {
    sonnerToast.error(message, opts);
  } else {
    sonnerToast(message, opts);
  }
}

function useToast() {
  return { toast };
}

export { useToast, toast };
