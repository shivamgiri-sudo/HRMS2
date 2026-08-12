import { useMemo } from "react";
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
 * The clamp is stated, never silent. A July-to-June policy is nine months here, not twelve, and
 * the panel says so — a shorter list appearing without explanation reads as a bug.
 */

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** April through March, matching every other financial-year derivation in the codebase. */
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

/**
 * The same split the server performs: truncate to paise, last row absorbs the residue by
 * subtraction. Rounding each row independently would drift, and a final row SMALLER than the
 * others reads as an error to whoever checks it.
 */
function equalSplit(amount: number, periods: string[]): number[] {
  if (!periods.length) return [];
  const totalPaise = Math.round(Number(amount) * 100);
  const base = Math.trunc(totalPaise / periods.length);
  const rows = periods.map(() => base / 100);
  rows[rows.length - 1] = (base + (totalPaise - base * periods.length)) / 100;
  return rows;
}

export type MonthSplitValue = {
  startPeriod: string;
  endPeriod: string;
};

export function MonthSplitPanel({
  value,
  onChange,
  amount,
  accountingPeriod,
  disabled,
}: {
  value: MonthSplitValue;
  onChange: (next: MonthSplitValue) => void;
  /** The figure that will actually be spread — the P&L cost, not the invoice gross. */
  amount: number;
  /** The month the GRN books to; the financial year is derived from it. */
  accountingPeriod: string;
  disabled?: boolean;
}) {
  const enabled = Boolean(value.startPeriod || value.endPeriod);

  const schedule = useMemo(() => {
    if (!value.startPeriod || !value.endPeriod) return null;
    const financialYear = financialYearOf(accountingPeriod);
    if (!financialYear) {
      return { error: "Set the bill date first — the financial year is derived from it." };
    }
    const requested = monthsBetween(value.startPeriod, value.endPeriod);
    if (!requested.length) {
      return { error: "The last month cannot fall before the first." };
    }
    const periods = requested.filter((p) => financialYearOf(p) === financialYear);
    if (!periods.length) {
      return {
        error: `None of ${monthLabel(value.startPeriod)} – ${monthLabel(value.endPeriod)} falls in FY ${financialYear}. Raise this against a bill date inside the same year.`,
      };
    }
    const amounts = equalSplit(amount, periods);
    return {
      financialYear,
      periods,
      amounts,
      clamped: periods.length !== requested.length,
      requestedCount: requested.length,
      total: amounts.reduce((sum, n) => sum + n, 0),
    };
  }, [value.startPeriod, value.endPeriod, amount, accountingPeriod]);

  return (
    <div>
      <GrnFieldRow
        label="Recognise across months"
        hint={
          enabled
            ? "The cost is spread equally across these months. The invoice, the payable and the budget consumption all stay in the accounting month — only the P&L is spread."
            : "Leave blank for a single-month invoice. Set a range for an annual policy, AMC or any pre-paid service."
        }
      >
        {!enabled ? (
          <GrnChip
            active={false}
            onClick={() => {
              if (disabled) return;
              // Seed with the accounting month itself, so the first thing shown is a valid
              // one-month schedule the raiser then widens.
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
          {schedule.clamped && (
            <GrnAlert tone="warn">
              {schedule.periods.length} of the {schedule.requestedCount} months you selected fall
              in FY {schedule.financialYear}. The whole amount is recognised across those{" "}
              {schedule.periods.length} — nothing carries into the next financial year.
            </GrnAlert>
          )}
          <div className="mt-2 overflow-x-auto">
            <GrnTable>
              <thead>
                <tr>
                  <GrnTh>Month</GrnTh>
                  <GrnTh className="text-right">Recognised</GrnTh>
                </tr>
              </thead>
              <tbody>
                {schedule.periods.map((period, index) => (
                  <tr key={period} className={GRN_TR}>
                    <GrnTd>{monthLabel(period)}</GrnTd>
                    <GrnTd className="text-right tabular-nums">
                      {money(schedule.amounts[index])}
                    </GrnTd>
                  </tr>
                ))}
                <tr className={GRN_TR}>
                  <GrnTd>
                    <span className="font-semibold">Total</span>
                    {/* The reconciliation is the point of the panel: it must equal the amount
                        being spread, to the paise, or the P&L will not tie at month end. */}
                    <GrnCellSub>{schedule.periods.length} months, split equally</GrnCellSub>
                  </GrnTd>
                  <GrnTd className="text-right font-semibold tabular-nums">
                    {money(schedule.total)}
                  </GrnTd>
                </tr>
              </tbody>
            </GrnTable>
          </div>
        </div>
      )}
    </div>
  );
}
