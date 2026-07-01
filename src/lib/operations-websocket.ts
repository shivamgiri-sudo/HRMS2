/**
 * Operations Dashboard Real-time Client
 * Uses polling (HTTP) for real-time updates as fallback when WebSocket is not available
 * Future: Can be upgraded to use WebSocket when server infrastructure supports it
 */

export interface WebSocketMessage {
  type: 'live-status' | 'roster-vs-actual' | 'attrition-risk' | 'error';
  data: any;
  timestamp: string;
}

type MessageHandler = (message: WebSocketMessage) => void;

export class OperationsWebSocketClient {
  private pollingInterval: NodeJS.Timer | null = null;
  private url: string;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private isManualClose = false;
  private lastDataHash: Record<string, string> = {};
  private token: string = '';

  constructor(baseUrl: string = '') {
    this.url = baseUrl || window.location.origin;
  }

  /**
   * Connect to the operations data source (using polling)
   */
  connect(token: string): Promise<void> {
    return new Promise((resolve) => {
      try {
        this.token = token;
        this.isManualClose = false;

        console.log('[OperationsClient] Starting real-time updates');
        this.emit('connected', { message: 'Connected to operations dashboard' });

        // Start polling
        this.startPolling();
        resolve();
      } catch (error) {
        console.error('[OperationsClient] Connection failed:', error);
        reject(error);
      }
    });
  }

  /**
   * Start polling for updates
   */
  private startPolling(): void {
    // Poll every 10 seconds as per spec
    this.pollingInterval = setInterval(() => {
      this.pollData();
    }, 10000);

    // Initial fetch
    this.pollData();
  }

  /**
   * Poll for data updates
   */
  private async pollData(): Promise<void> {
    try {
      const headers = this.token ? { Authorization: `Bearer ${this.token}` } : {};

      const [liveRes, rosterRes, attritionRes] = await Promise.all([
        fetch(`${this.url}/api/operations/live-status`, { headers }).then((r) => r.json()),
        fetch(`${this.url}/api/operations/roster-vs-actual`, { headers }).then((r) =>
          r.json()
        ),
        fetch(`${this.url}/api/operations/attrition-risk`, { headers }).then((r) => r.json()),
      ]);

      if (liveRes.success && liveRes.data) {
        this.emitIfChanged('live-status', liveRes.data);
      }
      if (rosterRes.success && rosterRes.data) {
        this.emitIfChanged('roster-vs-actual', rosterRes.data);
      }
      if (attritionRes.success && attritionRes.data) {
        this.emitIfChanged('attrition-risk', attritionRes.data);
      }
    } catch (error) {
      console.error('[OperationsClient] Polling error:', error);
      this.emit('error', { message: 'Failed to fetch updates' });
    }
  }

  /**
   * Emit only if data has changed (using hash)
   */
  private emitIfChanged(type: string, data: any): void {
    const dataStr = JSON.stringify(data);
    const hash = this.hashString(dataStr);

    if (this.lastDataHash[type] !== hash) {
      this.lastDataHash[type] = hash;
      this.emit(type, data);
    }
  }

  /**
   * Simple hash function for change detection
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Subscribe to messages of a specific type
   */
  subscribe(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(type);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Disconnect from the client
   */
  disconnect(): void {
    this.isManualClose = true;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.emit('disconnected', { message: 'Disconnected from operations dashboard' });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.pollingInterval !== null;
  }

  /**
   * Private method to emit events to subscribers
   */
  private emit(type: string, data: any): void {
    const handlers = this.handlers.get(type) || [];
    handlers.forEach((handler) => {
      try {
        handler({ type, data, timestamp: new Date().toISOString() });
      } catch (error) {
        console.error(`[OperationsClient] Error in handler for ${type}:`, error);
      }
    });
  }
}

// Singleton instance
let wsClient: OperationsWebSocketClient | null = null;

export const getOperationsWebSocketClient = (): OperationsWebSocketClient => {
  if (!wsClient) {
    wsClient = new OperationsWebSocketClient();
  }
  return wsClient;
};
