import { Info } from "lucide-react";
import { useIsReadOnly } from "@/contexts/AuthContext";

export function ReadOnlyBanner() {
  const isReadOnly = useIsReadOnly();

  if (!isReadOnly) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
      <div className="flex items-center justify-center gap-2 text-sm">
        <Info className="h-4 w-4 text-amber-700 shrink-0" />
        <p className="font-semibold text-amber-900">
          Your account is in <strong>read-only mode</strong>. You can view your data but cannot make changes.
        </p>
      </div>
    </div>
  );
}
