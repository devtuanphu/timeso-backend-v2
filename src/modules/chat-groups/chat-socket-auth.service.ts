import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Socket } from 'socket.io';
import { Repository } from 'typeorm';

import {
  Account,
  AccountStatus,
} from '../accounts/entities/account.entity';
import {
  JWT_ACCESS_TOKEN_USE,
  getLegacyUntypedTokenWindow,
  isLegacyUntypedAccessAccepted,
  type TimesoJwtPayload,
} from '../auth/jwt.config';

interface ChatSocketPrincipal {
  accountId: string;
  expiresAt: number;
}

@Injectable()
export class ChatSocketAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) {}

  async authenticate(
    client: Socket,
    requireV2Metadata: boolean,
  ): Promise<ChatSocketPrincipal> {
    const header = client.handshake.headers.authorization;
    const bearer =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7)
        : null;
    const authToken =
      typeof client.handshake.auth?.accessToken === 'string'
        ? client.handshake.auth.accessToken
        : typeof client.handshake.auth?.token === 'string'
          ? client.handshake.auth.token
          : bearer;
    if (!authToken || authToken.length > 8_192) {
      throw new Error('CHAT_SOCKET_UNAUTHORIZED');
    }

    if (requireV2Metadata) {
      const protocol = client.handshake.auth?.protocol;
      const appVersion = client.handshake.auth?.appVersion;
      if (
        String(protocol) !== '2' ||
        typeof appVersion !== 'string' ||
        appVersion.length < 1 ||
        appVersion.length > 32
      ) {
        throw new Error('CHAT_SOCKET_PROTOCOL_INVALID');
      }
    }

    const payload = await this.jwtService.verifyAsync<
      Partial<TimesoJwtPayload> & { exp?: number }
    >(authToken);
    const acceptsLegacyUntyped =
      payload.tokenUse === undefined &&
      isLegacyUntypedAccessAccepted(this.configService);
    if (
      !payload.sub ||
      (payload.tokenUse !== JWT_ACCESS_TOKEN_USE &&
        !acceptsLegacyUntyped) ||
      !payload.exp ||
      payload.exp * 1_000 <= Date.now()
    ) {
      throw new Error('CHAT_SOCKET_UNAUTHORIZED');
    }
    const account = await this.accountRepository.findOne({
      where: { id: payload.sub, status: AccountStatus.ACTIVE },
      select: { id: true },
    });
    if (!account) throw new Error('CHAT_SOCKET_UNAUTHORIZED');
    const legacyCutoff = acceptsLegacyUntyped
      ? getLegacyUntypedTokenWindow(this.configService)?.cutoffAt
      : undefined;
    const principal = {
      accountId: payload.sub,
      expiresAt: Math.min(payload.exp * 1_000, legacyCutoff || Infinity),
    };
    client.data.chatPrincipal = principal;
    return principal;
  }

  getPrincipal(client: Socket): ChatSocketPrincipal {
    const principal = client.data.chatPrincipal as
      | ChatSocketPrincipal
      | undefined;
    if (!principal || principal.expiresAt <= Date.now()) {
      throw new Error('CHAT_SOCKET_UNAUTHORIZED');
    }
    return principal;
  }
}
