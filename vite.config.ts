import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { VitePWA } from "vite-plugin-pwa";

// Plugin to update APP_VERSION from git tags before build
function versionUpdatePlugin(): Plugin {
  return {
    name: "version-update",
    buildStart() {
      const scriptPath = path.resolve(__dirname, "scripts/update-version.sh");
      if (existsSync(scriptPath)) {
        try {
          console.log("📦 Updating APP_VERSION from git tags...");
          execSync(`bash "${scriptPath}"`, { stdio: "inherit" });
        } catch (error) {
          // Non-fatal: continue build even if version update fails
          console.warn("⚠️ Version update skipped:", (error as Error).message);
        }
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
  },
  preview: {
    host: "0.0.0.0",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    mode === "production" && versionUpdatePlugin(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "favicon.svg", "pwa-192x192.png", "pwa-512x512.png"],
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        importScripts: ["sw-push.js"],
      },
      manifest: {
        name: "Peoplo - HR Management System",
        short_name: "Peoplo",
        description: "Comprehensive HR management system for employee onboarding, leave tracking, asset management, and payroll processing.",
        theme_color: "#0284C5",
        background_color: "#edf3f7",
        display: "standalone",
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
          },
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: ["lucide-react"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react":   ["react", "react-dom", "react-router-dom"],
          "vendor-query":   ["@tanstack/react-query"],
          "vendor-ui":      ["@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-select", "@radix-ui/react-tabs", "@radix-ui/react-tooltip"],
          "vendor-utils":   ["date-fns", "clsx", "tailwind-merge", "class-variance-authority"],
          "vendor-icons":   ["lucide-react"],
        },
      },
    },
  },
}));
