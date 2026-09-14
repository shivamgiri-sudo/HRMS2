/**
 * Every upload type the Sales Dashboard offers must have a route that can accept it.
 *
 * WHY THIS EXISTS
 *   NativeSalesDashboard has always POSTed to /api/sales-upload/upload/:type and DELETEd
 *   /api/sales-upload/batch/:id. The seven handlers existed in sales-upload.service.ts the
 *   whole time — uploadBellavitaSales/Apr/Chat/Cart, uploadGncSales/Apr/Allocation and
 *   deleteUploadBatch — and nothing called them, because the routes were never written. So
 *   every upload and every batch deletion failed, and a missing /api route answers 401 rather
 *   than 404, which reads as a permissions problem rather than an absent feature.
 *
 *   The drift that produced it is the drift this guards: the page's list of upload types and
 *   the server's list of handlers are maintained in two files, in two trees, by hand.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { salesUploadRouter } from "../sales-upload.routes.js";

const REPO = resolve(__dirname, "../../../../..");

/** The upload types the frontend actually offers, read from its own source. */
function frontendUploadTypes(): string[] {
  const src = readFileSync(resolve(REPO, "src/pages/NativeSalesDashboard.tsx"), "utf8");
  const block = src.slice(src.indexOf("UPLOAD_OPTIONS"), src.indexOf("function UploadPanel"));
  return [...block.matchAll(/type:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
}

/** Paths registered on the router, with the method, in registration order. */
function registeredRoutes(): Array<{ method: string; path: string }> {
  const stack = (salesUploadRouter as unknown as { stack: Array<Record<string, any>> }).stack ?? [];
  const out: Array<{ method: string; path: string }> = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods ?? {})) {
      out.push({ method: method.toUpperCase(), path: String(layer.route.path) });
    }
  }
  return out;
}

describe("sales upload routes exist", () => {
  it("registers POST /upload/:type and DELETE /batch/:batchId", () => {
    const routes = registeredRoutes();
    expect(
      routes.some((r) => r.method === "POST" && r.path === "/upload/:type"),
      `POST /upload/:type is not registered. The page cannot upload anything without it. ` +
        `Registered: ${routes.map((r) => `${r.method} ${r.path}`).join(", ")}`
    ).toBe(true);
    expect(
      routes.some((r) => r.method === "DELETE" && r.path === "/batch/:batchId"),
      "DELETE /batch/:batchId is not registered, so 'delete this upload batch' cannot succeed."
    ).toBe(true);
  });

  it("does not let a bare parameter route shadow the literal upload paths", () => {
    // Express matches in order. A "/:something" registered ahead of "/upload-neemans-apr"
    // would swallow it, and the failure would look like a handler bug rather than ordering.
    const routes = registeredRoutes();
    const firstBareParam = routes.findIndex((r) => /^\/:[^/]+$/.test(r.path));
    if (firstBareParam === -1) return;
    const literalsAfter = routes.slice(firstBareParam).filter((r) => !r.path.includes(":"));
    expect(
      literalsAfter,
      `these literal routes are registered after a bare /:param and are unreachable: ` +
        literalsAfter.map((r) => r.path).join(", ")
    ).toEqual([]);
  });
});

describe("the page and the server agree on the upload types", () => {
  const types = frontendUploadTypes();

  it("finds the frontend's list, so this test cannot pass by reading nothing", () => {
    expect(types.length, "UPLOAD_OPTIONS not parsed from NativeSalesDashboard.tsx").toBeGreaterThanOrEqual(7);
  });

  it("every type the page offers is handled by the server", () => {
    // The handler map lives in the routes file; reading its source keeps this honest even
    // though the map itself is not exported.
    const routeSrc = readFileSync(resolve(__dirname, "../sales-upload.routes.ts"), "utf8");
    const handled = new Set([...routeSrc.matchAll(/\["([a-z0-9-]+)",\s*svc\.upload/g)].map((m) => m[1]));

    const missing = types.filter((t) => !handled.has(t));
    expect(
      missing,
      `The Sales Dashboard offers upload type(s) the server cannot handle: ${missing.join(", ")}.\n` +
        `They would return 400 "Unknown upload type". Add them to UPLOAD_HANDLERS in ` +
        `sales-upload.routes.ts, pointing at the matching svc.upload* function.`
    ).toEqual([]);
  });
});
