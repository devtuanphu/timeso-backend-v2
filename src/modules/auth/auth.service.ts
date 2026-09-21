import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountsService } from '../accounts/accounts.service';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountRefreshToken, AppType } from '../accounts/entities/account-refresh-token.entity';
import {
  DataSource,
  EntityManager,
  IsNull,
  LessThan,
  MoreThan,
  Repository,
} from 'typeorm';
import { createHash, randomInt, randomUUID } from 'crypto';

import { hashOtp, matchesStoredOtp } from './otp-hash';
import {
  isOverSendLimit,
  OTP_SEND_WINDOW_MS,
  OTP_VERIFY_LIMIT,
  OTP_VERIFY_WINDOW_MS,
  SlidingWindowCounter,
} from './otp-rate-limit';

/** Kept in sync with `RegisterDto.password`. */
const MIN_PASSWORD_LENGTH = 6;

/**
 * Live refresh tokens kept per account and app. Caps how many devices can stay
 * signed in at once and bounds the legacy bcrypt fallback scan.
 */
const MAX_LIVE_REFRESH_TOKENS = 5;

/**
 * Refresh tokens are stored as `sha256:<hex>` of the full token.
 *
 * They used to be bcrypt-hashed, but bcrypt only reads the first 72 bytes of
 * its input. Every refresh JWT of one account shares those 72 bytes (header
 * plus the start of the payload), so any old refresh token matched any live
 * row and rotation/revocation did nothing. SHA-256 covers the whole token, and
 * a token of this entropy does not need a slow hash.
 */
const REFRESH_TOKEN_HASH_PREFIX = 'sha256:';
const LEGACY_BCRYPT_HASH_PREFIX = '$2';
/** How far a legacy row's `issuedAt` may drift from the token's `iat`. */
const LEGACY_REFRESH_ISSUED_AT_TOLERANCE_MS = 5_000;
const DEFAULT_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PASSWORD_RESET_TOKEN_USE = 'password_reset' as const;
const PASSWORD_RESET_TOKEN_TTL = '15m';

export function hashRefreshToken(token: string): string {
  return `${REFRESH_TOKEN_HASH_PREFIX}${createHash('sha256')
    .update(token)
    .digest('hex')}`;
}

/**
 * Binds a password-reset token to the password it replaces. Once the password
 * changes the fingerprint no longer matches, which makes the token single-use
 * without storing it.
 */
function passwordFingerprint(accountId: string, passwordHash: string): string {
  return createHash('sha256')
    .update(`${accountId}:${passwordHash}`)
    .digest('hex')
    .slice(0, 32);
}

/** Rejects unknown app types instead of silently storing them. */
export function resolveAppType(value: unknown): AppType {
  if (value === undefined || value === null || value === '') {
    return AppType.OWNER_APP;
  }
  if (Object.values(AppType).includes(value as AppType)) {
    return value as AppType;
  }
  throw new BadRequestException({
    code: 'INVALID_APP_TYPE',
    message: 'appType không hợp lệ',
  });
}

/**
 * Failed OTP verifications per account. See otp-rate-limit.ts for why this is
 * in-process and what that trades away.
 */
const otpVerifyFailures = new SlidingWindowCounter({
  limit: OTP_VERIFY_LIMIT,
  windowMs: OTP_VERIFY_WINDOW_MS,
});

