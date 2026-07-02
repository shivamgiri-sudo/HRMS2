import { useState } from "react";
import { MapPin, Loader2, CheckCircle2 } from "lucide-react";
import { fetchPincodeDetails } from "@/integrations/apis/pincode.api";
import type { PincodeDetails } from "@/integrations/types/integrations.types";

interface PincodeAutoFillProps {
  className?: string;
  onApply: (details: PincodeDetails, pincode: string) => void;
}

export function PincodeAutoFill({ className = "", onApply }: PincodeAutoFillProps) {
  const [pincode, setPincode] = useState("");
  const [details, setDetails] = useState<PincodeDetails | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [message, setMessage] = useState("Enter 6-digit Indian PIN code to auto-fill city/state.");


  const handleLookup = async () => {
    const cleanPincode = pincode.trim();

    if (!/^[1-9][0-9]{5}$/.test(cleanPincode)) {
      setDetails(null);
      setStatus("error");
      setMessage("Please enter a valid 6-digit Indian PIN code.");
      return;
    }

    setStatus("loading");
    setMessage("Checking India Post pincode directory...");

    try {
      const nextDetails = await fetchPincodeDetails(cleanPincode);

      if (!nextDetails) {
        setDetails(null);
        setStatus("error");
        setMessage("No matching location found. Please verify the PIN code.");
        return;
      }

      setDetails(nextDetails);
      setStatus("ready");
      setMessage(`${nextDetails.district}, ${nextDetails.state}, ${nextDetails.country}`);
    } catch {
      setDetails(null);
      setStatus("error");
      setMessage("Pincode service is unavailable. You can continue manually.");
    }
  };

  const applyDetails = () => {
    if (!details) return;
    onApply(details, pincode.trim());
    setMessage("Location added to the form. Please review before submitting.");
  };

  return (
    <div className={`rounded-xl border border-slate-200 bg-slate-50 p-3 ${className}`} data-hrms-pincode-widget="true">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
        <MapPin className="h-3.5 w-3.5 text-sky-700" />
        Pincode Auto-Fill
      </div>

      <div className="flex gap-2">
        <input
          value={pincode}
          onChange={(event) => {
            setPincode(event.target.value.replace(/\D/g, "").slice(0, 6));
            if (status !== "idle") {
              setStatus("idle");
              setDetails(null);
              setMessage("Enter 6-digit Indian PIN code to auto-fill city/state.");
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleLookup();
            }
          }}
          placeholder="201301"
          inputMode="numeric"
          maxLength={6}
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
        />
        <button
          type="button"
          onClick={handleLookup}
          disabled={status === "loading"}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}
        </button>
      </div>

      <div className={`mt-2 text-xs leading-5 ${status === "error" ? "text-red-600" : status === "ready" ? "text-emerald-700" : "text-slate-500"}`}>
        {message}
      </div>

      {details && (
        <button
          type="button"
          onClick={applyDetails}
          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Apply {details.district}, {details.state}
        </button>
      )}
    </div>
  );
}
