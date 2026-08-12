/**
 * One build stamp, read by every process that has to say which code it is running.
 *
 * The release certificate must prove backend runtime SHA, worker runtime SHA and built
 * artifact SHA all agree. Only the API served its version; the worker reported nothing, so
 * its SHA could only be INFERRED from having restarted in the same pm2 batch as the API — and
 * a worker left running a stale artifact satisfies that inference silently.
 *
 * The loader is shared rather than copied because two copies can disagree about where the
 * stamp lives or what a missing file means, which is the drift this codebase keeps producing.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, beforeEach } from "vitest";
import { readBuildInfo, UNKNOWN_BUILD, __resetBuildInfoCacheForTests } from "../buildInfo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, "..", "..", "..");

beforeEach(() => __resetBuildInfoCacheForTests());

describe("readBuildInfo", () => {
  it("resolves to 'unknown' rather than throwing when the stamp is absent", () => {
    // Running from source there is no dist/build-info.json, which is exactly the shape of a
    // broken build. It must degrade to a truthful answer, not take the process down — a
    // diagnostic that throws is worse than one that admits it does not know.
    const info = readBuildInfo();
    expect(info).toEqual(UNKNOWN_BUILD);
    expect(info.commit).toBe("unknown");
  });

  it("caches, so repeated reads cannot disagree within one process", () => {
    expect(readBuildInfo()).toBe(readBuildInfo());
  });
});

describe("both runtimes report the same stamp", () => {
  it("the worker entrypoint logs its build on startup", () => {
    const src = fs.readFileSync(path.join(BACKEND, "src", "workers", "all-workers.ts"), "utf8");
    expect(src).toMatch(/readBuildInfo\(\)/);
    expect(src).toMatch(/Build: commit=/);
  });

  it("the health route and the worker use the SAME loader, not two copies", () => {
    const worker = fs.readFileSync(path.join(BACKEND, "src", "workers", "all-workers.ts"), "utf8");
    const health = fs.readFileSync(path.join(BACKEND, "src", "routes", "health.routes.ts"), "utf8");
    for (const src of [worker, health]) {
      expect(src).toMatch(/from "\.\.\/shared\/buildInfo\.js"/);
    }
    // Neither may re-implement the read — that is how the two would drift apart.
    expect(health).not.toMatch(/build-info\.json/);
    expect(worker).not.toMatch(/build-info\.json/);
  });

  it("health.routes still re-exports readBuildInfo for existing importers", () => {
    const health = fs.readFileSync(path.join(BACKEND, "src", "routes", "health.routes.ts"), "utf8");
    expect(health).toMatch(/export \{[^}]*readBuildInfo/);
  });
});
