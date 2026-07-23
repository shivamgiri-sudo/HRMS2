import { useEffect, useState } from "react";
import { CloudSun, Quote, Sparkles } from "lucide-react";
import { useSmartGreeting } from "@/integrations/hooks/useSmartGreeting";
import { useGeoCapture } from "@/hooks/useGeoCapture";
import { defaultBranchLocation } from "@/integrations/apis/weather.api";
import { reverseGeocode } from "@/integrations/apis/reverseGeocode.api";
import type { BranchLocation } from "@/integrations/types/integrations.types";

interface LoginSmartGreetingProps {
  employeeName?: string;
}

const cleanDisplayName = (value?: string) => {
  const cleanValue = value?.trim();
  if (!cleanValue) return "Team MAS";

  return cleanValue
    .split("@")[0]
    .replace(/[._-]/g, " ")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
};

export function LoginSmartGreeting({ employeeName }: LoginSmartGreetingProps) {
  const displayName = cleanDisplayName(employeeName);
  const captureGeo = useGeoCapture();
  const [location, setLocation] = useState<BranchLocation>(defaultBranchLocation);

  useEffect(() => {
    captureGeo().then(async ({ latitude, longitude }) => {
      if (latitude !== null && longitude !== null) {
        const cityName = await reverseGeocode(latitude, longitude);
        setLocation({ label: cityName ?? "Your Location", latitude, longitude });
      }
    });
  }, []);

  const { greeting, weather, quote, advisory, isLoading } = useSmartGreeting(displayName, location);

  return (
    <div className="mb-5 overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-lg shadow-sm ring-1 ring-sky-100">
          {weather.icon || <CloudSun className="h-5 w-5 text-sky-700" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-black text-slate-950">{greeting}</p>
            {isLoading && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-sky-700 ring-1 ring-sky-100">
                <Sparkles className="h-3 w-3 animate-pulse" />
                Updating
              </span>
            )}
          </div>

          <p className="mt-1 text-xs leading-5 text-slate-600">
            {weather.condition} near {weather.locationLabel}. {advisory}
          </p>

          <div className="mt-3 rounded-xl border border-white/80 bg-white/75 px-3 py-2">
            <div className="flex gap-2">
              <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-700" />
              <p className="text-[11px] leading-5 text-slate-600">
                {quote.content}
                <span className="font-semibold text-slate-500"> — {quote.author}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
