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
      '/api': {
        target: 'http://localhost:5055',
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
    chunkSizeWarningLimit: 800,
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
          return undefined;
        },
      },
    },
  },
}));
