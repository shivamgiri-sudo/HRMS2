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
}

function toast({ title, description, variant, duration }: ToastInput) {
  const message = title ?? "";
  const opts = {
    description,
    duration: duration ?? 4000,
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
