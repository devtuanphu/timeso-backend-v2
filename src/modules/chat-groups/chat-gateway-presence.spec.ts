import { ChatGateway } from './chat.gateway';

/**
 * `isUserOnline` is called once per member by GET /chat-groups/:id/members, so
 * anything it throws turns the whole member list into a 500.
 *
 * The gateway is not constructed here: presence reads only `this.server`, and
 * building the real thing would drag in socket auth, the realtime config and
 * the outbox for a single getter.
 */
const presenceOf = (server: unknown): ChatGateway => {
  const gateway = Object.create(ChatGateway.prototype) as ChatGateway;
  (gateway as { server: unknown }).server = server;
  return gateway;
};

const withRooms = (rooms: Map<string, Set<string>>) => ({
  sockets: { adapter: { rooms } },
});

describe('ChatGateway.isUserOnline', () => {
  it('reports an account with a live socket room as online', () => {
    const rooms = new Map([['account:acc-1', new Set(['socket-1'])]]);

    expect(presenceOf(withRooms(rooms)).isUserOnline('acc-1')).toBe(true);
  });

  it('reports an account with no room as offline', () => {
    expect(presenceOf(withRooms(new Map())).isUserOnline('acc-1')).toBe(false);
  });

  // An empty room set is left behind after the last socket leaves.
  it('treats an empty room as offline rather than present', () => {
    const rooms = new Map([['account:acc-1', new Set<string>()]]);

    expect(presenceOf(withRooms(rooms)).isUserOnline('acc-1')).toBe(false);
  });

  // The regression: the optional chain covered only `this.server`, so a
  // half-initialised namespace threw "Cannot read properties of undefined
  // (reading 'rooms')" and took the member list down with it.
  it.each([
    ['no server at all', undefined],
    ['a server with no sockets', {}],
    ['a namespace with no adapter', { sockets: {} }],
    ['an adapter with no rooms', { sockets: { adapter: {} } }],
  ])('reports offline instead of throwing when there is %s', (_label, server) => {
    const gateway = presenceOf(server);

    expect(() => gateway.isUserOnline('acc-1')).not.toThrow();
    expect(gateway.isUserOnline('acc-1')).toBe(false);
  });
});
