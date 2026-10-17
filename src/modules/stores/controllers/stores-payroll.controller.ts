import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  UseGuards,
  Param,
  Query,
  NotFoundException,
  Res,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { StoresService } from '../stores.service';
import { CreatePayrollRecordDto } from '../dto/payroll-record.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { StoreAccessGuard } from '../guards/store-access.guard';
import { StoreResourceAccessGuard } from '../guards/store-resource-access.guard';
import { StoreOwnerOnlyGuard } from '../guards/store-owner-only.guard';
import { StoreOwnerOnly } from '../guards/store-owner-only.decorator';
import { GetUser } from '../../auth/decorators/get-user.decorator';
import {
  CreateEmployeeSalaryDto,
  UpdateEmployeeSalaryDto,
} from '../dto/employee-salary-write.dto';
import {
  CreateEmployeePaymentHistoryDto,
  UpdateEmployeePaymentHistoryDto,
} from '../dto/employee-payment-history.dto';
import {
  PayrollResponseDto,
  SalaryConfigResponseDto,
  CreateStorePayrollPaymentDto,
  UpdateStorePayrollPaymentDto,
  StorePayrollPaymentResponseDto,
  PayrollMonthlySummaryResponseDto,
} from '../dto/store-response.dto';
import {
  CreateSalaryConfigDto,
  UpdateSalaryConfigDto,
} from '../dto/salary-config.dto';
import {
  CreateSalaryAdjustmentDto,
  SalaryAdjustmentResponseDto,
} from '../dto/salary-adjustment.dto';
import { ConfigStatus } from '../entities/salary-config.entity';
import { UpdatePayrollSettingDto } from '../dto/store-payroll-setting.dto';
import { SavePayslipRowsDto } from '../dto/payslip-rows.dto';

/**
 * StoresPayrollController: routes split out of StoresController by domain. Same prefix,
 * guards and handlers as before; registered right after StoresController so
 * Express still matches routes in the original order.
 */
@ApiTags('Cửa hàng & Vận hành (Stores)')
@ApiBearerAuth()
@Controller('stores')
// StoreAccessGuard scopes every store-addressed route (`:id/...`, `:storeId/...`)
// to the owner or a current employee of that store. Routes addressed by a
// sub-resource id pass through it untouched — see the guard's own docs.
// StoreOwnerOnlyGuard then restricts handlers marked @StoreOwnerOnly() to the
// store's owner (stores.owner_account_id); unmarked handlers pass through it.
@UseGuards(
  JwtAuthGuard,
  StoreAccessGuard,
  StoreResourceAccessGuard,
  StoreOwnerOnlyGuard,
)
export class StoresPayrollController {
  constructor(private readonly storesService: StoresService) {}

  // Payroll Settings
  @StoreOwnerOnly()
  @Get(':id/payroll-settings')
  @ApiOperation({ summary: 'Lấy cấu hình tính lương' })
  @ApiQuery({
    name: 'rulesVersion',
    required: false,
    description:
      '2 / 3 = mọi khoản thưởng / vi phạm v2, kể cả khoản đang tắt (kèm calcConfig)',
  })
  async getPayrollSetting(
    @Param('id') id: string,
    @Query('rulesVersion') rulesVersion?: string,
  ) {
    return this.storesService.getPayrollSetting(id, {
      rulesVersion:
        rulesVersion === '2' ? 2 : rulesVersion === '3' ? 3 : undefined,
    });
  }

  @StoreOwnerOnly()
  @Put(':id/payroll-settings')
  @ApiOperation({ summary: 'Cập nhật cấu hình tính lương' })
  async updatePayrollSetting(
    @Param('id') id: string,
    @Body() body: UpdatePayrollSettingDto,
  ) {
    return this.storesService.upsertPayrollSetting(id, body);
  }

  // Ghi nhận thưởng / vi phạm thủ công cho từng nhân viên
  @StoreOwnerOnly()
  @Get('employees/:profileId/payroll-records')
  @ApiOperation({ summary: 'Các lần ghi nhận thưởng / vi phạm của nhân viên trong tháng' })
  @ApiQuery({ name: 'month', required: false, description: 'YYYY-MM (mặc định tháng này)' })
  async listPayrollRecords(
    @Param('profileId') profileId: string,
    @Query('month') month?: string,
  ) {
    return this.storesService.listPayrollRecords(profileId, month);
  }

