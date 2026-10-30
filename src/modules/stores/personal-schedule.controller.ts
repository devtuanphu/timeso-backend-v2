import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { GetUser } from '../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreatePersonalScheduleDto,
  UpdatePersonalScheduleDto,
} from './dto/personal-schedule.dto';
import { StoreAccessGuard } from './guards/store-access.guard';
import { PersonalScheduleService } from './personal-schedule.service';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 400 });

/**
 * Lịch cá nhân (lịch trống / bận / học).
 *
 * StoreAccessGuard admits the owner and employed staff of `:storeId`. The
 * `me` handlers act only on the caller's own profile; the employee read is
 * owner-or-self (assertEmployeeCalendarAccess), so a coworker is refused.
 */
@ApiTags('Stores - Personal schedules')
@Controller('stores')
@UseGuards(JwtAuthGuard, StoreAccessGuard)
export class PersonalScheduleController {
  constructor(private readonly service: PersonalScheduleService) {}

  @Get(':storeId/me/personal-schedules')
  @ApiOperation({ summary: 'Lịch cá nhân của tôi' })
  async listMine(@Param('storeId', uuid) storeId: string, @GetUser() user: any) {
    return this.service.listMine(storeId, user.userId);
  }

  @Post(':storeId/me/personal-schedules')
  @ApiOperation({ summary: 'Nhân viên thêm lịch trống / lịch bận / lịch học' })
  async create(
    @Param('storeId', uuid) storeId: string,
    @Body() dto: CreatePersonalScheduleDto,
    @GetUser() user: any,
  ) {
    return this.service.create(storeId, user.userId, dto);
  }

  @Put(':storeId/me/personal-schedules/:scheduleId')
  @ApiOperation({ summary: 'Nhân viên sửa lịch cá nhân của mình' })
  async update(
    @Param('storeId', uuid) storeId: string,
    @Param('scheduleId', uuid) scheduleId: string,
    @Body() dto: UpdatePersonalScheduleDto,
    @GetUser() user: any,
  ) {
    return this.service.update(storeId, user.userId, scheduleId, dto);
  }

  @Delete(':storeId/me/personal-schedules/:scheduleId')
  @ApiOperation({ summary: 'Nhân viên xoá lịch cá nhân của mình' })
  async remove(
    @Param('storeId', uuid) storeId: string,
    @Param('scheduleId', uuid) scheduleId: string,
    @GetUser() user: any,
  ) {
    return this.service.remove(storeId, user.userId, scheduleId);
  }

  @Get(':storeId/employees/:profileId/personal-schedules')
  @ApiOperation({ summary: 'Chủ cửa hàng xem lịch cá nhân của nhân viên' })
  async listForEmployee(
    @Param('storeId', uuid) storeId: string,
    @Param('profileId', uuid) profileId: string,
    @GetUser() user: any,
  ) {
    return this.service.listForEmployee(storeId, profileId, user.userId);
  }
}
