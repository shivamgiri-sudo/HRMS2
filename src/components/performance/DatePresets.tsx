import { Button } from "@/components/ui/button";
import { subDays, subMonths, startOfYear, startOfQuarter, subQuarters } from "date-fns";

interface DatePresetsProps {
  onSelect: (start: Date, end: Date) => void;
}

export function DatePresets({ onSelect }: DatePresetsProps) {
  const presets = [
    {
      label: "Last 30 days",
      getValue: () => ({
        start: subDays(new Date(), 30),
        end: new Date(),
      }),
    },
    {
      label: "Last quarter",
      getValue: () => ({
        start: startOfQuarter(subQuarters(new Date(), 1)),
        end: subQuarters(new Date(), 1),
      }),
    },
    {
      label: "Last 6 months",
      getValue: () => ({
        start: subMonths(new Date(), 6),
        end: new Date(),
      }),
    },
    {
      label: "This year",
      getValue: () => ({
        start: startOfYear(new Date()),
        end: new Date(),
      }),
    },
    {
      label: "All time",
      getValue: () => ({
        start: new Date(2020, 0, 1),
        end: new Date(),
      }),
    },
  ];

  return (
    <div className="flex flex-wrap gap-1">
      {presets.map((preset) => (
        <Button
          key={preset.label}
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            const { start, end } = preset.getValue();
            onSelect(start, end);
          }}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
}