  @StoreOwnerOnly()
  @Post('employees/:profileId/payroll-records')
  @ApiOperation({ summary: 'Ghi nhận một khoản thưởng / vi phạm cho nhân viên' })
  async createPayrollRecord(
    @Param('profileId') profileId: string,
    @Body() body: CreatePayrollRecordDto,
    @GetUser() user: any,
  ) {
    return this.storesService.createPayrollRecord(profileId, body, user.userId);
  }

  @StoreOwnerOnly()
  @Delete('payroll-records/:recordId')
  @ApiOperation({ summary: 'Xoá một lần ghi nhận thưởng / vi phạm' })
  async deletePayrollRecord(@Param('recordId') recordId: string) {
    return this.storesService.deletePayrollRecord(recordId);
  }

  // Payslip template: the rows every employee's payslip shows
  @StoreOwnerOnly()
  @Get(':id/payslip-rows')
  @ApiOperation({ summary: 'Lấy các hàng bảng lương chi tiết của nhân viên' })
  async getPayslipRows(@Param('id') id: string) {
    return this.storesService.getPayslipRows(id);
  }

  @StoreOwnerOnly()
  @Put(':id/payslip-rows')
  @ApiOperation({
    summary: 'Cập nhật các hàng bảng lương chi tiết của nhân viên',
  })
  async savePayslipRows(
    @Param('id') id: string,
    @Body() body: SavePayslipRowsDto,
  ) {
    return this.storesService.savePayslipRows(id, body);
  }

  // Monthly Payrolls
  @StoreOwnerOnly()
  @Post(':id/payrolls')
  @ApiOperation({
    summary: 'Tạo bảng lương tháng',
    description: 'Tính toán lương cho toàn bộ nhân viên trong tháng',
  })
  @ApiResponse({
    status: 201,
    description: 'Tạo bảng lương thành công',
    type: PayrollResponseDto,
  })
  async createPayroll(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createPayroll(id, body);
  }

  @StoreOwnerOnly()
  @Post(':id/payrolls/generate')
  @ApiOperation({
    summary: 'Tạo bảng lương tự động từ dữ liệu chấm công',
    description:
      'Aggregate ShiftAssignment, tính lương, áp dụng thưởng/phạt từ payroll rules',
  })
  @ApiResponse({
    status: 201,
    description: 'Bảng lương đã tạo thành công',
    type: PayrollResponseDto,
  })
  async generatePayroll(
    @Param('id') id: string,
    @Body() body: { date?: string },
  ) {
    // Raw string: the service parses it as a Vietnam month.
    return this.storesService.createMonthlyPayrollForStore(id, body.date);
  }

  @StoreOwnerOnly()
  @Post(':id/payrolls/recalculate')
  @ApiOperation({
    summary: 'Tính lại bảng lương từ dữ liệu chấm công',
    description:
      'Tính lại (cập nhật tại chỗ) bảng lương dựa trên dữ liệu chấm công thực tế; không xoá phiếu lương, giữ nguyên tạm ứng đã duyệt',
  })
  @ApiResponse({
    status: 201,
    description: 'Bảng lương đã tính lại thành công',
    type: PayrollResponseDto,
  })
  async recalculatePayroll(
    @Param('id') id: string,
    @Body() body: { date?: string },
  ) {
    // Raw string: the service parses it as a Vietnam month.
    return this.storesService.recalculatePayroll(id, body.date);
  }

  @StoreOwnerOnly()
  @Get(':id/payrolls')
  @ApiOperation({ summary: 'Lấy danh sách bảng lương' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách bảng lương',
    type: [PayrollResponseDto],
  })
  async getPayrolls(@Param('id') id: string) {
    return this.storesService.getPayrolls(id);
  }

  @StoreOwnerOnly()
  @Get(':id/payrolls/by-month')
  @ApiOperation({
    summary: 'Lấy bảng lương theo tháng cụ thể',
    description:
      'Lấy bảng lương của cửa hàng theo tháng (format: YYYY-MM-DD, ngày bất kỳ trong tháng)',
  })
  @ApiQuery({
    name: 'date',
    required: true,
    type: String,
    description: 'Tháng cần lấy (YYYY-MM-DD)',
    example: '2026-01-01',
  })
  @ApiResponse({
    status: 200,
    description: 'Bảng lương tháng',
    type: PayrollResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy bảng lương cho tháng này',
  })
  async getPayrollByMonth(
    @Param('id') id: string,
    @Query('date') date: string,
  ) {
    const payroll = await this.storesService.getPayrollByMonth(id, date);
    if (!payroll) {
      throw new NotFoundException(
        `Không tìm thấy bảng lương cho tháng ${date}`,
      );
    }
    return payroll;
  }

  // --- Store Payroll Payment History ---

