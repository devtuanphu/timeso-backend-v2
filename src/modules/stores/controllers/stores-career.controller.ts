import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { GetUser } from '../../auth/decorators/get-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CareerLadderService } from '../career-ladder.service';
import { CareerEvaluationService } from '../career/career-evaluation.service';
import { CareerProgressService } from '../career/career-progress.service';
import { CareerStructureService } from '../career/career-structure.service';
import {
  ConfirmSkillDto,
  CreateDepartmentDto,
  CreatePositionDto,
  CreateSkillDto,
  PromoteEmployeeDto,
  RecordSkillEvaluationDto,
  UpdateCareerSettingsDto,
  UpdateDepartmentDto,
  UpdatePositionDto,
  UpdateSkillDto,
} from '../dto/career/career.dto';
import { StoreAccessGuard } from '../guards/store-access.guard';
import { StoreOwnerOnly } from '../guards/store-owner-only.decorator';
import { StoreOwnerOnlyGuard } from '../guards/store-owner-only.guard';
import { StoreResourceAccessGuard } from '../guards/store-resource-access.guard';

const uuid = new ParseUUIDPipe();

/**
 * Lộ trình thăng tiến v2: Bộ phận · Vị trí · Kỹ năng.
 *
 * Route `:storeId/career/...` được StoreAccessGuard khoá theo cửa hàng; id con
 * (bộ phận / vị trí / kỹ năng) được service lọc thêm theo `storeId` nên id của
 * cửa hàng khác ra 404. Route `employees/:profileId/career...` được
 * StoreResourceAccessGuard / StoreOwnerOnlyGuard định vị cửa hàng qua hồ sơ;
 * id con lọc theo cửa hàng của hồ sơ. Mọi thao tác chỉ dành cho chủ cửa hàng
 * (D7), trừ xem lộ trình của chính mình.
 */
@ApiTags('Lộ trình thăng tiến (v2)')
@ApiBearerAuth()
@Controller('stores')
@UseGuards(JwtAuthGuard, StoreAccessGuard, StoreResourceAccessGuard, StoreOwnerOnlyGuard)
export class StoresCareerController {
  constructor(
    private readonly structure: CareerStructureService,
    private readonly evaluation: CareerEvaluationService,
    private readonly progress: CareerProgressService,
    private readonly careerLadderService: CareerLadderService,
  ) {}

  // ----- Cài đặt & cấu trúc ------------------------------------------------

  @Get(':storeId/career/settings')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Cài đặt lộ trình (nhắc kiểm duyệt, cờ v2)' })
  getSettings(@Param('storeId', uuid) storeId: string) {
    return this.structure.getSettings(storeId);
  }

  @Put(':storeId/career/settings')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Bật/tắt và đặt tần suất nhắc kiểm duyệt' })
  updateSettings(@Param('storeId', uuid) storeId: string, @Body() dto: UpdateCareerSettingsDto) {
    return this.structure.updateSettings(storeId, dto);
  }

  @Get(':storeId/career/structure')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Cây bộ phận, vị trí, kỹ năng, điều kiện và số nhân sự (3 tab)' })
  getStructure(@Param('storeId', uuid) storeId: string) {
    return this.structure.getStructure(storeId);
  }

  // ----- Bộ phận ---------------------------------------------------------------

  @Post(':storeId/career/departments')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Thêm bộ phận' })
  createDepartment(
    @Param('storeId', uuid) storeId: string,
    @Body() dto: CreateDepartmentDto,
    @GetUser() user: any,
  ) {
    return this.structure.createDepartment(storeId, dto, user.userId);
  }

  @Patch(':storeId/career/departments/:departmentId')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Sửa bộ phận (tên, mô tả, cấp, bộ phận quản lý, điều kiện)' })
  updateDepartment(
    @Param('storeId', uuid) storeId: string,
    @Param('departmentId', uuid) departmentId: string,
    @Body() dto: UpdateDepartmentDto,
    @GetUser() user: any,
  ) {
    return this.structure.updateDepartment(storeId, departmentId, dto, user.userId);
  }

  @Delete(':storeId/career/departments/:departmentId')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Xoá bộ phận (chặn khi còn bộ phận con / nhân viên / người đạt kỹ năng)' })
  deleteDepartment(
    @Param('storeId', uuid) storeId: string,
    @Param('departmentId', uuid) departmentId: string,
    @GetUser() user: any,
  ) {
    return this.structure.deleteDepartment(storeId, departmentId, user.userId);
  }

  @Post(':storeId/career/departments/:departmentId/duplicate')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Nhân bản bộ phận kèm vị trí, kỹ năng và điều kiện' })
  duplicateDepartment(
    @Param('storeId', uuid) storeId: string,
    @Param('departmentId', uuid) departmentId: string,
    @GetUser() user: any,
  ) {
    return this.structure.duplicateDepartment(storeId, departmentId, user.userId);
  }

