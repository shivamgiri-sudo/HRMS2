import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { hrmsApi } from "@/lib/hrmsApi";
import { storeJwtForSW, clearJwtFromSW, enqueuePosition } from "@/lib/locationDb";

const HEARTBEAT_INTERVAL_MS = 30_000;
const IP_FALLBACK_ACCURACY_THRESHOLD = 500; // metres — use IP if GPS is worse than this

// Free IP geolocation — no API key, no auth, HTTPS, 10k req/hour limit
const IP_GEO_URL = "https://ipwho.is/";

async function getIpPosition(): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  try {
    const res = await fetch(IP_GEO_URL, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.success && data.latitude && data.longitude) {
      return { latitude: data.latitude, longitude: data.longitude, accuracy: 5000 };
    }
    return null;
  } catch {
    return null;
  }
}

async function sendHeartbeat(lat: number, lng: number, accuracy: number | null) {
  await hrmsApi.post("/api/location/heartbeat", {
    latitude: lat,
    longitude: lng,
    accuracy,
  });
}

export function useLocationHeartbeat() {
  const { user } = useAuth();
  const watchIdRef   = useRef<number | null>(null);
  const lastSentRef  = useRef<number>(0);
  const wakeLockRef  = useRef<WakeLockSentinel | null>(null);

  // Keep JWT in IndexedDB so the SW Background Sync handler can use it
  useEffect(() => {
    if (!user) {
      void clearJwtFromSW();
      return;
    }
    const token = localStorage.getItem("hrms_access_token");
    if (token) void storeJwtForSW(token);

    // Re-sync token whenever localStorage changes (token refresh cycle)
    function onStorage(e: StorageEvent) {
      if (e.key === "hrms_access_token" && e.newValue) {
        void storeJwtForSW(e.newValue);
      }
      if (e.key === "hrms_access_token" && !e.newValue) {
        void clearJwtFromSW();
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [user?.id]);

  // Acquire Screen Wake Lock on mobile to keep tab alive while GPS is active
  useEffect(() => {
    if (!user || !("wakeLock" in navigator)) return;
    let released = false;

    navigator.wakeLock.request("screen").then((lock) => {
      if (released) { void lock.release(); return; }
      wakeLockRef.current = lock;
      lock.addEventListener("release", () => { wakeLockRef.current = null; });
    }).catch(() => { /* not available in all contexts */ });

    return () => {
      released = true;
      if (wakeLockRef.current) {
        void wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    };
  }, [user?.id]);

  // Main GPS watch + IP fallback
  useEffect(() => {
    if (!user) return;

    let ipFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    // If GPS is unavailable or denied after 8s, fire one IP-based heartbeat
    ipFallbackTimer = setTimeout(async () => {
      if (lastSentRef.current > 0) return; // GPS already succeeded
      const pos = await getIpPosition();
      if (!pos) return;
      lastSentRef.current = Date.now();
      try {
        await sendHeartbeat(pos.latitude, pos.longitude, pos.accuracy);
      } catch (err) {
        if (import.meta.env.DEV) console.warn("[location-heartbeat:ip-fallback]", err);
        // Queue for Background Sync retry
        void enqueuePosition(pos).then(() => triggerBackgroundSync());
      }
    }, 8_000);

    if (!("geolocation" in navigator)) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        if (ipFallbackTimer) { clearTimeout(ipFallbackTimer); ipFallbackTimer = null; }

        const now = Date.now();
        if (now - lastSentRef.current < HEARTBEAT_INTERVAL_MS) return;
        lastSentRef.current = now;

        const { latitude, longitude, accuracy } = pos.coords;

        // If GPS accuracy is poor on desktop (no real GPS chip), add IP fallback
        if (accuracy > IP_FALLBACK_ACCURACY_THRESHOLD) {
          const ipPos = await getIpPosition();
          // Use GPS coords but augment with knowledge that it's low-accuracy
          if (ipPos && ipPos.latitude !== latitude) {
            // Both available — use GPS but flag the low accuracy
          }
        }

        try {
          await sendHeartbeat(latitude, longitude, accuracy);
          // Also enqueue for SW Background Sync so it retries on network failure
          await enqueuePosition({ latitude, longitude, accuracy });
          triggerBackgroundSync();
        } catch (err) {
          if (import.meta.env.DEV) console.warn("[location-heartbeat]", err);
          // Queue the position — SW will retry when network returns
          void enqueuePosition({ latitude, longitude, accuracy }).then(() => triggerBackgroundSync());
        }
      },
      async () => {
        // GPS denied — try IP fallback immediately
        if (ipFallbackTimer) { clearTimeout(ipFallbackTimer); ipFallbackTimer = null; }
        if (lastSentRef.current > 0) return;
        const pos = await getIpPosition();
        if (!pos) return;
        lastSentRef.current = Date.now();
        try {
          await sendHeartbeat(pos.latitude, pos.longitude, pos.accuracy);
        } catch {
          void enqueuePosition(pos).then(() => triggerBackgroundSync());
        }
      },
      {
        enableHighAccuracy: true,   // use real GPS on mobile
        maximumAge: 15_000,
        timeout: 15_000,
      },
    );

    return () => {
      if (ipFallbackTimer) clearTimeout(ipFallbackTimer);
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
