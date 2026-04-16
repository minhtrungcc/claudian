/**
 * WebSocket transport for ACP agents.
 * Supports bidirectional streaming communication.
 */

import type { AcpTransport } from './AcpTransport';

type NotificationHandler = (params: unknown) => void;
type ServerRequestHandler = (requestId: string | number, params: unknown) => Promise<unknown>;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface AcpWebSocketTransportConfig {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  reconnectInterval?: number;
}

/**
 * WebSocket transport for ACP agents.
 * Supports streaming notifications and server requests.
 */
export class AcpWebSocketTransport implements AcpTransport {
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandlers = new Map<string, NotificationHandler>();
  private serverRequestHandlers = new Map<string, ServerRequestHandler>();
  private disposed = false;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;
  private connectionPromise: Promise<void> | null = null;
  private connectionResolve: (() => void) | null = null;

  constructor(private readonly config: AcpWebSocketTransportConfig) {}

  async start(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      this.connectionResolve = resolve;

      try {
        this.connect();
        resolve();
      } catch (error) {
        reject(error);
      }
    });

    return this.connectionPromise;
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    if (this.disposed) {
      throw new Error('Transport disposed');
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return new Promise<T>((_, reject) => {
        reject(new Error('WebSocket not connected'));
      });
    }

    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Request timeout: ${method} (${timeoutMs}ms)`));
        }, timeoutMs)
        : null;

      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timer,
      });

      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.send({ jsonrpc: '2.0', method, params });
  }

  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler);
  }

  onServerRequest(method: string, handler: ServerRequestHandler): void {
    this.serverRequestHandlers.set(method, handler);
  }

  isAlive(): boolean {
    return !this.disposed && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  dispose(): void {
    this.manuallyClosed = true;
    this.disposed = true;
    this.rejectAllPending(new Error('Transport disposed'));
    this.closeWebSocket();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private connect(): void {
    if (this.disposed) return;

    const wsUrl = this.config.url.replace(/^http/, 'ws');

    this.ws = new WebSocket(wsUrl);
    this.setupWebSocketHandlers();
  }

  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      // Clear any reconnect timer
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      // Resolve connection promise if pending
      if (this.connectionResolve) {
        this.connectionResolve();
        this.connectionResolve = null;
      }
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      // Schedule reconnect if not manually closed
      if (!this.manuallyClosed && !this.disposed) {
        const interval = this.config.reconnectInterval ?? 5000;
        this.reconnectTimer = setTimeout(() => {
          this.connect();
        }, interval);
      }

      // Reject all pending requests
      this.rejectAllPending(new Error('WebSocket disconnected'));
    };
  }

  private closeWebSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private handleMessage(data: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data);
    } catch {
      return; // malformed message
    }

    const id = msg.id as string | number | undefined;
    const method = msg.method as string | undefined;

    // Server response to our request
    if (typeof id === 'number' && !method) {
      this.handleResponse(id, msg);
      return;
    }

    // Server notification (no id, has method)
    if (method && id === undefined) {
      this.handleNotification(method, msg.params);
      return;
    }

    // Server-initiated request (has both id and method)
    if (method && id !== undefined) {
      this.handleServerRequest(id, method, msg.params);
      return;
    }
  }

  private handleResponse(id: number, msg: Record<string, unknown>): void {
    const pending = this.pending.get(id);
    if (!pending) return;

    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);

    if (msg.error) {
      const err = msg.error as { code: number; message: string; data?: unknown };
      pending.reject(new Error(err.message));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleNotification(method: string, params: unknown): void {
    const handler = this.notificationHandlers.get(method);
    if (handler) handler(params);
  }

  private async handleServerRequest(id: string | number, method: string, params: unknown): Promise<void> {
    const handler = this.serverRequestHandlers.get(method);
    if (!handler) {
      this.sendError(id, -32601, `Unhandled server request: ${method}`);
      return;
    }

    try {
      const result = await handler(id, params);
      this.send({ jsonrpc: '2.0', id, result });
    } catch (err) {
      this.sendError(id, -32603, err instanceof Error ? err.message : 'Internal error');
    }
  }

  private send(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify(msg));
  }

  private sendError(id: string | number, code: number, message: string): void {
    this.send({
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
