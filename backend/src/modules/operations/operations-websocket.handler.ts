import type WebSocket from 'ws';
import type { IncomingMessage } from 'http';
import { logger } from '../../logger.js';
import { operationsLiveService } from './operations-live.service.js';

interface SubscribedClient {
  ws: WebSocket;
  subscriptions: Set<string>;
  lastPing: number;
}

class OperationsWebSocketHandler {
  private clients: Map<string, SubscribedClient> = new Map();
  private broadcastInterval: NodeJS.Timeout | null = null;

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

      // TODO: Validate token with auth service
      // For now, accept all authenticated connections

      const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const client: SubscribedClient = {
        ws,
        subscriptions: new Set(['live-status', 'roster-vs-actual', 'attrition-risk']),
        lastPing: Date.now(),
      };

      this.clients.set(clientId, client);
      logger.info(`[OperationsWS] Client connected: ${clientId}`);

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