  // ----- Vị trí ------------------------------------------------------------------

  @Post(':storeId/career/positions')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Thêm vị trí vào một bộ phận' })
  createPosition(
    @Param('storeId', uuid) storeId: string,
    @Body() dto: CreatePositionDto,
    @GetUser() user: any,
  ) {
    return this.structure.createPosition(storeId, dto, user.userId);
  }

  @Patch(':storeId/career/positions/:positionId')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Sửa vị trí (tên, mô tả, bộ phận, cấp bậc, điều kiện)' })
  updatePosition(
    @Param('storeId', uuid) storeId: string,
    @Param('positionId', uuid) positionId: string,
    @Body() dto: UpdatePositionDto,
    @GetUser() user: any,
  ) {
    return this.structure.updatePosition(storeId, positionId, dto, user.userId);
  }

  @Delete(':storeId/career/positions/:positionId')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Xoá vị trí (chặn khi còn người giữ)' })
  deletePosition(
    @Param('storeId', uuid) storeId: string,
    @Param('positionId', uuid) positionId: string,
    @GetUser() user: any,
  ) {
    return this.structure.deletePosition(storeId, positionId, user.userId);
  }

  @Get(':storeId/career/positions/:positionId/candidates')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Nhân viên đủ điều kiện / đã xét duyệt / tuỳ chọn cho một vị trí' })
  getCandidates(
    @Param('storeId', uuid) storeId: string,
    @Param('positionId', uuid) positionId: string,
  ) {
    return this.evaluation.getPositionCandidates(storeId, positionId);
  }

  // ----- Kỹ năng -----------------------------------------------------------------

  @Post(':storeId/career/skills')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Thêm kỹ năng vào một bộ phận' })
  createSkill(
    @Param('storeId', uuid) storeId: string,
    @Body() dto: CreateSkillDto,
    @GetUser() user: any,
  ) {
    return this.structure.createSkill(storeId, dto, user.userId);
  }

  @Patch(':storeId/career/skills/:skillId')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Sửa / ngừng dùng kỹ năng' })
  updateSkill(
    @Param('storeId', uuid) storeId: string,
    @Param('skillId', uuid) skillId: string,
    @Body() dto: UpdateSkillDto,
    @GetUser() user: any,
  ) {
    return this.structure.updateSkill(storeId, skillId, dto, user.userId);
  }

  @Delete(':storeId/career/skills/:skillId')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Xoá kỹ năng (đã có người đạt thì chỉ ngừng dùng được)' })
  deleteSkill(
    @Param('storeId', uuid) storeId: string,
    @Param('skillId', uuid) skillId: string,
    @GetUser() user: any,
  ) {
    return this.structure.deleteSkill(storeId, skillId, user.userId);
  }

  // ----- Nhân viên ------------------------------------------------------------

  @Get('employees/:profileId/career')
  @ApiOperation({
    summary: 'Lộ trình v2 của một nhân viên',
    description: 'Chủ cửa hàng, hoặc chính nhân viên đó khi còn làm; đồng nghiệp bị từ chối.',
  })
  async getEmployeeCareer(@Param('profileId', uuid) profileId: string, @GetUser() user: any) {
    await this.careerLadderService.assertCanViewOwnCareer(profileId, user.userId);
    return this.evaluation.getEmployeeCareer(profileId);
  }

  @Post('employees/:profileId/career/promotions')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Duyệt lên vị trí / bộ phận (ngoại lệ cần ghi chú)' })
  promote(
    @Param('profileId', uuid) profileId: string,
    @Body() dto: PromoteEmployeeDto,
    @GetUser() user: any,
  ) {
    return this.progress.promote(profileId, dto, user.userId);
  }

  @Post('employees/:profileId/career/skills/:skillId/evaluations')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Ghi một lần đánh giá Đạt / Không đạt kỹ năng' })
  recordEvaluation(
    @Param('profileId', uuid) profileId: string,
    @Param('skillId', uuid) skillId: string,
    @Body() dto: RecordSkillEvaluationDto,
    @GetUser() user: any,
  ) {
    return this.progress.recordEvaluation(profileId, skillId, dto, user.userId);
  }

  @Post('employees/:profileId/career/skills/:skillId/confirm')
  @StoreOwnerOnly()
  @ApiOperation({ summary: 'Xác nhận nhân viên đạt kỹ năng (ngoại lệ cần ghi chú)' })
  confirmSkill(
    @Param('profileId', uuid) profileId: string,
    @Param('skillId', uuid) skillId: string,
    @Body() dto: ConfirmSkillDto,
    @GetUser() user: any,
  ) {
    return this.progress.confirmSkill(profileId, skillId, dto, user.userId);
  }
}
