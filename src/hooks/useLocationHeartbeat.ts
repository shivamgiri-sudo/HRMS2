import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

// Heartbeat interval — server resolves location from the request IP (geoip).
// No browser GPS permission is requested or needed.
const HEARTBEAT_INTERVAL_MS = 60_000;

export function useLocationHeartbeat() {
  const { user } = useAuth();
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPostRef = useRef<number>(0);

  useEffect(() => {
    if (!user) return;

    function ping() {
      const token = localStorage.getItem("hrms_access_token");
      if (!token) return;
      const now = Date.now();
      if (now - lastPostRef.current < HEARTBEAT_INTERVAL_MS) return;
      lastPostRef.current = now;
      // keepalive:true keeps the request alive even when the tab is backgrounded
      fetch("/api/location/heartbeat", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      }).catch(() => {});
    }

    // Immediate first ping on login/mount
    ping();

    // Regular interval — still fires when tab is active
    timerRef.current = setInterval(ping, HEARTBEAT_INTERVAL_MS);

    // Ping on tab-hide (keepalive ensures it completes before timers freeze)
    // Ping on tab-show (catch up if interval was throttled while backgrounded)
    function onVisibilityChange() {
      lastPostRef.current = 0; // force send regardless of last time
      ping();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [user?.id]);
}
