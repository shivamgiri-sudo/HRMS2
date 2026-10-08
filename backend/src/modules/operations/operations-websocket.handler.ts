import type WebSocket from 'ws';
import type { IncomingMessage } from 'http';
import { logger } from '../../logger.js';
import { operationsLiveService } from './operations-live.service.js';
import { authService } from '../auth/auth.service.js';
import { isAccountRevoked } from '../../shared/accountStatus.js';
import { getUserRoleContext } from '../../shared/roleResolver.js';
import { normalizeRoleInputs, expandRoles } from '../../platform/policy/index.js';
import { DEMO_TOKEN_MAP } from '../../shared/demoAuth.js';

interface SubscribedClient {
  ws: WebSocket;
  subscriptions: Set<string>;
  lastPing: number;
}

// Same authorization boundary as the equivalent HTTP surface (operations-live.routes.ts's
// three requireRole(...) calls, unioned) — the live-status/roster-vs-actual/attrition-risk
// data this socket streams is exactly what those routes gate. NOTE (2026-08-19): this handler
// is not currently wired to any http.Server upgrade listener anywhere in the repo, and the
// frontend's OperationsWebSocketClient (src/lib/operations-websocket.ts) only ever polls the
// HTTP endpoints, never opens a raw WebSocket — so this class is presently unreachable dead
// code. The token check below was still a real gap (any string satisfied it) and is fixed
// here for correctness in case this is ever wired up, not because it is exploitable today.
const OPERATIONS_WS_ALLOWED_ROLES = ["operations", "admin", "process_manager", "manager", "branch_head", "hr"];

class OperationsWebSocketHandler {
  private clients: Map<string, SubscribedClient> = new Map();
  private broadcastInterval: NodeJS.Timeout | null = null;

  /**
   * Verify the connection's token the same way requireAuth + requireRole do for the
   * equivalent HTTP endpoints: real JWT signature/expiry, reject a pre_auth (2FA-pending)
   * token, reject a revoked/deactivated account, and require one of the roles the HTTP
   * surface for this same data already requires. Returns the authenticated user id on
   * success, or null (caller closes the socket) on any failure.
   */
  private async validateToken(token: string): Promise<string | null> {
    // Demo bypass — mirrors authMiddleware.ts's requireAuth, only under the same explicit
    // env gate, so this never silently accepts a demo token in production.
    if (token.startsWith("mock-token")) {
      const demoBypassEnabled =
        process.env.INTERNAL_DEMO_BYPASS === "true" &&
        process.env.NODE_ENV !== "production";
      if (!demoBypassEnabled) return null;
      const demo = DEMO_TOKEN_MAP[token];
      if (!demo) return null;
      const demoRoles = normalizeRoleInputs([demo.role]);
      if (demoRoles.includes("super_admin")) return demo.id;
      const expandedDemoRoles = expandRoles(demoRoles);
      const expandedAllowed = expandRoles(normalizeRoleInputs(OPERATIONS_WS_ALLOWED_ROLES));
      return expandedAllowed.some((role) => expandedDemoRoles.includes(role)) ? demo.id : null;
    }

    const mysqlUser = authService.verifyAccessToken(token);
    if (!mysqlUser) return null;
    // 2FA gate: a pre_auth token must not reach any real data endpoint, socket included.
    if (mysqlUser.scope === "pre_auth") return null;
    if (await isAccountRevoked(mysqlUser.id)) return null;

    let roleKeys: string[] = [];
    try {
      const ctx = await getUserRoleContext(mysqlUser.id);
      roleKeys = ctx.roleKeys;
    } catch (error) {
      logger.error({ err: error, userId: mysqlUser.id }, '[OperationsWS] role resolution failed');
      return null;
    }
    const userRoles = normalizeRoleInputs(roleKeys);
    if (userRoles.includes("super_admin")) return mysqlUser.id;
    const expandedUserRoles = expandRoles(userRoles);
    const expandedAllowedRoles = expandRoles(normalizeRoleInputs(OPERATIONS_WS_ALLOWED_ROLES));
    return expandedAllowedRoles.some((role) => expandedUserRoles.includes(role)) ? mysqlUser.id : null;
  }

