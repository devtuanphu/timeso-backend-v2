import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ZaloToken } from './entities/zalo-token.entity';

/**
 * ===========================================
 *  Zalo Token Lifecycle (Production Notes)
 * ===========================================
 *
 * Zalo OAuth token có 2 thành phần:
 *   - access_token:  sống ~25 giờ, dùng để gọi ZNS API
 *   - refresh_token: sống 90 ngày, dùng để lấy access_token mới
 *
 * ĐẶC BIỆT QUAN TRỌNG:
 *   Mỗi lần gọi refresh, Zalo sẽ trả về CẢ access_token MỚI
 *   VÀ refresh_token MỚI. Refresh token cũ bị thu hồi ngay lập tức.
 *   → Nếu 2 process gửi cùng 1 refresh_token cũ lên Zalo,
 *     process thứ 2 sẽ bị Zalo trả lỗi -14014 (Invalid refresh token).
 *
 * Chiến lược chống race condition:
 *   1. PM2 instance guard: Cron chỉ chạy trên worker 0
 *      (process.env.NODE_APP_INSTANCE === '0'). Triệt tiêu 100%
 *      race condition từ cron.
 *   2. In-process lock: Promise dedup — chỉ cho 1 request refresh
 *      tại 1 thời điểm trong cùng 1 Node.js process.
 *   3. Cross-process (PM2 cluster): Khi nhận lỗi -14014,
 *      kiểm tra DB (có retry + delay) xem process khác đã refresh
 *      thành công chưa trước khi đánh dấu token chết.
 *   4. Cron time-based guard: backup thêm — skip refresh nếu token
 *      đã được cập nhật gần đây (< CRON_GUARD_HOURS).
 */

// ─── Constants ───────────────────────────────────────────────
const ACCESS_TOKEN_BUFFER_MS = 5 * 60 * 1000;        // 5 phút — refresh sớm trước khi hết hạn
const PROACTIVE_REFRESH_BUFFER_MS = 60 * 60 * 1000;  // 1 giờ  — refresh proactive khi khởi động
const REFRESH_TOKEN_LIFETIME_DAYS = 85;               // 90 ngày thực tế, trừ 5 ngày buffer
const DEFAULT_EXPIRES_IN_SECONDS = 90000;              // fallback ~25 giờ nếu Zalo không trả expires_in
const CRON_GUARD_HOURS = 5;                            // skip cron nếu token đã refresh trong N giờ gần đây
const CRON_INTERVAL_HOURS = 6;                         // chạy cron mỗi N giờ
const RACE_CONDITION_RETRY_DELAY_MS = 2000;            // chờ 2s trước khi retry DB check khi gặp -14014
const RACE_CONDITION_MAX_RETRIES = 3;                  // retry DB check tối đa 3 lần

@Injectable()
export class ZaloService implements OnModuleInit {
  private readonly logger = new Logger(ZaloService.name);

