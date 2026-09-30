import { describe, expect, it, vi } from "vitest";

const anyWritable = vi.hoisted(() => vi.fn());
vi.mock("../../pd.config.service.js", () => ({ hasAnyWritableProcess: anyWritable, isProcessReadable: vi.fn(), isProcessWritable: vi.fn() }));
vi.mock("../../pd.source.js", () => ({ PdError: class extends Error {} }));
vi.mock("../../../../logger.js", () => ({ logger: { error: vi.fn() } }));
const { requireAnyWritable } = await import("../ext.routes.js");

const run = async (ok: boolean) => {
  anyWritable.mockResolvedValue(ok);
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }; const next = vi.fn();
  await requireAnyWritable({ authUser: { id: "u1" } } as never, res as never, next);
  return { res, next };
};

describe("requireAnyWritable (process-less admin helpers)", () => {
  it("lets a caller with write scope over some process through", async () => {
    const { res, next } = await run(true);
    expect(next).toHaveBeenCalledWith(); expect(res.status).not.toHaveBeenCalled();
  });
  it("403s a caller who administers no process (e.g. a viewer-only manager)", async () => {
    const { res, next } = await run(false);
    expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
  });
});
