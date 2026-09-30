import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 2026-09-30 outage guard. Database-level DDL at startup (ALTER DATABASE, and CREATE DATABASE even with
 * IF NOT EXISTS) takes a schema metadata lock that queues behind any long-running query, which blocks every
 * new connection and keeps the backend from starting (nginx 502). Startup must read SCHEMATA first and only
 * issue CREATE DATABASE when the schema is genuinely missing, and must never ALTER DATABASE.
 */
describe("startup database DDL", () => {
  const src = readFileSync(new URL("../src/db/runPendingMigrations.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("async function ensureDatabaseExists"), src.indexOf("async function runFileOnConnection"));
  const fn = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // code only — comments may name the statements

  it("never issues ALTER DATABASE", () => {
    expect(fn).not.toMatch(/ALTER\s+DATABASE/i);
  });

  it("checks information_schema.SCHEMATA before any CREATE DATABASE", () => {
    const check = fn.indexOf("information_schema.SCHEMATA");
    const create = fn.indexOf("CREATE DATABASE");
    expect(check).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(check);
    expect(fn).toMatch(/existing\.length === 0/);
  });
});
