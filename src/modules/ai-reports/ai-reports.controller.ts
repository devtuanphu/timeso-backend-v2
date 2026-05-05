import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiReportsService } from './ai-reports.service';

@ApiTags('AI Báo cáo (AI Reports)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('stores')
export class AiReportsController {
  constructor(private readonly aiReportsService: AiReportsService) {}

  @Get(':id/ai-reports/forecast')
  @ApiOperation({
    summary: 'Dự đoán doanh thu và xu hướng',
    description:
      'Lấy dữ liệu dự đoán doanh thu, xu hướng và giờ cao điểm cho cửa hàng',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    description: 'Ngày bắt đầu (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    description: 'Ngày kết thúc (YYYY-MM-DD)',
  })
  async getForecastReport(
    @Param('id') storeId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.aiReportsService.getForecastReport(storeId, startDate, endDate);
  }

  @Get(':id/ai-reports/peak-hours')
  @ApiOperation({
    summary: 'Dự đoán giờ cao điểm',
    description: 'Lấy danh sách các khung giờ cao điểm dự đoán cho tuần tới',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    description: 'Ngày bắt đầu (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    description: 'Ngày kết thúc (YYYY-MM-DD)',
  })
  async getPeakHoursPrediction(
    @Param('id') storeId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.aiReportsService.getPeakHoursPrediction(
      storeId,
      startDate,
      endDate,
    );
  }

  @Get(':id/ai-reports/loss-analysis')
  @ApiOperation({
    summary: 'Phân tích món đang mất tiền',
    description:
      'Lấy danh sách các món bị huỷ, khuyến mãi nhiều và lợi nhuận thấp',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    description: 'Ngày bắt đầu (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    description: 'Ngày kết thúc (YYYY-MM-DD)',
  })
  async getLossAnalysis(
    @Param('id') storeId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.aiReportsService.getLossAnalysis(storeId, startDate, endDate);
  }

  @Get(':id/ai-reports/priority')
  @ApiOperation({
    summary: 'Báo cáo ưu tiên',
    description:
      'Lấy danh sách món bán chạy, lợi nhuận cao và giờ bán tốt nhất',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    description: 'Ngày bắt đầu (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    description: 'Ngày kết thúc (YYYY-MM-DD)',
  })
  async getPriorityReport(
    @Param('id') storeId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.aiReportsService.getPriorityReport(storeId, startDate, endDate);
  }

  @Get(':id/ai-reports/insights')
  @ApiOperation({
    summary: 'AI Insights tổng hợp',
    description: 'Lấy các insights tổng hợp từ AI cho dashboard',
  })
  @ApiQuery({
    name: 'date',
    required: true,
    description: 'Ngày cần lấy insights (YYYY-MM-DD)',
  })
  async getAIInsights(
    @Param('id') storeId: string,
    @Query('date') date: string,
  ) {
    return this.aiReportsService.getAIInsights(storeId, date);
  }

  @Get(':id/reports/revenue-trend')
  @ApiOperation({
    summary: 'Xu hướng doanh thu',
    description: 'Lấy dữ liệu xu hướng doanh thu theo ngày/giờ',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    description: 'Ngày bắt đầu (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    description: 'Ngày kết thúc (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'granularity',
    required: false,
    description: 'Độ chi tiết: hour, day, week',
  })
  async getRevenueTrend(
    @Param('id') storeId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('granularity') granularity: 'hour' | 'day' | 'week' = 'day',
  ) {
    return this.aiReportsService.getRevenueTrend(
      storeId,
      startDate,
      endDate,
      granularity,
    );
  }

  @Get(':id/reports/product-performance')
  @ApiOperation({
    summary: 'Hiệu suất sản phẩm',
    description: 'Lấy dữ liệu hiệu suất của các sản phẩm',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    description: 'Ngày bắt đầu (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    description: 'Ngày kết thúc (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    description: 'Sắp xếp theo: revenue, profit, quantity',
  })
  async getProductPerformance(
    @Param('id') storeId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('sortBy') sortBy: 'revenue' | 'profit' | 'quantity' = 'revenue',
  ) {
    return this.aiReportsService.getProductPerformance(
      storeId,
      startDate,
      endDate,
      sortBy,
    );
  }

  @Get(':id/reports/shift-performance')
  @ApiOperation({
    summary: 'Hiệu suất ca làm việc',
    description: 'Lấy dữ liệu hiệu suất của các ca làm việc',
  })
  @ApiQuery({
    name: 'startDate',
    required: true,
    description: 'Ngày bắt đầu (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: true,
    description: 'Ngày kết thúc (YYYY-MM-DD)',
  })
  async getShiftPerformance(
    @Param('id') storeId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.aiReportsService.getShiftPerformance(
      storeId,
      startDate,
      endDate,
    );
  }

  @Get(':id/ai-reports/analysis-summary')
  @ApiOperation({
    summary: 'AI Phân tích tổng hợp',
    description:
      'Lấy dữ liệu tổng hợp cho AnalysisDrawer: nhân viên xuất sắc, ca hiệu quả, món huỷ nhiều',
  })
  async getAIAnalysisSummary(@Param('id') storeId: string) {
    return this.aiReportsService.getAIAnalysisSummary(storeId);
  }

  @Get(':id/ai-reports/employee-ranking')
  @ApiOperation({
    summary: 'Bảng xếp hạng nhân viên',
    description:
      'Lấy danh sách xếp hạng nhân viên theo doanh thu, giờ làm, hiệu suất',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Ngày bắt đầu (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Ngày kết thúc (YYYY-MM-DD)',
  })
  async getEmployeeRanking(
    @Param('id') storeId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.aiReportsService.getEmployeeRankingReport(
      storeId,
      startDate,
      endDate,
    );
  }

  @Get(':id/ai-reports/shift-performance-report')
  @ApiOperation({
    summary: 'Báo cáo hiệu suất ca',
    description:
      'Lấy dữ liệu hiệu suất theo ca làm việc với chi tiết từng ngày',
  })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Ngày bắt đầu (YYYY-MM-DD)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'Ngày kết thúc (YYYY-MM-DD)',
  })
  async getShiftPerformanceReport(
    @Param('id') storeId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.aiReportsService.getShiftPerformanceReport(
      storeId,
      startDate,
      endDate,
    );
  }
}
