import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StoreAccessGuard } from '../guards/store-access.guard';
import { StoreOwnerOnly } from '../guards/store-owner-only.decorator';
import { StoreOwnerOnlyGuard } from '../guards/store-owner-only.guard';
import { StoreResourceAccessGuard } from '../guards/store-resource-access.guard';
import { WorkTypesService } from '../work-types.service';

const uuid = new ParseUUIDPipe();
const NOT_BLANK = /\S/;

export class CreateWorkTypeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(NOT_BLANK, { message: 'Nhập tên hình thức làm việc' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;
}

export class UpdateWorkTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(NOT_BLANK, { message: 'Nhập tên hình thức làm việc' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;
}

/** Danh mục hình thức làm việc (Toàn thời gian, Bán thời gian…) — chỉ chủ cửa hàng. */
@ApiTags('Hình thức làm việc')
@ApiBearerAuth()
@Controller('stores')
@UseGuards(JwtAuthGuard, StoreAccessGuard, StoreResourceAccessGuard, StoreOwnerOnlyGuard)
export class StoresWorkTypesController {
  constructor(private readonly workTypes: WorkTypesService) {}

  @Get(':storeId/work-types')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Danh mục hình thức làm việc (lần đầu tạo 4 mục mặc định)' })
  list(@Param('storeId', uuid) storeId: string) {
    return this.workTypes.list(storeId);
  }

  @Post(':storeId/work-types')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Thêm hình thức làm việc' })
  create(@Param('storeId', uuid) storeId: string, @Body() dto: CreateWorkTypeDto) {
    return this.workTypes.create(storeId, dto);
  }

  @Patch(':storeId/work-types/:workTypeId')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Sửa hình thức làm việc' })
  update(
    @Param('storeId', uuid) storeId: string,
    @Param('workTypeId', uuid) workTypeId: string,
    @Body() dto: UpdateWorkTypeDto,
  ) {
    return this.workTypes.update(storeId, workTypeId, dto);
  }

  @Delete(':storeId/work-types/:workTypeId')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Xoá hình thức làm việc (nhân viên đang mang giữ nguyên)' })
  remove(
    @Param('storeId', uuid) storeId: string,
    @Param('workTypeId', uuid) workTypeId: string,
  ) {
    return this.workTypes.remove(storeId, workTypeId);
  }
}
