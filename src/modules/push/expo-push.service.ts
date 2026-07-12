import { Injectable, Logger } from '@nestjs/common';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: string;
  badge?: number;
  categoryId?: string;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
}

interface PushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: any;
}

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);
  private readonly EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

  async sendPushNotification(message: PushMessage): Promise<boolean> {
    try {
      const response = await fetch(this.EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        this.logger.error(`Expo push failed: ${response.status}`);
        return false;
      }

      const result = await response.json();
      const ticket: PushTicket = result.data?.[0] || result;

      if (ticket.status === 'error') {
        this.logger.error(`Push ticket error: ${ticket.message}`);
        return false;
      }

      this.logger.log(`✅ Push sent successfully: ${ticket.id}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to send push notification:', error);
      return false;
    }
  }

  async sendToMultiple(tokens: string[], notification: {
    title: string;
    body: string;
    data?: Record<string, any>;
    categoryId?: string;
    priority?: 'default' | 'normal' | 'high';
    channelId?: string;
  }): Promise<void> {
    this.logger.log(`📤 Sending push to ${tokens.length} device(s)...`);
    this.logger.log(`Tokens: ${JSON.stringify(tokens)}`);
    this.logger.log(`Notification: ${JSON.stringify(notification)}`);

    const messages: PushMessage[] = tokens.map(token => ({
      to: token,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      sound: 'default',
      categoryId: notification.categoryId,
      priority: notification.priority,
      channelId: notification.channelId,
    }));

    // Send in batches of 100 (Expo limit)
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      
      try {
        this.logger.log(`Sending batch ${i / 100 + 1}...`);
        const response = await fetch(this.EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(batch),
        });

        const result = await response.json();
        this.logger.log(`✅ Expo response: ${JSON.stringify(result)}`);

        // Check for errors in tickets
        if (result.data) {
          result.data.forEach((ticket: any, index: number) => {
            if (ticket.status === 'error') {
              this.logger.error(`❌ Push failed for token ${tokens[index]}: ${ticket.message}`);
            } else {
              this.logger.log(`✅ Push sent successfully: ${ticket.id}`);
            }
          });
        }
      } catch (error) {
        this.logger.error(`❌ Batch ${i / 100 + 1} failed:`, error);
      }
    }
  }
}
