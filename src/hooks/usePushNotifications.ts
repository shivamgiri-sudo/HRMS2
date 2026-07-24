import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { hrmsApi } from "@/lib/hrmsApi";

// Push subscriptions via backend API
// Push subscriptions are not available in local MySQL deployment.
// Service worker registration is preserved for future PWA support.

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const { user } = useAuth();
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setIsSupported(supported);

    if (supported) {
      setPermission(Notification.permission);
      checkExistingSubscription();
    }
  }, []);

  const checkExistingSubscription = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setIsSubscribed(!!subscription);
    } catch {
      setIsSubscribed(false);
    }
  };

  const subscribe = useCallback(async () => {
    if (!user || !isSupported) return false;

    console.info("[PushNotifications] Push notifications via backend API — push subscriptions not available in local deployment");
    setIsLoading(true);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setIsLoading(false);
        return false;
      }

      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        console.info("[PushNotifications] VAPID public key not configured — push disabled");
        setIsLoading(false);
        return false;
      }

      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      });

      // Persist subscription to backend
      try {
        await hrmsApi.post("/api/push/subscribe", {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.toJSON().keys?.p256dh,
            auth: subscription.toJSON().keys?.auth,
          },
          userAgent: navigator.userAgent,
        });
      } catch (err) {
        console.warn("[PushNotifications] Failed to persist subscription to backend:", err);
      }

      setIsSubscribed(true);
      setIsLoading(false);
      return true;
    } catch (err) {
      console.error("Push subscription error:", err);
      setIsLoading(false);
      return false;
    }
  }, [user, isSupported]);

  const unsubscribe = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Remove from backend first, then unsubscribe
        try {
          await hrmsApi.delete("/api/push/subscribe", { data: { endpoint: subscription.endpoint } });
        } catch {
          /* best-effort */
        }
        await subscription.unsubscribe();
      }

      setIsSubscribed(false);
    } catch (err) {
      console.error("Push unsubscribe error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  return {
    isSupported,
    isSubscribed,
    permission,
    isLoading,
    subscribe,
    unsubscribe,
  };
}
