import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CustomShiftRequestService } from './custom-shift-request.service';
import {
  CreateCustomShiftRequestDto,
  CustomShiftRequestListQueryDto,
  RejectCustomShiftRequestDto,
} from './dto/custom-shift-request.dto';
import { StoreAccessGuard } from './guards/store-access.guard';
import { StoreOwnerOnly } from './guards/store-owner-only.decorator';
import { StoreOwnerOnlyGuard } from './guards/store-owner-only.guard';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 400 });

/**
 * X5 "Khung giờ khác" (custom-time shift requests).
 *
 * StoreAccessGuard admits the owner and employed staff of `:storeId`;
 * StoreOwnerOnlyGuard restricts @StoreOwnerOnly handlers to the owner. The
 * staff handlers additionally act only on the caller's own profile.
 */
@ApiTags('Stores - Custom shift requests')
@Controller('stores')
@UseGuards(JwtAuthGuard, StoreAccessGuard, StoreOwnerOnlyGuard)
export class CustomShiftRequestController {
  constructor(private readonly service: CustomShiftRequestService) {}

  @Post(':storeId/custom-shift-requests')
  @ApiOperation({ summary: 'Nhân viên gửi yêu cầu khung giờ khác' })
  async create(
    @Param('storeId', uuid) storeId: string,
    @Body() dto: CreateCustomShiftRequestDto,
    @GetUser() user: any,
  ) {
    return this.service.create(storeId, user.userId, dto);
  }

  @Get(':storeId/me/custom-shift-requests')
  @ApiOperation({ summary: 'Yêu cầu khung giờ khác của tôi' })
  async listMine(
    @Param('storeId', uuid) storeId: string,
    @GetUser() user: any,
  ) {
    return this.service.listMine(storeId, user.userId);
  }

  @HttpCode(200)
  @Post(':storeId/custom-shift-requests/:requestId/cancel')
  @ApiOperation({ summary: 'Nhân viên huỷ yêu cầu khung giờ khác đang chờ' })
  async cancel(
    @Param('storeId', uuid) storeId: string,
    @Param('requestId', uuid) requestId: string,
    @GetUser() user: any,
  ) {
    return this.service.cancel(storeId, requestId, user.userId);
  }

  @StoreOwnerOnly()
  @Get(':storeId/custom-shift-requests')
  @ApiOperation({ summary: 'Danh sách yêu cầu khung giờ khác (chủ cửa hàng)' })
  async listForOwner(
    @Param('storeId', uuid) storeId: string,
    @Query() query: CustomShiftRequestListQueryDto,
  ) {
    return this.service.listForOwner(storeId, query.status);
  }

  @StoreOwnerOnly()
  @HttpCode(200)
  @Post(':storeId/custom-shift-requests/:requestId/approve')
  @ApiOperation({
    summary: 'Duyệt yêu cầu khung giờ khác và tạo ca cho nhân viên',
  })
  async approve(
    @Param('storeId', uuid) storeId: string,
    @Param('requestId', uuid) requestId: string,
    @GetUser() user: any,
  ) {
    return this.service.approve(storeId, requestId, user.userId);
  }

  @StoreOwnerOnly()
  @HttpCode(200)
  @Post(':storeId/custom-shift-requests/:requestId/reject')
  @ApiOperation({ summary: 'Từ chối yêu cầu khung giờ khác' })
  async reject(
    @Param('storeId', uuid) storeId: string,
    @Param('requestId', uuid) requestId: string,
    @Body() dto: RejectCustomShiftRequestDto,
    @GetUser() user: any,
  ) {
    return this.service.reject(storeId, requestId, user.userId, dto);
  }
}
