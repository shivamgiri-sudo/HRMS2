import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { LogIn, LogOut, MapPin, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useQueryClient } from "@tanstack/react-query";

interface WebPunchState {
  punch_in: string | null;
  punch_out: string | null;
}

interface Props {
  employeeId: string;
  initialState?: WebPunchState;
  onPunch?: (state: WebPunchState) => void;
}

async function getGps(): Promise<{ latitude: number; longitude: number; location_name: string } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        location_name: `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`,
      }),
      () => resolve(null),
      { timeout: 5000 },
    );
  });
}

export function WebPunchButton({ employeeId, initialState, onPunch }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<WebPunchState>(initialState ?? { punch_in: null, punch_out: null });
  const qc = useQueryClient();

  const isPunchedIn = !!state.punch_in;
  const isPunchedOut = !!state.punch_out;

  async function handlePunch() {
    setLoading(true);
    setError(null);
    try {
      const loc = await getGps();
      const endpoint = isPunchedIn ? "/api/wfm/attendance/web-punch-out" : "/api/wfm/attendance/web-punch-in";
      const res = await hrmsApi.post<{ success: boolean; web_punch_in?: string; web_punch_out?: string; error?: string }>(
        endpoint,
        loc ?? {},
      );
      if (!res.success) throw new Error(res.error ?? "Punch failed");

      const next: WebPunchState = {
        punch_in: res.web_punch_in ?? state.punch_in,
        punch_out: res.web_punch_out ?? state.punch_out,
      };
      setState(next);
      onPunch?.(next);
      qc.invalidateQueries({ queryKey: ["attendance-ncosec"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Punch failed");
    } finally {
      setLoading(false);
    }
  }

  const label = isPunchedOut
    ? "Web punched out"
    : isPunchedIn
    ? "Web Punch Out"
    : "Web Punch In";

  const Icon = isPunchedIn ? LogOut : LogIn;

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant={isPunchedIn ? "outline" : "default"}
        disabled={loading || isPunchedOut}
        onClick={handlePunch}
        className="gap-2 text-xs"
      >
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Icon className="w-3 h-3" />
        )}
        {label}
        <MapPin className="w-3 h-3 text-slate-400" />
      </Button>

      {state.punch_in && (
        <p className="text-[11px] text-slate-500">
          In: {new Date(state.punch_in).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          {state.punch_out && (
            <> · Out: {new Date(state.punch_out).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</>
          )}
        </p>
      )}

      {error && <p className="text-[11px] text-red-500">{error}</p>}

      <p className="text-[10px] text-slate-400">
        Web punch is for presence validation only. Attendance status is determined by biometric data.
      </p>
    </div>
  );
}
