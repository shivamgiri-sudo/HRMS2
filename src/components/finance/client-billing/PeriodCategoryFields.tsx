// src/components/finance/client-billing/PeriodCategoryFields.tsx
import { Label } from "@/components/ui/label";
import {
  SearchableSelect,
  type SearchableOption,
} from "@/components/ui/searchable-select";
import {
  BILLING_CATEGORY_OPTIONS,
  financeYearOptions,
  monthLabelOptions,
} from "./billingFieldOptions";

interface Props {
  financeYear: string;
  monthLabel: string;
  category: string;
  onFinanceYearChange: (financeYear: string) => void;
  onMonthLabelChange: (monthLabel: string) => void;
  onCategoryChange: (category: string) => void;
}

/** An already-saved value outside today's closed set (legacy artefact) stays selectable so an
 *  edit does not silently blank it; it is never offered for new documents. */
const toOptions = (
  values: readonly string[],
  current = "",
): SearchableOption[] => {
  const options = values.map((value) => ({ value, label: value }));
  return current && !values.includes(current)
    ? [{ value: current, label: current, hint: "as saved" }, ...options]
    : options;
};

/**
 * Finance year / month / category — closed sets (CLAUDE.md Form Input Rule). `financeYear`
 * is part of the bill-number scope key, so it must never be free text: a typo opens a fresh
 * numbering scope and re-issues numbers a client already holds. Picking a finance year clears
 * the month, because the month list is derived from it.
 */
export function PeriodCategoryFields({
  financeYear,
  monthLabel,
  category,
  onFinanceYearChange,
  onMonthLabelChange,
  onCategoryChange,
}: Props) {
  return (
    <>
      <div>
        <Label className="text-xs">Finance year *</Label>
        <SearchableSelect
          className="mt-1"
          options={toOptions(financeYearOptions(), financeYear)}
          value={financeYear}
          onChange={(v) => {
            onFinanceYearChange(v);
            onMonthLabelChange("");
          }}
          placeholder="Select finance year"
          searchPlaceholder="Search finance year…"
          aria-label="Finance year"
        />
      </div>
      <div>
        <Label className="text-xs">Month label *</Label>
        <SearchableSelect
          className="mt-1"
          options={toOptions(
            financeYear ? monthLabelOptions(financeYear) : [],
            monthLabel,
          )}
          value={monthLabel}
          onChange={onMonthLabelChange}
          disabled={!financeYear}
          placeholder="Select month"
          searchPlaceholder="Search month…"
          aria-label="Month label"
        />
      </div>
      <div>
        <Label className="text-xs">Category *</Label>
        <SearchableSelect
          className="mt-1"
          options={toOptions(BILLING_CATEGORY_OPTIONS, category)}
          value={category}
          onChange={onCategoryChange}
          placeholder="Select category"
          searchPlaceholder="Search category…"
          aria-label="Category"
        />
      </div>
    </>
  );
}
