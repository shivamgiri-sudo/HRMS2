import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { hrmsApi } from "@/lib/hrmsApi";
import { storeJwtForSW, clearJwtFromSW, enqueuePosition } from "@/lib/locationDb";

const HEARTBEAT_INTERVAL_MS = 60_000;

export function useLocationHeartbeat() {
  const { user } = useAuth();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Fixed-interval snapshot — ONE reading per minute, no continuous watching.
  // watchPosition fires on every GPS chip update (noisy indoors, causes jumping).
  // getCurrentPosition on a timer gives one stable reading per interval.
  useEffect(() => {
    if (!user || !("geolocation" in navigator)) return;

    function snap() {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
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
        () => { /* permission denied — silent */ },
        // maximumAge: 300_000 — use any position the browser already has cached
        // in the last 5 minutes. Returns instantly on page load without waiting
        // for a fresh GPS fix. Avoids the 5–15s cold-start delay.
        { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
      );
    }

    snap(); // fire immediately on login / page load
    timerRef.current = setInterval(snap, HEARTBEAT_INTERVAL_MS);

    // Also re-snap when the tab becomes visible again (user switches back to HRMS)
    function onVisible() {
      if (document.visibilityState === "visible") snap();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
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
