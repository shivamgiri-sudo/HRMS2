import { beforeEach, describe, expect, it, vi } from "vitest";
import { peekRedirect, rememberRedirect, sanitizeRedirect, takeRedirect } from "./postLoginRedirect";

describe("sanitizeRedirect", () => {
  it("accepts same-origin paths with query and hash", () => {
    expect(sanitizeRedirect("/profile?tab=documents")).toBe("/profile?tab=documents");
    expect(sanitizeRedirect("/payroll/pf-management?tab=esi-reg#x")).toBe("/payroll/pf-management?tab=esi-reg#x");
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "http://evil.com",
    "https://evil.com/x",
    "javascript:alert(1)",
    "profile",
    "",
    "/pro\nfile",
    "/a\\b",
    "/auth",
    "/auth?x=1",
    "/two-factor",
    "/change-password",
  ])("rejects %j", (value) => {
    expect(sanitizeRedirect(value)).toBeNull();
  });

  it("rejects non-strings and oversize values", () => {
    expect(sanitizeRedirect(undefined)).toBeNull();
    expect(sanitizeRedirect(42)).toBeNull();
    expect(sanitizeRedirect("/" + "a".repeat(2001))).toBeNull();
  });
});

describe("remember / take", () => {
  // vitest runs in the node environment here, so provide a minimal sessionStorage.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });

  it("stores a safe path, peek keeps it, take clears it", () => {
    rememberRedirect("/profile?tab=statutory");
    expect(peekRedirect()).toBe("/profile?tab=statutory");
    expect(peekRedirect()).toBe("/profile?tab=statutory");
    expect(takeRedirect()).toBe("/profile?tab=statutory");
    expect(takeRedirect()).toBe("/dashboard");
  });

  it("ignores an unsafe value and keeps the default", () => {
    rememberRedirect("//evil.com");
    expect(takeRedirect()).toBe("/dashboard");
  });
});
