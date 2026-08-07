import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

/**
 * Superseded by sonner — kept, not deleted.
 *
 * `App.tsx` mounts `Toaster` from `@/components/ui/sonner`; this component has no import site
 * anywhere in `src/`. It used to read a `toasts` array from `useToast()`, but that hook is now a
 * thin shim that forwards every call to sonner so only one toast system runs in the DOM, and it
 * exposes no such array — so this file could not compile against the hook it depends on.
 *
 * It renders an empty provider rather than being removed: CLAUDE.md rule 3 keeps existing
 * components until a deletion is explicitly approved, and nothing observable changes either way
 * because nothing mounts it. The imports below are retained so the primitives it would need stay
 * referenced and the file remains a working starting point if a non-sonner toaster is ever wanted.
 */
export function Toaster() {
  return (
    <ToastProvider>
      <ToastViewport />
    </ToastProvider>
  );
}

// Referenced so the toast primitives this component would use are not dropped by tooling that
// prunes unused imports. See the note above.
export const _TOAST_PRIMITIVES = { Toast, ToastClose, ToastDescription, ToastTitle };
