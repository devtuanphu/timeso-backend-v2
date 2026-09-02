import { randomUUID } from 'crypto';
import request from 'supertest';

import {
  describeWithIsolatedChatDatabase,
  IsolatedChatPgHarness,
} from './chat-isolated-pg-harness';
import {
  OwnedChatBackend,
  startOwnedChatBackend,
  stopOwnedChatBackend,
} from './chat-owned-app';
import {
  ReservedChatFixture,
  reserveOwnedChatFixture,
  SeededChatFixture,
  seedOwnedChatFixture,
  teardownOwnedChatFixture,
} from './chat-owned-fixture';

describeWithIsolatedChatDatabase('Chat real AppModule PostgreSQL E2E', () => {
  let reservation: ReservedChatFixture;
  let fixture: SeededChatFixture;
  let backend: OwnedChatBackend;
  let database: IsolatedChatPgHarness;

  beforeAll(async () => {
    reservation = await reserveOwnedChatFixture();
    backend = await startOwnedChatBackend(reservation);
    fixture = await seedOwnedChatFixture(reservation);
    database = new IsolatedChatPgHarness(reservation.schema);
  }, 45_000);

  afterAll(async () => {
    await database?.pool.end();
    await stopOwnedChatBackend(backend);
    if (reservation) await teardownOwnedChatFixture(reservation);
  }, 15_000);

  const send = (token: string, clientMessageId: string, content: string) =>
    request(backend.baseUrl)
      .post(`/api/chat-groups/${fixture.groupId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ clientMessageId, content });

  it('exposes the exact seeded attachment message identity for native selectors', async () => {
    expect(fixture.attachmentMessageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const attachment = await database.query<{
      id: string;
      attachment_name: string;
    }>(
      `SELECT id,attachment_name FROM chat_messages
        WHERE id=$1 AND group_id=$2`,
      [fixture.attachmentMessageId, fixture.groupId],
    );
    expect(attachment.rows).toEqual([
      {
        id: fixture.attachmentMessageId,
        attachment_name: fixture.attachmentName,
      },
    ]);
  });

  it('allows active member settings and denies terminated staff with stale active membership', async () => {
    const endpoint = `/api/chat-groups/${fixture.groupId}/members/settings`;
    const active = await request(backend.baseUrl)
      .patch(endpoint)
      .set('Authorization', `Bearer ${fixture.staffAccessToken}`)
      .send({ chatColor: '#123456', notificationsEnabled: false })
      .expect(200);
    expect(active.body).toMatchObject({
      chatColor: '#123456',
      notificationsEnabled: false,
    });

    const before = await memberSettings(fixture.terminatedId);
    const denied = await request(backend.baseUrl)
      .patch(endpoint)
      .set('Authorization', `Bearer ${fixture.terminatedAccessToken}`)
      .send({ chatColor: '#ffffff', notificationsEnabled: false })
      .expect(403);
    expect(denied.body).toMatchObject({ code: 'CHAT_ACCESS_DENIED' });
    expect(await memberSettings(fixture.terminatedId)).toEqual(before);
  });

  it('preserves independent concurrent member setting updates', async () => {
    const endpoint = `/api/chat-groups/${fixture.groupId}/members/settings`;
    await database.query(
      `UPDATE chat_group_members
          SET chat_color='#111111',notifications_enabled=true
        WHERE group_id=$1 AND account_id=$2`,
      [fixture.groupId, fixture.staffId],
    );

    const [color, notifications] = await Promise.all([
      request(backend.baseUrl)
        .patch(endpoint)
        .set('Authorization', `Bearer ${fixture.staffAccessToken}`)
        .send({ chatColor: '#222222' }),
      request(backend.baseUrl)
        .patch(endpoint)
        .set('Authorization', `Bearer ${fixture.staffAccessToken}`)
        .send({ notificationsEnabled: false }),
    ]);
    expect([color.status, notifications.status]).toEqual([200, 200]);
    expect(await memberSettings(fixture.staffId)).toEqual({
      chat_color: '#222222',
      notifications_enabled: false,
    });
  });

  it.each([
    ['owner', () => fixture.ownerAccessToken],
    ['staff', () => fixture.staffAccessToken],
  ])(
    'persists valid %s sends through real guards/providers',
    async (_role, token) => {
      const response = await send(
        token(),
        randomUUID(),
        `hello-${_role}`,
      ).expect(201);
      expect(response.body.deduplicated).toBe(false);
      expect(response.body.message.sequence).toMatch(/^\d+$/);
    },
  );

  it('returns the original message for a canonical retry and 409 for changed content', async () => {
    const clientMessageId = randomUUID();
    const first = await send(
      fixture.ownerAccessToken,
      clientMessageId,
      '  Xin chào\r\n',
    ).expect(201);
    const retry = await send(
      fixture.ownerAccessToken,
      clientMessageId,
      'Xin chào',
    ).expect(200);
    expect(retry.body).toMatchObject({
      deduplicated: true,
      message: { id: first.body.message.id },
    });

    const before = await durableCounts(clientMessageId);
    await send(fixture.ownerAccessToken, clientMessageId, 'different').expect(
      409,
    );
    expect(await durableCounts(clientMessageId)).toEqual(before);
  });

  it('serializes concurrent identical requests to one message/outbox/sequence', async () => {
    const clientMessageId = randomUUID();
    const responses = await Promise.all([
      send(fixture.staffAccessToken, clientMessageId, 'concurrent'),
      send(fixture.staffAccessToken, clientMessageId, 'concurrent'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 201,
    ]);
    expect(await durableCounts(clientMessageId)).toEqual({
      messages: 1,
      outbox: 1,
      sequences: 1,
    });
  });

  it.each([
    ['cross-store', () => fixture.crossStoreAccessToken, 403],
    ['terminated', () => fixture.terminatedAccessToken, 403],
    ['removed', () => fixture.removedAccessToken, 403],
    ['blocked', () => fixture.blockedAccessToken, 401],
  ])(
    'denies %s actors without durable side effects',
    async (_case, token, expectedStatus) => {
      const clientMessageId = randomUUID();
      const response = await send(token(), clientMessageId, 'denied');
      expect(response.status).toBe(expectedStatus);
      expect(response.body.statusCode).toBe(expectedStatus);
      expect(await durableCounts(clientMessageId)).toEqual({
        messages: 0,
        outbox: 0,
        sequences: 0,
      });
    },
  );

  it('exercises real history, catch-up, monotonic reads, literal search, and unread aggregate', async () => {
    const first = await send(
      fixture.ownerAccessToken,
      randomUUID(),
      `literal %_ ${fixture.runTag}`,
    ).expect(201);
    const second = await send(
      fixture.ownerAccessToken,
      randomUUID(),
      `ordinary ${fixture.runTag}`,
    ).expect(201);

    const history = await request(backend.baseUrl)
      .get(`/api/chat-groups/${fixture.groupId}/messages/history?limit=100`)
      .set('Authorization', `Bearer ${fixture.staffAccessToken}`)
      .expect(200);
    expect(
      history.body.data.map((message: { id: string }) => message.id),
    ).toEqual(
      expect.arrayContaining([first.body.message.id, second.body.message.id]),
    );

    const catchUp = await request(backend.baseUrl)
      .get(
        `/api/chat-groups/${fixture.groupId}/messages/catch-up?afterSequence=${first.body.message.sequence}&limit=100`,
      )
      .set('Authorization', `Bearer ${fixture.staffAccessToken}`)
      .expect(200);
    expect(
      catchUp.body.data.map((message: { id: string }) => message.id),
    ).toContain(second.body.message.id);

    const unreadBefore = await request(backend.baseUrl)
      .get('/api/chat-groups/unread/total')
      .set('Authorization', `Bearer ${fixture.staffAccessToken}`)
      .expect(200);
    expect(unreadBefore.body.totalUnread).toBeGreaterThan(0);

    const high = await markRead(second.body.message.sequence);
    const lower = await markRead(first.body.message.sequence);
    expect(lower.body.lastReadSequence).toBe(high.body.lastReadSequence);

    const search = await request(backend.baseUrl)
      .get(`/api/chat-groups/${fixture.groupId}/messages/search`)
      .query({ query: '%_', limit: 50 })
      .set('Authorization', `Bearer ${fixture.staffAccessToken}`)
      .expect(200);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].id).toBe(first.body.message.id);
  });

  it('cannot resurrect membership or persist settings after concurrent removal', async () => {
    const before = await memberSettings(fixture.staffId);
    const remover = await database.connect();
    let committed = false;
    try {
      await remover.query('BEGIN');
      await remover.query(
        `UPDATE chat_group_members SET status='removed'
          WHERE group_id=$1 AND account_id=$2 AND status='active'`,
        [fixture.groupId, fixture.staffId],
      );

      const pendingSettings = request(backend.baseUrl)
        .patch(`/api/chat-groups/${fixture.groupId}/members/settings`)
        .set('Authorization', `Bearer ${fixture.staffAccessToken}`)
        .send({ chatColor: '#race-lost', notificationsEnabled: true })
        .then((response) => response);
      await waitForBlockedMemberSettingsUpdate();
      await remover.query('COMMIT');
      committed = true;

      const denied = await pendingSettings;
      expect(denied.status).toBe(403);
      expect(denied.body).toMatchObject({ code: 'CHAT_ACCESS_DENIED' });
      const final = await database.query<{
        status: string;
        chat_color: string | null;
        notifications_enabled: boolean;
      }>(
        `SELECT status,chat_color,notifications_enabled
           FROM chat_group_members WHERE group_id=$1 AND account_id=$2`,
        [fixture.groupId, fixture.staffId],
      );
      expect(final.rows[0]).toEqual({ status: 'removed', ...before });
    } finally {
      if (!committed) await remover.query('ROLLBACK').catch(() => undefined);
      remover.release();
    }
  });

  async function markRead(sequence: string) {
    return request(backend.baseUrl)
      .patch(`/api/chat-groups/${fixture.groupId}/read`)
      .set('Authorization', `Bearer ${fixture.staffAccessToken}`)
      .send({ sequence })
      .expect(200);
  }

  async function memberSettings(accountId: string) {
    const result = await database.query<{
      chat_color: string | null;
      notifications_enabled: boolean;
    }>(
      `SELECT chat_color,notifications_enabled FROM chat_group_members
        WHERE group_id=$1 AND account_id=$2`,
      [fixture.groupId, accountId],
    );
    return result.rows[0];
  }

  async function waitForBlockedMemberSettingsUpdate() {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const blocked = await database.query<{ blocked: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM pg_stat_activity
            WHERE datname=current_database()
              AND pid<>pg_backend_pid()
              AND wait_event_type='Lock'
              AND query ILIKE '%UPDATE%chat_group_members%'
         ) blocked`,
      );
      if (blocked.rows[0]?.blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('CHAT_E2E_MEMBER_SETTINGS_UPDATE_NOT_BLOCKED');
  }

  async function durableCounts(clientMessageId: string) {
    const result = await database.query<{
      messages: string;
      outbox: string;
      sequences: string;
    }>(
      `SELECT COUNT(*)::text messages,
              COUNT(outbox.id)::text outbox,
              COUNT(message.sequence)::text sequences
         FROM chat_messages message
         LEFT JOIN chat_outbox_events outbox
           ON outbox.message_id=message.id AND outbox.event_type='MESSAGE_CREATED_V1'
        WHERE message.client_message_id=$1`,
      [clientMessageId],
    );
    const row = result.rows[0];
    return {
      messages: Number(row.messages),
      outbox: Number(row.outbox),
      sequences: Number(row.sequences),
    };
  }
});