  /**
   * In-process mutex: chặn nhiều caller cùng gọi refresh đồng thời
   * trong cùng 1 Node.js event loop.
   */
  private refreshPromise: Promise<string> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @InjectRepository(ZaloToken)
    private readonly zaloTokenRepository: Repository<ZaloToken>,
  ) {}

  // ═══════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ═══════════════════════════════════════════════════════════

  async onModuleInit() {
    const token = await this.findLatestToken();

    if (!token) {
      this.logger.warn(
        '⚠️ Chưa có Zalo token trong DB. Gọi GET /zalo/oauth-url để authorize.',
      );
      return;
    }

    if (this.isRefreshTokenExpired(token)) {
      this.logger.warn(
        '⚠️ Zalo refresh token đã hết hạn. Cần authorize lại qua GET /zalo/oauth-url',
      );
      return;
    }

    // Proactive refresh nếu access token sắp hết trong 1 giờ tới
    if (this.isAccessTokenExpiringSoon(token, PROACTIVE_REFRESH_BUFFER_MS)) {
      this.logger.log('🔄 Access token sắp/đã hết hạn, proactive refresh...');
      try {
        await this.refreshAccessToken();
        this.logger.log('✅ Proactive refresh thành công. ZNS sẵn sàng.');
      } catch (error) {
        this.logger.error('❌ Proactive refresh thất bại:', error.message);
      }
    } else {
      this.logger.log('✅ Zalo token còn hạn. ZNS sẵn sàng.');
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════

  /**
   * Lấy access token hợp lệ. Tự động refresh nếu sắp hết hạn.
   * Đây là entry point duy nhất mà các module khác nên gọi.
   */
  async getValidAccessToken(): Promise<string> {
    const token = await this.findLatestToken();

    if (!token) {
      throw new Error(
        'Chưa có Zalo token. Vui lòng authorize qua GET /zalo/oauth-url.',
      );
    }

    if (this.isRefreshTokenExpired(token)) {
      throw new Error(
        'Refresh token đã hết hạn. Vui lòng authorize lại qua GET /zalo/oauth-url.',
      );
    }

    // Access token còn hạn (trừ buffer) → trả ngay
    if (!this.isAccessTokenExpiringSoon(token, ACCESS_TOKEN_BUFFER_MS)) {
      return token.accessToken;
    }

    // Access token sắp/đã hết hạn → refresh
    this.logger.log('Access token sắp hết hạn, đang refresh...');
    return this.refreshAccessToken();
  }

  /**
   * Khởi tạo token lần đầu hoặc override (gọi từ OAuth callback hoặc admin API).
   */
  async initToken(
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ) {
    await this.zaloTokenRepository.clear();

    const entity = this.zaloTokenRepository.create({
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      refreshTokenExpiresAt: new Date(
        Date.now() + REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
      ),
    });

    await this.zaloTokenRepository.save(entity);
    this.logger.log('✅ Khởi tạo Zalo token thành công');
    return { message: 'Khởi tạo token thành công' };
  }

  /**
   * Kiểm tra trạng thái token hiện tại (dành cho admin dashboard).
   */
  async getTokenStatus() {
    const token = await this.findLatestToken();

    if (!token) {
      return {
        hasToken: false,
        accessTokenValid: false,
        message:
          'Chưa có token. Vui lòng gọi GET /zalo/oauth-url để authorize.',
      };
    }

    const accessTokenValid = !this.isAccessTokenExpiringSoon(
      token,
      ACCESS_TOKEN_BUFFER_MS,
    );
    const refreshTokenValid = !this.isRefreshTokenExpired(token);

    let message: string;
    if (accessTokenValid) {
      message = 'Access token còn hạn. Sẵn sàng gửi ZNS.';
    } else if (refreshTokenValid) {
      message =
        'Access token hết hạn nhưng sẽ tự động refresh khi gọi API.';
    } else {
      message =
        'Cả access token và refresh token đều hết hạn. Cần authorize lại.';
    }

    return {
      hasToken: true,
      accessTokenValid,
      accessTokenExpiresAt: token.accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: token.refreshTokenExpiresAt.toISOString(),
      lastRefreshed: token.updatedAt.toISOString(),
      message,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  ZNS — GỬI TIN NHẮN
  // ═══════════════════════════════════════════════════════════

  /**
   * Gửi OTP qua ZNS. Tự động retry 1 lần nếu token bị reject.
   */
  async sendOtp(
    phone: string,
    otp: string,
    type: 'register' | 'forgot-password' = 'register',
  ) {
    const templateId =
      type === 'register'
        ? this.configService.get('ZALO_ZNS_REGISTER_TEMPLATE_ID')
        : this.configService.get('ZALO_ZNS_FORGOT_TEMPLATE_ID');

    const formattedPhone = this.formatPhoneNumber(phone);
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const accessToken = await this.getValidAccessToken();

        const response = await firstValueFrom(
          this.httpService.post(
            'https://business.openapi.zalo.me/message/template',
            {
              phone: formattedPhone,
              template_id: templateId,
              template_data: { otp },
            },
            {
              headers: {
                'Content-Type': 'application/json',
                access_token: accessToken,
              },
            },
          ),
        );

        const data = response.data;
        this.logger.log(
          `ZNS sent to ${formattedPhone}: error=${data.error}, message=${data.message}`,
        );

        // Zalo trả error trong body (HTTP vẫn 200)
        if (data.error !== 0) {
          const isTokenError =
            data.error === -124 || data.error === -216;

          if (isTokenError && attempt < maxAttempts) {
            this.logger.warn(
              `ZNS token error (code: ${data.error}), force refresh và retry...`,
            );
            await this.refreshAccessToken();
            continue;
          }

          throw new Error(
            `ZNS Error (code: ${data.error}): ${data.message}`,
          );
        }

        return data;
      } catch (error) {
        // Retry 1 lần nếu lỗi liên quan token
        const isTokenRelated = error.message
          ?.toLowerCase()
          .includes('token');

        if (isTokenRelated && attempt < maxAttempts) {
          this.logger.warn('ZNS lỗi token, force refresh và retry...');
          try {
            await this.refreshAccessToken();
            continue;
          } catch (refreshErr) {
            this.logger.error(
              'Force refresh thất bại:',
              refreshErr.message,
            );
          }
        }

        this.logger.error(
          'Lỗi gửi ZNS:',
          error.response?.data || error.message,
        );
        throw error;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  OAUTH
  // ═══════════════════════════════════════════════════════════

  /**
   * Exchange authorization code → access_token + refresh_token (OAuth 2.0).
   */
  async exchangeCodeForToken(code: string): Promise<{ message: string }> {
    const appId = this.configService.get('ZALO_APP_ID');
    const secretKey = this.configService.get('ZALO_APP_SECRET');
    const redirectUri =
      this.configService.get('ZALO_REDIRECT_URI') ||
      'http://localhost:3000/zalo/oauth-callback';

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          'https://oauth.zaloapp.com/v4/oa/access_token',
          new URLSearchParams({
            code,
            app_id: appId,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              secret_key: secretKey,
            },
          },
        ),
      );

      const { access_token, refresh_token, expires_in } = response.data;

      if (!access_token) {
        throw new Error(
          `Zalo OAuth Error: ${response.data.error_description || 'Unknown error'}`,
        );
      }

      await this.initToken(
        access_token,
        refresh_token,
        Number(expires_in) || DEFAULT_EXPIRES_IN_SECONDS,
      );

      this.logger.log('✅ OAuth token exchange thành công');
      return { message: 'Token đã được khởi tạo thành công từ OAuth' };
    } catch (error) {
      this.logger.error(
        'Lỗi exchange code:',
        error.response?.data || error.message,
      );
      throw new Error(
        `Không thể lấy token từ Zalo: ${error.response?.data?.error_description || error.message}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CRON — KEEP-ALIVE TOKEN
  // ═══════════════════════════════════════════════════════════

  /**
   * Chạy mỗi 6 giờ. Đảm bảo refresh_token luôn được renew
   * (vì Zalo cấp refresh_token mới mỗi lần refresh).
   *
   * Guard chống PM2 cluster race condition:
   *   - Nếu token đã được cập nhật trong CRON_GUARD_HOURS gần đây → skip.
   *   - Nếu refresh_token đã hết hạn → log cảnh báo, không retry.
   */
  @Cron(`0 */${CRON_INTERVAL_HOURS} * * *`)
  async keepAliveToken() {
    // ─── PM2 Cluster Guard ───
    // PM2 cluster mode gán NODE_APP_INSTANCE cho mỗi worker (0, 1, 2...).
    // Chỉ cho worker 0 chạy cron để tránh race condition hoàn toàn.
    const instanceId = process.env.NODE_APP_INSTANCE;
    if (instanceId !== undefined && instanceId !== '0') {
      return; // silent skip — không log để tránh spam
    }

    this.logger.log('⏰ [Cron] Bắt đầu keep-alive token...');

    try {
      const token = await this.findLatestToken();

      if (!token) {
        this.logger.warn('[Cron] Không có token trong DB.');
        return;
      }

      if (this.isRefreshTokenExpired(token)) {
        this.logger.error(
          '[Cron] ⚠️ Refresh token đã hết hạn! Cần authorize lại qua GET /zalo/oauth-url',
        );
        return;
      }

      // Guard: skip nếu một process khác (PM2) đã refresh gần đây
      const guardMs = CRON_GUARD_HOURS * 60 * 60 * 1000;
      const guardThreshold = new Date(Date.now() - guardMs);
      if (token.updatedAt && token.updatedAt > guardThreshold) {
        this.logger.log(
          `[Cron] Token đã được refresh lúc ${token.updatedAt.toISOString()}, skip.`,
        );
        return;
      }

      await this.refreshAccessToken();
      this.logger.log(
        '✅ [Cron] Keep-alive thành công. Token mới đã được lưu.',
      );
    } catch (error) {
      this.logger.error('[Cron] Keep-alive thất bại:', error.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CORE: REFRESH TOKEN (với in-process lock + cross-process guard)
  // ═══════════════════════════════════════════════════════════

  /**
   * Entry point chính để refresh token. Có 2 tầng bảo vệ:
   *
   * 1. In-process dedup (Promise lock):
   *    Nếu đang có 1 request refresh chạy, các request sau sẽ chờ
   *    kết quả thay vì gửi thêm request lên Zalo.
   *
   * 2. Fresh-read từ DB:
   *    Luôn đọc token MỚI NHẤT từ DB trước khi gửi lên Zalo,
   *    tránh dùng stale token từ caller trước đó.
   */
  async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) {
      this.logger.log(
        '⏳ Đang có request refresh khác chạy, chờ kết quả...',
      );
      return this.refreshPromise;
    }

    this.refreshPromise = this.executeRefresh().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  /**
   * Thực thi refresh token lên Zalo API.
   * KHÔNG gọi trực tiếp — luôn gọi qua refreshAccessToken().
   */
  private async executeRefresh(): Promise<string> {
    // Luôn đọc fresh từ DB — không dùng stale reference
    const token = await this.findLatestToken();
    if (!token) {
      throw new Error(
        'Không có Zalo token trong DB. Authorize qua GET /zalo/oauth-url.',
      );
    }

    if (this.isRefreshTokenExpired(token)) {
      throw new Error(
        'Refresh token đã hết hạn. Authorize lại qua GET /zalo/oauth-url.',
      );
    }

    const appId = this.configService.get('ZALO_APP_ID');
    const secretKey = this.configService.get('ZALO_APP_SECRET');

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          'https://oauth.zaloapp.com/v4/oa/access_token',
          new URLSearchParams({
            refresh_token: token.refreshToken,
            app_id: appId,
            grant_type: 'refresh_token',
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              secret_key: secretKey,
            },
          },
        ),
      );

      const data = response.data;
      this.logger.log(
        `Zalo refresh response: access_token=${!!data.access_token}, refresh_token=${!!data.refresh_token}, expires_in=${data.expires_in}, error=${data.error || 'none'}`,
      );

      // ─── Zalo trả error trong body (HTTP vẫn 200) ───
      if (data.error && data.error < 0) {
        return this.handleRefreshError(data, token);
      }

      if (!data.access_token || !data.refresh_token) {
        await this.markTokenExpired(token);
        throw new Error(
          `Zalo trả về response không hợp lệ: ${JSON.stringify(data)}`,
        );
      }

      // ─── Thành công: lưu token mới vào DB ───
      return this.saveNewTokens(token, data);
    } catch (error) {
      // Nếu là lỗi đã throw ở trên (handleRefreshError), rethrow
      if (error.message?.includes('authorize lại') || error.message?.includes('Authorize')) {
        throw error;
      }
      this.logger.error(
        'Lỗi gọi Zalo refresh API:',
        error.response?.data || error.message,
      );
      throw new Error(
        'Không thể refresh Zalo token. Kiểm tra kết nối mạng hoặc authorize lại.',
      );
    }
  }

  /**
   * Xử lý khi Zalo trả error code < 0 trong body response.
   *
   * Case quan trọng nhất: -14014 (Invalid refresh token)
   *   → Có thể do PM2 cluster: process khác đã refresh trước,
   *     Zalo đã thu hồi refresh_token cũ.
   *   → Kiểm tra DB: nếu refresh_token trong DB khác với cái vừa gửi,
   *     nghĩa là process khác đã cập nhật thành công → dùng luôn token đó.
   */
  private async handleRefreshError(
    data: any,
    usedToken: ZaloToken,
  ): Promise<string> {
    const errorCode = data.error;
    const errorName = data.error_name || data.error_description || 'Unknown';

    this.logger.error(`Zalo API error: code=${errorCode}, name=${errorName}`);

    // -14014: Invalid refresh token — có thể do race condition PM2
    if (errorCode === -14014 || errorName === 'Invalid refresh token.') {
      // Retry DB check với delay: worker khác có thể đang save token mới
      // nhưng chưa kịp commit vào DB tại thời điểm ta check.
      for (let retry = 0; retry < RACE_CONDITION_MAX_RETRIES; retry++) {
        const latestToken = await this.findLatestToken();

        if (latestToken && latestToken.refreshToken !== usedToken.refreshToken) {
          this.logger.warn(
            `✅ Token đã được cập nhật bởi process khác (phát hiện ở retry ${retry}). Dùng token từ DB.`,
          );
          return latestToken.accessToken;
        }

        // Chưa thấy token mới → chờ rồi thử lại
        if (retry < RACE_CONDITION_MAX_RETRIES - 1) {
          this.logger.log(
            `[Race guard] DB chưa có token mới, chờ ${RACE_CONDITION_RETRY_DELAY_MS}ms (retry ${retry + 1}/${RACE_CONDITION_MAX_RETRIES})...`,
          );
          await this.sleep(RACE_CONDITION_RETRY_DELAY_MS);
        }
      }

      // Sau tất cả retries, không ai cập nhật → token thực sự đã chết
      this.logger.error(
        '🔴 Refresh token thực sự đã bị Zalo thu hồi (đã chờ và retry). Cần authorize lại.',
      );
      await this.markTokenExpired(usedToken);
    }

    throw new Error(
      `Zalo token bị từ chối (${errorCode}: ${errorName}). Cần authorize lại qua GET /zalo/oauth-url.`,
    );
  }

  /**
   * Lưu access_token + refresh_token mới vào DB.
   */
  private async saveNewTokens(
    tokenRecord: ZaloToken,
    data: { access_token: string; refresh_token: string; expires_in?: number },
  ): Promise<string> {
    const expiresInSeconds =
      Number(data.expires_in) || DEFAULT_EXPIRES_IN_SECONDS;

    tokenRecord.accessToken = data.access_token;
    tokenRecord.refreshToken = data.refresh_token;
    tokenRecord.accessTokenExpiresAt = new Date(
      Date.now() + expiresInSeconds * 1000,
    );
    tokenRecord.refreshTokenExpiresAt = new Date(
      Date.now() + REFRESH_TOKEN_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.zaloTokenRepository.save(tokenRecord);
    this.logger.log(
      `✅ Token refreshed. Access expires: ${tokenRecord.accessTokenExpiresAt.toISOString()}`,
    );

    return data.access_token;
  }

  // ═══════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════

  private async findLatestToken(): Promise<ZaloToken | null> {
    return this.zaloTokenRepository.findOne({
      where: {},
      order: { updatedAt: 'DESC' },
    });
  }

  private isRefreshTokenExpired(token: ZaloToken): boolean {
    return token.refreshTokenExpiresAt.getTime() <= Date.now();
  }

  private isAccessTokenExpiringSoon(
    token: ZaloToken,
    bufferMs: number,
  ): boolean {
    return token.accessTokenExpiresAt.getTime() - bufferMs <= Date.now();
  }

  private async markTokenExpired(token: ZaloToken): Promise<void> {
    this.logger.warn(
      '🔴 Đánh dấu Zalo token hết hạn trong DB (cron sẽ dừng retry).',
    );
    token.refreshTokenExpiresAt = new Date(0);
    token.accessTokenExpiresAt = new Date(0);
    await this.zaloTokenRepository.save(token);
  }

  private formatPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '84' + cleaned.substring(1);
    }
    if (!cleaned.startsWith('84')) {
      cleaned = '84' + cleaned;
    }
    return cleaned;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
