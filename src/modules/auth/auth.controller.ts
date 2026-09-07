import {
  Controller,
  Post,
  Get,
  Body,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import {
  LoginResponseDto,
  AuthMessageDto,
  RegisterResponseDto,
  ResendOtpResponseDto,
} from './dto/auth-response.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GetUser } from './decorators/get-user.decorator';
import { AccountsService } from '../accounts/accounts.service';
import {
  AccountRefreshToken,
  AppType,
} from '../accounts/entities/account-refresh-token.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@ApiTags('Xác thực (Authentication)')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accountsService: AccountsService,
    @InjectRepository(AccountRefreshToken)
    private readonly refreshTokenRepository: Repository<AccountRefreshToken>,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Lấy thông tin tài khoản hiện tại',
    description:
      'Trả về thông tin người dùng đang đăng nhập (yêu cầu Access Token)',
  })
  @ApiResponse({ status: 200, description: 'Thông tin tài khoản' })
  @ApiResponse({
    status: 401,
    description: 'Token không hợp lệ hoặc đã hết hạn',
  })
  async getMe(@GetUser() user: { userId: string; email: string }) {
    const account = await this.accountsService.findById(user.userId);
    if (!account) {
      throw new UnauthorizedException('Tài khoản không tồn tại');
    }
    const { passwordHash, ...cleanAccount } = account;
    return cleanAccount;
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Đăng xuất',
    description:
      'Thu hồi Refresh Token hiện tại để vô hiệu hóa phiên đăng nhập',
  })
  @ApiResponse({ status: 200, description: 'Đăng xuất thành công' })
  @ApiResponse({
    status: 401,
    description: 'Token không hợp lệ hoặc đã hết hạn',
  })
  async logout(
    @GetUser() user: { userId: string; email: string },
    @Body() body: { appType?: string },
  ) {
    const appType = (body.appType as AppType) || AppType.OWNER_APP;
    // Revoke all refresh tokens for this account + appType
    await this.refreshTokenRepository.update(
      { accountId: user.userId, appType, revokedAt: null as any },
      { revokedAt: new Date() },
    );
    return { message: 'Đăng xuất thành công' };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Đăng nhập vào hệ thống',
    description:
      'Sử dụng email hoặc số điện thoại và mật khẩu để lấy Access Token',
  })
  @ApiResponse({
    status: 200,
    description: 'Đăng nhập thành công',
    type: LoginResponseDto,
  })
  @ApiResponse({
    status: 401,
    description:
      'Thông tin đăng nhập không chính xác hoặc tài khoản chưa xác thực',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        emailOrPhone: {
          type: 'string',
          example: 'user@example.com hoặc 0901234567',
        },
        password: { type: 'string', example: 'password123' },
      },
    },
  })
  async login(@Body() body: any) {
    const user = await this.authService.validateUser(
      body.emailOrPhone,
      body.password,
    );
    if (!user) {
      throw new UnauthorizedException(
        'Email/Số điện thoại hoặc mật khẩu không đúng',
      );
    }
    return this.authService.login(user, body.appType || 'OWNER_APP');
  }

  @Post('register')
  @ApiOperation({
    summary: 'Đăng ký tài khoản mới',
    description: 'Tạo tài khoản chủ cửa hàng (Owner)',
  })
  @ApiResponse({
    status: 201,
    description: 'Đăng ký thành công, vui lòng kiểm tra Zalo để lấy OTP',
    type: RegisterResponseDto,
  })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register({
      fullName: registerDto.fullName,
      email: registerDto.email,
      phone: registerDto.phone,
      passwordHash: registerDto.password,
      gender: registerDto.gender,
      birthday: registerDto.birthday,
    });
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Xác thực mã OTP',
    description:
      'Dùng mã OTP để kích hoạt tài khoản hoặc xác thực quên mật khẩu',
  })
  @ApiResponse({ status: 200, description: 'Xác thực thành công' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', example: '0901234567' },
        otp: { type: 'string', example: '123456' },
        type: {
          type: 'string',
          enum: ['register', 'forgot-password'],
          example: 'register',
        },
      },
      required: ['phone', 'otp'],
    },
  })
  async verifyOtp(@Body() body: VerifyOtpDto) {
    return this.authService.verifyOtp(
      body.phone,
      body.otp,
      body.type,
      body.appType,
    );
  }

  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gửi lại mã OTP',
    description: 'Gửi lại mã OTP mới qua Zalo ZNS',
  })
  @ApiResponse({
    status: 200,
    description: 'Đã gửi lại mã OTP',
    type: ResendOtpResponseDto,
  })
  async resendOtp(
    @Body('phone') phone: string,
    @Body('type') type?: 'register' | 'forgot-password',
  ) {
    return this.authService.resendOtp(phone, type);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Quên mật khẩu',
    description: 'Gửi OTP qua Zalo ZNS để reset mật khẩu',
  })
  @ApiResponse({
    status: 200,
    description: 'Đã gửi mã OTP qua Zalo',
    type: AuthMessageDto,
  })
  async forgotPassword(@Body('phone') phone: string) {
    return this.authService.forgotPassword(phone);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Đặt lại mật khẩu mới',
    description: 'Đặt lại mật khẩu sau khi đã verify OTP thành công',
  })
  @ApiResponse({
    status: 200,
    description: 'Đổi mật khẩu thành công',
    type: AuthMessageDto,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', example: '0901234567' },
        newPassword: { type: 'string', example: 'newPassword123' },
      },
      required: ['phone', 'newPassword'],
    },
  })
  async resetPassword(
    @Body('phone') phone: string,
    @Body('newPassword') newPassword: string,
  ) {
    return this.authService.resetPassword(phone, newPassword);
  }

  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Làm mới Access Token',
    description: 'Sử dụng Refresh Token để lấy cặp Token mới (Token Rotation)',
  })
  @ApiResponse({
    status: 200,
    description: 'Cấp mới token thành công',
    type: LoginResponseDto,
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        refresh_token: { type: 'string' },
        appType: {
          type: 'string',
          enum: ['OWNER_APP', 'EMPLOYEE_APP'],
          example: 'OWNER_APP',
        },
      },
      required: ['refresh_token'],
    },
  })
  async refreshToken(
    @Body('refresh_token') rfToken: string,
    @Body('appType') appType: any,
  ) {
    return this.authService.refreshToken(rfToken, appType);
  }
}
