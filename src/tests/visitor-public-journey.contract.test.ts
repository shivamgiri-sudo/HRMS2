import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildVisitorRegisterQrData, buildVisitorStatusQrData } from "@/integrations/apis/qrCode.api";
import { extractToken } from "@/pages/VisitorStatusPage";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("public visitor journey", () => {
  describe("entry QR", () => {
    // Visitors were expected to scan their way into the form, but nothing in the
    // product ever generated a code — /visitor-register was reachable only by
    // typing the URL.
    it("points at the public registration route", () => {
      expect(buildVisitorRegisterQrData()).toMatch(/\/visitor-register$/);
    });

    it("can pre-select the branch the code is printed for", () => {
      expect(buildVisitorRegisterQrData("branch-42")).toMatch(/\/visitor-register\?branch=branch-42$/);
    });

    it("builds a tracking URL the status route can parse", () => {
      expect(buildVisitorStatusQrData("abc123")).toMatch(/\/visitor-status\/abc123$/);
    });

    it("escapes tokens rather than interpolating them raw", () => {
      expect(buildVisitorStatusQrData("a/b?c")).toContain("a%2Fb%3Fc");
    });
  });

  describe("status lookup", () => {
    // /visitor-status with no token used to render "no tracking token found"
    // with no way forward, even though the register page links there.
    it("accepts a full tracking link pasted from the visitor's phone", () => {
      expect(extractToken("https://mcnhrms.teammas.in/visitor-status/deadbeef01")).toBe("deadbeef01");
    });

    it("accepts a bare token", () => {
      expect(extractToken("  deadbeef01  ")).toBe("deadbeef01");
    });

    it("returns empty for junk so the submit button stays disabled", () => {
      expect(extractToken("   ")).toBe("");
    });
  });

  describe("registration page wiring", () => {
    const page = read("src/pages/VisitorSelfRegister.tsx");

    it("renders a scannable QR on the confirmation instead of only a raw URL", () => {
      expect(page).toContain("buildVisitorStatusQrData");
      expect(page).toContain("Scan to track your visit");
    });

    it("searches hosts as the visitor types rather than behind a button", () => {
      expect(page).toContain("setTimeout");
      expect(page).not.toMatch(/onClick=\{searchHosts\}/);
    });

    it("honours the branch pre-selected by a desk QR", () => {
      expect(page).toContain("useSearchParams");
      expect(page).toContain('params.get("branch")');
    });

    it("uses MAS brand colours, not the old teal palette", () => {
      expect(page).toContain("#1B6AB5");
      expect(page).not.toMatch(/0d9488|0f766e|teal-/);
    });
  });

  describe("public surface stays unauthenticated", () => {
    const publicRoutes = read("src/config/routes/public.routes.tsx");
    const backend = read("backend/src/modules/visitor/visitor-public.routes.ts");
    const app = read("backend/src/app.ts");

    it("keeps the visitor routes outside ProtectedRoute", () => {
      for (const route of ["/visitor-register", "/visitor-status/:token", "/visitor-status"]) {
        const line = publicRoutes.split("\n").find(l => l.includes(`path="${route}"`));
        expect(line, `route ${route} missing`).toBeTruthy();
        expect(line).not.toContain("ProtectedRoute");
      }
    });

    it("never applies auth middleware to the public visitor router", () => {
      expect(backend).not.toContain("requireAuth");
      expect(backend).toContain("rateLimit");
    });

    it("mounts the public router before the authenticated visitor routers", () => {
      const pub = app.indexOf('app.use("/api/visitor/public"');
      const authed = app.indexOf('app.use("/api/visitor", visitorRouter)');
      expect(pub).toBeGreaterThan(-1);
      expect(authed).toBeGreaterThan(-1);
      expect(pub).toBeLessThan(authed);
    });
  });
});
