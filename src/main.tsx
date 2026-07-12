import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./index.css";

// With registerType:'autoUpdate', VitePWA bakes skipWaiting into the SW and
// reloads via the activated event internally — onNeedRefresh is never called
// in that mode. We still call registerSW so the SW is registered on first load.
registerSW({ immediate: false });

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} forcedTheme="light">
    <App />
  </ThemeProvider>
);
