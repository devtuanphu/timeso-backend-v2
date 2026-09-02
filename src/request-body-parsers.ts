import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';

export const CHAT_BODY_LIMIT = '32kb';
export const DEFAULT_BODY_LIMIT = '50mb';

/**
 * Register the chat parsers before the existing broad application parsers.
 * Express parsers are content-type aware, so multipart upload requests pass
 * through untouched for the route's Multer interceptor.
 */
export const configureRequestBodyParsers = (
  app: Pick<INestApplication, 'use'>,
): void => {
  app.use('/api/chat-groups', json({ limit: CHAT_BODY_LIMIT }));
  app.use(
    '/api/chat-groups',
    urlencoded({ extended: true, limit: CHAT_BODY_LIMIT }),
  );
  app.use(json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));
};