  @StoreOwnerOnly()
  @Post(':id/payroll-payments')
  @ApiOperation({ summary: 'Tạo lịch sử thanh toán lương tổng cho cửa hàng' })
  @ApiResponse({ status: 201, type: StorePayrollPaymentResponseDto })
  async createPaymentHistory(
    @Param('id') id: string,
    @Body() data: CreateStorePayrollPaymentDto,
  ) {
    return this.storesService.createPaymentHistory(id, data);
  }

  @StoreOwnerOnly()
  @Get(':id/payroll-payments')
  @ApiOperation({
    summary: 'Lấy danh sách lịch sử thanh toán lương của cửa hàng',
  })
  @ApiResponse({ status: 200, type: [StorePayrollPaymentResponseDto] })
  async getPaymentHistories(@Param('id') id: string) {
    return this.storesService.getPaymentHistories(id);
  }

  @StoreOwnerOnly()
  @Put('payroll-payments/:paymentId')
  @ApiOperation({ summary: 'Cập nhật lịch sử thanh toán lương' })
  @ApiResponse({ status: 200, type: StorePayrollPaymentResponseDto })
  async updatePaymentHistory(
    @Param('paymentId') paymentId: string,
    @Body() data: UpdateStorePayrollPaymentDto,
  ) {
    return this.storesService.updatePaymentHistory(paymentId, data);
  }

  @StoreOwnerOnly()
  @Delete('payroll-payments/:paymentId')
  @ApiOperation({ summary: 'Xóa lịch sử thanh toán lương' })
  @ApiResponse({ status: 200 })
  async deletePaymentHistory(@Param('paymentId') paymentId: string) {
    return this.storesService.deletePaymentHistory(paymentId);
  }

  @StoreOwnerOnly()
  @Get(':id/payroll-summary')
  @ApiOperation({ summary: 'Lấy báo cáo tổng hợp lương theo tháng' })
  @ApiQuery({
    name: 'date',
    required: true,
    example: '11/2025',
    description: 'Tháng cần lấy báo cáo (MM/YYYY)',
  })
  @ApiResponse({ status: 200, type: PayrollMonthlySummaryResponseDto })
  async getPayrollSummary(
    @Param('id') id: string,
    @Query('date') date: string,
    @GetUser() user: any,
  ) {
    return this.storesService.getPayrollSummary(id, date, user.userId);
  }

  @StoreOwnerOnly()
  @Get(':id/payroll-details')
  @ApiOperation({
    summary: 'Lấy danh sách chi tiết phạt, thưởng và tăng ca trong tháng',
  })
  @ApiQuery({
    name: 'date',
    required: true,
    example: '11/2025',
    description: 'Tháng cần lấy báo cáo (MM/YYYY)',
  })
  @ApiResponse({ status: 200, description: 'Danh sách chi tiết' })
  async getPayrollDetails(
    @Param('id') id: string,
    @Query('date') date: string,
  ) {
    if (!date) throw new BadRequestException('Vui lòng cung cấp tháng (date)');
    return this.storesService.getPayrollDetailsList(id, date);
  }

  @StoreOwnerOnly()
  @Patch(':id/salary-fund')
  @ApiOperation({ summary: 'Cập nhật quỹ lương của cửa hàng trong tháng' })
  @ApiQuery({ name: 'date', required: true, example: '11/2025' })
  async updateSalaryFund(
    @Param('id') id: string,
    @Query('date') date: string,
    @Body() body: any,
  ) {
    const amount = body.amount ?? body.salaryFund;
    return this.storesService.updateSalaryFund(id, date, amount);
  }

