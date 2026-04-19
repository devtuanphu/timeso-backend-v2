import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountsService } from '../accounts/accounts.service';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { AccountRefreshToken, AppType } from '../accounts/entities/account-refresh-token.entity';
import { Repository, MoreThan, IsNull } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { AccountOtp } from '../accounts/entities/account-otp.entity';
import { AccountStatus } from '../accounts/entities/account.entity';
import { ZaloService } from '../zalo/zalo.service';
import { EmployeeProfile } from '../stores/entities/employee-profile.entity';
import { StoresService } from '../stores/stores.service';

@Injectable()
export class AuthService {
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
  ) {}

  /**
   * Validate user by email OR phone + password
   */
  async validateUser(emailOrPhone: string, pass: string): Promise<any> {
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

    const payload = { email: user.email, sub: user.id };
    
    const accessToken = this.jwtService.sign(payload);
    const refreshTokenValue = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN'),
    });

    // Save refresh token to DB (hashed)
    const refreshTokenHash = await bcrypt.hash(refreshTokenValue, 10);
    const refreshTokenEntity = this.refreshTokenRepository.create({
      accountId: user.id,
      tokenHash: refreshTokenHash,
      appType,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days matching .env
    });
    await this.refreshTokenRepository.save(refreshTokenEntity);

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

    // Fire-and-forget: ensure daily report exists (cron job fallback)
    this.triggerDailyReportEnsure(user, appType, employeeData.storeId);

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
    try {
      const user = await this.accountsService.create(data);
      
      // Invalidate any existing OTPs for SAFETY (though unlikely for new user, prevents edge cases)
      await this.otpRepository.update(
        { accountId: user.id, type: 'REGISTER', isUsed: false },
        { isUsed: true }
      );

      // Generate 6-digit OTP
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      const otpEntity = this.otpRepository.create({
        accountId: user.id,
        otp: otpCode,
        type: 'REGISTER',
        expiresAt,
      });
      await this.otpRepository.save(otpEntity);

      // Send OTP via Zalo ZNS (thay vì email)
      try {
        await this.zaloService.sendOtp(data.phone, otpCode, 'register');
        return {
          message: 'Đăng ký thành công. Vui lòng kiểm tra Zalo để nhận mã xác thực.',
          phone: data.phone,
        };
      } catch (error) {
        console.error('Failed to send ZNS:', error);
        // Fallback: gửi email nếu ZNS fail
        // await this.mailService.sendVerificationCode(user.email, user.fullName, otpCode);
        return {
          message: 'Đăng ký thành công, nhưng không thể gửi OTP qua Zalo. Vui lòng thử lại.',
          phone: data.phone,
        };
      }
    } catch (error) {
      console.error('🔴 Register error details:', error?.message || error);
      if (error.status === 409) {
        throw error;
      }
      throw new UnauthorizedException('Không thể đăng ký tài khoản. Vui lòng thử lại.');
    }
  }

  async verifyOtp(phone: string, otp: string , type: 'register' | 'forgot-password' = 'register') {
    const user = await this.accountsService.findByPhone(phone);
    if (!user) {
      throw new UnauthorizedException('Không tìm thấy tài khoản với số điện thoại này.');
    }

    const formattedType = type === 'register' ? 'REGISTER' : 'FORGOT_PASSWORD';
    const otpRecord = await this.otpRepository.findOne({
      where: {
        accountId: user.id,
        otp,
        type: formattedType,
        isUsed: false,
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' }, // Prefer the newest one
    });

    if (!otpRecord) {
      throw new UnauthorizedException('Mã OTP không chính xác hoặc đã hết hạn.');
    }

    // Đánh dấu mã đã dùng
    otpRecord.isUsed = true;
    await this.otpRepository.save(otpRecord);

    // Kích hoạt tài khoản (nếu đang ở luồng đăng ký và tài khoản chưa kích hoạt)
    if (formattedType === 'REGISTER' && user.status === AccountStatus.UNVERIFIED) {
        user.status = AccountStatus.ACTIVE;
        await this.accountsService.update(user.id, { status: AccountStatus.ACTIVE });
        return this.login(user); // Đăng ký xong thì login luôn cho tiện
    }

    return {
      message: "Xác thực thành công. Bây giờ bạn có thể đặt lại mật khẩu mới."
    }
  }

  async resendOtp(phone: string, type: 'register' | 'forgot-password' = 'register') {
    const user = await this.accountsService.findByPhone(phone);
    if (!user) {
      throw new UnauthorizedException('Không tìm thấy tài khoản với số điện thoại này.');
    }

    if (type === 'register' && user.status === AccountStatus.ACTIVE) {
      return { message: 'Tài khoản đã được xác thực trước đó.' };
    }

    // Vô hiệu hóa các OTP cũ của loại này
    await this.otpRepository.update(
      { accountId: user.id, type: type === 'register' ? 'REGISTER' : 'FORGOT_PASSWORD', isUsed: false },
      { isUsed: true }
    );

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const otpEntity = this.otpRepository.create({
      accountId: user.id,
      otp: otpCode,
      expiresAt,
      type: type === 'register' ? 'REGISTER' : 'FORGOT_PASSWORD',
    });
    await this.otpRepository.save(otpEntity);

    try {
      // Gửi OTP qua Zalo ZNS
      await this.zaloService.sendOtp(user.phone, otpCode, type);
      return { message: 'Mã OTP mới đã được gửi qua Zalo.', phone: user.phone };
    } catch (error) {
      console.error('Failed to send ZNS:', error);
      // Fallback: gửi email nếu ZNS fail
      // if (type === 'register') {
      //   await this.mailService.sendVerificationCode(user.email, user.fullName, otpCode);
      // } else {
      //   await this.mailService.sendPasswordResetOtp(user.email, user.fullName, otpCode);
      // }
      return { message: 'Lỗi gửi OTP qua Zalo. Vui lòng thử lại.', phone: user.phone };
    }
  }

  async forgotPassword(phone: string) {
    const user = await this.accountsService.findByPhone(phone);
    if (!user) throw new UnauthorizedException('Không tìm thấy tài khoản với số điện thoại này.');

    // Vô hiệu hóa các OTP cũ cho luồng quên mật khẩu
    await this.otpRepository.update(
      { accountId: user.id, type: 'FORGOT_PASSWORD', isUsed: false },
      { isUsed: true }
    );

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const otpEntity = this.otpRepository.create({
      accountId: user.id,
      otp: otpCode,
      expiresAt,
      type: 'FORGOT_PASSWORD',
    });
    await this.otpRepository.save(otpEntity);

    // Gửi OTP qua Zalo ZNS thay vì email
    try {
      await this.zaloService.sendOtp(user.phone, otpCode, 'forgot-password');
      return { message: 'Mã OTP đặt lại mật khẩu đã được gửi qua Zalo.', phone: user.phone };
    } catch (error) {
      console.error('Failed to send ZNS:', error);
      // Fallback email nếu cần
      // await this.mailService.sendPasswordResetOtp(user.email, user.fullName, otpCode);
      return { message: 'Lỗi gửi OTP. Vui lòng thử lại.', phone: user.phone };
    }
  }

  async resetPassword(phone: string, newPassword: string) {
    const user = await this.accountsService.findByPhone(phone);
    if (!user) throw new UnauthorizedException('Không tìm thấy tài khoản với số điện thoại này.');

    // KIỂM TRA BẢO MẬT: Phải có ít nhất 1 OTP "FORGOT_PASSWORD" đã được verify (isUsed=true)
    // trong vòng 15 phút gần nhất để chứng minh bước verify-otp đã thực sự diễn ra.
    const lastVerification = await this.otpRepository.findOne({
        where: {
            accountId: user.id,
            type: 'FORGOT_PASSWORD',
            isUsed: true,
            updatedAt: MoreThan(new Date(Date.now() - 15 * 60 * 1000))
        },
        order: { updatedAt: 'DESC' }
    });

    if (!lastVerification) {
        throw new UnauthorizedException('Yêu cầu chưa được xác thực hoặc mã đã hết hạn. Vui lòng verify OTP lại.');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.accountsService.update(user.id, { passwordHash: hashedPassword });

    return { message: 'Mật khẩu đã được đặt lại thành công.' };
  }

  async refreshToken(refreshToken: string, appType: AppType = AppType.OWNER_APP) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });

      const accountId = payload.sub;

      // Find valid refresh tokens for this account
      const tokens = await this.refreshTokenRepository.find({
        where: {
          accountId,
          appType,
          revokedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
        },
      });

      // Find the one that matches our hash
      let matchedTokenEntity: AccountRefreshToken | null = null;
      for (const tokenEntity of tokens) {
        const isMatch = await bcrypt.compare(refreshToken, tokenEntity.tokenHash);
        if (isMatch) {
          matchedTokenEntity = tokenEntity;
          break;
        }
      }

      if (!matchedTokenEntity) {
        throw new UnauthorizedException('Refresh token is invalid or has been revoked');
      }

      // Revoke the old token (Token Rotation)
      matchedTokenEntity.revokedAt = new Date();
      await this.refreshTokenRepository.save(matchedTokenEntity);

      // Get user data
      const user = await this.accountsService.findById(accountId);
      if (!user) throw new UnauthorizedException('User no longer exists');

      // Generate new pair
      return this.login(user, appType);
    } catch (e) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
