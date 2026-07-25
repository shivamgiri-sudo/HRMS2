import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { hrmsApi } from "@/lib/hrmsApi";
import { storeJwtForSW, clearJwtFromSW, enqueuePosition } from "@/lib/locationDb";

const HEARTBEAT_INTERVAL_MS = 60_000;
const MAX_ACCURACY_METERS = 50; // only accept GPS-quality readings (≤50m)

export function useLocationHeartbeat() {
  const { user } = useAuth();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastPostRef = useRef<number>(0);
  const latestPosRef = useRef<{ latitude: number; longitude: number; accuracy: number } | null>(null);

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

  useEffect(() => {
    if (!user || !("geolocation" in navigator)) return;

    async function postLocation(latitude: number, longitude: number, accuracy: number) {
      lastPostRef.current = Date.now();
      try {
        await hrmsApi.post("/api/location/heartbeat", { latitude, longitude, accuracy });
        await enqueuePosition({ latitude, longitude, accuracy });
        triggerBackgroundSync();
      } catch {
        void enqueuePosition({ latitude, longitude, accuracy })
          .then(() => triggerBackgroundSync());
      }
    }

    function onPosition(pos: GeolocationPosition) {
      const { latitude, longitude, accuracy } = pos.coords;
      // Ignore low-quality readings (e.g. cell-tower only, accuracy 1000m+)
      if (accuracy > MAX_ACCURACY_METERS) return;
      latestPosRef.current = { latitude, longitude, accuracy };
      const now = Date.now();
      if (now - lastPostRef.current >= HEARTBEAT_INTERVAL_MS) {
        void postLocation(latitude, longitude, accuracy);
      }
    }

    // watchPosition is OS-level — Android Chrome keeps it running in background.
    // setInterval/setTimeout are frozen by the browser after ~60s when backgrounded.
    watchIdRef.current = navigator.geolocation.watchPosition(
      onPosition,
      () => { /* permission denied or unavailable — silent */ },
      {
        enableHighAccuracy: true,
        maximumAge: 0,        // always get a fresh GPS fix, never serve stale cache
        timeout: 20_000,
      },
    );

    // Fallback: also post every minute from the latest cached position.
    // This covers the case where GPS hasn't moved (watchPosition doesn't fire
    // if position unchanged) but we still want a heartbeat.
    timerRef.current = setInterval(() => {
      const pos = latestPosRef.current;
      if (!pos) return;
      const now = Date.now();
      if (now - lastPostRef.current >= HEARTBEAT_INTERVAL_MS) {
        void postLocation(pos.latitude, pos.longitude, pos.accuracy);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // When user switches back to tab: post immediately if stale
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      const pos = latestPosRef.current;
      if (!pos) return;
      const now = Date.now();
      if (now - lastPostRef.current >= HEARTBEAT_INTERVAL_MS) {
        void postLocation(pos.latitude, pos.longitude, pos.accuracy);
      }
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
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
