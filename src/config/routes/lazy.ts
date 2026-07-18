import { lazy as reactLazy } from "react";
import type { ComponentType } from "react";

export function lazyWithRecovery<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  return reactLazy(async () => {
    try {
      return await factory();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      const isChunkFailure =
        /Failed to fetch dynamically imported module/i.test(message) ||
        /Importing a module script failed/i.test(message) ||
        /error loading dynamically imported module/i.test(message);
      if (isChunkFailure && typeof window !== "undefined") {
        const reloadKey = "hrms-chunk-reload";
        if (sessionStorage.getItem(reloadKey) !== "1") {
          sessionStorage.setItem(reloadKey, "1");
          window.location.reload();
          return new Promise<never>(() => {});
        }
      }
      throw error;
    }
  });
}

export const lazy = lazyWithRecovery;
