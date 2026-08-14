const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * A period picker that works in every browser.
 *
 * A native `<input type="month">` renders as a working calendar picker in Chrome/Edge/Firefox,
 * but Safari has never implemented it — it falls back to a plain text box with no picker UI at
 * all, which reads as "the month dropdown doesn't work" rather than as a browser gap. Two plain
 * `<select>`s behave identically everywhere, so there is no browser-dependent path here.
 *
 * Lifted out of BranchBudgetManagementWorkspace, which had the only copy. The rest of the
 * finance surface — Budget Consolidation, Process P&L, LOB Management and Period Close — was
 * still on `<input type="month">`, so the workspace was the one page of five that a Safari user
 * could actually pick a period on. Same component, same behaviour, now shared rather than
 * reimplemented.
 *
 * Value and onChange speak "YYYY-MM", identical to the input it replaces, so a caller only
 * swaps the element.
 */
export function MonthYearPicker({
  value,
  onChange,
  yearsBack = 3,
  yearsForward = 2,
  className,
  selectClassName,
  disabled = false,
  emptyLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  yearsBack?: number;
  yearsForward?: number;
  className?: string;
  /** Overrides the default theme classes on both selects. The GRN module has its own design
   *  language (grn-scope, IBM Plex, its own border and focus tokens), so it passes styling here
   *  rather than importing a control that would visibly not belong. */
  selectClassName?: string;
  /** The native input this replaces accepted `disabled`, and callers on locked forms rely on it.
   *  Without it a caller swapping the element would silently make a read-only period editable,
   *  which is a worse defect than the Safari gap this component exists to close. Defaults to
   *  false, so existing callers are unaffected. */
  disabled?: boolean;
  /** Opt-in "no period selected" state, for the filter case rather than the form case. A native
   *  `<input type="month">` expresses "" as a blank box, so a filter could always be cleared back
   *  to "all periods"; two selects have no such state and would strand the user on whichever month
   *  they picked first. Passing a label (e.g. "All periods") adds it as the leading option in both
   *  selects and emits "" when chosen. Omitted by default, so every existing caller — all of them
   *  form fields with a value that is always set — behaves exactly as before. */
  emptyLabel?: string;
}) {
  const hasValue = Boolean(value);
  const [yearPart, monthPart] = value.split("-");
  const year = Number(yearPart) || new Date().getFullYear();
  const month = Number(monthPart) || 1;
  const currentYear = new Date().getFullYear();
  const years = Array.from(
    { length: yearsBack + yearsForward + 1 },
    (_, index) => currentYear - yearsBack + index
  );
  return (
    <div className={`flex gap-1.5 ${className ?? ""}`}>
      <select
        aria-label="Month"
        className={selectClassName ?? "h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"}
        disabled={disabled}
        value={hasValue ? month : ""}
        onChange={(event) => onChange(
          event.target.value ? `${year}-${String(Number(event.target.value)).padStart(2, "0")}` : ""
        )}
      >
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {MONTH_NAMES.map((name, index) => (
          <option key={name} value={index + 1}>{name}</option>
        ))}
      </select>
      <select
        aria-label="Year"
        className={selectClassName ? `${selectClassName} w-24` : "h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"}
        disabled={disabled}
        value={hasValue ? year : ""}
        onChange={(event) => onChange(
          event.target.value ? `${event.target.value}-${String(month).padStart(2, "0")}` : ""
        )}
      >
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
