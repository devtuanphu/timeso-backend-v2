import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Socket } from 'socket.io';
import { Repository } from 'typeorm';

import { Account } from '../accounts/entities/account.entity';
import {
  JWT_ACCESS_TOKEN_USE,
  JWT_REFRESH_TOKEN_USE,
} from '../auth/jwt.config';
import { ChatSocketAuthService } from './chat-socket-auth.service';

const socket = (token = 'signed-token') =>
  ({
    handshake: {
      auth: { accessToken: token, protocol: 2, appVersion: '1.0.0' },
      headers: {},
    },
    data: {},
  }) as unknown as Socket;

describe('ChatSocketAuthService', () => {
  const config = (values: Record<string, string> = {}) =>
    ({ get: jest.fn((key: string) => values[key]) }) as unknown as ConfigService;
  it('accepts an unexpired token only while its account remains active', async () => {
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: 'account-id',
        exp: Math.floor(Date.now() / 1_000) + 60,
        tokenUse: JWT_ACCESS_TOKEN_USE,
      }),
    } as unknown as JwtService;
    const accounts = {
      findOne: jest.fn().mockResolvedValue({ id: 'account-id' }),
    } as unknown as Repository<Account>;
    const service = new ChatSocketAuthService(jwt, config(), accounts);
    await expect(service.authenticate(socket(), true)).resolves.toMatchObject({
      accountId: 'account-id',
    });
  });

  it.each(['blocked-or-deleted', 'revoked-signature'])('rejects %s sockets', async (kind) => {
    const jwt = {
      verifyAsync:
        kind === 'revoked-signature'
          ? jest.fn().mockRejectedValue(new Error('invalid'))
          : jest.fn().mockResolvedValue({
              sub: 'account-id',
              exp: Math.floor(Date.now() / 1_000) + 60,
              tokenUse: JWT_ACCESS_TOKEN_USE,
            }),
    } as unknown as JwtService;
    const accounts = {
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as Repository<Account>;
    const service = new ChatSocketAuthService(jwt, config(), accounts);
    await expect(service.authenticate(socket(), true)).rejects.toThrow();
  });

  it('rejects refresh and legacy undiscriminated tokens', async () => {
    const verifyAsync = jest
      .fn()
      .mockResolvedValueOnce({
        sub: 'account-id',
        exp: Math.floor(Date.now() / 1_000) + 60,
        tokenUse: JWT_REFRESH_TOKEN_USE,
      })
      .mockResolvedValueOnce({
        sub: 'account-id',
        exp: Math.floor(Date.now() / 1_000) + 60,
      });
    const service = new ChatSocketAuthService(
      { verifyAsync } as unknown as JwtService,
      config(),
      { findOne: jest.fn() } as unknown as Repository<Account>,
    );
    await expect(service.authenticate(socket(), true)).rejects.toThrow(
      'CHAT_SOCKET_UNAUTHORIZED',
    );
    await expect(service.authenticate(socket(), true)).rejects.toThrow(
      'CHAT_SOCKET_UNAUTHORIZED',
    );
  });

  it('accepts a legacy untyped access token only during the configured window', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-30T00:00:00Z'));
    const service = new ChatSocketAuthService(
      {
        verifyAsync: jest.fn().mockResolvedValue({
          sub: 'account-id',
          exp: Math.floor(Date.now() / 1_000) + 60,
        }),
      } as unknown as JwtService,
      config({
        JWT_LEGACY_UNTYPED_WINDOW_STARTED_AT: '2026-08-29T00:00:00Z',
        JWT_LEGACY_UNTYPED_CUTOFF_AT: '2026-09-05T00:00:00Z',
        JWT_LEGACY_UNTYPED_ACCESS_ATTESTED: 'true',
      }),
      { findOne: jest.fn().mockResolvedValue({ id: 'account-id' }) } as unknown as Repository<Account>,
    );
    await expect(service.authenticate(socket(), true)).resolves.toMatchObject({
      accountId: 'account-id',
    });
    jest.useRealTimers();
  });

  it('caps an accepted untyped socket principal at the transition cutoff', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-30T00:00:00Z'));
    const cutoff = Date.parse('2026-09-05T00:00:00Z');
    const service = new ChatSocketAuthService(
      { verifyAsync: jest.fn().mockResolvedValue({
        sub: 'account-id',
        exp: Math.floor(Date.parse('2026-09-20T00:00:00Z') / 1_000),
      }) } as unknown as JwtService,
      config({
        JWT_LEGACY_UNTYPED_WINDOW_STARTED_AT: '2026-08-29T00:00:00Z',
        JWT_LEGACY_UNTYPED_CUTOFF_AT: '2026-09-05T00:00:00Z',
        JWT_LEGACY_UNTYPED_ACCESS_ATTESTED: 'true',
      }),
      { findOne: jest.fn().mockResolvedValue({ id: 'account-id' }) } as unknown as Repository<Account>,
    );
    await expect(service.authenticate(socket(), true)).resolves.toMatchObject({
      expiresAt: cutoff,
    });
    jest.useRealTimers();
  });
});
