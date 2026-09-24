import { NON_SHIFT_CHOICES, SHIFT_GROUP_ORDER, type ShiftOption } from "./teamRosterFormat";

/**
 * The <option>/<optgroup> body shared by the grid cell select and the change dialog: shifts grouped
 * Templates / In use / Shift master (only the groups that have entries), then Week off / Training /
 * Unscheduled. The value of a shift is `SHIFT:HH:MM-HH:MM`.
 */
export default function ShiftChoiceOptions({ options }: { options: ShiftOption[] }) {
  return (
    <>
      {SHIFT_GROUP_ORDER.map((group) => {
        const inGroup = options.filter((o) => o.group === group);
        if (inGroup.length === 0) return null;
        return (
          <optgroup key={group} label={group}>
            {inGroup.map((o) => (
              <option key={o.key} value={`SHIFT:${o.key}`}>{o.useCount > 0 && group !== "Templates" ? `${o.label} (${o.useCount} in use)` : o.label}</option>
            ))}
          </optgroup>
        );
      })}
      <optgroup label="Other">
        {NON_SHIFT_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
      </optgroup>
    </>
  );
}

