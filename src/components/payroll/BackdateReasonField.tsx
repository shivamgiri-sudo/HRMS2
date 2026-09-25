import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { backdateNeedsReason } from "@/hooks/useDateLockMin";

export const MIN_BACKDATE_REASON_LENGTH = 5;

interface BackdateReasonFieldProps {
  /** The salary start / effective date currently picked (YYYY-MM-DD). */
  date: string;
  /** Date of joining (YYYY-MM-DD), when known. */
  joiningDate?: string | null;
  value: string;
  onChange: (value: string) => void;
}

/**
 * Shown only when the picked salary date is before today or before the date of joining - a date
 * only payroll_head / super_admin can pick, and one the server refuses without a written reason
 * (REASON_REQUIRED). It is recorded in the salary start date audit trail.
 */
export function BackdateReasonField({
  date,
  joiningDate,
  value,
  onChange,
}: BackdateReasonFieldProps) {
  if (!backdateNeedsReason(date, joiningDate)) return null;
  const tooShort = value.trim().length < MIN_BACKDATE_REASON_LENGTH;
  return (
    <div className="mt-2 max-w-sm">
      <Label className="text-[10px] font-medium mb-1 block text-amber-700">
        Reason for backdating <span className="text-red-500">*</span>
      </Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={500}
        placeholder="Why does salary start before joining / before today?"
        aria-invalid={tooShort}
        className="h-8 text-xs rounded-lg border-amber-300"
      />
      <p
        className={`mt-1 text-[10px] ${tooShort ? "text-red-600" : "text-slate-400"}`}
      >
        Saved in the audit trail. At least {MIN_BACKDATE_REASON_LENGTH}{" "}
        characters.
      </p>
    </div>
  );
}
