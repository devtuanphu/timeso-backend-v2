import { Injectable, Logger } from '@nestjs/common';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: string;
  badge?: number;
  categoryId?: string;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
}

export type PushDeliveryResult =
  | { outcome: 'accepted'; ticketId: string }
  | { outcome: 'retryable'; errorCode: string }
  | { outcome: 'permanent'; errorCode: string; deviceInvalid: boolean };

export type PushReceiptResult =
  | { outcome: 'delivered' }
  | { outcome: 'pending' }
  | { outcome: 'retryable'; errorCode: string }
  | { outcome: 'permanent'; errorCode: string; deviceInvalid: boolean };

interface ExpoTicket {
  status?: unknown;
  id?: unknown;
  details?: { error?: unknown };
}

const normalizeProviderCode = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 48);
  return normalized || fallback;
};

const isDeviceInvalidCode = (code: string): boolean =>
  code === 'DeviceNotRegistered';

const isPermanentTicketCode = (code: string): boolean =>
  isDeviceInvalidCode(code) ||
  code === 'MessageTooBig' ||
  code === 'MismatchSenderId' ||
  code === 'InvalidCredentials';

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);
  private readonly sendUrl = 'https://exp.host/--/api/v2/push/send';
  private readonly receiptUrl = 'https://exp.host/--/api/v2/push/getReceipts';
  private readonly timeoutMs = 10_000;

  async sendDeviceNotification(
    message: PushMessage,
  ): Promise<PushDeliveryResult> {
    try {
      const { response, payload } = await this.fetchJsonWithTimeout<{
        data?: ExpoTicket | ExpoTicket[];
      }>(this.sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(message),
      });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          return {
            outcome: 'retryable',
            errorCode: `EXPO_HTTP_${response.status}`,
          };
        }
        return {
          outcome: 'permanent',
          errorCode: `EXPO_HTTP_${response.status}`,
          deviceInvalid: false,
        };
      }

      const ticket = Array.isArray(payload?.data)
        ? payload.data[0]
        : payload?.data;
      if (
        ticket?.status === 'ok' &&
        typeof ticket.id === 'string' &&
        ticket.id
      ) {
        return { outcome: 'accepted', ticketId: ticket.id };
      }
      const code = normalizeProviderCode(
        ticket?.details?.error,
        'EXPO_TICKET_ERROR',
      );
      if (code === 'MessageRateExceeded') {
        return { outcome: 'retryable', errorCode: code };
      }
      if (isPermanentTicketCode(code)) {
        return {
          outcome: 'permanent',
          errorCode: code,
          deviceInvalid: isDeviceInvalidCode(code),
        };
      }
      return { outcome: 'retryable', errorCode: code };
    } catch {
      return { outcome: 'retryable', errorCode: 'EXPO_REQUEST_FAILED' };
    }
  }

  async getPushReceipts(
    ticketIds: string[],
  ): Promise<Record<string, PushReceiptResult>> {
    if (ticketIds.length === 0) return {};
    try {
      const { response, payload } = await this.fetchJsonWithTimeout<{
        data?: Record<string, ExpoTicket>;
      }>(this.receiptUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ ids: ticketIds.slice(0, 100) }),
      });
      if (!response.ok) {
        const code = `EXPO_RECEIPT_HTTP_${response.status}`;
        return Object.fromEntries(
          ticketIds.map((id) => [
            id,
            { outcome: 'retryable', errorCode: code },
          ]),
        );
      }
      const data =
        payload?.data && typeof payload.data === 'object' ? payload.data : {};
      return Object.fromEntries(
        ticketIds.map((id) => {
          const receipt = data[id];
          if (!receipt) return [id, { outcome: 'pending' }];
          if (receipt.status === 'ok') return [id, { outcome: 'delivered' }];
          const code = normalizeProviderCode(
            receipt.details?.error,
            'EXPO_RECEIPT_ERROR',
          );
          if (code === 'MessageRateExceeded') {
            return [id, { outcome: 'retryable', errorCode: code }];
          }
          return [
            id,
            {
              outcome: 'permanent',
              errorCode: code,
              deviceInvalid: isDeviceInvalidCode(code),
            },
          ];
        }),
      );
    } catch {
      return Object.fromEntries(
        ticketIds.map((id) => [
          id,
          { outcome: 'retryable', errorCode: 'EXPO_RECEIPT_REQUEST_FAILED' },
        ]),
      );
    }
  }

  async sendPushNotification(message: PushMessage): Promise<boolean> {
    return (await this.sendDeviceNotification(message)).outcome === 'accepted';
  }

  async sendToMultiple(
    tokens: string[],
    notification: Omit<PushMessage, 'to' | 'sound' | 'badge'>,
  ): Promise<void> {
    let accepted = 0;
    for (let index = 0; index < tokens.length; index += 20) {
      const batch = tokens.slice(index, index + 20);
      const results = await Promise.all(
        batch.map((token) =>
          this.sendDeviceNotification({
            ...notification,
            to: token,
            sound: 'default',
          }),
        ),
      );
      accepted += results.filter(
        (result) => result.outcome === 'accepted',
      ).length;
    }
    this.logger.log(
      `Push batch complete (${accepted}/${tokens.length} accepted)`,
    );
  }

  private async fetchJsonWithTimeout<T>(
    url: string,
    init: RequestInit,
  ): Promise<{ response: Response; payload: T | undefined }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const payload = response.ok ? ((await response.json()) as T) : undefined;
      return { response, payload };
    } finally {
      clearTimeout(timeout);
    }
  }
}
