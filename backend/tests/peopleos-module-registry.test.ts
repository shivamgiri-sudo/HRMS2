/**
 * PeopleOS Module Registry Validation Tests
 *
 * CI must fail if:
 * - Two PRODUCTION modules declare the same canonical route
 * - A PRODUCTION module has no business_owner or production_readiness
 * - A module with contains_pii=true or contains_payroll_data=true has audit_required=false
 * - A module has an invalid status or readiness value
 * - A module's canonical_route doesn't start with /
 * - The registry JSON is not parseable or schema-invalid
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = resolve(__dirname, "../../config/peopleos-module-registry.json");

interface ModuleEntry {
  module_code: string;
  module_name: string;
  domain: string;
  business_owner: string;
  technical_owner: string;
  canonical_route: string;
  legacy_routes?: string[];
  canonical_api: string;
  legacy_apis?: string[];
  authoritative_tables?: string[];
  roles: string[];
  scope_dimensions?: string[];
  status: string;
  production_readiness: string;
  contains_pii: boolean;
  contains_payroll_data: boolean;
  audit_required: boolean;
  replacement_target?: string | null;
  deprecation_date?: string | null;
  test_coverage?: string;
  known_gaps?: string[];
}

interface Registry {
  modules: ModuleEntry[];
}

const VALID_STATUSES = new Set(["PRODUCTION", "CONTROLLED_PILOT", "BETA", "LEGACY", "REDIRECT_ONLY", "DISABLED", "PLANNED"]);
const VALID_READINESS = new Set(["READY", "PARTIAL", "BLOCKED", "UNVERIFIED"]);
const VALID_DOMAINS = new Set(["people", "recruitment", "workforce", "payroll", "performance", "learning", "employee-experience", "finance", "compliance", "platform", "external-portals"]);

let registry: Registry;

try {
  const raw = readFileSync(REGISTRY_PATH, "utf-8");
  registry = JSON.parse(raw) as Registry;
} catch (err) {
  throw new Error(`Failed to parse module registry at ${REGISTRY_PATH}: ${String(err)}`);
}

describe("PeopleOS Module Registry", () => {
  it("registry file must be parseable JSON with a modules array", () => {
    expect(registry).toBeDefined();
    expect(Array.isArray(registry.modules)).toBe(true);
    expect(registry.modules.length).toBeGreaterThan(0);
  });

  it("every module must have required fields", () => {
    const required: (keyof ModuleEntry)[] = [
      "module_code", "module_name", "domain", "business_owner", "technical_owner",
      "canonical_route", "canonical_api", "roles", "status", "production_readiness",
      "contains_pii", "contains_payroll_data", "audit_required"
    ];
    for (const mod of registry.modules) {
      for (const field of required) {
        expect(mod[field], `${mod.module_code}.${field} must be present`).toBeDefined();
      }
    }
  });

  it("every module must have a unique module_code", () => {
    const codes = registry.modules.map(m => m.module_code);
    const unique = new Set(codes);
    expect(unique.size, `Duplicate module_codes found: ${codes.filter((c, i) => codes.indexOf(c) !== i)}`).toBe(codes.length);
  });

  it("no two PRODUCTION modules may declare the same canonical_route", () => {
    const productionModules = registry.modules.filter(m => m.status === "PRODUCTION");
    const routes = productionModules.map(m => m.canonical_route);
    const duplicates = routes.filter((r, i) => routes.indexOf(r) !== i);
    expect(duplicates, `Duplicate PRODUCTION canonical routes: ${duplicates}`).toHaveLength(0);
  });

  it("every PRODUCTION or CONTROLLED_PILOT module must have a non-empty business_owner", () => {
    for (const mod of registry.modules) {
      if (mod.status === "PRODUCTION" || mod.status === "CONTROLLED_PILOT") {
        expect(mod.business_owner, `${mod.module_code} business_owner must not be empty`).toBeTruthy();
      }
    }
  });

  it("every PRODUCTION or CONTROLLED_PILOT module must have a valid production_readiness", () => {
    for (const mod of registry.modules) {
      if (mod.status === "PRODUCTION" || mod.status === "CONTROLLED_PILOT") {
        expect(VALID_READINESS.has(mod.production_readiness), `${mod.module_code} has invalid readiness: ${mod.production_readiness}`).toBe(true);
      }
    }
  });

  it("every module must have a valid status value", () => {
    for (const mod of registry.modules) {
      expect(VALID_STATUSES.has(mod.status), `${mod.module_code} has invalid status: ${mod.status}`).toBe(true);
    }
  });

  it("every module must have a valid domain value", () => {
    for (const mod of registry.modules) {
      expect(VALID_DOMAINS.has(mod.domain), `${mod.module_code} has invalid domain: ${mod.domain}`).toBe(true);
    }
  });

  it("every canonical_route must start with /", () => {
    for (const mod of registry.modules) {
      expect(mod.canonical_route.startsWith("/"), `${mod.module_code} canonical_route must start with /`).toBe(true);
    }
  });

  it("every canonical_api must start with /", () => {
    for (const mod of registry.modules) {
      expect(mod.canonical_api.startsWith("/"), `${mod.module_code} canonical_api must start with /`).toBe(true);
    }
  });

  it("modules with contains_pii=true must have audit_required=true", () => {
    for (const mod of registry.modules) {
      if (mod.contains_pii) {
        expect(mod.audit_required, `${mod.module_code} contains PII but audit_required is false`).toBe(true);
      }
    }
  });

  it("modules with contains_payroll_data=true must have audit_required=true", () => {
    for (const mod of registry.modules) {
      if (mod.contains_payroll_data) {
        expect(mod.audit_required, `${mod.module_code} contains payroll data but audit_required is false`).toBe(true);
      }
    }
  });

  it("every module must have at least one role", () => {
    for (const mod of registry.modules) {
      expect(Array.isArray(mod.roles) && mod.roles.length > 0, `${mod.module_code} must have at least one role`).toBe(true);
    }
  });

  it("no legacy_route may equal its own canonical_route", () => {
    for (const mod of registry.modules) {
      for (const legacy of (mod.legacy_routes ?? [])) {
        expect(legacy, `${mod.module_code} legacy_route ${legacy} must not equal canonical_route`).not.toBe(mod.canonical_route);
      }
    }
  });

  it("PRODUCTION modules with BLOCKED readiness must have known_gaps listed", () => {
    for (const mod of registry.modules) {
      if (mod.status === "PRODUCTION" && mod.production_readiness === "BLOCKED") {
        expect(Array.isArray(mod.known_gaps) && mod.known_gaps.length > 0,
          `${mod.module_code} is PRODUCTION+BLOCKED but has no known_gaps — must document why`).toBe(true);
      }
    }
  });

  it("registry must cover all expected critical domains", () => {
    const domains = new Set(registry.modules.map(m => m.domain));
    for (const required of ["people", "recruitment", "workforce", "payroll", "external-portals", "platform"]) {
      expect(domains.has(required), `Registry missing modules for domain: ${required}`).toBe(true);
    }
  });

  it("snapshot: registry must contain at least 25 modules", () => {
    expect(registry.modules.length).toBeGreaterThanOrEqual(25);
  });
});
