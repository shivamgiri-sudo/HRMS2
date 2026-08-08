/**
 * GET /api/processes/my-processes — the two things that silently break it.
 *
 * WHY THIS EXISTS
 *   ProcessPayrollReadiness called /api/process/my-processes (singular) for as long as it has
 *   existed. Nothing was mounted at /api/process, so the query always failed, assignedProcesses
 *   was permanently [], and the page told EVERY user "No processes are assigned to your
 *   account. Contact your HR admin to map you to a process." — while 26 users did have a
 *   mapping. A missing /api route answers 401 rather than 404, so it never looked like a
 *   missing endpoint.
 *
 *   The endpoint now exists. These are the two ways it goes quietly dead again.
 */
import { describe, expect, it } from "vitest";

import { processRouter } from "../process.routes.js";
import { processController } from "../process.controller.js";

/** Literal paths in the order Express will try them. */
function registeredGetPaths(): string[] {
  const stack = (processRouter as unknown as { stack: Array<Record<string, any>> }).stack ?? [];
  return stack
    .filter((layer) => layer.route && layer.route.methods?.get)
    .map((layer) => String(layer.route.path));
}

describe("GET /my-processes route registration", () => {
  it("is registered before /:id, or it is unreachable", () => {
    // Express matches in registration order. Declared after "/:id", a request for
    // /my-processes is handled by getById with id="my-processes" and answers
    // "Process not found" — the literal route never runs, and nothing about that failure
    // says "route ordering". This assertion is the whole reason the handler works.
    const paths = registeredGetPaths();
    const mine = paths.indexOf("/my-processes");
    const wildcard = paths.indexOf("/:id");

    expect(mine, "/my-processes is not registered on processRouter at all").toBeGreaterThan(-1);
    expect(
      wildcard === -1 || mine < wildcard,
      `"/my-processes" must be registered before "/:id". Current order: ${paths.join(", ")}`
    ).toBe(true);
  });
});

describe("GET /my-processes identity handling", () => {
  it("answers 401 when there is no authenticated user, rather than falling back to a parameter", () => {
    // The caller used to send ?userId=... and the obvious implementation would read it.
    // That would let anyone enumerate another user's process assignments by editing a query
    // string, so the handler takes the id from the verified token only. Passing a userId
    // while unauthenticated must NOT produce data.
    let status = 0;
    let body: unknown = null;
    const res = {
      status(code: number) { status = code; return this; },
      json(payload: unknown) { body = payload; return this; },
    };

    const req = { authUser: undefined, query: { userId: "somebody-elses-id" } };

    return processController
      .listMyProcesses(req as never, res as never)
      .then(() => {
        expect(status, "an unauthenticated caller supplying ?userId must be refused").toBe(401);
        expect(body).toMatchObject({ success: false });
      });
  });
});
