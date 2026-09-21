import { Controller, Post, Body, Get, Query, HttpCode, HttpStatus, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZaloAdminGuard } from './zalo-admin.guard';
import { ApiTags, ApiOperation, ApiBody, ApiQuery, ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber } from 'class-validator';
import { Response } from 'express';
import { ZaloService } from './zalo.service';
import { ConfigService } from '@nestjs/config';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { ZaloOAuthStateService } from './zalo-oauth-state.service';

class InitTokenDto {
  @ApiProperty({ description: 'Zalo access token' })
  @IsString()
  accessToken: string;

  @ApiProperty({ description: 'Zalo refresh token' })
  @IsString()
  refreshToken: string;

  @ApiProperty({ description: 'Token expires in seconds', example: 90000 })
  @IsNumber()
  expiresIn: number;
}

@ApiTags('Zalo')
@Controller('zalo')
export class ZaloController {
  constructor(
    private readonly zaloService: ZaloService,
    private readonly configService: ConfigService,
    private readonly oauthState: ZaloOAuthStateService,
  ) {}

  @Post('init-token')
  @UseGuards(JwtAuthGuard, ZaloAdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Khởi tạo Zalo token lần đầu (manual)' })
  @ApiBody({ type: InitTokenDto })
  async initToken(@Body() body: InitTokenDto) {
    return this.zaloService.initToken(
      body.accessToken,
      body.refreshToken,
      body.expiresIn,
    );
  }

  @Get('oauth-url')
  @UseGuards(JwtAuthGuard, ZaloAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lấy URL để authorize Zalo OAuth (production flow)' })
  getOAuthUrl(@GetUser() user: any) {
    const appId = this.configService.get('ZALO_APP_ID');
    const redirectUri = this.configService.get('ZALO_REDIRECT_URI') || 'http://localhost:3000/zalo/oauth-callback';
    // Single-use, 10-minute state bound to this admin; the public callback
    // refuses anything else (a constant state let anyone install their token).
    const state = this.oauthState.issue(user.userId);

    // Zalo OAuth 2.0 authorization URL
    const authUrl = `https://oauth.zaloapp.com/v4/oa/permission?app_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    
    return {
      message: 'Mở URL này trong browser để authorize Zalo',
      url: authUrl,
      instructions: [
        '1. Mở URL trong browser',
        '2. Đăng nhập Zalo và cho phép quyền',
        '3. Sau khi redirect, token sẽ được tự động lưu vào DB',
        '4. URL chỉ dùng được một lần trong 10 phút',
      ],
    };
  }

  @Get('oauth-callback')
  @ApiOperation({ summary: 'Callback từ Zalo OAuth, exchange code lấy token' })
  @ApiQuery({ name: 'code', required: true, description: 'Authorization code từ Zalo' })
  @ApiQuery({ name: 'state', required: true, description: 'State do GET /zalo/oauth-url cấp' })
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const verdict = this.oauthState.consume(state);
    if (!verdict.ok) {
      res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Zalo OAuth</title></head>
        <body>
          <h1>Liên kết không hợp lệ hoặc đã hết hạn</h1>
          <p>Vui lòng gọi lại <code>GET /zalo/oauth-url</code> để lấy liên kết mới.</p>
        </body>
        </html>
      `);
      return;
    }
    try {
      const result = await this.zaloService.exchangeCodeForToken(code);
      
      // Trả về HTML đơn giản để hiển thị kết quả
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Zalo Token Initialized</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #0068ff; }
            .success { color: #28a745; font-size: 18px; }
            pre { background: #f8f9fa; padding: 15px; border-radius: 4px; overflow-x: auto; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Zalo Token Initialized</h1>
            <p class="success">Token đã được lưu vào database thành công!</p>
            <p>Bạn có thể đóng tab này và sử dụng ZNS API.</p>
            <hr>
            <p><strong>Token expires at:</strong></p>
            <pre>${new Date(Date.now() + 90000 * 1000).toISOString()}</pre>
          </div>
        </body>
        </html>
      `);
    } catch (error) {
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Zalo Token Error</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #dc3545; }
            .error { color: #dc3545; }
            pre { background: #f8f9fa; padding: 15px; border-radius: 4px; overflow-x: auto; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Lỗi khởi tạo Token</h1>
            <p class="error">Không thể hoàn tất kết nối Zalo.</p>
            <p>Vui lòng thử lại bằng cách gọi <code>GET /zalo/oauth-url</code></p>
          </div>
        </body>
        </html>
      `);
    }
  }

  @Get('token-status')
  @UseGuards(JwtAuthGuard, ZaloAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Kiểm tra trạng thái token hiện tại' })
  async getTokenStatus() {
    return this.zaloService.getTokenStatus();
  }
}
