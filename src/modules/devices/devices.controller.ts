import { Controller, Post, Body, UseGuards, Delete, Param, HttpCode } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../auth/decorators/get-user.decorator';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@ApiTags('Devices')
@ApiBearerAuth()
@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post('register')
  @ApiOperation({ summary: 'Đăng ký device cho push notifications' })
  async register(@GetUser() user: any, @Body() dto: RegisterDeviceDto) {
    return this.devicesService.register(user.userId, dto);
  }

  @Delete(':deviceId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Gỡ đăng ký push của thiết bị thuộc tài khoản hiện tại' })
  async unregister(
    @GetUser() user: any,
    @Param('deviceId') deviceId: string,
  ): Promise<void> {
    await this.devicesService.disableOwnedDevice(user.userId, deviceId);
  }
}