  @StoreOwnerOnly()
  @Get(':id/payroll-report/export')
  @ApiOperation({ summary: 'Xuất file báo cáo quỹ lương tháng' })
  @ApiQuery({ name: 'date', required: true, example: '11/2025' })
  async exportPayrollReport(
    @Param('id') id: string,
    @Query('date') date: string,
    @Res() res: any,
  ) {
    if (!id || !date)
      throw new BadRequestException('Vui lòng cung cấp storeId và date');
    const buffer = await this.storesService.downloadPayrollReport(id, date);

    const slugDate = date.replace('/', '-');
    const fileName = `Bao_Cao_Quy_Luong_${slugDate}.xlsx`;

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });

    res.send(buffer);
  }

  @StoreOwnerOnly()
  @Get(':id/salary-fund/history')
  @ApiOperation({ summary: 'Lịch sử điều chỉnh quỹ lương của cửa hàng' })
  @ApiQuery({ name: 'date', required: false, example: '11/2025' })
  @ApiResponse({ status: 200, description: 'Danh sách lịch sử điều chỉnh' })
  async getSalaryFundHistory(
    @Param('id') id: string,
    @Query('date') date?: string,
  ) {
    return this.storesService.getSalaryFundHistory(id, date);
  }

  @StoreOwnerOnly()
  @Get('payrolls/:payrollId')
  @ApiOperation({ summary: 'Chi tiết bảng lương' })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết bảng lương',
    type: PayrollResponseDto,
  })
  async getPayrollById(@Param('payrollId') payrollId: string) {
    return this.storesService.getPayrollById(payrollId);
  }

  @StoreOwnerOnly()
  @Put('payrolls/:payrollId')
  @ApiOperation({ summary: 'Cập nhật bảng lương' })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
    type: PayrollResponseDto,
  })
  async updatePayroll(
    @Param('payrollId') payrollId: string,
    @Body() body: any,
  ) {
    return this.storesService.updatePayroll(payrollId, body);
  }

  @StoreOwnerOnly()
  @Delete('payrolls/:payrollId')
  @ApiOperation({ summary: 'Xóa bảng lương' })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  async deletePayroll(@Param('payrollId') payrollId: string) {
    return this.storesService.deletePayroll(payrollId);
  }

  @StoreOwnerOnly()
  @Get(':id/employee-salaries')
  @ApiOperation({
    summary: 'Lấy danh sách lương nhân viên của cửa hàng theo tháng',
  })
  @ApiQuery({ name: 'month', required: true, example: '11/2025' })
  @ApiQuery({
    name: 'type',
    required: false,
    description: 'Lọc theo loại nhân viên (Full-time, Part-time...)',
  })
  async getEmployeeSalariesByStore(
    @Param('id') id: string,
    @Query('month') month: string,
    @Query('type') type?: string,
  ) {
    if (!month)
      throw new BadRequestException('Vui lòng cung cấp tháng (month)');
    return this.storesService.getEmployeeSalariesByStore(id, month, type);
  }

  // Salary Configs
  @StoreOwnerOnly()
  @Get(':id/salary-configs')
  @ApiOperation({ summary: 'Lấy cấu hình lương của cửa hàng' })
  @ApiResponse({
    status: 200,
    type: [SalaryConfigResponseDto],
  })
  async getSalaryConfigsByStore(@Param('id') id: string) {
    return this.storesService.getSalaryConfigsByStore(id);
  }

  @StoreOwnerOnly({ bodyStoreIdLists: ['storeIds'] })
  @Post('salary-configs')
  @ApiOperation({ summary: 'Tạo cấu hình lương' })
  @ApiResponse({
    status: 201,
    description: 'Tạo thành công',
    type: SalaryConfigResponseDto,
  })
  async createSalaryConfig(
    @GetUser() user: any,
    @Body() body: CreateSalaryConfigDto,
  ) {
    return this.storesService.createSalaryConfig(user.userId, body);
  }

  @StoreOwnerOnly({ bodyStoreIdLists: ['storeIds'] })
  @Post(':id/salary-configs')
  @ApiOperation({
    summary: 'Tạo cấu hình lương cho cửa hàng cụ thể (URL có ID)',
  })
  @ApiResponse({
    status: 201,
    description: 'Tạo thành công',
    type: SalaryConfigResponseDto,
  })
  async createSalaryConfigWithId(
    @Param('id') id: string,
    @GetUser() user: any,
    @Body() body: CreateSalaryConfigDto,
  ) {
    if (!body.storeIds || body.storeIds.length === 0) {
      body.storeIds = [id];
    }
    return this.storesService.createSalaryConfig(user.userId, body);
  }

  @StoreOwnerOnly({ bodyStoreIdLists: ['storeIds'] })
  @Put('salary-configs/:configId')
  @ApiOperation({ summary: 'Cập nhật cấu hình lương' })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật thành công',
    type: SalaryConfigResponseDto,
  })
  async updateSalaryConfig(
    @Param('configId') configId: string,
    @Body() body: UpdateSalaryConfigDto,
  ) {
    return this.storesService.updateSalaryConfig(configId, body);
  }

  @StoreOwnerOnly()
  @Patch('salary-configs/:configId/status')
  @ApiOperation({ summary: 'Thay đổi trạng thái cấu hình lương' })
  @ApiResponse({
    status: 200,
    description: 'Cập nhật trạng thái thành công',
    type: SalaryConfigResponseDto,
  })
  async changeSalaryConfigStatus(
    @Param('configId') configId: string,
    @Body('status') status: ConfigStatus,
  ) {
    return this.storesService.changeSalaryConfigStatus(configId, status);
  }

  @StoreOwnerOnly()
  @Delete('salary-configs/:configId')
  @ApiOperation({ summary: 'Xóa cấu hình lương' })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  async deleteSalaryConfig(@Param('configId') configId: string) {
    return this.storesService.deleteSalaryConfig(configId);
  }

  // Employee Salaries
  @StoreOwnerOnly({
    bodyResources: [{ field: 'employeeProfileId', resource: 'employees' }],
  })
  @Post('employee-salaries')
  @ApiOperation({ summary: 'Tạo phiếu lương nhân viên' })
  @ApiResponse({ status: 201, description: 'Tạo thành công' })
  async createEmployeeSalary(@Body() body: CreateEmployeeSalaryDto) {
    return this.storesService.createEmployeeSalaryForStore(body);
  }

  @Get('employees/:profileId/salaries')
  @ApiOperation({ summary: 'Lấy lịch sử lương nhân viên' })
  @ApiResponse({ status: 200, description: 'Danh sách lương' })
  async getEmployeeSalaries(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
    @Query('month') month?: string,
  ) {
    // Owner of the employee's store, or the employee — never a coworker.
    await this.storesService.assertEmployeeSalaryAccess(profileId, user.userId);
    return this.storesService.getEmployeeSalaries(profileId, month);
  }

  @Get('employees/:profileId/estimated-salary')
  @ApiOperation({
    summary: 'Lương tạm tính (live) cho màn hình Trang chủ nhân viên',
  })
  @ApiQuery({ name: 'storeId', required: true })
  @ApiQuery({ name: 'month', required: false })
  @ApiResponse({ status: 200, description: 'Lương tạm tính + giờ đã làm' })
  async getEstimatedSalary(
    @Param('profileId') profileId: string,
    @Query('storeId') storeId: string,
    @GetUser() user: any,
    @Query('month') month?: string,
  ) {
    // Owner-or-self, and the profile must belong to the queried store.
    await this.storesService.assertEmployeeSalaryAccess(
      profileId,
      user.userId,
      storeId,
    );
    return this.storesService.getEstimatedSalary(profileId, storeId, month);
  }

  @Get('employee-salaries/:salaryId')
  @ApiOperation({ summary: 'Chi tiết phiếu lương' })
  @ApiResponse({ status: 200, description: 'Chi tiết phiếu lương' })
  async getEmployeeSalaryById(
    @Param('salaryId') salaryId: string,
    @GetUser() user: any,
  ) {
    return this.storesService.getEmployeeSalaryByIdForViewer(
      salaryId,
      user.userId,
    );
  }

  @StoreOwnerOnly({
    bodyResources: [{ field: 'employeeProfileId', resource: 'employees' }],
  })
  @Put('employee-salaries/:salaryId')
  @ApiOperation({ summary: 'Cập nhật phiếu lương' })
  @ApiResponse({ status: 200, description: 'Cập nhật thành công' })
  async updateEmployeeSalary(
    @Param('salaryId') salaryId: string,
    @Body() body: UpdateEmployeeSalaryDto,
  ) {
    return this.storesService.updateEmployeeSalary(salaryId, body);
  }

  @StoreOwnerOnly()
  @Delete('employee-salaries/:salaryId')
  @ApiOperation({ summary: 'Xóa phiếu lương' })
  @ApiResponse({ status: 200, description: 'Xóa thành công' })
  async deleteEmployeeSalary(@Param('salaryId') salaryId: string) {
    return this.storesService.deleteEmployeeSalary(salaryId);
  }

  // Employee Salary Payment History
  @Get('employees/:profileId/salary-history')
  @ApiOperation({
    summary: 'Lấy lịch sử thanh toán lương của nhân viên (phân trang)',
  })
  @ApiQuery({ name: 'page', required: false, example: '1' })
  @ApiQuery({ name: 'limit', required: false, example: '10' })
  @ApiResponse({ status: 200, description: 'Danh sách lịch sử thanh toán' })
  async getEmployeeSalaryHistory(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    await this.storesService.assertEmployeeSalaryAccess(profileId, user.userId);
    return this.storesService.getEmployeeSalaryHistory(
      profileId,
      parseInt(page || '1', 10),
      parseInt(limit || '10', 10),
    );
  }

  // Salary Advance Requests
  @Post('employees/:profileId/salary-advance-requests')
  @ApiOperation({ summary: 'Tạo yêu cầu ứng lương' })
  @ApiResponse({ status: 201, description: 'Tạo yêu cầu thành công' })
  async createSalaryAdvanceRequest(
    @Param('profileId') profileId: string,
    @Body()
    body: {
      /** Omitted by the staff app: this month's payslip. */
      employeeSalaryId?: string;
      requestedAmount: number;
      requestReason?: string;
    },
    @GetUser() user: any,
  ) {
    // Owner-or-self: a coworker must not file an advance on someone else's
    // payslip (store membership alone is not enough).
    await this.storesService.assertEmployeeSalaryAccess(profileId, user.userId);
    return this.storesService.createSalaryAdvanceRequest(
      profileId,
      body,
      user.userId,
    );
  }

  @StoreOwnerOnly()
  @Get(':storeId/salary-advance-requests')
  @ApiOperation({ summary: 'Lấy danh sách yêu cầu ứng lương của cửa hàng' })
  @ApiResponse({ status: 200, description: 'Danh sách yêu cầu ứng lương' })
  async getSalaryAdvanceRequests(
    @Param('storeId') storeId: string,
    @Query('status') status?: string,
    @Query('month') month?: string,
  ) {
    return this.storesService.getSalaryAdvanceRequests({
      storeId,
      status: status as any,
      month: month ? new Date(month) : undefined,
    });
  }

  @Get('employees/:profileId/salary-advance-requests')
  @ApiOperation({ summary: 'Lấy danh sách yêu cầu ứng lương của nhân viên' })
  @ApiResponse({ status: 200, description: 'Danh sách yêu cầu ứng lương' })
  async getEmployeeSalaryAdvanceRequests(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
    @Query('status') status?: string,
  ) {
    await this.storesService.assertEmployeeSalaryAccess(profileId, user.userId);
    return this.storesService.getSalaryAdvanceRequests({
      employeeProfileId: profileId,
      status: status as any,
    });
  }

  @StoreOwnerOnly()
  @Patch('salary-advance-requests/:requestId/review')
  @ApiOperation({ summary: 'Duyệt/Từ chối yêu cầu ứng lương' })
  @ApiResponse({ status: 200, description: 'Xử lý yêu cầu thành công' })
  async reviewSalaryAdvanceRequest(
    @Param('requestId') requestId: string,
    @GetUser() user: any,
    @Body()
    body: {
      status: string;
      approvedAmount?: number;
      reviewNote?: string;
      paymentMethod?: string;
      paymentReference?: string;
    },
  ) {
    return this.storesService.reviewSalaryAdvanceRequest(
      requestId,
      user.userId,
      body as any,
    );
  }

  @Delete('salary-advance-requests/:requestId')
  @ApiOperation({ summary: 'Hủy yêu cầu ứng lương (chỉ người tạo)' })
  @ApiResponse({ status: 200, description: 'Hủy yêu cầu thành công' })
  async cancelSalaryAdvanceRequest(
    @Param('requestId') requestId: string,
    @GetUser() user: any,
  ) {
    // The request's own employee profile decides who may cancel it; the
    // token carries an account id, never a profile id.
    return this.storesService.cancelSalaryAdvanceRequest(
      requestId,
      user.userId,
    );
  }

  // Salary Adjustments
  @Post('salary-adjustments')
  @ApiOperation({ summary: 'Tạo phiếu điều chỉnh lương (tăng/giảm)' })
  @ApiResponse({
    status: 201,
    description: 'Điều chỉnh thành công',
    type: SalaryAdjustmentResponseDto,
  })
  async createSalaryAdjustment(
    @GetUser() user: any,
    @Body() body: CreateSalaryAdjustmentDto,
  ) {
    return this.storesService.createSalaryAdjustment(user.userId, body);
  }

  @Get('salary-adjustments/:employeeProfileId')
  @ApiOperation({ summary: 'Lấy lịch sử điều chỉnh lương của nhân viên' })
  @ApiResponse({
    status: 200,
    type: [SalaryAdjustmentResponseDto],
  })
  async getSalaryAdjustments(
    @Param('employeeProfileId') employeeProfileId: string,
    @GetUser() user: any,
  ) {
    await this.storesService.assertEmployeeSalaryAccess(
      employeeProfileId,
      user.userId,
    );
    return this.storesService.getSalaryAdjustments(employeeProfileId);
  }

  @StoreOwnerOnly()
  @Get(':id/employees-salary-overview')
  @ApiOperation({
    summary:
      'Lấy danh sách tổng hợp lương và điều chỉnh của nhân viên trong store',
  })
  @ApiResponse({
    status: 200,
    description: 'Lấy dữ liệu thành công',
  })
  async getEmployeesSalaryOverview(@Param('id') id: string) {
    return this.storesService.getEmployeesSalaryOverview(id);
  }

  @Get('employees/:employeeProfileId/salary-overview')
  @ApiOperation({
    summary: 'Lấy tổng hợp lương và điều chỉnh của MỘT nhân viên',
  })
  @ApiResponse({
    status: 200,
    description: 'Lấy dữ liệu thành công',
  })
  async getEmployeeSalaryOverview(
    @Param('employeeProfileId') employeeProfileId: string,
    @GetUser() user: any,
  ) {
    await this.storesService.assertEmployeeSalaryAccess(
      employeeProfileId,
      user.userId,
    );
    return this.storesService.getEmployeeSalaryOverview(employeeProfileId);
  }

  @Get('employees/:employeeProfileId/salary-details')
  @ApiOperation({ summary: 'Lấy chi tiết phiếu lương nhân viên theo tháng' })
  async getEmployeeSalaryDetailByMonth(
    @Param('employeeProfileId') employeeProfileId: string,
    @Query('month') month: string,
    @GetUser() user: any,
  ) {
    await this.storesService.assertEmployeeSalaryAccess(
      employeeProfileId,
      user.userId,
    );
    return this.storesService.getEmployeeSalaryDetailByMonth(
      employeeProfileId,
      month,
    );
  }

  @StoreOwnerOnly()
  @Post('salaries/:id/pay')
  @ApiOperation({ summary: 'Thực hiện thanh toán lương cho nhân viên' })
  async payEmployeeSalary(
    @Param('id') id: string,
    @Body()
    body: {
      paymentAccountId: string;
      paymentMethod?: string;
      referenceNumber?: string;
      notes?: string;
    },
    @GetUser() user?: any,
  ) {
    return this.storesService.payEmployeeSalary(id, body, user?.userId);
  }

  @StoreOwnerOnly()
  @Patch('employees/:id/salary-structure')
  @ApiOperation({
    summary: 'Cập nhật mức lương và các khoản phụ cấp của nhân viên',
  })
  async updateEmployeeSalaryStructure(
    @Param('id') id: string,
    @Body()
    body: { salaryAmount?: number; allowances?: Record<string, number> },
  ) {
    return this.storesService.updateEmployeeSalaryStructure(id, body);
  }

  // Employee Payment History (Individual)
  @Get('employees/:employeeProfileId/payment-histories')
  @ApiOperation({ summary: 'Lấy lịch sử thanh toán lương của MỘT nhân viên' })
  async getEmployeePaymentHistories(
    @Param('employeeProfileId') employeeProfileId: string,
    @GetUser() user: any,
  ) {
    await this.storesService.assertEmployeeSalaryAccess(
      employeeProfileId,
      user.userId,
    );
    return this.storesService.getEmployeePaymentHistories(employeeProfileId);
  }

  @StoreOwnerOnly({
    bodyResources: [{ field: 'employeeProfileId', resource: 'employees' }],
  })
  @Post('employees/payment-histories')
  @ApiOperation({ summary: 'Tạo bản ghi thanh toán lương cho nhân viên' })
  async createEmployeePaymentHistory(
    @Body() body: CreateEmployeePaymentHistoryDto,
  ) {
    return this.storesService.createEmployeePaymentHistory(body);
  }

  @StoreOwnerOnly({
    bodyResources: [{ field: 'employeeProfileId', resource: 'employees' }],
  })
  @Patch('employees/payment-histories/:id')
  @ApiOperation({ summary: 'Cập nhật bản ghi thanh toán lương' })
  async updateEmployeePaymentHistory(
    @Param('id') id: string,
    @Body() body: UpdateEmployeePaymentHistoryDto,
  ) {
    return this.storesService.updateEmployeePaymentHistory(id, body);
  }

  @StoreOwnerOnly()
  @Delete('employees/payment-histories/:id')
  @ApiOperation({ summary: 'Xóa bản ghi thanh toán lương' })
  async deleteEmployeePaymentHistory(@Param('id') id: string) {
    return this.storesService.deleteEmployeePaymentHistory(id);
  }

  // Store Payment Accounts
  @StoreOwnerOnly()
  @Get(':id/payment-accounts')
  @ApiOperation({ summary: 'Lấy danh sách tài khoản ngân hàng của cửa hàng' })
  async getStorePaymentAccounts(@Param('id') id: string) {
    return this.storesService.getStorePaymentAccounts(id);
  }

  @StoreOwnerOnly()
  @Post(':id/payment-accounts')
  @ApiOperation({ summary: 'Thêm tài khoản ngân hàng mới cho cửa hàng' })
  async createStorePaymentAccount(@Param('id') id: string, @Body() body: any) {
    return this.storesService.createStorePaymentAccount({
      ...body,
      storeId: id,
    });
  }

  @StoreOwnerOnly()
  @Patch('payment-accounts/:id')
  @ApiOperation({ summary: 'Cập nhật tài khoản ngân hàng cửa hàng' })
  async updateStorePaymentAccount(@Param('id') id: string, @Body() body: any) {
    return this.storesService.updateStorePaymentAccount(id, body);
  }

  @StoreOwnerOnly()
  @Delete('payment-accounts/:id')
  @ApiOperation({ summary: 'Xóa tài khoản ngân hàng cửa hàng' })
  async deleteStorePaymentAccount(@Param('id') id: string) {
    return this.storesService.deleteStorePaymentAccount(id);
  }

  @StoreOwnerOnly()
  @Post(':id/salary-adjustment-reasons')
  @ApiOperation({ summary: 'Tạo lý do điều chỉnh lương' })
  async createSalaryAdjustmentReason(
    @Param('id') id: string,
    @Body('name') name: string,
  ) {
    return this.storesService.createSalaryAdjustmentReason(id, name);
  }

  @StoreOwnerOnly()
  @Get(':id/salary-adjustment-reasons')
  @ApiOperation({ summary: 'Lấy danh sách lý do điều chỉnh lương' })
  async getSalaryAdjustmentReasons(@Param('id') id: string) {
    return this.storesService.getSalaryAdjustmentReasons(id);
  }

  @Get(':id/bonus-history')
  @ApiOperation({ summary: 'Lịch sử thưởng' })
  async getBonusHistory(
    @Param('id') id: string,
    @Query('month') month?: string,
    @GetUser() user?: any,
  ) {
    // Owner sees every employee's rows; an employee sees only their own.
    const viewer = await this.storesService.resolveStoreViewer(
      id,
      user?.userId,
    );
    return this.storesService.getBonusHistory(
      id,
      month,
      viewer.isOwner ? undefined : viewer.profileId,
    );
  }

  @Get(':id/penalty-history')
  @ApiOperation({ summary: 'Lịch sử phạt' })
  async getPenaltyHistory(
    @Param('id') id: string,
    @Query('month') month?: string,
    @GetUser() user?: any,
  ) {
    // Owner sees every employee's rows; an employee sees only their own.
    const viewer = await this.storesService.resolveStoreViewer(
      id,
      user?.userId,
    );
    return this.storesService.getPenaltyHistory(
      id,
      month,
      viewer.isOwner ? undefined : viewer.profileId,
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SALARY INQUIRIES (Nhân viên hỏi về lương)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Post('employees/:profileId/salary-inquiries')
  @ApiOperation({
    summary: 'Gửi câu hỏi về lương tới quản lý',
    description:
      'Nhân viên đặt câu hỏi liên quan đến lương thưởng. Câu hỏi được lưu và thông báo tới quản lý.',
  })
  @ApiResponse({ status: 201, description: 'Câu hỏi đã được gửi thành công' })
  async createSalaryInquiry(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
    @Body() body: { question: string; month?: string },
  ) {
    // Owner-or-self, like reading the inquiries.
    await this.storesService.assertEmployeeSalaryAccess(profileId, user.userId);
    return this.storesService.createSalaryInquiry(
      profileId,
      body.question,
      body.month,
      user.userId,
    );
  }

  @Get('employees/:profileId/salary-inquiries')
  @ApiOperation({ summary: 'Lấy danh sách câu hỏi lương của nhân viên' })
  async getSalaryInquiries(
    @Param('profileId') profileId: string,
    @GetUser() user: any,
  ) {
    await this.storesService.assertEmployeeSalaryAccess(profileId, user.userId);
    return this.storesService.getSalaryInquiries(profileId);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SALARY SLIPS (Phiếu lương)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  @Post('employees/:profileId/salary-slips')
  @ApiOperation({
    summary: 'Yêu cầu xuất phiếu lương',
    description:
      'Lấy dữ liệu phiếu lương của nhân viên cho tháng được chỉ định. Trả về dữ liệu lương chi tiết.',
  })
  @ApiResponse({ status: 200, description: 'Dữ liệu phiếu lương' })
  async createSalarySlip(
    @Param('profileId') profileId: string,
    @Body() body: { month: string },
    @GetUser() user: any,
  ) {
    // Returns payslip data: owner-or-self like every other salary read.
    await this.storesService.assertEmployeeSalaryAccess(profileId, user.userId);
    return this.storesService.getSalarySlipData(profileId, body.month);
  }
}
