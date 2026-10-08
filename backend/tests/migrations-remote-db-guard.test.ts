import { describe, expect, it } from "vitest";
import { isLocalOrPrivateDbHost, shouldSkipMigrationsForRemoteDb } from "../src/db/runPendingMigrations.js";

describe("startup migrations against a remote database", () => {
  it("treats loopback and private hosts as local", () => {
    for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.11.225", "172.16.0.5", "172.31.255.1", "db.local"]) {
      expect(isLocalOrPrivateDbHost(h), h).toBe(true);
    }
  });
  it("treats public hosts as remote", () => {
    for (const h of ["122.184.128.90", "172.32.0.1", "172.15.0.1", "db.example.com"]) {
      expect(isLocalOrPrivateDbHost(h), h).toBe(false);
    }
  });
  it("never skips in production or test", () => {
    expect(shouldSkipMigrationsForRemoteDb("production", "122.184.128.90", undefined)).toBe(false);
    expect(shouldSkipMigrationsForRemoteDb("test", "122.184.128.90", undefined)).toBe(false);
  });
  it("skips a development process pointed at a public database unless forced", () => {
    expect(shouldSkipMigrationsForRemoteDb("development", "122.184.128.90", undefined)).toBe(true);
    expect(shouldSkipMigrationsForRemoteDb("development", "122.184.128.90", "true")).toBe(false);
  });
  it("does not skip a development process on a local/private database", () => {
    expect(shouldSkipMigrationsForRemoteDb("development", "localhost", undefined)).toBe(false);
    expect(shouldSkipMigrationsForRemoteDb("development", "192.168.11.225", undefined)).toBe(false);
  });
});
