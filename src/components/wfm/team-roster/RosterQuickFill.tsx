import { useMemo, useState } from "react";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { GridRow } from "@/hooks/useTeamRoster";
import ShiftChoiceOptions from "./ShiftChoiceOptions";
import {
  computeBulkFill,
  computeRepeatWeek,
  describeSkipped,
  pageShiftOptions,
  type BulkEdit,
  type BulkResult,
  type StagedLookup,
} from "./rosterBulkFill";
import { parseChoice, type TemplateProcess } from "./teamRosterFormat";

const WEEKDAY_CHIPS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const;

interface Props {
  rows: GridRow[];
  dates: string[];
  today: string;
  templates: TemplateProcess[];
  staged: StagedLookup;
  onApply: (edits: BulkEdit[]) => void;
}

/**
 * Time-savers for roster creation: one choice applied to many cells ("apply to all"), optionally
 * limited to some weekdays, plus "repeat week 1" to copy a filled first week across the range.
 * Everything only stages edits locally; nothing is saved or submitted until the manager does so.
 */
export default function RosterQuickFill({
  rows,
  dates,
  today,
  templates,
  staged,
  onApply,
}: Props) {
  const [choiceValue, setChoiceValue] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [onlyBlank, setOnlyBlank] = useState(true);
  const shiftOptions = useMemo(
    () => pageShiftOptions(rows, templates),
    [rows, templates],
  );
  const choice = parseChoice(choiceValue);

  const finish = (result: BulkResult, what: string) => {
    if (result.edits.length === 0) {
      toast.info(`Nothing to fill. ${describeSkipped(result.skipped)}`.trim());
      return;
    }
    onApply(result.edits);
    const skipped = describeSkipped(result.skipped);
    toast.success(
      `${what}: ${result.edits.length} cell${result.edits.length === 1 ? "" : "s"} filled${skipped ? ` (skipped ${skipped})` : ""}. Review, then save the draft.`,
    );
  };

  const applyToAll = () => {
    if (!choice) return;
    finish(
      computeBulkFill({
        rows,
        dates,
        today,
        templates,
        staged,
        choice,
        weekdays,
        onlyBlank,
      }),
      "Applied",
    );
  };
  const repeatWeek = () =>
    finish(
      computeRepeatWeek({ rows, dates, today, templates, staged, onlyBlank }),
      "Repeated week 1",
    );

  const toggleDay = (day: number) =>
    setWeekdays((d) =>
      d.includes(day) ? d.filter((x) => x !== day) : [...d, day],
    );
  const canRepeat = dates.length > 7;

  return (
    <div
      className="rounded-xl border border-blue-100 bg-blue-50/60 p-3"
      role="group"
      aria-label="Quick fill"
    >
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-blue-900">
        <Wand2 className="h-4 w-4" aria-hidden /> Quick fill
        <span className="text-xs font-normal text-blue-800">
          Set many cells at once instead of one by one. Applies to the{" "}
          {rows.length} {rows.length === 1 ? "person" : "people"} shown.
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="qf-choice">Apply this</Label>
          <select
            id="qf-choice"
            className="h-11 min-w-[190px] rounded-md border border-slate-200 bg-white px-2 text-sm sm:h-9"
            value={choiceValue}
            onChange={(e) => setChoiceValue(e.target.value)}
          >
            <option value="">Choose a shift or week off...</option>
            <ShiftChoiceOptions options={shiftOptions} />
          </select>
        </div>
        <div className="space-y-1">
          <span className="text-sm font-medium leading-none">On days</span>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label="Days of the week"
          >
            {WEEKDAY_CHIPS.map((d) => (
              <button
                key={d.value}
                type="button"
                aria-pressed={weekdays.includes(d.value)}
                onClick={() => toggleDay(d.value)}
                className={`h-11 min-w-[44px] cursor-pointer rounded-md border px-2 text-xs font-medium transition-colors duration-200 sm:h-9 sm:min-w-0 ${weekdays.includes(d.value) ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
              >
                {d.label}
              </button>
            ))}
            <button
              type="button"
              className="h-11 cursor-pointer rounded-md px-2 text-xs text-slate-500 underline sm:h-9"
              onClick={() => setWeekdays([])}
            >
              All days
            </button>
          </div>
        </div>
        <label className="flex h-9 items-center gap-1.5 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={onlyBlank}
            onChange={(e) => setOnlyBlank(e.target.checked)}
          />
          Only cells I have not filled yet
        </label>
        <Button
          type="button"
          size="sm"
          disabled={!choice || rows.length === 0}
          onClick={applyToAll}
        >
          Apply to all
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canRepeat || rows.length === 0}
          onClick={repeatWeek}
          title={
            canRepeat
              ? "Copy each person's first-week pattern to every later week"
              : "Choose a range longer than 7 days"
          }
        >
          Repeat week 1 across range
        </Button>
      </div>
    </div>
  );
}
