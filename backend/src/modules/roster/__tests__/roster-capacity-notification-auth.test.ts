import { describe, it, expect, vi } from "vitest";

vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

import { readFileSync } from "fs";
import { resolve } from "path";

describe("roster-capacity.routes.ts — notification endpoints require role", () => {
  it("GET /notifications/:employeeId has requireRole call", () => {
    const src = readFileSync(
      resolve("src/modules/roster/roster-capacity.routes.ts"),
      "utf8"
    );
    const notifBlock = src.slice(src.indexOf("notifications/:employeeId"));
    expect(notifBlock).toMatch(/requireRole\(/);
  });

  it("PATCH /notifications/:notificationId/read has requireRole call", () => {
    const src = readFileSync(
      resolve("src/modules/roster/roster-capacity.routes.ts"),
      "utf8"
    );
    const patchBlock = src.slice(src.indexOf("notifications/:notificationId/read"));
    expect(patchBlock).toMatch(/requireRole\(/);
  });
});