  /**
   * Handle new WebSocket connection
   */
  async handleConnection(
    ws: WebSocket,
    req: IncomingMessage
  ): Promise<void> {
    try {
      // Extract token from URL query
      const url = new URL(`http://localhost${req.url}`);
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(1008, 'Missing authentication token');
        return;
      }

      const userId = await this.validateToken(token);
      if (!userId) {
        ws.close(1008, 'Invalid, expired, or unauthorized token');
        return;
      }

      const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const client: SubscribedClient = {
        ws,
        subscriptions: new Set(['live-status', 'roster-vs-actual', 'attrition-risk']),
        lastPing: Date.now(),
      };

      this.clients.set(clientId, client);
      logger.info(`[OperationsWS] Client connected: ${clientId} (user ${userId})`);

      // Send welcome message
      this.sendMessage(ws, 'welcome', {
        message: 'Connected to operations dashboard',
        clientId,
      });

      // Set up message handler
      ws.on('message', (data: WebSocket.Data) => this.handleMessage(clientId, data));
      ws.on('close', () => this.handleDisconnection(clientId));
      ws.on('error', (error: Error) => {
        logger.error({ err: error, clientId }, '[OperationsWS] Client error');
      });

      // Start broadcast if not already running
      this.ensureBroadcasting();
    } catch (error) {
      logger.error({ err: error }, '[OperationsWS] Connection handler error');
      ws.close(1011, 'Internal server error');
    }
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(clientId: string, data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'subscribe') {
        const client = this.clients.get(clientId);
        if (client && message.channel) {
          client.subscriptions.add(message.channel);
        }
      } else if (message.type === 'unsubscribe') {
        const client = this.clients.get(clientId);
        if (client && message.channel) {
          client.subscriptions.delete(message.channel);
        }
      }
    } catch (error) {
      logger.error({ err: error, clientId }, '[OperationsWS] Failed to parse message');
    }
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnection(clientId: string): void {
    this.clients.delete(clientId);
    logger.info(`[OperationsWS] Client disconnected: ${clientId}`);

    // Stop broadcasting if no clients
    if (this.clients.size === 0) {
      this.stopBroadcasting();
    }
  }

  /**
   * Broadcast updates to all connected clients
   */
  private async broadcast(): Promise<void> {
    if (this.clients.size === 0) {
      return;
    }

    try {
      // Fetch current data
      const [liveStatus, rosterVsActual, attritionRisk] = await Promise.all([
        operationsLiveService.getLiveStatus(),
        operationsLiveService.getRosterVsActual(),
        operationsLiveService.getAttritionRiskScores(),
      ]);

      // Send to subscribed clients
      for (const [clientId, client] of this.clients) {
        try {
          if (client.subscriptions.has('live-status')) {
            this.sendMessage(client.ws, 'live-status', liveStatus);
          }
          if (client.subscriptions.has('roster-vs-actual')) {
            this.sendMessage(client.ws, 'roster-vs-actual', rosterVsActual);
          }
          if (client.subscriptions.has('attrition-risk')) {
            this.sendMessage(client.ws, 'attrition-risk', attritionRisk);
          }
        } catch (error) {
          logger.error({ err: error, clientId }, '[OperationsWS] Failed to send to client');
        }
      }
    } catch (error) {
      logger.error({ err: error }, '[OperationsWS] Broadcast error');
    }
  }

  /**
   * Ensure broadcasting is active
   */
  private ensureBroadcasting(): void {
    if (!this.broadcastInterval) {
      // Broadcast every 10 seconds
      this.broadcastInterval = setInterval(() => {
        this.broadcast().catch((error) => {
          logger.error({ err: error }, '[OperationsWS] Broadcast failed');
        });
      }, 10000);

      logger.info('[OperationsWS] Broadcasting started (10s interval)');
    }
  }

  /**
   * Stop broadcasting
   */
  private stopBroadcasting(): void {
    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
      logger.info('[OperationsWS] Broadcasting stopped');
    }
  }

  /**
   * Send message to client
   */
  private sendMessage(ws: WebSocket, type: string, data: any): void {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(
          JSON.stringify({
            type,
            data,
            timestamp: new Date().toISOString(),
          })
        );
      } catch (error) {
        logger.error({ err: error }, '[OperationsWS] Failed to send message');
      }
    }
  }

  /**
   * Get connection stats
   */
  getStats() {
    return {
      connectedClients: this.clients.size,
      broadcasting: this.broadcastInterval !== null,
    };
  }
}

export const operationsWebSocketHandler = new OperationsWebSocketHandler();
