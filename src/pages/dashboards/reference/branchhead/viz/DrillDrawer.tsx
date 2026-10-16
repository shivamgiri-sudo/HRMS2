import { useEffect, useId, useRef, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export interface DrillDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Render in place instead of portalling to <body>. For static-markup tests; leave off in the app. */
  inline?: boolean;
  /** Identity of the view shown; when it changes while open (content swap), focus moves to the title. */
  focusKey?: string;
}

interface Focusable { focus?: (opts?: { preventScroll?: boolean }) => void; isConnected?: boolean }

/**
 * Return focus after the drawer closes. There is no Dialog.Trigger (drawers open from tiles, bars and
 * rows), so Radix has nothing to return to: focus the element that had focus when the drawer opened,
 * or the fallback (document.body) when it is gone from the DOM. Returns the element focused.
 */
export function restoreFocus<T extends Focusable>(saved: T | null | undefined, fallback: Focusable | null | undefined): Focusable | null {
  const target = saved && saved.isConnected !== false && typeof saved.focus === "function" ? saved : fallback;
  if (!target || typeof target.focus !== "function") return null;
  target.focus({ preventScroll: true });
  return target;
}

/**
 * Drill-down sheet on the repo's Radix Dialog (the vaul drawer wrapper is bottom-only and scales the
 * page background). Radix gives the focus trap, Esc to close and scroll lock; focus return to the
 * opener is ours (restoreFocus, as there is no Dialog.Trigger). Title and subtitle are wired with
 * explicit ids; content mounts only while open. CSS in viz.css makes it a bottom sheet below 768 px
 * and a right-side sheet from 768 px.
 */
export function DrillDrawer({ open, onClose, title, subtitle, children, inline = false, focusKey }: DrillDrawerProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const shownKey = useRef<string | undefined>(undefined);
  // A swap keeps the drawer open (so the saved opener survives for the final close); only the title takes focus.
  useEffect(() => {
    if (open && shownKey.current !== undefined && focusKey !== undefined && shownKey.current !== focusKey) {
      titleRef.current?.focus({ preventScroll: true });
    }
    shownKey.current = open ? focusKey : undefined;
  }, [open, focusKey]);
  const subId = useId();
  const saved = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  // Capture the opener during the render that opens the drawer: Radix moves focus into the content in
  // an effect, so an effect here would already see focus inside the dialog.
  if (open && !wasOpen.current && typeof document !== "undefined") {
    saved.current = document.activeElement as HTMLElement | null;
  }
  wasOpen.current = open;
  const body = (
    <>
      <DialogPrimitive.Overlay className="bh-viz bh-drawer-overlay" />
      <DialogPrimitive.Content className="bh-viz bh-drawer" aria-labelledby={titleId}
        aria-describedby={subtitle ? subId : undefined}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          restoreFocus(saved.current, typeof document !== "undefined" ? document.body : null);
          saved.current = null;
        }}>
        <div className="bh-drawer-head">
          <div style={{ minWidth: 0 }}>
            <DialogPrimitive.Title id={titleId} ref={titleRef} tabIndex={-1} className="bh-drawer-title">{title}</DialogPrimitive.Title>
            {subtitle ? <DialogPrimitive.Description id={subId} className="bh-drawer-sub">{subtitle}</DialogPrimitive.Description> : null}
          </div>
          <DialogPrimitive.Close className="bh-drawer-close" aria-label={`Close ${title}`}>
            <X className="h-5 w-5" aria-hidden="true" />
          </DialogPrimitive.Close>
        </div>
        <div className="bh-drawer-body">{children}</div>
      </DialogPrimitive.Content>
    </>
  );
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      {inline ? body : <DialogPrimitive.Portal>{body}</DialogPrimitive.Portal>}
    </DialogPrimitive.Root>
  );
}
