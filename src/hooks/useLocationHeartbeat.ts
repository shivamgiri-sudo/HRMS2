import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { hrmsApi } from "@/lib/hrmsApi";

const HEARTBEAT_INTERVAL_MS = 30_000;

export function useLocationHeartbeat() {
  const { user } = useAuth();
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<number>(0);

  useEffect(() => {
    if (!user || !("geolocation" in navigator)) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSentRef.current < HEARTBEAT_INTERVAL_MS) return;
        lastSentRef.current = now;

        hrmsApi.post("/api/location/heartbeat", {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }).catch(() => { /* silent — heartbeat is best-effort */ });
      },
      () => { /* permission denied or unavailable — silent */ },
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 10_000 },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [user?.id]);
}
