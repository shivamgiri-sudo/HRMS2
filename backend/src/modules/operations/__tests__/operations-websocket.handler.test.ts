import { describe, expect, it, vi, beforeEach } from "vitest";
import type WebSocket from "ws";
import type { IncomingMessage } from "http";

/**
 * The WebSocket handshake used to accept ANY non-empty token string — the TODO at the old
 * line 33 said "For now, accept all authenticated connections" but nothing behind it actually
 * checked the token was a real, current, authorized session. This proves the fix: the same
 * checks the equivalent HTTP endpoints (operations-live.routes.ts's requireAuth+requireRole)
 * already enforce now also gate the socket — invalid signature, expired, pre_auth (2FA-pending),
 * revoked account, and wrong role are all refused; only a real token for an allowed role opens
 * the connection.
 *
 * Note: as of this fix, nothing in the repo wires this handler to an http.Server upgrade
 * listener and the frontend client only polls HTTP — so this class is currently unreachable.
 * That does not make the check moot to test: it is exactly the kind of code that gets wired up
 * later by someone trusting it already does the right thing.
 */

vi.mock("../../auth/auth.service.js", () => ({
  authService: { verifyAccessToken: vi.fn() },
}));
vi.mock("../../../shared/accountStatus.js", () => ({
  isAccountRevoked: vi.fn(),
}));
vi.mock("../../../shared/roleResolver.js", () => ({
  getUserRoleContext: vi.fn(),
}));
vi.mock("../operations-live.service.js", () => ({
  operationsLiveService: {
    getLiveStatus: vi.fn(),
    getRosterVsActual: vi.fn(),
    getAttritionRiskScores: vi.fn(),
  },
}));

const { authService } = await import("../../auth/auth.service.js");
const { isAccountRevoked } = await import("../../../shared/accountStatus.js");
const { getUserRoleContext } = await import("../../../shared/roleResolver.js");
const { operationsWebSocketHandler } = await import("../operations-websocket.handler.js");

const mockVerify = authService.verifyAccessToken as ReturnType<typeof vi.fn>;
const mockRevoked = isAccountRevoked as ReturnType<typeof vi.fn>;
const mockRoleContext = getUserRoleContext as ReturnType<typeof vi.fn>;

function fakeReq(token?: string): IncomingMessage {
  const qs = token !== undefined ? `?token=${encodeURIComponent(token)}` : "";
  return { url: `/ws/operations${qs}` } as IncomingMessage;
}

function fakeWs(): WebSocket {
  return {
    close: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
    readyState: 1,
    OPEN: 1,
  } as unknown as WebSocket;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRevoked.mockResolvedValue(false);
  // Drain any clients left registered by a previous (successful-connection) test —
  // getStats() is the only externally visible read of the private clients map.
  (operationsWebSocketHandler as unknown as { clients: Map<string, unknown> }).clients.clear();
});

describe("OperationsWebSocketHandler auth gate", () => {
  it("closes the socket when no token is supplied", async () => {
    const ws = fakeWs();
    await operationsWebSocketHandler.handleConnection(ws, fakeReq());
    expect(ws.close).toHaveBeenCalledWith(1008, "Missing authentication token");
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("closes the socket when the token fails signature/expiry verification", async () => {
    mockVerify.mockReturnValue(null);
    const ws = fakeWs();
    await operationsWebSocketHandler.handleConnection(ws, fakeReq("garbage"));
    expect(ws.close).toHaveBeenCalledWith(1008, "Invalid, expired, or unauthorized token");
  });

  it("closes the socket for a pre_auth (2FA-pending) token — the same gate requireAuth applies to every HTTP route", async () => {
    mockVerify.mockReturnValue({ id: "u1", email: "a@b.com", scope: "pre_auth" });
    const ws = fakeWs();
    await operationsWebSocketHandler.handleConnection(ws, fakeReq("pre-auth-token"));
    expect(ws.close).toHaveBeenCalledWith(1008, "Invalid, expired, or unauthorized token");
    expect(mockRevoked).not.toHaveBeenCalled();
  });

  it("closes the socket for a revoked/deactivated account", async () => {
    mockVerify.mockReturnValue({ id: "u1", email: "a@b.com" });
    mockRevoked.mockResolvedValue(true);
    const ws = fakeWs();
    await operationsWebSocketHandler.handleConnection(ws, fakeReq("valid-token"));
    expect(ws.close).toHaveBeenCalledWith(1008, "Invalid, expired, or unauthorized token");
  });

  it("closes the socket for a role not authorized on the equivalent HTTP endpoints", async () => {
    mockVerify.mockReturnValue({ id: "u1", email: "a@b.com" });
    mockRoleContext.mockResolvedValue({ roleKeys: ["employee"], primaryRole: "employee", isSuperAdmin: false });
    const ws = fakeWs();
    await operationsWebSocketHandler.handleConnection(ws, fakeReq("valid-token"));
    expect(ws.close).toHaveBeenCalledWith(1008, "Invalid, expired, or unauthorized token");
  });

  it("accepts the connection for a role the equivalent HTTP endpoints already allow", async () => {
    mockVerify.mockReturnValue({ id: "u1", email: "a@b.com" });
    mockRoleContext.mockResolvedValue({ roleKeys: ["operations"], primaryRole: "operations", isSuperAdmin: false });
    const ws = fakeWs();
    await operationsWebSocketHandler.handleConnection(ws, fakeReq("valid-token"));
    expect(ws.close).not.toHaveBeenCalled();
    expect(ws.send).toHaveBeenCalled();
    expect(operationsWebSocketHandler.getStats().connectedClients).toBe(1);
  });

  it("accepts super_admin regardless of the explicit allowed-role list", async () => {
    mockVerify.mockReturnValue({ id: "u1", email: "a@b.com" });
    mockRoleContext.mockResolvedValue({ roleKeys: ["super_admin"], primaryRole: "super_admin", isSuperAdmin: true });
    const ws = fakeWs();
    await operationsWebSocketHandler.handleConnection(ws, fakeReq("valid-token"));
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("closes the socket when role resolution itself throws, rather than defaulting open", async () => {
    mockVerify.mockReturnValue({ id: "u1", email: "a@b.com" });
    mockRoleContext.mockRejectedValue(new Error("db down"));
    const ws = fakeWs();
    await operationsWebSocketHandler.handleConnection(ws, fakeReq("valid-token"));
    expect(ws.close).toHaveBeenCalledWith(1008, "Invalid, expired, or unauthorized token");
  });
});
