import { useEffect, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Spellings and neighbouring names that mean "the same place" for a branch city check.
const CITY_ALIASES: Record<string, string> = {
  gurgaon: "gurugram", bangalore: "bengaluru", bombay: "mumbai", calcutta: "kolkata",
  madras: "chennai", poona: "pune", baroda: "vadodara", "new delhi": "delhi",
  "greater noida": "noida", "gautam buddh nagar": "noida", "gautam buddha nagar": "noida",
};

function normCity(v?: string | null): string {
  const base = String(v ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return CITY_ALIASES[base] ?? base;
}

/** True only when both cities are known and clearly different. Unknown on either side = no warning. */
export function isDifferentCity(branchCity?: string | null, enteredCity?: string | null): boolean {
  const a = normCity(branchCity);
  const b = normCity(enteredCity);
  if (!a || !b) return false;
  return a !== b && !a.includes(b) && !b.includes(a);
}

/**
 * Non-blocking heads-up shown when the CURRENT address city differs from the branch's city. It
 * never prevents saving or moving on — a candidate may genuinely be relocating — it only asks them
 * to double-check, because this address is later verified with a live GPS selfie.
 * Shown once per distinct city, so editing the same city again does not re-trigger it.
 */
export function BranchCityNotice({ branchName, branchCity, presentCity }: {
  branchName?: string | null;
  branchCity?: string | null;
  presentCity?: string | null;
}) {
  const reference = branchCity || branchName;
  const [open, setOpen] = useState(false);
  const shownFor = useRef<string>("");

  useEffect(() => {
    const entered = normCity(presentCity);
    if (!entered || shownFor.current === entered) return;
    if (isDifferentCity(reference, presentCity)) {
      shownFor.current = entered;
      setOpen(true);
    }
  }, [presentCity, reference]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Please check your current address</AlertDialogTitle>
          <AlertDialogDescription>
            You are joining the <strong>{branchName || branchCity}</strong> branch, but the current address you
            entered is in <strong>{presentCity}</strong>. Please enter the address where you are{" "}
            <strong>currently living</strong>. It will be verified later using your live location, so it must be
            your correct current residential address — not your permanent or hometown address. If it is correct,
            you can continue.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => setOpen(false)}>OK, I understand</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
