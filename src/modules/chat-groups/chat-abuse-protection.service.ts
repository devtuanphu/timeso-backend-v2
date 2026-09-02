import { HttpException, Injectable } from '@nestjs/common';

export const CHAT_HTTP_LIMITS = {
  send: { max: 30, windowMs: 60_000 },
  search: { max: 60, windowMs: 60_000 },
  unread: { max: 120, windowMs: 60_000 },
  list: { max: 120, windowMs: 60_000 },
  history: { max: 120, windowMs: 60_000 },
  media: { max: 60, windowMs: 60_000 },
  typing: { max: 10, windowMs: 5_000 },
} as const;

// Account quotas are authoritative. IP quotas are only a coarse process-local
// safety net and deliberately accommodate more than 200 users behind a store
// gateway. Callers must pass the direct socket/request address, never XFF.
export const CHAT_HTTP_IP_ACCOUNT_CAPACITY = 256;
export const CHAT_SOCKET_MAX_PER_ACCOUNT = 5;
export const CHAT_SOCKET_MAX_PER_IP = 2_048;

type HttpRoute = keyof typeof CHAT_HTTP_LIMITS;

interface WindowCounter {
  startedAt: number;
  count: number;
}

@Injectable()
export class ChatAbuseProtectionService {
  private readonly counters = new Map<string, WindowCounter>();
  private readonly sockets = new Map<
    string,
    { accountId: string; ipAddress: string }
  >();
  private readonly accountSocketCounts = new Map<string, number>();
  private readonly ipSocketCounts = new Map<string, number>();

  assertHttp(
    route: HttpRoute,
    accountId: string,
    ipAddress: string | undefined,
    now = Date.now(),
  ): void {
    const limit = CHAT_HTTP_LIMITS[route];
    this.take(`${route}:account:${accountId}`, limit, now);
    this.take(
      `${route}:ip:${ipAddress || 'unknown'}`,
      { max: limit.max * CHAT_HTTP_IP_ACCOUNT_CAPACITY, windowMs: limit.windowMs },
      now,
    );
    if (this.counters.size > 10_000) this.prune(now);
  }

  acquireSocket(
    socketId: string,
    accountId: string,
    ipAddress: string | undefined,
  ): void {
    if (this.sockets.has(socketId)) return;
    const ip = ipAddress || 'unknown';
    const accountCount = this.accountSocketCounts.get(accountId) || 0;
    const ipCount = this.ipSocketCounts.get(ip) || 0;
    if (
      accountCount >= CHAT_SOCKET_MAX_PER_ACCOUNT ||
      ipCount >= CHAT_SOCKET_MAX_PER_IP
    ) {
      throw new Error('CHAT_SOCKET_LIMITED');
    }
    this.sockets.set(socketId, { accountId, ipAddress: ip });
    this.accountSocketCounts.set(accountId, accountCount + 1);
    this.ipSocketCounts.set(ip, ipCount + 1);
  }

  releaseSocket(socketId: string): void {
    const socket = this.sockets.get(socketId);
    if (!socket) return;
    this.sockets.delete(socketId);
    this.decrement(this.accountSocketCounts, socket.accountId);
    this.decrement(this.ipSocketCounts, socket.ipAddress);
  }

  private take(
    key: string,
    limit: { max: number; windowMs: number },
    now: number,
  ): void {
    const current = this.counters.get(key);
    if (!current || now - current.startedAt >= limit.windowMs) {
      this.counters.set(key, { startedAt: now, count: 1 });
      return;
    }
    if (current.count >= limit.max) {
      throw new HttpException(
        {
          statusCode: 429,
          code: 'CHAT_RATE_LIMITED',
          message: 'Thao tác trò chuyện quá nhanh',
        },
        429,
      );
    }
    current.count += 1;
  }

  private decrement(counts: Map<string, number>, key: string): void {
    const next = (counts.get(key) || 1) - 1;
    if (next <= 0) counts.delete(key);
    else counts.set(key, next);
  }

  private prune(now: number): void {
    for (const [key, counter] of this.counters) {
      if (now - counter.startedAt >= 60_000) this.counters.delete(key);
    }
  }
}
