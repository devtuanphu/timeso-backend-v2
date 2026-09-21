import {
  normalizePushCapabilities,
  resolveDeviceChannelId,
} from './push-capabilities';

describe('push capabilities', () => {
  it('keeps known capability ids only', () => {
    expect(
      normalizePushCapabilities(['x', 'shift-alert-channels', 'shift-alert-channels', 3]),
    ).toEqual(['shift-alert-channels']);
    expect(normalizePushCapabilities(undefined)).toEqual([]);
  });

  it('maps shift-alert channels to default for builds without them', () => {
    expect(resolveDeviceChannelId('shift-alerts', null)).toBe('default');
    expect(resolveDeviceChannelId('shift-alerts-quiet', [])).toBe('default');
    expect(
      resolveDeviceChannelId('shift-alerts-quiet', ['shift-alert-channels']),
    ).toBe('shift-alerts-quiet');
    expect(resolveDeviceChannelId('chat', null)).toBe('chat');
    expect(resolveDeviceChannelId(undefined, null)).toBeUndefined();
  });
});
