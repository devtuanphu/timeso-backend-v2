import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ShiftAggregationService,
  StaffingStatus,
} from './shift-aggregation.service';

@Controller('stores')
@UseGuards(JwtAuthGuard)
export class ShiftAggregationController {
  constructor(private readonly aggService: ShiftAggregationService) {}

  /**
   * GET /stores/:storeId/shifts/slots
   * List shift slots với filter + aggregations
   */
  @Get(':storeId/shifts/slots')
  async getShiftSlots(
    @Param('storeId') storeId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('type') type: string,
    @Query('staffingStatus') staffingStatus: StaffingStatus,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.aggService.getShiftSlots({
      storeId,
      from,
      to,
      type,
      staffingStatus,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  /**
   * GET /stores/:storeId/shifts/summary
   * Stats summary (3 cards)
   */
  @Get(':storeId/shifts/summary')
  async getShiftSummary(
    @Param('storeId') storeId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.aggService.getShiftSummary({ storeId, from, to });
  }

  /**
   * GET /stores/:storeId/shifts/month-summary
   * Month summary (ca đủ/thiếu/thiếu nghiêm trọng)
   */
  @Get(':storeId/shifts/month-summary')
  async getMonthSummary(
    @Param('storeId') storeId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.aggService.getMonthSummary({
      storeId,
      year: parseInt(year, 10),
      month: parseInt(month, 10),
    });
  }

  /**
   * GET /stores/:storeId/shifts/suggestions
   * Gợi ý nhân viên cho ca thiếu
   */
  @Get(':storeId/shifts/suggestions')
  async getShiftSuggestions(
    @Param('storeId') storeId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit: string,
  ) {
    return this.aggService.getShiftSuggestions({
      storeId,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : 3,
    });
  }

  /**
   * GET /stores/:storeId/shifts/:shiftSlotId
   * Chi tiết 1 ca
   */
  @Get(':storeId/shifts/:shiftSlotId')
  async getShiftDetail(
    @Param('storeId') storeId: string,
    @Param('shiftSlotId') shiftSlotId: string,
  ) {
    return this.aggService.getShiftDetail({ storeId, shiftSlotId });
  }

  /**
   * GET /stores/:storeId/employees/:empId/schedule-grid
   * Lịch nhân viên dạng grid
   */
  @Get(':storeId/employees/:empId/schedule-grid')
  async getEmployeeScheduleGrid(
    @Param('storeId') storeId: string,
    @Param('empId') empId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.aggService.getEmployeeScheduleGrid({
      storeId,
      employeeId: empId,
      from,
      to,
    });
  }
}
