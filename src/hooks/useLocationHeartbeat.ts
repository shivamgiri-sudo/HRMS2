import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { hrmsApi } from "@/lib/hrmsApi";
import { storeJwtForSW, clearJwtFromSW, enqueuePosition } from "@/lib/locationDb";

const HEARTBEAT_INTERVAL_MS = 60_000;
// Relaxed to 500m — office/building GPS commonly reads 100–300m. Strict 50m
// filter caused latestPosRef to stay null and nothing ever posted indoors.
const MAX_ACCURACY_METERS = 500;

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
        // Allow cached positions up to 2 minutes old — prevents indoor GPS
        // timeout (was 0, meaning forced fresh fix every call, which fails
        // silently when the device can't get a lock within timeout seconds)
        maximumAge: 120_000,
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

    // On hide: send a keepalive beacon immediately so the server has a fresh
    // captured_at before the browser throttles/freezes our timers.
    // On show: post immediately if the last heartbeat is stale (tab was
    // backgrounded for > 1 minute and the interval may have been suspended).
    function onVisibilityChange() {
      const pos = latestPosRef.current;
      if (!pos) return;
      if (document.visibilityState === "hidden") {
        // keepalive: true keeps the request alive after the page is hidden
        const token = localStorage.getItem("hrms_access_token");
        if (!token) return;
        try {
          fetch("/api/location/heartbeat", {
            method: "POST",
            keepalive: true,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy }),
          }).catch(() => {});
          lastPostRef.current = Date.now();
        } catch { /* ignore */ }
      } else {
        const now = Date.now();
        if (now - lastPostRef.current >= HEARTBEAT_INTERVAL_MS) {
          void postLocation(pos.latitude, pos.longitude, pos.accuracy);
        }
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
