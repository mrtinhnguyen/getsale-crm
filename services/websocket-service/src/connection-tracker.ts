import type { Socket } from 'socket.io';
import type { Logger } from '@getsale/logger';
import type { SocketUser } from './socket-auth';

const MAX_CONNECTIONS_PER_ORG = parseInt(process.env.MAX_CONNECTIONS_PER_ORG || '100');
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_EVENTS = 100;
const HEARTBEAT_INTERVAL = 30_000;
const HEARTBEAT_TIMEOUT = 90_000;

interface RateEntry {
  count: number;
  resetAt: number;
}

export class ConnectionTracker {
  private connectionCounts = new Map<string, number>();
  private eventCounts = new Map<string, RateEntry>();
  private log: Logger;

  constructor(log: Logger) {
    this.log = log;
  }

  /** Returns false if the org has hit its connection limit. */
  canConnect(organizationId: string): boolean {
    const current = this.connectionCounts.get(organizationId) || 0;
    if (current >= MAX_CONNECTIONS_PER_ORG) {
      this.log.warn({ message: 'Connection limit reached', organization_id: organizationId, current });
      return false;
    }
    return true;
  }

  trackConnect(organizationId: string): void {
    const current = this.connectionCounts.get(organizationId) || 0;
    this.connectionCounts.set(organizationId, current + 1);
  }

  trackDisconnect(organizationId: string, socketId: string): void {
    const current = this.connectionCounts.get(organizationId) || 0;
    this.connectionCounts.set(organizationId, Math.max(0, current - 1));
    this.eventCounts.delete(`${organizationId}:${socketId}`);
  }

  checkRateLimit(organizationId: string, socketId: string): boolean {
    const key = `${organizationId}:${socketId}`;
    const now = Date.now();
    const entry = this.eventCounts.get(key);

    if (!entry || now > entry.resetAt) {
      this.eventCounts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }

    if (entry.count >= RATE_LIMIT_MAX_EVENTS) return false;
    entry.count++;
    return true;
  }

  /** Set up ping/pong heartbeat. Returns a cleanup function. */
  setupHeartbeat(socket: Socket, user: SocketUser): () => void {
    let heartbeatInterval: NodeJS.Timeout;
    let heartbeatTimeout: NodeJS.Timeout;

    const reset = () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (heartbeatTimeout) clearTimeout(heartbeatTimeout);

      heartbeatInterval = setInterval(() => {
        socket.emit('ping', { timestamp: Date.now() });
      }, HEARTBEAT_INTERVAL);

      heartbeatTimeout = setTimeout(() => {
        this.log.info({ message: 'Heartbeat timeout', user_id: user.id, socket_id: socket.id });
        socket.disconnect();
      }, HEARTBEAT_TIMEOUT);
    };

    socket.on('pong', () => reset());
    reset();

    return () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (heartbeatTimeout) clearTimeout(heartbeatTimeout);
    };
  }

  getTotalConnections(): number {
    let total = 0;
    for (const count of this.connectionCounts.values()) total += count;
    return total;
  }
}
