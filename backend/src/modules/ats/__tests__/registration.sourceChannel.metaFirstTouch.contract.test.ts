import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../../../..");

describe("walk-in registration keeps a Meta lead's Social Media source", () => {
  const src = fs.readFileSync(
    path.join(backendRoot, "src/modules/ats/registration.enhanced.routes.ts"),
    "utf8",
  );
  const keep =
    "sourcing_channel = CASE WHEN sourcing_channel = 'Social Media' THEN sourcing_channel ELSE ? END";

  it("both UPDATEs that write sourcing_channel on an existing candidate preserve Social Media", () => {
    expect(src.split(keep).length - 1).toBe(2);
  });

  it("no UPDATE overwrites sourcing_channel unconditionally", () => {
    expect(src).not.toMatch(/sourcing_channel = \?/);
  });
});
