import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import App from "./App.tsx";
import "./index.css";

async function clearLegacyServiceWorkers() {
  if (!("serviceWorker" in navigator)) return;

  let hadLegacyRuntime = false;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    hadLegacyRuntime = hadLegacyRuntime || registrations.length > 0;
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch (error) {
    console.warn("Failed to unregister service workers", error);
  }

  if (!("caches" in window)) return;

  try {
    const cacheKeys = await caches.keys();
    hadLegacyRuntime = hadLegacyRuntime || cacheKeys.length > 0;
    await Promise.all(cacheKeys.map((key) => caches.delete(key)));
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

void clearLegacyServiceWorkers();

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} forcedTheme="light">
    <App />
  </ThemeProvider>
);
