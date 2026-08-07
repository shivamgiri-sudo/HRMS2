import { cn } from "@/lib/utils";
import {
  GrnCard,
  GrnCardHeader,
  GrnFieldRow,
} from "@/components/finance/grn/grn-ui";

/**
 * Layout primitives lifted out of BudgetLinkedGrnForm, byte-for-byte.
 *
 * Step one of the I-Spark restructure is a PURE MOVE: no markup, props or behaviour change.
 * The form owns document hashing, Gemini extraction, duplicate detection, GST components and
 * budget reservation, and every one of those fails quietly rather than loudly if a handler is
 * dropped mid-refactor. Separating "move it" from "change it" is what makes the diff of the
 * second step readable enough to review.
 *
 * These stay presentational and stateless — all form state remains in the parent, so a section
 * cannot acquire its own copy of the truth.
 */

export function FieldRow({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <GrnFieldRow
      label={label}
      htmlFor={htmlFor}
      required={required}
      hint={hint}
      error={error}
      // Tints whatever control this row contains rather than threading an `invalid` prop through
      // every call site. The descendant selector also out-specifies the control's own border, so
      // it wins without !important.
      className={
        error
          ? "[&_input]:border-grn-crit [&_input]:bg-grn-crit-bg [&_textarea]:border-grn-crit [&_textarea]:bg-grn-crit-bg"
          : undefined
      }
    >
      {children}
    </GrnFieldRow>
  );
}

export function FormSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <GrnCard>
      <GrnCardHeader title={title} description={description} action={action} />
      <div>{children}</div>
    </GrnCard>
  );
}

/** Read-only value rendered at input height so rows stay on one baseline. */
export function StaticValue({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-[34px] items-center text-[12.5px] font-semibold",
        muted ? "text-grn-ink-soft" : "text-grn-ink"
      )}
    >
      {children}
    </div>
  );
}
