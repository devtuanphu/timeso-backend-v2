import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { Repository } from 'typeorm';

import { Account, AccountStatus } from '../src/modules/accounts/entities/account.entity';
import {
  JWT_ACCESS_TOKEN_USE,
  JWT_REFRESH_TOKEN_USE,
} from '../src/modules/auth/jwt.config';
import { ChatAbuseProtectionService } from '../src/modules/chat-groups/chat-abuse-protection.service';
import { ChatAuthorizationService } from '../src/modules/chat-groups/chat-authorization.service';
import { ChatRealtimeCoordinatorService } from '../src/modules/chat-groups/chat-realtime-coordinator.service';
import { ChatRealtimeReadinessService } from '../src/modules/chat-groups/chat-realtime-readiness.service';
import { ChatSocketAuthService } from '../src/modules/chat-groups/chat-socket-auth.service';
import { ChatV2Gateway } from '../src/modules/chat-groups/chat-v2.gateway';
import { LocalSocketChatEventPublisher } from '../src/modules/chat-groups/local-socket-chat-event-publisher';

type ClientSocket = {
  connected: boolean;
  on: (event: string, handler: (...values: any[]) => void) => ClientSocket;
  once: (event: string, handler: (...values: any[]) => void) => ClientSocket;
  emit: (event: string, ...values: any[]) => ClientSocket;
  disconnect: () => void;
};
type ClientFactory = (
  url: string,
  options: Record<string, unknown>,
) => ClientSocket;

const socketTestEnabled = process.env.TIMESO_RUN_CHAT_SOCKET_E2E === 'true';
const socketClientModule = process.env.TIMESO_SOCKET_IO_CLIENT_MODULE;
if (socketTestEnabled && !socketClientModule) {
  throw new Error('CHAT_SOCKET_E2E_CLIENT_MODULE_REQUIRED');
}
const createClient: ClientFactory | null = socketTestEnabled
  ? (loadSocketClient(socketClientModule as string).io as ClientFactory)
  : null;
const describeSocketIntegration = createClient ? describe : describe.skip;