/** Test-only: clears accumulated verify failures between cases. */
export function __resetOtpVerifyLimiterForTests(): void {
  otpVerifyFailures.clear();
}
import { MailService } from '../mail/mail.service';
import { AccountOtp } from '../accounts/entities/account-otp.entity';
import { Account, AccountStatus } from '../accounts/entities/account.entity';
import { ZaloService } from '../zalo/zalo.service';
import { EmployeeProfile } from '../stores/entities/employee-profile.entity';
import { StoresService } from '../stores/stores.service';
import { isAppReadOnlyMode } from '../../common/utils/app-read-only-mode';
import {
  JWT_ACCESS_TOKEN_USE,
  JWT_REFRESH_TOKEN_USE,
  isLegacyUntypedTokenAccepted,
  requireJwtRefreshSecret,
  requireJwtSecret,
  type TimesoJwtPayload,
} from './jwt.config';
import {
  normalizeEmail,
  normalizeVietnamPhone,
} from '../../common/utils/account-identifier';
import { OtpDeliveryStatus } from './dto/auth-response.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly accountsService: AccountsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(AccountRefreshToken)
    private readonly refreshTokenRepository: Repository<AccountRefreshToken>,
    @InjectRepository(AccountOtp)
    private readonly otpRepository: Repository<AccountOtp>,
    @InjectRepository(EmployeeProfile)
    private readonly employeeProfileRepository: Repository<EmployeeProfile>,
    private readonly mailService: MailService,
    private readonly zaloService: ZaloService,
    private readonly storesService: StoresService,
    private readonly dataSource: DataSource,
  ) {}

  /** Server secret keying the OTP HMAC; required at startup already. */
  private otpHashSecret(): string {
    return requireJwtSecret(this.configService);
  }

  /** Codes are persisted hashed; the plaintext is only sent to the user. */
  private storedOtpValue(code: string): string {
    return hashOtp(code, this.otpHashSecret());
  }

  private generateOtp(): string {
    return randomInt(100000, 1000000).toString();
  }

  private invalidOtp(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_OR_EXPIRED_OTP',
      message: 'Mã OTP không chính xác hoặc đã hết hạn.',
    });
  }

  /** The row expires when the JWT does, so JWT_REFRESH_EXPIRES_IN is honoured. */
  private refreshTokenExpiry(token: string, issuedAt: Date): Date {
    const decoded = this.jwtService.decode(token) as { exp?: number } | null;
    if (decoded && typeof decoded.exp === 'number') {
      return new Date(decoded.exp * 1000);
    }
    return new Date(issuedAt.getTime() + DEFAULT_REFRESH_TTL_MS);
  }

  private passwordResetSecret(): string {
    // A distinct secret means a reset token can never pass as an access or
    // refresh token, whatever the strategies check.
    return `${requireJwtSecret(this.configService)}:${PASSWORD_RESET_TOKEN_USE}`;
  }

  private issuePasswordResetToken(account: Pick<Account, 'id' | 'passwordHash'>): string {
    return this.jwtService.sign(
      {
        sub: account.id,
        tokenUse: PASSWORD_RESET_TOKEN_USE,
        pwf: passwordFingerprint(account.id, account.passwordHash),
      },
      { secret: this.passwordResetSecret(), expiresIn: PASSWORD_RESET_TOKEN_TTL },
    );
  }

  private invalidResetToken(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_OR_EXPIRED_RESET_TOKEN',
      message: 'Phiên đặt lại mật khẩu không hợp lệ hoặc đã hết hạn. Vui lòng xác thực OTP lại.',
    });
  }

  /**
   * Rows written before the switch to SHA-256 are bcrypt hashes. bcrypt alone
   * cannot tell tokens of one account apart (72-byte limit), so a legacy row
   * only matches when it was also issued at the token's own `iat`. These rows
   * expire within the refresh TTL, after which this path finds nothing.
   */
  private async findLegacyRefreshToken(
    refreshToken: string,
    issuedAtSeconds: number | undefined,
    accountId: string,
    appType: AppType,
  ): Promise<AccountRefreshToken | null> {
    if (typeof issuedAtSeconds !== 'number') return null;
    const candidates = await this.refreshTokenRepository.find({
      where: {
        accountId,
        appType,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    const issuedAtMs = issuedAtSeconds * 1000;
    for (const row of candidates) {
      if (!row.tokenHash?.startsWith(LEGACY_BCRYPT_HASH_PREFIX)) continue;
      const issuedAt = row.issuedAt ? new Date(row.issuedAt).getTime() : NaN;
      if (
        !Number.isFinite(issuedAt) ||
        Math.abs(issuedAt - issuedAtMs) > LEGACY_REFRESH_ISSUED_AT_TOLERANCE_MS
      ) {
        continue;
      }
      if (await bcrypt.compare(refreshToken, row.tokenHash)) return row;
    }
    return null;
  }

  /**
   * Revokes live refresh tokens beyond the most recent
   * `MAX_LIVE_REFRESH_TOKENS` for an account/app, and clears out rows that are
   * already dead. Keeps the per-refresh bcrypt scan bounded.
   */
  private async revokeStaleRefreshTokens(
    accountId: string,
    appType: AppType,
  ): Promise<void> {
    try {
      const live = await this.refreshTokenRepository.find({
        where: { accountId, appType, revokedAt: IsNull() },
        order: { issuedAt: 'DESC' },
        select: ['id'],
      });

      const stale = live.slice(MAX_LIVE_REFRESH_TOKENS).map((row) => row.id);
      if (stale.length) {
        await this.refreshTokenRepository.update(stale, {
          revokedAt: new Date(),
        });
      }

      // Housekeeping: drop rows that can never match again.
      await this.refreshTokenRepository.delete({
        accountId,
        appType,
        expiresAt: LessThan(new Date()),
      });
    } catch (error) {
      // Never fail a login because housekeeping failed.
      this.logger.warn(
        `Refresh token pruning failed for account ${accountId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private tooManyRequests(message: string): HttpException {
    return new HttpException(
      { code: 'TOO_MANY_REQUESTS', message },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Caps how many codes one account can request in the send window. Derived
   * from persisted `created_at`, so it holds across processes and restarts.
   */
  private async assertOtpSendAllowed(
    accountId: string,
    type: 'REGISTER' | 'FORGOT_PASSWORD',
  ): Promise<void> {
    const recentSends = await this.otpRepository.count({
      where: {
        accountId,
        type,
        createdAt: MoreThan(new Date(Date.now() - OTP_SEND_WINDOW_MS)),
      },
    });
    if (isOverSendLimit(recentSends)) {
      throw this.tooManyRequests(
        'Bạn đã yêu cầu mã quá nhiều lần. Vui lòng thử lại sau ít phút.',
      );
    }
  }

  /** Bounds brute force against a six-digit code. */
  private assertOtpVerifyAllowed(accountId: string): void {
    if (otpVerifyFailures.count(accountId) >= OTP_VERIFY_LIMIT) {
      throw this.tooManyRequests(
        'Bạn đã nhập sai mã quá nhiều lần. Vui lòng thử lại sau ít phút.',
      );
    }
  }

  private async lockRegistrationIdentifiers(
    manager: EntityManager,
    email: string | undefined,
    phone: string,
  ): Promise<void> {
    const keys = [
      email ? `account-identifier:email:${email}` : undefined,
      `account-identifier:phone:${phone}`,
    ]
      .filter((value): value is string => Boolean(value))
      .sort();
    for (const key of keys) {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [key],
      );
    }
  }

  private async deliverOtp(
    phone: string,
    otp: string,
    type: 'register' | 'forgot-password',
  ): Promise<OtpDeliveryStatus> {
    try {
      await this.zaloService.sendOtp(phone, otp, type);
      return OtpDeliveryStatus.SENT;
    } catch {
      this.loggerDeliveryFailure(type);
      return OtpDeliveryStatus.FAILED;
    }
  }

  private loggerDeliveryFailure(type: string): void {
    // Intentionally omit the phone, OTP and provider payload.
    console.warn(`OTP delivery failed for flow=${type}`);
  }

  /**
   * Validate user by email OR phone + password
   */
  async validateUser(emailOrPhone: string, pass: string): Promise<any> {
    if (typeof emailOrPhone !== 'string' || typeof pass !== 'string') {
      return null;
    }
    try {
      if (emailOrPhone.includes('@')) normalizeEmail(emailOrPhone);
      else normalizeVietnamPhone(emailOrPhone);
    } catch {
      return null;
    }
    const user = await this.accountsService.findByEmailOrPhone(emailOrPhone);
    if (user && (await bcrypt.compare(pass, user.passwordHash))) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: any, appType: AppType = AppType.OWNER_APP) {
    if (user.status === 'unverified') {
      // Trả về thông tin để frontend chuyển sang màn xác thực
      // OTP sẽ chỉ được gửi khi user bấm nút "Gửi OTP" trên màn xác thực
      return {
        requiresVerification: true,
        message: 'Tài khoản chưa được xác thực. Vui lòng xác thực để hoàn tất đăng ký.',
        phone: user.phone,
      };
    }

    const accessPayload: TimesoJwtPayload = {
      email: user.email,
      sub: user.id,
      tokenUse: JWT_ACCESS_TOKEN_USE,
    };
    const refreshPayload: TimesoJwtPayload = {
      email: user.email,
      sub: user.id,
      tokenUse: JWT_REFRESH_TOKEN_USE,
    };

    const accessToken = this.jwtService.sign(accessPayload);
    // `jti` makes every refresh token unique even when two are signed in the
    // same second for the same account (token_hash is a unique column).
    const refreshTokenValue = this.jwtService.sign(
      { ...refreshPayload, jti: randomUUID() },
      {
        secret: requireJwtRefreshSecret(this.configService),
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN'),
      },
    );

    const readOnly = isAppReadOnlyMode(this.configService);
    if (!readOnly) {
      const issuedAt = new Date();
      const refreshTokenEntity = this.refreshTokenRepository.create({
        accountId: user.id,
        tokenHash: hashRefreshToken(refreshTokenValue),
        appType,
        issuedAt,
        expiresAt: this.refreshTokenExpiry(refreshTokenValue, issuedAt),
      });
      await this.refreshTokenRepository.save(refreshTokenEntity);
      await this.revokeStaleRefreshTokens(user.id, appType);
    }

    const { passwordHash, ...cleanUser } = user;

    // For staff app: include employeeProfile data
    let employeeData: any = {};
    if (appType === AppType.EMPLOYEE_APP) {
      const profile = await this.employeeProfileRepository.findOne({
        where: { accountId: user.id },
        relations: ['store'],
      });
      if (profile) {
        employeeData = {
          employeeProfileId: profile.id,
          storeId: profile.storeId,
          storeName: profile.store?.name || '',
          employmentStatus: profile.employmentStatus,
        };
      }
    }

    if (!readOnly) {
      // Fire-and-forget: ensure daily report exists (cron job fallback)
      this.triggerDailyReportEnsure(user, appType, employeeData.storeId);
    }

    return {
      access_token: accessToken,
      refresh_token: refreshTokenValue,
      user: { ...cleanUser, ...employeeData },
    };
  }

  /**
   * Fire-and-forget: Đảm bảo daily report tồn tại khi login.
   * Fallback cho cron job bị miss (server sập, lỗi...).
   */
  private triggerDailyReportEnsure(user: any, appType: AppType, storeId?: string): void {
    const task = async () => {
      try {
        if (appType === AppType.EMPLOYEE_APP && storeId) {
          await this.storesService.ensureDailyReportForStore(storeId);
        } else if (appType === AppType.OWNER_APP) {
          await this.storesService.ensureDailyReportsForOwner(user.id);
        }
      } catch (error) {
        // Silent fail — không ảnh hưởng login
      }
    };
    task(); // fire-and-forget, không await
  }

  async register(data: any) {
    let phone: string;
    let email: string | undefined;
    try {
      phone = normalizeVietnamPhone(data.phone);
      email = data.email ? normalizeEmail(data.email) : undefined;
    } catch {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Số điện thoại không hợp lệ.',
      });
    }

    const otpCode = this.generateOtp();
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.lockRegistrationIdentifiers(manager, email, phone);
        const user = await this.accountsService.create(
          { ...data, phone, email },
          manager,
        );
        const otpRepository = manager.getRepository(AccountOtp);
        await otpRepository.update(
          { accountId: user.id, type: 'REGISTER', isUsed: false },
          { isUsed: true },
        );
        await otpRepository.save(
          otpRepository.create({
            accountId: user.id,
            otp: this.storedOtpValue(otpCode),
            type: 'REGISTER',
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          }),
        );
      });
    } catch (error: any) {
      if (error instanceof ConflictException || error?.code === '23505') {
        throw new ConflictException({
          code: 'ACCOUNT_ALREADY_EXISTS',
          message: 'Email hoặc số điện thoại đã được sử dụng.',
        });
      }
      throw error;
    }

    const otpDelivery = await this.deliverOtp(phone, otpCode, 'register');
    return {
      message:
        otpDelivery === OtpDeliveryStatus.SENT
          ? 'Đăng ký thành công. Vui lòng kiểm tra Zalo để nhận mã xác thực.'
          : 'Đăng ký thành công, nhưng chưa gửi được OTP qua Zalo. Vui lòng gửi lại mã.',
      phone,
      verificationRequired: true as const,
      otpDelivery,
    };
  }

  async verifyOtp(
    phone: string,
    otp: string,
    type: 'register' | 'forgot-password' = 'register',
    appType: AppType = AppType.OWNER_APP,
  ) {
    const formattedType = type === 'register' ? 'REGISTER' : 'FORGOT_PASSWORD';
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeVietnamPhone(phone);
    } catch {
      throw this.invalidOtp();
    }

    const activatedAccount = await this.dataSource.transaction(async (manager) => {
      const user = await this.accountsService.findByPhone(
        normalizedPhone,
        manager,
        true,
      );
      if (!user) throw this.invalidOtp();
      // Bound brute force before comparing the code.
      this.assertOtpVerifyAllowed(user.id);
      if (
        formattedType === 'REGISTER' &&
        user.status !== AccountStatus.UNVERIFIED
      ) {
        throw this.invalidOtp();
      }

      const otpRecord = await manager
        .getRepository(AccountOtp)
        .createQueryBuilder('accountOtp')
        .where('accountOtp.accountId = :accountId', { accountId: user.id })
        .andWhere('accountOtp.type = :type', { type: formattedType })
        .andWhere('accountOtp.isUsed = false')
        .orderBy('accountOtp.createdAt', 'DESC')
        .addOrderBy('accountOtp.id', 'DESC')
        .getOne();

      if (
        !otpRecord ||
        !matchesStoredOtp(otpRecord.otp, otp, this.otpHashSecret()) ||
        otpRecord.expiresAt.getTime() <= Date.now()
      ) {
        // Count the miss so repeated guesses eventually trip the limit.
        otpVerifyFailures.hit(user.id);
        throw this.invalidOtp();
      }

      // A correct code clears the account's failure budget.
      otpVerifyFailures.reset(user.id);
      otpRecord.isUsed = true;
      await manager.save(AccountOtp, otpRecord);

      if (formattedType === 'REGISTER') {
        await manager.update(
          AccountOtp,
          { accountId: user.id, type: 'REGISTER', isUsed: false },
          { isUsed: true },
        );
        user.status = AccountStatus.ACTIVE;
        return { activated: await manager.save(Account, user), resetFor: null };
      }
      return { activated: null, resetFor: user };
    });

    if (activatedAccount.activated) {
      return this.login(activatedAccount.activated, appType);
    }
    return {
      message: 'Xác thực thành công. Bây giờ bạn có thể đặt lại mật khẩu mới.',
      // The only proof reset-password accepts. It is bound to the current
      // password, so it stops working once the password changes.
      resetToken: this.issuePasswordResetToken(activatedAccount.resetFor!),
    };
  }

  async resendOtp(phone: string, type: 'register' | 'forgot-password' = 'register') {
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeVietnamPhone(phone);
    } catch {
      throw new UnauthorizedException('Không tìm thấy tài khoản với số điện thoại này.');
    }
    const formattedType =
      type === 'register' ? 'REGISTER' : 'FORGOT_PASSWORD';
    const otpCode = this.generateOtp();
    const canonicalPhone = await this.dataSource.transaction(async (manager) => {
      const user = await this.accountsService.findByPhone(
        normalizedPhone,
        manager,
        true,
      );
      if (!user) {
        throw new UnauthorizedException(
          'Không tìm thấy tài khoản với số điện thoại này.',
        );
      }
      if (type === 'register' && user.status !== AccountStatus.UNVERIFIED) {
        throw new UnauthorizedException(
          'Không thể gửi mã xác thực cho tài khoản này.',
        );
      }
      await this.assertOtpSendAllowed(user.id, formattedType);
      const repository = manager.getRepository(AccountOtp);
      await repository.update(
        { accountId: user.id, type: formattedType, isUsed: false },
        { isUsed: true },
      );
      await repository.save(
        repository.create({
          accountId: user.id,
          otp: this.storedOtpValue(otpCode),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          type: formattedType,
        }),
      );
      return { phone: user.phone };
    });
    const otpDelivery = await this.deliverOtp(
      canonicalPhone.phone,
      otpCode,
      type,
    );
    return {
      message:
        otpDelivery === OtpDeliveryStatus.SENT
          ? 'Mã OTP mới đã được gửi qua Zalo.'
          : 'Chưa gửi được OTP qua Zalo. Vui lòng thử lại.',
      phone: canonicalPhone.phone,
      otpDelivery,
    };
  }

  async forgotPassword(phone: string) {
    let normalizedPhone: string;
    try {
      normalizedPhone = normalizeVietnamPhone(phone);
    } catch {
      throw new UnauthorizedException('Không tìm thấy tài khoản với số điện thoại này.');
    }
    const user = await this.accountsService.findByPhone(normalizedPhone);
    if (!user) throw new UnauthorizedException('Không tìm thấy tài khoản với số điện thoại này.');

    await this.assertOtpSendAllowed(user.id, 'FORGOT_PASSWORD');

    // Vô hiệu hóa các OTP cũ cho luồng quên mật khẩu
    await this.otpRepository.update(
      { accountId: user.id, type: 'FORGOT_PASSWORD', isUsed: false },
      { isUsed: true }
    );

    // Math.random() is not a CSPRNG. Password reset is the flow that most needs
    // an unpredictable code, and register/resend already use this helper.
    const otpCode = this.generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const otpEntity = this.otpRepository.create({
      accountId: user.id,
      otp: this.storedOtpValue(otpCode),
      expiresAt,
      type: 'FORGOT_PASSWORD',
    });
    await this.otpRepository.save(otpEntity);

    // Gửi OTP qua Zalo ZNS thay vì email
    try {
      await this.zaloService.sendOtp(user.phone, otpCode, 'forgot-password');
      return { message: 'Mã OTP đặt lại mật khẩu đã được gửi qua Zalo.', phone: user.phone };
    } catch {
      // The axios error carries `config.data` (the recipient phone and the OTP)
      // and the provider Authorization header, so it must never be logged whole.
      // `loggerDeliveryFailure` records only the flow.
      this.loggerDeliveryFailure('forgot-password');
      // Previously returned HTTP 200 with an error message, so a failed
      // delivery was indistinguishable from success to the client.
      throw new ServiceUnavailableException({
        code: 'OTP_DELIVERY_FAILED',
        message: 'Lỗi gửi OTP. Vui lòng thử lại.',
      });
    }
  }

  /**
   * Sets a new password. The caller must present the reset token returned by
   * a successful forgot-password `verify-otp`; nothing else proves the OTP was
   * entered. (The old check looked for any recently "used" OTP row, but
   * forgot-password marks superseded codes used too, so two forgot-password
   * calls were enough to reset any account.)
   */
  async resetPassword(
    resetToken: string,
    newPassword: string,
    phone?: string,
  ) {
    // Mirrors RegisterDto's rule, which this path bypassed entirely: any
    // non-empty string was accepted, so a reset could weaken an account below
    // the floor enforced at sign-up.
    if (
      typeof newPassword !== 'string' ||
      newPassword.length < MIN_PASSWORD_LENGTH
    ) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Mật khẩu phải ít nhất ${MIN_PASSWORD_LENGTH} ký tự`,
      });
    }
    if (typeof resetToken !== 'string' || !resetToken) {
      throw this.invalidResetToken();
    }

    let claims: { sub?: string; tokenUse?: string; pwf?: string };
    try {
      claims = this.jwtService.verify(resetToken, {
        secret: this.passwordResetSecret(),
      });
    } catch {
      throw this.invalidResetToken();
    }
    if (
      claims.tokenUse !== PASSWORD_RESET_TOKEN_USE ||
      typeof claims.sub !== 'string' ||
      typeof claims.pwf !== 'string'
    ) {
      throw this.invalidResetToken();
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.dataSource.transaction(async (manager) => {
      const account = await manager
        .getRepository(Account)
        .createQueryBuilder('account')
        .addSelect('account.passwordHash')
        .where('account.id = :id', { id: claims.sub })
        .setLock('pessimistic_write')
        .getOne();
      if (
        !account ||
        passwordFingerprint(account.id, account.passwordHash) !== claims.pwf
      ) {
        throw this.invalidResetToken();
      }
      if (phone) {
        let normalizedPhone: string | null = null;
        try {
          normalizedPhone = normalizeVietnamPhone(phone);
        } catch {
          normalizedPhone = null;
        }
        let accountPhone: string | null = null;
        try {
          accountPhone = normalizeVietnamPhone(account.phone);
        } catch {
          accountPhone = account.phone;
        }
        if (!normalizedPhone || accountPhone !== normalizedPhone) {
          throw this.invalidResetToken();
        }
      }

      await manager.update(Account, account.id, { passwordHash: hashedPassword });
      await manager.update(
        AccountOtp,
        { accountId: account.id, type: 'FORGOT_PASSWORD', isUsed: false },
        { isUsed: true },
      );
      // Whoever knew the old password may hold live sessions; end them all.
      await manager.update(
        AccountRefreshToken,
        { accountId: account.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    });

    return { message: 'Mật khẩu đã được đặt lại thành công.' };
  }

  async refreshToken(refreshToken: string, appType: AppType = AppType.OWNER_APP) {
    const resolvedAppType = resolveAppType(appType);
    try {
      const payload = this.jwtService.verify<TimesoJwtPayload & { iat?: number }>(
        refreshToken,
        { secret: requireJwtRefreshSecret(this.configService) },
      );

      if (
        payload.tokenUse !== JWT_REFRESH_TOKEN_USE &&
        !(
          payload.tokenUse === undefined &&
          isLegacyUntypedTokenAccepted(this.configService)
        )
      ) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const accountId = payload.sub;
      const matchedTokenEntity =
        (await this.refreshTokenRepository.findOne({
          where: {
            accountId,
            appType: resolvedAppType,
            tokenHash: hashRefreshToken(refreshToken),
            revokedAt: IsNull(),
            expiresAt: MoreThan(new Date()),
          },
        })) ??
        (await this.findLegacyRefreshToken(
          refreshToken,
          payload.iat,
          accountId,
          resolvedAppType,
        ));

      if (!matchedTokenEntity) {
        throw new UnauthorizedException('Refresh token is invalid or has been revoked');
      }

      // Rotation: revoke only if still live, so two concurrent refreshes with
      // the same token cannot both mint a new pair.
      const revoked = await this.refreshTokenRepository.update(
        { id: matchedTokenEntity.id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      if (!revoked.affected) {
        throw new UnauthorizedException('Refresh token is invalid or has been revoked');
      }

      const user = await this.accountsService.findById(accountId);
      if (!user) throw new UnauthorizedException('User no longer exists');

      return this.login(user, resolvedAppType);
    } catch (e) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
