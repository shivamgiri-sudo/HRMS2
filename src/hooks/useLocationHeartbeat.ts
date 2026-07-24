import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { hrmsApi } from "@/lib/hrmsApi";
import { storeJwtForSW, clearJwtFromSW, enqueuePosition } from "@/lib/locationDb";

const HEARTBEAT_INTERVAL_MS = 60_000; // 60s — stable indoor GPS, less map fluctuation

export function useLocationHeartbeat() {
  const { user } = useAuth();
  const watchIdRef  = useRef<number | null>(null);
  const lastSentRef = useRef<number>(0);

  // Keep JWT in IndexedDB so the SW Background Sync handler can use it
  useEffect(() => {
    if (!user) {
      void clearJwtFromSW();
      return;
    }
    const sync = () => {
      const token = localStorage.getItem("hrms_access_token");
      if (token) void storeJwtForSW(token);
    };
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [user?.id]);

  // GPS heartbeat — accurate, silent after first permission grant
  useEffect(() => {
    if (!user || !("geolocation" in navigator)) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const now = Date.now();
        if (now - lastSentRef.current < HEARTBEAT_INTERVAL_MS) return;
        lastSentRef.current = now;

        const { latitude, longitude, accuracy } = pos.coords;
        try {
          await hrmsApi.post("/api/location/heartbeat", { latitude, longitude, accuracy });
          await enqueuePosition({ latitude, longitude, accuracy });
          triggerBackgroundSync();
        } catch {
          void enqueuePosition({ latitude, longitude, accuracy })
            .then(() => triggerBackgroundSync());
        }
      },
      () => { /* permission denied — silent, no fallback */ },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [user?.id]);
}

function triggerBackgroundSync() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready.then((reg) => {
    if ("sync" in reg) {
      (reg as any).sync.register("location-heartbeat").catch(() => {});
    }
  }).catch(() => {});
}
