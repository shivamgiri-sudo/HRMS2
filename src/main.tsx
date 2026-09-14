import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App.tsx";
import "./index.css";

const PUSH_SW_URL = "/sw-push.js";

async function clearLegacyServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;

  let hadLegacyRuntime = false;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    // Keep sw-push.js; unregister everything else
    const toRemove = registrations.filter((r) => {
      const scope = r.scope || "";
      const scriptUrl: string = (r as any).active?.scriptURL || (r as any).installing?.scriptURL || (r as any).waiting?.scriptURL || "";
      return !scriptUrl.endsWith(PUSH_SW_URL) && !scope.endsWith("/sw-push/");
    });
    hadLegacyRuntime = hadLegacyRuntime || toRemove.length > 0;
    await Promise.all(toRemove.map((r) => r.unregister()));
  } catch (error) {
    console.warn("Failed to unregister service workers", error);
  }

  if (!("caches" in window)) return;

  try {
    const cacheKeys = await caches.keys();
    // Keep push-related caches; remove legacy ones
    const legacyCaches = cacheKeys.filter((k) => !k.startsWith("push-"));
    hadLegacyRuntime = hadLegacyRuntime || legacyCaches.length > 0;
    await Promise.all(legacyCaches.map((key) => caches.delete(key)));
  } catch (error) {
    console.warn("Failed to clear service worker caches", error);
  }

  const reloadKey = "hrms-sw-reset";
  if (hadLegacyRuntime && !sessionStorage.getItem(reloadKey)) {
    sessionStorage.setItem(reloadKey, "1");
    window.location.reload();
    return;
  }

  sessionStorage.removeItem(reloadKey);
}

async function registerPushServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const existing = await navigator.serviceWorker.getRegistrations();
    const alreadyRegistered = existing.some((r) => {
      const scriptUrl: string = (r as any).active?.scriptURL || (r as any).installing?.scriptURL || (r as any).waiting?.scriptURL || "";
      return scriptUrl.endsWith(PUSH_SW_URL);
    });
    if (!alreadyRegistered) {
      await navigator.serviceWorker.register(PUSH_SW_URL);
    }

    // Register Periodic Background Sync for location heartbeat (Android Chrome PWA)
    const reg = await navigator.serviceWorker.ready;
    if ("periodicSync" in reg) {
      try {
        const status = await (navigator.permissions as any).query({ name: "periodic-background-sync" });
        if (status.state === "granted") {
          await (reg as any).periodicSync.register("location-heartbeat-periodic", {
            minInterval: 30 * 60 * 1000, // 30 minutes
          });
        }
      } catch {
        // periodicSync not available on this browser — silent
      }
    }
  } catch (err) {
    console.warn("Failed to register push service worker", err);
  }
}

function installChunkLoadRecovery() {
  const reloadKey = "hrms-chunk-reload";

  const shouldRecover = (message: string) =>
    /Failed to fetch dynamically imported module/i.test(message)
    || /Importing a module script failed/i.test(message)
    || /error loading dynamically imported module/i.test(message);

  const recover = (message: string) => {
    if (!shouldRecover(message)) return;
    if (sessionStorage.getItem(reloadKey) === "1") return;
    sessionStorage.setItem(reloadKey, "1");
    window.location.reload();
  };

  window.addEventListener("error", (event) => {
    recover(event.message ?? "");
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "";
    recover(message);
  });

  window.addEventListener("load", () => {
    sessionStorage.removeItem(reloadKey);
  }, { once: true });
}

void clearLegacyServiceWorkers().then(() => registerPushServiceWorker());
installChunkLoadRecovery();

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} forcedTheme="light">
    <App />
  </ThemeProvider>
);
