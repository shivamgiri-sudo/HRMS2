/**
 * The public appointment-letter accept page.
 *
 * Same constraint as the rest of this suite: no jsdom, no @testing-library, so
 * there is no click-through. What is checked instead is (a) the real component
 * renders its first, loading state under a router, and (b) the behaviours a
 * signer depends on are pinned against the source the same way
 * externalRedirects.test.ts pins the joining-kit page — the public API is the
 * only thing it calls, the redirect navigates the tab, and each failure has its
 * own state rather than one generic error.
 */
import { describe, expect, it } from "vitest";
import * as React from "react";
import fs from "fs";
import path from "path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import EmployeeAppointmentLetterEsignPage from "../EmployeeAppointmentLetterEsignPage";

const ROOT = path.resolve(__dirname, "../..");
const page = fs.readFileSync(path.join(ROOT, "pages/EmployeeAppointmentLetterEsignPage.tsx"), "utf8");
const code = page.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.split("//")[0]).join("\n");
const routes = fs.readFileSync(path.join(ROOT, "config/routes/public.routes.tsx"), "utf8");

describe("EmployeeAppointmentLetterEsignPage — rendering", () => {
  it("renders its loading state for a token route, without needing a session", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employee/appointment-letter/abc123"] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: "/employee/appointment-letter/:token",
            element: React.createElement(EmployeeAppointmentLetterEsignPage),
          }),
        ),
      ),
    );
    expect(html).toContain("Your appointment letter");
    expect(html).toContain("MAS Callnet India Pvt. Ltd.");
    expect(html).toContain('aria-busy="true"');
    // Nothing that needs data is shown before the session has loaded.
    expect(html).not.toContain("Review &amp; Accept");
  });
});

describe("EmployeeAppointmentLetterEsignPage — public, token-gated wiring", () => {
  it("is routed publicly at the exact path the email links to, with no ProtectedRoute", () => {
    const line = routes.split("\n").find((l) => l.includes('path="/employee/appointment-letter/:token"'));
    expect(line, "route missing from public.routes.tsx").toBeTruthy();
    expect(line).toContain("<EmployeeAppointmentLetterEsignPage />");
    expect(line).not.toMatch(/ProtectedRoute|Gate|RequireAuth/);
    expect(routes).toContain('lazy(() => import("@/pages/EmployeeAppointmentLetterEsignPage"))');
  });

  it("talks only to the public appointment-letter API, with plain fetch and never the authenticated client", () => {
    expect(code).not.toMatch(/hrmsApi/);
    const apiCalls = [...code.matchAll(/`(\/api\/[^`]+)`/g)].map((m) => m[1]);
    expect(apiCalls.length).toBeGreaterThanOrEqual(3);
    for (const call of apiCalls) expect(call).toMatch(/^\/api\/public\/appointment-letter\/\$\{token\}\/(session|file|start)/);
    expect(code).toMatch(/fetch\(`\/api\/public\/appointment-letter\/\$\{token\}\/start`,\s*\{\s*method:\s*"POST"/);
  });

  it("reads responses through readPublicJson so a gateway HTML error page is not shown as a broken link", () => {
    expect(code).toContain('from "@/lib/publicJson"');
    expect(code).toMatch(/readPublicJson\(response\)/);
    expect(code).not.toMatch(/await response\.json\(\)/);
  });

  it("navigates the tab to the provider (a popup would be silently blocked after the await) and keeps a manual link", () => {
    expect(code).not.toMatch(/\bwindow\.open\s*\(/);
    expect(code).toMatch(/window\.location\.assign\(providerUrl\)/);
    expect(code).toContain("open the Aadhaar eSign page");
    // Only ever navigates to an http(s) URL from the server.
    expect(code).toMatch(/\/\^https\?:\/i\.test\(providerUrl\)/);
  });

  it("has a distinct state for each way the page can fail or finish", () => {
    expect(code).toContain('"revoked"');
    expect(code).toContain("This letter is no longer valid");
    expect(code).toContain("This link cannot be opened");
    expect(code).toContain("Thank you — you have accepted this letter.");
    expect(code).toContain("esignAvailable");
    expect(code).toContain("contact HR");
    expect(code).toContain("Loader2");
    expect(code).toMatch(/response\.status === 410/);
    expect(code).toMatch(/response\.status === 404/);
  });

  it("requires a deliberate consent before the primary button works, and labels it as specified", () => {
    expect(code).toContain("Review &amp; Accept — Sign with Aadhaar");
    expect(code).toMatch(/disabled=\{busy \|\| !consented \|\| !session\.esignAvailable\}/);
  });

  it("offers the PDF inline and as a plain link (phone browsers blank PDF iframes)", () => {
    expect(code).toMatch(/<iframe/);
    expect((code.match(/href=\{fileUrl\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(code).toContain("Open the letter to read it");
  });

  it("never asks for or shows salary, and reads the session fields the backend actually returns", () => {
    expect(code).not.toMatch(/salary_?snapshot|gross|ctc/i);
    const backend = fs.readFileSync(
      path.resolve(ROOT, "../backend/src/modules/letters/appointmentLetterPublic.service.ts"), "utf8");
    const block = backend.slice(backend.indexOf("export type LetterSession"), backend.indexOf("type LetterRow"));
    const backendKeys = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();
    const typeBlock = page.slice(page.indexOf("type LetterSession"), page.indexOf("/** Why the page"));
    const frontendKeys = [...typeBlock.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();
    expect(frontendKeys).toEqual(backendKeys);
  });
});
