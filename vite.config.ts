import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { execFileSync } from "child_process";
import { existsSync } from "fs";

function versionUpdatePlugin(): Plugin {
  return {
    name: "version-update",
    buildStart() {
      const scriptPath = path.resolve(__dirname, "scripts/update-version.mjs");
      if (!existsSync(scriptPath)) return;

      try {
        console.log("Updating APP_VERSION from git tags...");
        execFileSync(process.execPath, [scriptPath], { stdio: "inherit" });
      } catch (error) {
        // Non-fatal: continue build even if version update fails.
        console.warn("Version update skipped:", (error as Error).message);
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    proxy: {
      // Explicit 127.0.0.1, not 'localhost' — on Windows + Node 20+, Node's
      // autoSelectFamily (Happy Eyeballs) races 127.0.0.1 vs ::1 when resolving
      // 'localhost' inside Vite's own http-proxy request, and on this machine
      // that race hangs indefinitely even though both addresses answer fine to
      // every other HTTP client (curl, PowerShell, a browser). Only the proxy's
      // own outbound connection was affected — the dev server's public host
      // binding above is unrelated and stays 0.0.0.0. Confirmed live: every
      // /api/* request through localhost:8080 hung 45s+ before this change,
      // and connecting to the backend directly on either address family always
      // worked, isolating the hang to this one DNS-resolution path.
      '/api': {
        target: 'http://127.0.0.1:5055',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    mode === "production" && versionUpdatePlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    chunkSizeWarningLimit: 500,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/.test(id)) return "vendor-react";
          if (id.includes("@tanstack/react-query")) return "vendor-query";
          if (id.includes("@radix-ui/")) return "vendor-ui";
          if (id.includes("@tanstack/react-virtual")) return "vendor-virtual";
          if (/[\\/]node_modules[\\/](date-fns|clsx|tailwind-merge|class-variance-authority)[\\/]/.test(id)) return "vendor-utils";
          if (id.includes("recharts")) return "vendor-charts";
          if (/[\\/]node_modules[\\/](jspdf|jspdf-autotable)[\\/]/.test(id)) return "vendor-pdf";
          if (/[\\/]node_modules[\\/](apexcharts|react-apexcharts)[\\/]/.test(id)) return "vendor-apex";
          if (id.includes("xlsx")) return "vendor-xlsx";
          if (id.includes("framer-motion")) return "vendor-motion";
          if (/[\\/]node_modules[\\/](@xyflow|@dagrejs)[\\/]/.test(id)) return "vendor-xyflow";
          return undefined;
        },
      },
    },
  },
}));
