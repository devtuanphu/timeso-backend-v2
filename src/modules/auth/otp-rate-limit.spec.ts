import {
  isOverSendLimit,
  OTP_SEND_LIMIT,
  SlidingWindowCounter,
} from './otp-rate-limit';

describe('SlidingWindowCounter', () => {
  it('allows attempts up to the limit and flags the one past it', () => {
    const counter = new SlidingWindowCounter({ limit: 3, windowMs: 1000 });
    expect(counter.hit('a', 0)).toBe(false);
    expect(counter.hit('a', 10)).toBe(false);
    expect(counter.hit('a', 20)).toBe(false);
    expect(counter.hit('a', 30)).toBe(true);
  });

  it('forgets attempts once they age out of the window', () => {
    const counter = new SlidingWindowCounter({ limit: 2, windowMs: 1000 });
    counter.hit('a', 0);
    counter.hit('a', 100);
    expect(counter.hit('a', 200)).toBe(true);
    // 1200 is more than one window after the earlier attempts.
    expect(counter.count('a', 1201)).toBe(0);
    expect(counter.hit('a', 1201)).toBe(false);
  });

  it('tracks keys independently', () => {
    const counter = new SlidingWindowCounter({ limit: 1, windowMs: 1000 });
    expect(counter.hit('a', 0)).toBe(false);
    expect(counter.hit('b', 0)).toBe(false);
    expect(counter.hit('a', 1)).toBe(true);
    expect(counter.count('b', 1)).toBe(1);
  });

  it('resets a key after a successful verification', () => {
    const counter = new SlidingWindowCounter({ limit: 1, windowMs: 1000 });
    counter.hit('a', 0);
    counter.reset('a');
    expect(counter.hit('a', 1)).toBe(false);
  });

  it('bounds memory when many distinct keys are seen', () => {
    const counter = new SlidingWindowCounter({
      limit: 5,
      windowMs: 60_000,
      maxKeys: 10,
    });
    for (let i = 0; i < 50; i += 1) counter.hit(`key-${i}`, i);
    // The oldest keys are evicted rather than accumulating without bound.
    expect(counter.count('key-0', 60)).toBe(0);
    expect(counter.count('key-49', 60)).toBe(1);
  });
});

describe('isOverSendLimit', () => {
  it('permits sends below the limit', () => {
    expect(isOverSendLimit(0)).toBe(false);
    expect(isOverSendLimit(OTP_SEND_LIMIT - 1)).toBe(false);
  });

  it('blocks once the limit is reached', () => {
    expect(isOverSendLimit(OTP_SEND_LIMIT)).toBe(true);
    expect(isOverSendLimit(OTP_SEND_LIMIT + 3)).toBe(true);
  });
});
