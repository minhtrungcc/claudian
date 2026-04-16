/**
 * HTTP/WebSocket transport for ACP agents.
 * Supports both HTTP (for simple request/response) and WebSocket (for streaming).
 */

import type { AcpTransport } from './AcpTransport';

type NotificationHandler = (params: unknown) => void;
type ServerRequestHandler = (requestId: string | number, params: unknown) => Promise<unknown>;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface AcpHttpTransportConfig {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
}

/**
 * HTTP transport for ACP agents.
 * Uses fetch for request/response pattern.
 */
export class AcpHttpTransport implements AcpTransport {
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandlers = new Map<string, NotificationHandler>();
  private serverRequestHandlers = new Map<string, ServerRequestHandler>();
  private disposed = false;

  constructor(private readonly config: AcpHttpTransportConfig) {}

  start(): void {
    // HTTP transport doesn't need startup
  }

  async request<T = unknown>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    if (this.disposed) {
      throw new Error('Transport disposed');
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

      this.sendRequest(id, method, params).then(
        (result) => {
          this.pending.delete(id);
          if (timer) clearTimeout(timer);
          resolve(result as T);
        },
        (error) => {
          this.pending.delete(id);
          if (timer) clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  notify(_method: string, _params?: unknown): void {
    // HTTP doesn't support one-way notifications
    // Could implement as fire-and-forget POST if needed
  }

  onNotification(_method: string, _handler: NotificationHandler): void {
    // HTTP doesn't support server notifications
    // For streaming, use WebSocket transport instead
  }

  onServerRequest(_method: string, _handler: ServerRequestHandler): void {
    // HTTP doesn't support server requests
    // Server requests require bidirectional communication (WebSocket or long polling)
  }

  isAlive(): boolean {
    return !this.disposed;
  }

  dispose(): void {
    this.disposed = true;
    this.rejectAllPending(new Error('Transport disposed'));
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private async sendRequest(id: number, method: string, params?: unknown): Promise<unknown> {
    const response = await fetch(this.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }),
      signal: AbortSignal.timeout(this.config.timeout ?? 60000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      const error = data.error as { code: number; message: string; data?: unknown };
      throw new Error(error.message || 'Unknown error');
    }

    return data.result;
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
