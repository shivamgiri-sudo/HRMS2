import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { hrmsApi } from "@/lib/hrmsApi";
import { storeJwtForSW, clearJwtFromSW, enqueuePosition } from "@/lib/locationDb";

const HEARTBEAT_INTERVAL_MS = 30_000;
const IP_GEO_URL = "https://ipwho.is/";

async function fetchIpPosition(): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  try {
    const res = await fetch(IP_GEO_URL, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.success && data.latitude && data.longitude) {
      return { latitude: data.latitude, longitude: data.longitude, accuracy: 5000 };
    }
    return null;
  } catch {
    return null;
  }
}

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

  // Silent IP-based heartbeat — no GPS permission prompt, no alerts
  useEffect(() => {
    if (!user) return;

    async function beat() {
      const pos = await fetchIpPosition();
      if (!pos) return;
      try {
        await hrmsApi.post("/api/location/heartbeat", {
          latitude: pos.latitude,
          longitude: pos.longitude,
          accuracy: pos.accuracy,
        });
        await enqueuePosition(pos);
        triggerBackgroundSync();
      } catch {
        // Network failure — queue for SW retry, no error shown to user
        void enqueuePosition(pos).then(() => triggerBackgroundSync());
      }
    }

    void beat(); // fire immediately on login
    timerRef.current = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
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
