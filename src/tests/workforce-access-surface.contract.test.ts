import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * useWorkforceAccess returns `{ ...roleQuery, ...access }`. roleQuery is the
 * react-query result object, so anything living at `roleQuery.data.X` is NOT on
 * the hook's own surface — reading `X` off the hook yields undefined, silently.
 *
 * That is not hypothetical. `primaryRole` sits at roleQuery.data.primaryRole and
 * was never copied into `access`, while PayslipCenterRoute destructured it
 * directly from the hook. The check `primaryRole === "employee"` was therefore
 * always false, and every employee opening /payroll/payslips was handed
 * NativePayslipCenter — the admin payroll console — instead of their payslips.
 * TypeScript could not catch it: spreading a react-query result produces a wide
 * type, so the property read type-checks and just evaluates to undefined.
 *
 * These tests pin the hook's surface against every destructuring of it.
 */

const root = resolve(process.cwd(), "src");
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Keys the hook adds itself, i.e. the object literal returned from its useMemo. */
function accessKeys(source: string): string[] {
  const start = source.indexOf("const access = useMemo(() => {");
  const end = source.indexOf("}, [roleQuery.data]);", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = source.slice(start, end);
  const returnStart = block.lastIndexOf("return {");
  return [...block.slice(returnStart).matchAll(/^ {6}(\w+)\s*[:,]/gm)].map((m) => m[1]);
}

/** Fields reachable through the spread of the react-query result itself. */
const QUERY_FIELDS = new Set([
  "data", "error", "isLoading", "isPending", "isFetching", "isError", "isSuccess",
  "isRefetching", "refetch", "status", "fetchStatus", "dataUpdatedAt", "errorUpdatedAt",
  "failureCount", "failureReason", "isStale", "isPlaceholderData", "isFetched",
  "isFetchedAfterMount", "isInitialLoading", "isPaused", "isRefetchError",
  "isLoadingError", "promise",
]);

describe("useWorkforceAccess surface contract", () => {
  const hookSource = read("src/hooks/useUserRole.ts");
  const keys = accessKeys(hookSource);

  it("exposes primaryRole, the field PayslipCenterRoute routes employees on", () => {
    expect(keys).toContain("primaryRole");
    expect(hookSource).toContain("primaryRole: roleQuery.data?.primaryRole ?? null");
  });

  it("exposes every field any call site destructures from it", () => {
    const available = new Set([...keys, ...QUERY_FIELDS]);
    const offenders: string[] = [];

    for (const file of collectSourceFiles(root)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("useWorkforceAccess()")) continue;

      for (const match of source.matchAll(/const\s*\{([^}]*)\}\s*=\s*useWorkforceAccess\(\)/g)) {
        const destructured = match[1]
          .split(",")
          .map((part) => part.split(":")[0].trim())
          .filter((name) => /^\w+$/.test(name));

        for (const name of destructured) {
          if (!available.has(name)) {
            offenders.push(`${file.replace(root, "src")} destructures "${name}"`);
          }
        }
      }
    }

    // A name here reads as undefined at runtime with no type error — exactly the
    // failure that routed employees into the admin payroll console.
    expect(offenders).toEqual([]);
  });

  it("still routes employees to their own payslip viewer", () => {
    const routes = read("src/config/routes/payroll.routes.tsx");
    expect(routes).toContain('primaryRole === "employee"');
    expect(routes).toContain("<PayslipViewer");
  });
});
