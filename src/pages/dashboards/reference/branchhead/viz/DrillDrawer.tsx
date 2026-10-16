import { useId, type ReactNode } from "react";
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
}

/**
 * Drill-down sheet on the repo's Radix Dialog (the vaul drawer wrapper is bottom-only and scales the
 * page background). Radix gives the focus trap, Esc to close, scroll lock, focus return to the trigger
 * and aria-labelledby on the title; content mounts only while open. CSS in viz.css makes it a bottom
 * sheet below 768 px and a right-side sheet from 768 px.
 */
export function DrillDrawer({ open, onClose, title, subtitle, children, inline = false }: DrillDrawerProps) {
  const titleId = useId();
  const subId = useId();
  const body = (
    <>
      <DialogPrimitive.Overlay className="bh-viz bh-drawer-overlay" />
      <DialogPrimitive.Content className="bh-viz bh-drawer" aria-labelledby={titleId}
        aria-describedby={subtitle ? subId : undefined}>
        <div className="bh-drawer-head">
          <div style={{ minWidth: 0 }}>
            <DialogPrimitive.Title id={titleId} className="bh-drawer-title">{title}</DialogPrimitive.Title>
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
