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
  maxPeriod,
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
  /**
   * "YYYY-MM" — hides every month/year option strictly after it. Every P&L ACTUALS caller
   * (Process P&L, LOB Management, Period Close) must pass this as the current month: with the
   * default `yearsForward=2` and no cap, this picker could select up to two years into the
   * future, and a future period silently reads back as a real zero (every actual/GRN/payroll
   * table just matches 0 rows — the backend now refuses it outright, per pnl-period-guard.ts,
   * but the picker offering it at all is a worse UX than not offering it). Omitted by default so
   * budget-PLANNING callers (Budget Consolidation, Branch Budget) — which legitimately plan
   * ahead of the money being spent — are unaffected.
   */
  maxPeriod?: string;
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
  const [maxYear, maxMonth] = maxPeriod ? maxPeriod.split("-").map(Number) : [null, null];
  const yearOptions = maxYear ? years.filter((y) => y <= maxYear) : years;
  const monthOptions = maxYear && year === maxYear
    ? MONTH_NAMES.map((name, index) => ({ name, value: index + 1 })).filter((m) => m.value <= (maxMonth ?? 12))
    : MONTH_NAMES.map((name, index) => ({ name, value: index + 1 }));
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
        {monthOptions.map(({ name, value }) => (
          <option key={name} value={value}>{name}</option>
        ))}
      </select>
      <select
        aria-label="Year"
        className={selectClassName ? `${selectClassName} w-24` : "h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"}
        disabled={disabled}
        value={hasValue ? year : ""}
        onChange={(event) => {
          if (!event.target.value) { onChange(""); return; }
          const nextYear = Number(event.target.value);
          // Clamp month too — switching from a past year to maxYear while a later month is
          // selected must not silently produce a still-future period.
          const nextMonth = maxYear && nextYear === maxYear && month > (maxMonth ?? 12) ? (maxMonth ?? 12) : month;
          onChange(`${nextYear}-${String(nextMonth).padStart(2, "0")}`);
        }}
      >
        {emptyLabel && <option value="">{emptyLabel}</option>}
        {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
