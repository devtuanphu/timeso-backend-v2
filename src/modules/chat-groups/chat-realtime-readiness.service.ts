import { Inject, Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

import {
  CHAT_REALTIME_CONFIG,
  ChatRealtimeConfig,
} from './chat-realtime.config';

type NamespaceName = 'v2' | 'legacy';

@Injectable()
export class ChatRealtimeReadinessService {
  private readonly namespaces = new Map<NamespaceName, Server>();
  private active = false;

  constructor(
    @Inject(CHAT_REALTIME_CONFIG)
    private readonly config: ChatRealtimeConfig,
  ) {}

  attach(namespace: NamespaceName, server: Server): void {
    this.namespaces.set(namespace, server);
  }

  detach(namespace: NamespaceName, server: Server): void {
    if (this.namespaces.get(namespace) === server) {
      this.namespaces.delete(namespace);
      this.active = false;
    }
  }

  getServer(namespace: NamespaceName): Server | null {
    return this.namespaces.get(namespace) || null;
  }

  namespacesReady(): boolean {
    return (
      this.namespaces.has('v2') &&
      (!this.legacyConnectionsAllowed() || this.namespaces.has('legacy'))
    );
  }

  setActive(active: boolean): void {
    this.active = active && this.namespacesReady();
  }

  isActive(): boolean {
    return this.active && this.namespacesReady();
  }

  legacyConnectionsAllowed(now = Date.now()): boolean {
    return (
      this.config.legacyConnectionEnabled &&
      !!this.config.legacyCutoffAt &&
      now < this.config.legacyCutoffAt.getTime()
    );
  }
}
