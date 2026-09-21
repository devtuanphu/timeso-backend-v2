/**
 * What a registered app build can do with a push, sent by the app in
 * POST /devices/register `capabilities`. Old builds send nothing.
 */

/** The build creates the Android channels 'shift-alerts' and 'shift-alerts-quiet'. */
export const SHIFT_ALERT_CHANNELS_CAPABILITY = 'shift-alert-channels';

export const KNOWN_PUSH_CAPABILITIES: readonly string[] = [
  SHIFT_ALERT_CHANNELS_CAPABILITY,
];

/** Android channels that only exist on builds with the capability above. */
const SHIFT_ALERT_CHANNELS = new Set(['shift-alerts', 'shift-alerts-quiet']);

/** The channel every app build creates. */
export const DEFAULT_ANDROID_CHANNEL = 'default';

/** Keeps only known capability ids (unknown ones are ignored, not rejected). */
export function normalizePushCapabilities(
  capabilities: readonly unknown[] | null | undefined,
): string[] {
  if (!Array.isArray(capabilities)) return [];
  return [
    ...new Set(
      capabilities.filter(
        (value): value is string =>
          typeof value === 'string' && KNOWN_PUSH_CAPABILITIES.includes(value),
      ),
    ),
  ].sort();
}

/**
 * The Android channel to use for one device. A shift-alert channel on a build
 * that never created it would land in the OS fallback channel (no vibration),
 * so such devices get 'default' instead.
 */
export function resolveDeviceChannelId(
  channelId: string | undefined,
  capabilities: readonly string[] | null | undefined,
): string | undefined {
  if (!channelId || !SHIFT_ALERT_CHANNELS.has(channelId)) return channelId;
  return capabilities?.includes(SHIFT_ALERT_CHANNELS_CAPABILITY)
    ? channelId
    : DEFAULT_ANDROID_CHANNEL;
}
