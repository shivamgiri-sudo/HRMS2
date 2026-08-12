import { useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import {
  GrnAlert, GrnCellSub, GrnChip, GrnFieldRow, GrnInput, GrnTable, GrnTd, GrnTh, GRN_TR,
} from "@/components/finance/grn/grn-ui";
import { money } from "@/components/finance/grn/grn-format";
import { MonthYearPicker } from "@/components/finance/MonthYearPicker";

/**
 * Multi-month recognition (Requirement 5).
 *
 * An annual policy of ₹12,00,000 covering April to March must not land entirely in April; the
 * cost belongs to all twelve months, because that is when the cover is consumed.
 *
 * The panel shows the schedule it is about to write, per month, before the GRN is saved. That
 * is deliberate: the split is an accounting decision the raiser is making, and a decision made
 * invisibly is one nobody checks. The preview mirrors the server's arithmetic exactly — same
 * paise truncation, same residue on the final row — so what is shown is what is stored. The
 * server recomputes and re-asserts it regardless; this is not the authority, only the mirror.
 *
 * FY CROSSING (2026-08-12): cross-year windows are now allowed. The panel warns when a window
 * spans two financial years so Finance Head can decide whether that is intentional.
 *
 * CUSTOM SPLIT: Finance Head may override the equal-split with explicit per-month percentages.
 * Percentages must sum to 100. The resulting amounts are sent to the backend as
 * recognitionCustomPercentages.
 */

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

function financialYearOf(period: string): string | null {
  if (!PERIOD.test(period)) return null;
  const [year, month] = period.split("-").map(Number);
  return month >= 4
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;
}

function monthsBetween(from: string, to: string): string[] {
  if (!PERIOD.test(from) || !PERIOD.test(to) || to < from) return [];
  const months: string[] = [];
  let [year, month] = from.split("-").map(Number);
  const [endYear, endMonth] = to.split("-").map(Number);
  while ((year < endYear || (year === endYear && month <= endMonth)) && months.length < 120) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

const MONTH_LABEL = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function monthLabel(period: string) {
  const [year, month] = period.split("-").map(Number);
  return `${MONTH_LABEL[month - 1]} ${year}`;
}

function equalSplit(amount: number, periods: string[]): number[] {
  if (!periods.length) return [];
  const totalPaise = Math.round(Number(amount) * 100);
  const base = Math.trunc(totalPaise / periods.length);
  const rows = periods.map(() => base / 100);
  rows[rows.length - 1] = (base + (totalPaise - base * periods.length)) / 100;
  return rows;
}

function customSplitAmounts(amount: number, periods: string[], pcts: Record<string, number>): number[] {
  const totalPaise = Math.round(Number(amount) * 100);
  let allocated = 0;
  const result = periods.map((p) => {
    const pct = Number(pcts[p] ?? 0);
    const paise = Math.trunc((totalPaise * pct) / 100);
    allocated += paise;
    return paise / 100;
  });
  // residue on last row
  result[result.length - 1] += (totalPaise - allocated) / 100;
  return result;
}

export type MonthSplitValue = {
  startPeriod: string;
  endPeriod: string;
  /** Per-month percentages for custom (non-equal) splits. Finance Head only. */
  customPercentages?: Record<string, number>;
};

/**
 * Whether a recognition window spills outside the financial year the GRN books to.
 *
 * Exported so BudgetLinkedGrnForm can block submission on the same rule the panel
 * displays and the server enforces, rather than a second copy of it drifting.
 */
export function windowCrossesFinancialYear(
  accountingPeriod: string,
  startPeriod: string | null | undefined,
  endPeriod: string | null | undefined,
): boolean {
  if (!startPeriod || !endPeriod) return false;
  const financialYear = financialYearOf(accountingPeriod);
  if (!financialYear) return false;
  const periods = monthsBetween(startPeriod, endPeriod);
  if (!periods.length) return false;
  return periods.some((p) => financialYearOf(p) !== financialYear);
}

export function MonthSplitPanel({
  value,
  onChange,
  amount,
  accountingPeriod,
  disabled,
  canCustomSplit,
  canCrossFy,
}: {
  value: MonthSplitValue;
  onChange: (next: MonthSplitValue) => void;
  /** The figure that will actually be spread — the P&L cost, not the invoice gross. */
  amount: number;
  /** The month the GRN books to; the financial year is derived from it. */
  accountingPeriod: string;
  disabled?: boolean;
  /** Whether the user may switch to custom % mode. Finance Head / Accounts Head / Super Admin. */
  canCustomSplit?: boolean;
  /**
   * Whether the user may commit a window that crosses a financial year. Same three
   * roles, checked separately because the server checks them separately.
   */
  canCrossFy?: boolean;
}) {
  const enabled = Boolean(value.startPeriod || value.endPeriod);
  const isCustomMode = Boolean(value.customPercentages && Object.keys(value.customPercentages).length > 0);

  const schedule = useMemo(() => {
    if (!value.startPeriod || !value.endPeriod) return null;
    const financialYear = financialYearOf(accountingPeriod);
    if (!financialYear) {
      return { error: "Set the bill date first — the financial year is derived from it." };
    }
    const periods = monthsBetween(value.startPeriod, value.endPeriod);
    if (!periods.length) {
      return { error: "The last month cannot fall before the first." };
    }
    const crossFy = periods.some((p) => financialYearOf(p) !== financialYear);
    const amounts = isCustomMode && value.customPercentages
      ? customSplitAmounts(amount, periods, value.customPercentages)
      : equalSplit(amount, periods);
    const pctSum = isCustomMode && value.customPercentages
      ? periods.reduce((s, p) => s + Number(value.customPercentages![p] ?? 0), 0)
      : 100;
    return {
      financialYear,
      periods,
      amounts,
      crossFy,
      requestedCount: periods.length,
      total: amounts.reduce((s, n) => s + n, 0),
      pctSum,
    };
  }, [value.startPeriod, value.endPeriod, value.customPercentages, amount, accountingPeriod, isCustomMode]);

  function switchToCustom() {
    if (!schedule || "error" in schedule) return;
    const eqPct = 100 / schedule.periods.length;
    const pcts: Record<string, number> = {};
    schedule.periods.forEach((p) => { pcts[p] = eqPct; });
    onChange({ ...value, customPercentages: pcts });
  }

  function switchToEqual() {
    onChange({ ...value, customPercentages: undefined });
  }

  function updatePct(period: string, pct: number) {
    if (!value.customPercentages) return;
    onChange({ ...value, customPercentages: { ...value.customPercentages, [period]: pct } });
  }

  return (
    <div>
      <GrnFieldRow
        label="Recognise across months"
        hint={
          enabled
            ? isCustomMode
              ? "Custom split: enter a percentage for each month. They must total 100%."
              : "The cost is spread equally across these months. The invoice, the payable and the budget consumption all stay in the accounting month — only the P&L is spread."
            : "Leave blank for a single-month invoice. Set a range for an annual policy, AMC or any pre-paid service."
        }
      >
        {!enabled ? (
          <GrnChip
            active={false}
            onClick={() => {
              if (disabled) return;
              onChange({ startPeriod: accountingPeriod, endPeriod: accountingPeriod });
            }}
          >
            <CalendarRange className="mr-1 h-3.5 w-3.5" />
            Spread across months
          </GrnChip>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <MonthYearPicker
              className="w-[210px]"
              value={value.startPeriod}
              onChange={(v) => onChange({ ...value, startPeriod: v })}
              selectClassName={"h-[34px] rounded-[8px] border border-grn-line bg-white px-[8px] text-[12.5px] text-grn-ink focus:outline-none focus:ring-2 focus:ring-grn-brand/15"}
            />
            <span className="text-[11px] text-grn-ink-soft">to</span>
            <MonthYearPicker
              className="w-[210px]"
              value={value.endPeriod}
              onChange={(v) => onChange({ ...value, endPeriod: v })}
              selectClassName={"h-[34px] rounded-[8px] border border-grn-line bg-white px-[8px] text-[12.5px] text-grn-ink focus:outline-none focus:ring-2 focus:ring-grn-brand/15"}
            />
            <GrnChip
              active={false}
              onClick={() => !disabled && onChange({ startPeriod: "", endPeriod: "" })}
            >
              Single month
            </GrnChip>
            {canCustomSplit && schedule && !("error" in schedule) && !isCustomMode && (
              <GrnChip active={false} onClick={() => !disabled && switchToCustom()}>
                Custom %
              </GrnChip>
            )}
            {isCustomMode && canCustomSplit && (
              <GrnChip active={true} onClick={() => !disabled && switchToEqual()}>
                Equal split
              </GrnChip>
            )}
          </div>
        )}
      </GrnFieldRow>

      {schedule && "error" in schedule && (
        <div className="px-4 pb-3">
          <GrnAlert tone="crit">{schedule.error}</GrnAlert>
        </div>
      )}

      {schedule && !("error" in schedule) && (
        <div className="px-4 pb-3">
          {schedule.crossFy && canCrossFy && (
            <GrnAlert tone="warn">
              This recognition window crosses a financial year boundary. The cost will be spread
              across both FY {financialYearOf(schedule.periods[0])} and FY{" "}
              {financialYearOf(schedule.periods[schedule.periods.length - 1])}. Confirm this is
              intentional.
            </GrnAlert>
          )}
          {schedule.crossFy && !canCrossFy && (
            /* The server refuses this for anyone outside the three roles, so say so here
               rather than letting the save fail after everything else is filled in. */
            <GrnAlert tone="crit">
              This recognition window crosses a financial year boundary — FY{" "}
              {financialYearOf(schedule.periods[0])} into FY{" "}
              {financialYearOf(schedule.periods[schedule.periods.length - 1])}. Only a Finance
              Head, Accounts Head or Super Admin may recognise cost outside the GRN's own
              financial year. Shorten the window, or ask one of them to save this GRN.
            </GrnAlert>
          )}
          <div className="mt-2 overflow-x-auto">
            <GrnTable>
              <thead>
                <tr>
                  <GrnTh>Month</GrnTh>
                  {isCustomMode && <GrnTh align="right" className="w-28">%</GrnTh>}
                  <GrnTh className="text-right">Recognised</GrnTh>
                </tr>
              </thead>
              <tbody>
                {schedule.periods.map((period, index) => (
                  <tr key={period} className={GRN_TR}>
                    <GrnTd>{monthLabel(period)}</GrnTd>
                    {isCustomMode && (
                      <GrnTd>
                        <GrnInput
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max="100"
                          step="0.01"
                          className="w-24 text-right"
                          value={value.customPercentages?.[period] ?? 0}
                          disabled={disabled}
                          onChange={(e) => updatePct(period, Number(e.target.value))}
                        />
                      </GrnTd>
                    )}
                    <GrnTd className="text-right tabular-nums">
                      {money(schedule.amounts[index])}
                    </GrnTd>
                  </tr>
                ))}
                <tr className={GRN_TR}>
                  <GrnTd>
                    <span className="font-semibold">Total</span>
                    <GrnCellSub>
                      {isCustomMode
                        ? `${schedule.periods.length} months, custom split`
                        : `${schedule.periods.length} months, split equally`}
                    </GrnCellSub>
                  </GrnTd>
                  {isCustomMode && (
                    <GrnTd className="text-right tabular-nums">
                      <span className={
                        Math.abs(schedule.pctSum - 100) > 0.01
                          ? "font-semibold text-red-600"
                          : "font-semibold text-green-700"
                      }>
                        {schedule.pctSum.toFixed(2)}%
                      </span>
                    </GrnTd>
                  )}
                  <GrnTd className="text-right font-semibold tabular-nums">
                    {money(schedule.total)}
                  </GrnTd>
                </tr>
              </tbody>
            </GrnTable>
            {isCustomMode && Math.abs(schedule.pctSum - 100) > 0.01 && (
              <div className="mt-1">
                <GrnAlert tone="crit">
                  Percentages must total 100% — currently {schedule.pctSum.toFixed(2)}%.
                </GrnAlert>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
