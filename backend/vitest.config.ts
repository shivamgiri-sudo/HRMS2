import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts", "src/**/__tests__/**/*.test.ts", "scripts/**/*.test.ts"],
    env: loadEnv("test", process.cwd(), ""),
    envFile: ".env.test",
    coverage: {
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
    },
  },
}));
