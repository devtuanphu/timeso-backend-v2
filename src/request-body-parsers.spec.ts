import express from 'express';
import request from 'supertest';

import { configureRequestBodyParsers } from './request-body-parsers';

const createApp = () => {
  const app = express();
  configureRequestBodyParsers(app);
  app.post('/api/chat-groups/test', (req, res) =>
    res.status(200).json({ parsed: req.body?.content?.length ?? null }),
  );
  app.post('/api/other/test', (req, res) =>
    res.status(200).json({ parsed: req.body?.content?.length ?? null }),
  );
  return app;
};

describe('configureRequestBodyParsers', () => {
  const oversized = 'x'.repeat(33 * 1024);

  it.each([
    ['json', 'application/json', JSON.stringify({ content: oversized })],
    [
      'urlencoded',
      'application/x-www-form-urlencoded',
      `content=${oversized}`,
    ],
  ])('caps chat %s requests before the broad parser', async (_, type, body) => {
    await request(createApp())
      .post('/api/chat-groups/test')
      .set('content-type', type)
      .send(body)
      .expect(413);
  });

  it('retains the broad limit outside chat routes', async () => {
    await request(createApp())
      .post('/api/other/test')
      .send({ content: oversized })
      .expect(200, { parsed: oversized.length });
  });

  it('does not consume multipart chat uploads', async () => {
    await request(createApp())
      .post('/api/chat-groups/test')
      .field('content', oversized)
      .expect(200, { parsed: null });
  });
});
