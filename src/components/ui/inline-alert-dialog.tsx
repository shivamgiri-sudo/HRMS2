/**
 * A confirmation shown in place (no overlay, no portal) that is still a real modal alert dialog (Radix): focus moves in on open (to the
 * cancel button, the safe choice), is trapped while open, Escape cancels, and focus goes back to where it was on close.
 */
import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

export interface InlineAlertDialogProps {
  title: React.ReactNode; description?: React.ReactNode; className?: string; titleClassName?: string; descriptionClassName?: string;
  /** The cancel button (rendered as the dialog's Cancel: focused first, closes the dialog). */
  cancel: React.ReactElement; onCancel: () => void; children?: React.ReactNode;
  /** The confirming button(s), laid out before the cancel button in one row. */
  actions?: React.ReactNode; actionsClassName?: string;
}

export function InlineAlertDialog({ title, description, className, titleClassName, descriptionClassName, cancel, onCancel, children, actions, actionsClassName }: InlineAlertDialogProps) {
  // There is no Radix Trigger here: remember what had focus when the dialog appeared and give it back on close.
  const [returnTo] = React.useState<HTMLElement | null>(() => (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null));
  return (
    <AlertDialogPrimitive.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogPrimitive.Content className={className}
        onCloseAutoFocus={(e) => { if (returnTo && returnTo.isConnected) { e.preventDefault(); returnTo.focus(); } }}>
        <AlertDialogPrimitive.Title className={titleClassName}>{title}</AlertDialogPrimitive.Title>
        {description != null && <AlertDialogPrimitive.Description asChild><div className={descriptionClassName}>{description}</div></AlertDialogPrimitive.Description>}
        {children}
        <div className={actionsClassName}>
          {actions}
          <AlertDialogPrimitive.Cancel asChild>{React.cloneElement(cancel, { "data-dialog-cancel": "" } as Record<string, string>)}</AlertDialogPrimitive.Cancel>
        </div>
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Root>
  );
}