describeSocketIntegration('Chat /chat-v2 live Socket.IO integration', () => {
  jest.setTimeout(20_000);
  const accessSecret = 'chat-e2e-access-secret-not-for-runtime';
  const refreshSecret = 'chat-e2e-refresh-secret-not-for-runtime';
  const ownerId = randomUUID();
  const staffId = randomUUID();
  const groupId = randomUUID();
  const statuses = new Map([
    [ownerId, AccountStatus.ACTIVE],
    [staffId, AccountStatus.ACTIVE],
  ]);
  let httpServer: HttpServer;
  let ioServer: Server;
  let gateway: ChatV2Gateway;
  let publisher: LocalSocketChatEventPublisher;
  let baseUrl: string;
  const sockets: ClientSocket[] = [];
  const configValues: Record<string, unknown> = {
    JWT_SECRET: accessSecret,
    JWT_REFRESH_SECRET: refreshSecret,
  };

  beforeAll(async () => {
    httpServer = createServer();
    ioServer = new Server(httpServer, { cors: { origin: '*' } });
    const namespace = ioServer.of('/chat-v2');
    const config = {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;
    const jwt = new JwtService({ secret: accessSecret });
    const accounts = {
      findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
        statuses.get(where.id) === AccountStatus.ACTIVE ? { id: where.id } : null,
      ),
    } as unknown as Repository<Account>;
    const readiness = new ChatRealtimeReadinessService({
      legacyConnectionEnabled: false,
      legacyMutationEnabled: false,
      legacyWindowStartedAt: null,
      legacyCutoffAt: null,
      singletonGuardMode: 'required',
    });
    publisher = new LocalSocketChatEventPublisher(readiness);
    const authorization = {
      requireGroupAccess: jest.fn(async (_groupId: string, accountId: string) => {
        if (statuses.get(accountId) !== AccountStatus.ACTIVE) {
          throw new Error('CHAT_ACCESS_DENIED');
        }
        return {};
      }),
      getEligibleRecipientAccountIds: jest.fn(async () =>
        [ownerId, staffId].filter(
          (accountId) => statuses.get(accountId) === AccountStatus.ACTIVE,
        ),
      ),
    } as unknown as ChatAuthorizationService;
    gateway = new ChatV2Gateway(
      new ChatSocketAuthService(jwt, config, accounts),
      authorization,
      readiness,
      { isActive: () => true } as ChatRealtimeCoordinatorService,
      {
        acquireSocket: jest.fn(),
        releaseSocket: jest.fn(),
        assertHttp: jest.fn(),
      } as unknown as ChatAbuseProtectionService,
      publisher,
    );
    gateway.afterInit(namespace as never);
    readiness.setActive(true);
    namespace.on('connection', (socket) => {
      socket.on('chat.typing.start.v1', (data, acknowledge) => {
        void gateway.handleTypingStart(socket, data).then(acknowledge);
      });
      socket.on('chat.typing.stop.v1', (data, acknowledge) => {
        void gateway.handleTypingStop(socket, data).then(acknowledge);
      });
      void gateway.handleConnection(socket);
      socket.on('disconnect', () => void gateway.handleDisconnect(socket));
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/chat-v2`;
  });

  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
    statuses.set(ownerId, AccountStatus.ACTIVE);
    statuses.set(staffId, AccountStatus.ACTIVE);
    delete configValues.JWT_LEGACY_UNTYPED_WINDOW_STARTED_AT;
    delete configValues.JWT_LEGACY_UNTYPED_CUTOFF_AT;
    delete configValues.JWT_LEGACY_UNTYPED_ACCESS_ATTESTED;
  });

  afterAll(async () => {
    gateway?.onApplicationShutdown();
    await ioServer?.close();
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  });

  const token = (accountId: string, use: 'access' | 'refresh', expiresIn = 60) =>
    new JwtService({ secret: use === 'access' ? accessSecret : refreshSecret }).sign(
      { sub: accountId, tokenUse: use === 'access' ? JWT_ACCESS_TOKEN_USE : JWT_REFRESH_TOKEN_USE },
      { expiresIn },
    );

  const connect = (accessToken?: string) => {
    const socket = createClient!(baseUrl, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      auth: { accessToken, protocol: 2, appVersion: 'e2e' },
    });
    sockets.push(socket);
    return socket;
  };

  it.each([
    ['missing', undefined],
    ['malformed', 'not-a-jwt'],
    ['expired', () => token(ownerId, 'access', -1)],
    ['refresh', () => token(ownerId, 'refresh')],
  ])('rejects %s credentials', async (_case, tokenValue) => {
    const socket = connect(
      typeof tokenValue === 'function' ? tokenValue() : tokenValue,
    );
    await expect(waitForEvent(socket, 'chat.error.v1')).resolves.toMatchObject({
      code: 'CHAT_SOCKET_UNAUTHORIZED',
    });
  });

  it('connects owner/staff and fans out a message to account rooms', async () => {
    const owner = connect(token(ownerId, 'access'));
    const staff = connect(token(staffId, 'access'));
    await Promise.all([waitForEvent(owner, 'connect'), waitForEvent(staff, 'connect')]);
    await delay(25);
    const ownerEvent = waitForEvent(owner, 'chat.message.created.v1');
    const staffEvent = waitForEvent(staff, 'chat.message.created.v1');
    await publisher.publishMessageCreated(
      {
        version: 1,
        message: {
          id: randomUUID(),
          groupId,
          clientMessageId: randomUUID(),
          sequence: '1',
          content: 'fixture',
          messageType: 'text',
          attachment: null,
          sender: { id: ownerId, fullName: 'Owner', avatar: null },
          createdAt: new Date().toISOString(),
        },
      },
      [ownerId, staffId],
    );
    await expect(ownerEvent).resolves.toMatchObject({ message: { sequence: '1' } });
    await expect(staffEvent).resolves.toMatchObject({ message: { sequence: '1' } });
  });

  it('reauthorizes typing and publishes its five-second expiry', async () => {
    const owner = connect(token(ownerId, 'access'));
    const staff = connect(token(staffId, 'access'));
    await Promise.all([waitForEvent(owner, 'connect'), waitForEvent(staff, 'connect')]);
    await delay(25);
    const started = waitForEvent(staff, 'chat.typing.v1');
    const ack = await emitWithAck(owner, 'chat.typing.start.v1', { groupId });
    expect(ack).toEqual({ ok: true });
    await expect(started).resolves.toMatchObject({ isTyping: true });
    const expired = await waitForEvent(staff, 'chat.typing.v1', 6_000);
    expect(expired).toMatchObject({ isTyping: false });
  });

  it('fails typing closed after account revocation', async () => {
    const owner = connect(token(ownerId, 'access'));
    await waitForEvent(owner, 'connect');
    await delay(25);
    statuses.set(ownerId, AccountStatus.BLOCKED);
    await expect(
      emitWithAck(owner, 'chat.typing.start.v1', { groupId }),
    ).resolves.toEqual({ ok: false, code: 'CHAT_ACCESS_DENIED' });
  });

  it('disconnects an attested untyped socket at its bounded cutoff', async () => {
    configValues.JWT_LEGACY_UNTYPED_WINDOW_STARTED_AT = new Date(
      Date.now() - 1_000,
    ).toISOString();
    configValues.JWT_LEGACY_UNTYPED_CUTOFF_AT = new Date(
      Date.now() + 500,
    ).toISOString();
    configValues.JWT_LEGACY_UNTYPED_ACCESS_ATTESTED = 'true';
    const untyped = new JwtService({ secret: accessSecret }).sign(
      { sub: ownerId },
      { expiresIn: 60 },
    );
    const owner = connect(untyped);
    await waitForEvent(owner, 'connect');
    await expect(waitForEvent(owner, 'disconnect', 2_000)).resolves.toBeTruthy();
  });
});

function loadSocketClient(moduleName: string): { io: ClientFactory } {
  // Deliberately runtime-only: backend production dependencies remain free of
  // socket.io-client. CI points this at the already approved mobile test module.
  const runtimeRequire = eval('require') as NodeRequire;
  return runtimeRequire(moduleName) as { io: ClientFactory };
}

function waitForEvent(
  socket: ClientSocket,
  event: string,
  timeoutMs = 2_000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout:${event}`)), timeoutMs);
    socket.once(event, (value) => {
      clearTimeout(timeout);
      resolve(value);
    });
  });
}

function emitWithAck(
  socket: ClientSocket,
  event: string,
  payload: unknown,
): Promise<unknown> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
