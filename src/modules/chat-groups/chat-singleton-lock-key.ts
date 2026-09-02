import { createHash } from 'crypto';

const digest = createHash('sha256')
  .update('timeso:chat-realtime-singleton:v2')
  .digest();

export const CHAT_SINGLETON_LOCK_KEY = {
  first: digest.readInt32BE(0),
  second: digest.readInt32BE(4),
} as const;

