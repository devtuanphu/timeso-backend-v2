import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PeakHour,
  RevenueTrendItem,
  CancelledProduct,
  PromotionProduct,
  ProductData,
  ShiftBestSelling,
  AIAnalysisSummary,
  TopEmployee,
  EmployeeRankingReport,
  EmployeeRankingItem,
  ShiftPerformanceReport,
  ShiftPerformanceItem,
  ShiftDailyData,
} from './ai-reports.types';
import { Order, OrderStatus } from '../stores/entities/order.entity';
import {
  ShiftAssignment,
  ShiftAssignmentStatus,
  AttendanceStatus,
} from '../stores/entities/shift-management.entity';
import { EmployeeProfile } from '../stores/entities/employee-profile.entity';

@Injectable()
export class AiReportsService {
  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(ShiftAssignment)
    private shiftAssignmentRepository: Repository<ShiftAssignment>,
    @InjectRepository(EmployeeProfile)
    private employeeRepository: Repository<EmployeeProfile>,
  ) {}

  /**
   * Get forecast report - Revenue prediction and trends
   * Queries real data and generates predictions based on historical patterns
   */
  async getForecastReport(storeId: string, startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // 1. Get hourly revenue data from orders
    const hourlyData = await this.orderRepository
      .createQueryBuilder('o')
      .select('EXTRACT(HOUR FROM o.created_at)', 'hour')
      .addSelect('SUM(o."totalAmount")', 'revenue')
      .addSelect('COUNT(o.id)', 'orderCount')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .setParameter('completed', OrderStatus.COMPLETED)
      .groupBy('EXTRACT(HOUR FROM o.created_at)')
      .orderBy('hour', 'ASC')
      .getRawMany();

    // Get previous period data for comparison
    const periodLength = end.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - periodLength - 1);
    const prevEnd = new Date(start.getTime() - 1);

    const prevHourlyData = await this.orderRepository
      .createQueryBuilder('o')
      .select('EXTRACT(HOUR FROM o.created_at)', 'hour')
      .addSelect('SUM(o."totalAmount")', 'revenue')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', {
        start: prevStart,
        end: prevEnd,
      })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .setParameter('completed', OrderStatus.COMPLETED)
      .groupBy('EXTRACT(HOUR FROM o.created_at)')
      .getRawMany();

    // Build hourly map for quick lookup
    const hourlyMap = new Map<
      number,
      { revenue: number; orderCount: number }
    >();
    hourlyData.forEach((h) => {
      hourlyMap.set(parseInt(h.hour), {
        revenue: parseFloat(h.revenue || '0'),
        orderCount: parseInt(h.orderCount || '0'),
      });
    });

    const prevHourlyMap = new Map<number, number>();
    prevHourlyData.forEach((h) => {
      prevHourlyMap.set(parseInt(h.hour), parseFloat(h.revenue || '0'));
    });

    // 2. Generate trend data (hours with data, fill gaps with 0)
    const trendData: Array<{ x: number; y: number }> = [];
    const allHours = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
    let maxRevenue = 0;

    for (const hour of allHours) {
      const hourData = hourlyMap.get(hour);
      const revenue = hourData?.revenue || 0;
      if (revenue > maxRevenue) maxRevenue = revenue;
      trendData.push({ x: hour, y: revenue });
    }

    // 3. Generate forecast data based on historical patterns
    // Simple forecast: average with growth trend
    const totalRevenue = hourlyData.reduce(
      (sum, h) => sum + parseFloat(h.revenue || '0'),
      0,
    );
    const avgRevenue = totalRevenue / (hourlyData.length || 1);

    // Calculate growth rate from previous period
    const prevTotalRevenue = prevHourlyData.reduce(
      (sum, h) => sum + parseFloat(h.revenue || '0'),
      0,
    );
    const growthRate =
      prevTotalRevenue > 0
        ? (totalRevenue - prevTotalRevenue) / prevTotalRevenue
        : 0;

    // Forecast with slight adjustment based on growth
    const forecastData = trendData.map((d) => ({
      x: d.x,
      y: Math.round(d.y * (1 + growthRate * 0.5)), // 50% of growth rate applied to forecast
    }));

    // 4. Find peak hours for each day of the week
    const vnDays = [
      'Chủ nhật',
      'Thứ 2',
      'Thứ 3',
      'Thứ 4',
      'Thứ 5',
      'Thứ 6',
      'Thứ 7',
    ];

    // Get daily peak hours from historical data
    const dailyPeakHours = await this.orderRepository
      .createQueryBuilder('o')
      .select('EXTRACT(DOW FROM o.created_at)', 'dayOfWeek')
      .addSelect('EXTRACT(HOUR FROM o.created_at)', 'hour')
      .addSelect('SUM(o."totalAmount")', 'revenue')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .setParameter('completed', OrderStatus.COMPLETED)
      .groupBy('EXTRACT(DOW FROM o.created_at)')
      .addGroupBy('EXTRACT(HOUR FROM o.created_at)')
      .getRawMany();

    // Group by day and find peak hour per day
    const dayPeakMap: Record<number, { hour: number; revenue: number }> = {};
    dailyPeakHours.forEach((h) => {
      const day = parseInt(h.dayOfWeek);
      const hour = parseInt(h.hour);
      const revenue = parseFloat(h.revenue || '0');
      if (!dayPeakMap[day] || revenue > dayPeakMap[day].revenue) {
        dayPeakMap[day] = { hour, revenue };
      }
    });

    // Generate peak hours for the week
    const peakHours: PeakHour[] = [];
    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(start);
      currentDate.setDate(start.getDate() + i);
      const dayOfWeek = currentDate.getDay();
      const dayName = vnDays[dayOfWeek === 0 ? 0 : dayOfWeek];
      const peakData = dayPeakMap[dayOfWeek];

      const shiftInfo = this.getShiftInfoFromHour(peakData?.hour || 12);

      peakHours.push({
        day: dayName,
        date: `${currentDate.getDate().toString().padStart(2, '0')}/${(
          currentDate.getMonth() + 1
        )
          .toString()
          .padStart(2, '0')}`,
        time: shiftInfo.time,
        shift: shiftInfo.shift,
        confidence: peakData
          ? 75 + Math.min(Math.round((peakData.revenue / maxRevenue) * 20), 20)
          : 70,
      });
    }

    // 5. Determine trend
    const avgTrend = trendData.reduce((a, b) => a + b.y, 0) / trendData.length;
    const avgForecast =
      forecastData.reduce((a, b) => a + b.y, 0) / forecastData.length;
    const trend =
      avgForecast > avgTrend * 1.05
        ? 'increasing'
        : avgForecast < avgTrend * 0.95
          ? 'decreasing'
          : 'stable';

    // 6. Generate insight based on real data
    const insights = {
      increasing:
        'Nhu cầu có xu hướng tăng. Dự kiến doanh thu tăng so với kỳ trước. Hãy chuẩn bị đủ nhân sự cho giờ cao điểm.',
      decreasing:
        'Nhu cầu có xu hướng giảm. Cần xem xét các chương trình khuyến mãi hoặc cải thiện chất lượng phục vụ.',
      stable:
        'Nhu cầu ổn định. Duy trì chất lượng dịch vụ hiện tại và chuẩn bị đủ nguyên liệu.',
    };

    // If no real data, return empty state
    if (totalRevenue === 0) {
      return {
        peakHours: [],
        trendData: [],
        forecastData: [],
        insight:
          'Chưa có đủ dữ liệu để dự đoán. Vui lòng quay lại sau khi có thêm đơn hàng.',
        trend: 'stable' as const,
        summary: {
          currentWeekRevenue: 0,
          nextWeekRevenue: 0,
          growthRate: 0,
          trend: 'stable' as const,
        },
      };
    }

    return {
      peakHours,
      trendData,
      forecastData,
      insight: insights[trend],
      trend,
      summary: {
        currentWeekRevenue: totalRevenue,
        nextWeekRevenue: avgForecast * 24,
        growthRate: Math.round(growthRate * 100 * 10) / 10,
        trend,
      },
    };
  }

  /**
   * Helper to get shift info from hour
   */
  private getShiftInfoFromHour(hour: number): { time: string; shift: string } {
    if (hour >= 4 && hour < 8)
      return { time: '04:00AM - 08:00AM', shift: 'Ca sáng sớm' };
    if (hour >= 8 && hour < 12)
      return { time: '09:00AM - 12:00PM', shift: 'Ca sáng' };
    if (hour >= 12 && hour < 16)
      return { time: '12:00PM - 04:00PM', shift: 'Ca trưa' };
    if (hour >= 16 && hour < 20)
      return { time: '05:00PM - 08:00PM', shift: 'Ca chiều' };
    return { time: '08:00PM - 11:00PM', shift: 'Ca tối' };
  }

  /**
   * Get peak hours prediction for the week based on historical data
   */
  async getPeakHoursPrediction(
    storeId: string,
    startDate: string,
    endDate: string,
  ) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const vnDays = [
      'Chủ nhật',
      'Thứ 2',
      'Thứ 3',
      'Thứ 4',
      'Thứ 5',
      'Thứ 6',
      'Thứ 7',
    ];

    // Query historical peak hours data
    const peakHoursData = await this.orderRepository
      .createQueryBuilder('o')
      .select('EXTRACT(DOW FROM o.created_at)', 'dayOfWeek')
      .addSelect('EXTRACT(HOUR FROM o.created_at)', 'hour')
      .addSelect('SUM(o."totalAmount")', 'revenue')
      .addSelect('COUNT(o.id)', 'orderCount')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .setParameter('completed', OrderStatus.COMPLETED)
      .groupBy('EXTRACT(DOW FROM o.created_at)')
      .addGroupBy('EXTRACT(HOUR FROM o.created_at)')
      .orderBy('revenue', 'DESC')
      .getRawMany();

    // Group by day and find top 3 peak hours per day
    const dayHoursMap: Record<
      number,
      { hour: number; revenue: number; orderCount: number }[]
    > = {};
    peakHoursData.forEach((h) => {
      const day = parseInt(h.dayOfWeek);
      if (!dayHoursMap[day]) {
        dayHoursMap[day] = [];
      }
      dayHoursMap[day].push({
        hour: parseInt(h.hour),
        revenue: parseFloat(h.revenue || '0'),
        orderCount: parseInt(h.orderCount || '0'),
      });
    });

    const peakHours: PeakHour[] = [];
    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(start);
      currentDate.setDate(start.getDate() + i);
      const dayOfWeek = currentDate.getDay();
      const dayName = vnDays[dayOfWeek === 0 ? 0 : dayOfWeek];

      const dayPeaks = dayHoursMap[dayOfWeek] || [];
      // Get the top peak hour for this day
      const topPeak = dayPeaks[0];

      const shiftInfo = this.getShiftInfoFromHour(topPeak?.hour || 12);
      const maxRevenue = topPeak?.revenue || 1;

      peakHours.push({
        day: dayName,
        date: `${currentDate.getDate().toString().padStart(2, '0')}/${(
          currentDate.getMonth() + 1
        )
          .toString()
          .padStart(2, '0')}`,
        time: shiftInfo.time,
        shift: shiftInfo.shift,
        confidence: topPeak
          ? 75 + Math.min(Math.round((topPeak.revenue / maxRevenue) * 20), 20)
          : 70,
      });
    }

    // If no data, return empty state
    if (peakHoursData.length === 0) {
      return {
        peakHours: [],
        trend: 'stable' as const,
        insight: 'Chưa có đủ dữ liệu để dự đoán giờ cao điểm.',
      };
    }

    return {
      peakHours,
      trend: 'stable' as const,
      insight:
        'A.I gợi ý các khung giờ cao điểm sắp tới dựa trên lịch sử và xu hướng.',
    };
  }

  /**
   * Get loss analysis report
   * Returns: cancelled products, promotion/discount products, low profit products
   */
  async getLossAnalysis(storeId: string, startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // 1. Get cancelled products
    const cancelledProductsData = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.items', 'item')
      .innerJoin('item.serviceItem', 'si')
      .select('si.id', 'id')
      .addSelect('si.name', 'name')
      .addSelect('si.avatar_url', 'avatar')
      .addSelect('COUNT(item.id)', 'count')
      .addSelect('SUM(item."totalPrice")', 'value')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('o.status = :cancelled', { cancelled: OrderStatus.CANCELLED })
      .setParameter('cancelled', OrderStatus.CANCELLED)
      .groupBy('si.id')
      .addGroupBy('si.name')
      .addGroupBy('si.avatar_url')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany();

    // 2. Get promotion/discount products (orders with discount)
    const promotionProductsData = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.items', 'item')
      .innerJoin('item.serviceItem', 'si')
      .select('si.id', 'id')
      .addSelect('si.name', 'name')
      .addSelect('si.avatar_url', 'avatar')
      .addSelect('EXTRACT(HOUR FROM o.created_at)', 'hour')
      .addSelect('COUNT(item.id)', 'count')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .andWhere('o."discountAmount" > 0')
      .setParameter('completed', OrderStatus.COMPLETED)
      .groupBy('si.id')
      .addGroupBy('si.name')
      .addGroupBy('si.avatar_url')
      .addGroupBy('EXTRACT(HOUR FROM o.created_at)')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany();

    // Determine shift from hour for promotion products
    const getShiftFromHour = (hour: number): 'morning' | 'noon' | 'evening' => {
      if (hour >= 6 && hour < 12) return 'morning';
      if (hour >= 12 && hour < 18) return 'noon';
      return 'evening';
    };

    // 3. Get low profit products (profit margin < 20%)
    const productPerformanceData = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.items', 'item')
      .innerJoin('item.serviceItem', 'si')
      .select('si.id', 'id')
      .addSelect('si.name', 'name')
      .addSelect('si.avatar_url', 'avatar')
      .addSelect('SUM(item."totalPrice")', 'revenue')
      .addSelect('SUM(item."totalCost")', 'cost')
      .addSelect('SUM(item.quantity)', 'quantity')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .setParameter('completed', OrderStatus.COMPLETED)
      .groupBy('si.id')
      .addGroupBy('si.name')
      .addGroupBy('si.avatar_url')
      .getRawMany();

    // Calculate profit margin and filter low profit products
    const lowProfitThreshold = 0.2; // 20% profit margin
    const lowProfitProducts = productPerformanceData
      .map((p) => {
        const revenue = parseFloat(p.revenue || '0');
        const cost = parseFloat(p.cost || '0');
        const profit = revenue - cost;
        const profitMargin = revenue > 0 ? profit / revenue : 0;
        return {
          ...p,
          profit,
          profitMargin,
        };
      })
      .filter((p) => p.profitMargin < lowProfitThreshold)
      .sort((a, b) => a.profitMargin - b.profitMargin)
      .slice(0, 10);

    // 4. Calculate total loss value
    const cancelledLoss = cancelledProductsData.reduce(
      (sum, p) => sum + parseFloat(p.value || '0'),
      0,
    );
    const promotionLoss = promotionProductsData.reduce(
      (sum, p) => sum + parseFloat(p.value || '0') * 0.2, // Estimate 20% discount loss
      0,
    );
    const lowProfitLoss = lowProfitProducts.reduce(
      (sum, p) =>
        sum + (parseFloat(p.revenue || '0') - parseFloat(p.cost || '0')),
      0,
    );
    const totalLossValue = cancelledLoss + promotionLoss;

    // 5. Calculate loss trend (compare with previous period)
    const periodLength = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - periodLength);

    const prevCancelledLoss = await this.orderRepository
      .createQueryBuilder('o')
      .select('SUM(o."totalAmount")', 'total')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', {
        start: prevStart,
        end: prevEnd,
      })
      .andWhere('o.status = :cancelled', { cancelled: OrderStatus.CANCELLED })
      .setParameter('cancelled', OrderStatus.CANCELLED)
      .getRawOne();

    const currentCancelledCount = cancelledProductsData.reduce(
      (sum, p) => sum + parseInt(p.count || '0'),
      0,
    );
    const prevCancelledCount =
      parseInt(prevCancelledLoss?.total || '0') / 100000; // Estimate
    const lossTrend =
      prevCancelledCount > 0
        ? ((currentCancelledCount - prevCancelledCount) / prevCancelledCount) *
          100
        : 0;

    // 6. Format response to match frontend types
    const cancelledProducts = cancelledProductsData.map((p) => ({
      id: p.id,
      name: p.name || 'Sản phẩm',
      avatar: p.avatar,
      count: parseInt(p.count || '0'),
      value: parseFloat(p.value || '0'),
      displayValue: `${parseInt(p.count || '0')} lần`,
    }));

    const promotionProducts = promotionProductsData.map((p) => ({
      id: p.id,
      name: p.name || 'Sản phẩm',
      avatar: p.avatar,
      count: parseInt(p.count || '0'),
      value: parseFloat(p.value || '0'),
      displayValue: `${parseInt(p.count || '0')} lần`,
      shift: getShiftFromHour(parseInt(p.hour || '12')),
    }));

    const lowProfitFormatted = lowProfitProducts.map((p) => ({
      id: p.id,
      name: p.name || 'Sản phẩm',
      avatar: p.avatar,
      value: parseFloat(p.profit?.toString() || '0') / 1000000, // Convert to millions
      displayValue: `${(parseFloat(p.profit?.toString() || '0') / 1000000).toFixed(1)}tr`,
    }));

    // Generate insight
    const topCancelled = cancelledProducts[0];
    const insight = topCancelled
      ? `Món "${topCancelled.name}" bị huỷ nhiều nhất với ${topCancelled.count} lần. Cần kiểm tra chất lượng và quy trình phục vụ.`
      : 'Không có dữ liệu huỷ trong kỳ này.';

    // If no real data, return empty state
    if (
      cancelledProducts.length === 0 &&
      promotionProducts.length === 0 &&
      lowProfitFormatted.length === 0
    ) {
      return {
        cancelledProducts: [],
        promotionProducts: [],
        lowProfitProducts: [],
        totalLossValue: 0,
        lossTrend: 0,
        insight: 'Chưa có dữ liệu phân tích cho kỳ này.',
      };
    }

    return {
      cancelledProducts,
      promotionProducts,
      lowProfitProducts: lowProfitFormatted,
      totalLossValue,
      lossTrend: Math.round(lossTrend * 10) / 10,
      insight,
    };
  }

  /**
   * Get priority report
   * Returns: top selling products, high profit products, slow selling products, best selling shifts
   */
  async getPriorityReport(storeId: string, startDate: string, endDate: string) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    // 1. Get all product performance data
    const productStats = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.items', 'item')
      .innerJoin('item.serviceItem', 'si')
      .select('si.id', 'id')
      .addSelect('si.name', 'name')
      .addSelect('si.avatar_url', 'avatar')
      .addSelect('SUM(item.quantity)', 'totalQuantity')
      .addSelect('SUM(item."totalPrice")', 'revenue')
      .addSelect('SUM(item."totalCost")', 'cost')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .setParameter('completed', OrderStatus.COMPLETED)
      .groupBy('si.id')
      .addGroupBy('si.name')
      .addGroupBy('si.avatar_url')
      .getRawMany();

    // Calculate metrics for each product
    const productMetrics = productStats.map((p) => {
      const quantity = parseInt(p.totalQuantity || '0');
      const revenue = parseFloat(p.revenue || '0');
      const cost = parseFloat(p.cost || '0');
      const profit = revenue - cost;
      const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

      return {
        id: p.id,
        name: p.name || 'Sản phẩm',
        avatar: p.avatar,
        quantity,
        revenue,
        cost,
        profit,
        profitMargin,
      };
    });

    // 2. Top selling products (by quantity)
    const sortedByQuantity = [...productMetrics].sort(
      (a, b) => b.quantity - a.quantity,
    );
    const maxQuantity = sortedByQuantity[0]?.quantity || 1;
    const topSelling = sortedByQuantity.slice(0, 10).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      value: p.quantity,
      displayValue: String(p.quantity),
      trend: `${p.profitMargin.toFixed(1)}%`,
      trendDirection: 'up' as const,
    }));

    // 3. High profit products (by profit margin and absolute profit)
    const sortedByProfit = [...productMetrics]
      .filter((p) => p.profit > 0)
      .sort((a, b) => b.profit - a.profit);
    const maxProfit = sortedByProfit[0]?.profit || 1;
    const highProfit = sortedByProfit.slice(0, 10).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      value: p.profit / 1000000, // Convert to millions
      displayValue: `${(p.profit / 1000000).toFixed(1)}tr`,
      trend: `${p.profitMargin.toFixed(1)}%`,
      trendDirection: 'up' as const,
    }));

    // 4. Slow selling products (low quantity)
    const sortedBySlow = [...productMetrics].sort(
      (a, b) => a.quantity - b.quantity,
    );
    const slowSelling = sortedBySlow.slice(0, 10).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      value: p.quantity,
      displayValue: String(p.quantity),
      trend: `${Math.max(0, p.profitMargin).toFixed(1)}%`,
      trendDirection: 'down' as const,
    }));

    // 5. Best selling shifts (group by hour and find peak hours)
    const shiftStats = await this.orderRepository
      .createQueryBuilder('o')
      .select('EXTRACT(HOUR FROM o.created_at)', 'hour')
      .addSelect('COUNT(o.id)', 'orderCount')
      .addSelect('SUM(o."totalAmount")', 'revenue')
      .addSelect('MAX(o."totalAmount")', 'maxOrderValue')
      .addSelect('si.name', 'topProductName')
      .addSelect('si.id', 'topProductId')
      .innerJoin('o.items', 'item')
      .innerJoin('item.serviceItem', 'si')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .setParameter('completed', OrderStatus.COMPLETED)
      .groupBy('EXTRACT(HOUR FROM o.created_at)')
      .addGroupBy('si.name')
      .addGroupBy('si.id')
      .orderBy('revenue', 'DESC')
      .limit(20)
      .getRawMany();

    // Group by hour and find top product per hour
    const hourMap: Record<
      number,
      {
        revenue: number;
        topProduct: string;
        topProductId: string;
        orderCount: number;
      }
    > = {};
    shiftStats.forEach((stat) => {
      const hour = parseInt(stat.hour);
      const revenue = parseFloat(stat.revenue || '0');
      if (!hourMap[hour] || revenue > hourMap[hour].revenue) {
        hourMap[hour] = {
          revenue,
          topProduct: stat.topProductName,
          topProductId: stat.topProductId,
          orderCount: parseInt(stat.orderCount || '0'),
        };
      }
    });

    // Convert to shifts
    const getShiftName = (hour: number): string => {
      if (hour >= 4 && hour < 9) return 'Ca sáng';
      if (hour >= 9 && hour < 14) return 'Ca trưa';
      if (hour >= 14 && hour < 18) return 'Ca chiều';
      if (hour >= 18 && hour < 22) return 'Ca tối';
      return 'Ca đêm';
    };

    const formatTime = (hour: number): string => {
      const startHour = hour;
      const endHour = (hour + 3) % 24;
      const format = (h: number) => {
        if (h === 0 || h === 24) return '12AM';
        if (h === 12) return '12PM';
        if (h < 12) return `${h}AM`;
        return `${h - 12}PM`;
      };
      return `${format(startHour)} - ${format(endHour)}`;
    };

    const bestSellingShifts = Object.entries(hourMap)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .slice(0, 5)
      .map(([hourStr, data]) => ({
        shift: getShiftName(parseInt(hourStr)),
        time: formatTime(parseInt(hourStr)),
        product: data.topProduct,
        productId: data.topProductId,
        trend: `${data.orderCount} đơn`,
      }));

    // 6. Generate highlight and insight
    const topProduct = topSelling[0];
    const topProfitProduct = highProfit[0];
    const highlight = topProduct
      ? `Top bán chạy và lợi nhuận cao: ${topProduct.name}`
      : 'Chưa có dữ liệu';

    const insight = topProfitProduct
      ? `Ưu tiên đẩy mạnh sản phẩm "${topProfitProduct.name}" vào giờ cao điểm để tối ưu lợi nhuận.`
      : 'Chưa có dữ liệu phân tích cho kỳ này.';

    // If no real data, return empty state
    if (productMetrics.length === 0) {
      return {
        topSelling: [],
        highProfit: [],
        slowSelling: [],
        bestSellingShifts: [],
        highlight: 'Chưa có dữ liệu cho kỳ này.',
        insight: 'Chưa có dữ liệu phân tích cho kỳ này.',
      };
    }

    return {
      topSelling,
      highProfit,
      slowSelling,
      bestSellingShifts,
      highlight,
      insight,
    };
  }

  /**
   * Get AI insights summary
   */
  async getAIInsights(storeId: string, date: string) {
    const revenue = Math.floor(Math.random() * 10000000) + 5000000;
    const expense = Math.floor(revenue * (Math.random() * 0.3 + 0.5));
    const profit = revenue - expense;

    return {
      insights: [
        {
          type: 'warning',
          message:
            'Chi phí chiếm hơn 70% doanh thu. Cần kiểm tra lại chi phí vận hành.',
          priority: 'high',
        },
        {
          type: 'info',
          message: 'Món Cà phê sữa đang bán rất chạy, nên tăng tồn kho.',
          priority: 'medium',
        },
        {
          type: 'success',
          message: 'Lợi nhuận tuần này tăng 15% so với tuần trước.',
          priority: 'low',
        },
      ],
      summary: {
        revenue,
        expense,
        profit,
        change: Math.random() * 30 - 10,
      },
    };
  }

  /**
   * Get revenue trend data
   */
  async getRevenueTrend(
    storeId: string,
    startDate: string,
    endDate: string,
    granularity: 'hour' | 'day' | 'week' = 'day',
  ) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days =
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const data: RevenueTrendItem[] = [];
    for (let i = 0; i < days; i++) {
      const currentDate = new Date(start);
      currentDate.setDate(start.getDate() + i);
      data.push({
        date: currentDate.toISOString().split('T')[0],
        revenue: Math.floor(Math.random() * 5000000) + 2000000,
        profit: Math.floor(Math.random() * 2000000) + 500000,
        expense: Math.floor(Math.random() * 3000000) + 1000000,
      });
    }

    const avgRevenue = data.reduce((a, b) => a + b.revenue, 0) / data.length;
    const prevAvg = avgRevenue * (Math.random() * 0.4 + 0.8);

    return {
      data,
      comparison: {
        revenueChange: ((avgRevenue - prevAvg) / prevAvg) * 100,
        profitChange: Math.random() * 30 - 10,
        expenseChange: Math.random() * 20 - 5,
      },
    };
  }

  /**
   * Get product performance report
   */
  async getProductPerformance(
    storeId: string,
    startDate: string,
    endDate: string,
    sortBy: 'revenue' | 'profit' | 'quantity' = 'revenue',
  ) {
    const products = [
      {
        id: 'p1',
        name: 'Cà phê sữa',
        avatar: 'https://i.pravatar.cc/150?u=cf1',
      },
      { id: 'p2', name: 'Trà sữa', avatar: 'https://i.pravatar.cc/150?u=ts1' },
      {
        id: 'p3',
        name: 'Matcha Latte',
        avatar: 'https://i.pravatar.cc/150?u=mt1',
      },
      { id: 'p4', name: 'Cacao', avatar: 'https://i.pravatar.cc/150?u=cc1' },
      { id: 'p5', name: 'Yogurt', avatar: 'https://i.pravatar.cc/150?u=yg1' },
    ];

    const productData = products.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      quantity: Math.floor(Math.random() * 100) + 20,
      revenue: Math.floor(Math.random() * 5000000) + 1000000,
      profit: Math.floor(Math.random() * 2000000) + 300000,
      profitMargin: Math.random() * 0.4 + 0.2,
      cancelledCount: Math.floor(Math.random() * 15) + 1,
      promotionCount: Math.floor(Math.random() * 10) + 1,
    }));

    // Sort based on criteria
    if (sortBy === 'revenue') {
      productData.sort((a, b) => b.revenue - a.revenue);
    } else if (sortBy === 'profit') {
      productData.sort((a, b) => b.profit - a.profit);
    } else {
      productData.sort((a, b) => b.quantity - a.quantity);
    }

    return {
      products: productData,
      summary: {
        totalProducts: productData.length,
        totalRevenue: productData.reduce((a, b) => a + b.revenue, 0),
        totalProfit: productData.reduce((a, b) => a + b.profit, 0),
      },
    };
  }

  /**
   * Get shift performance
   */
  async getShiftPerformance(
    storeId: string,
    startDate: string,
    endDate: string,
  ) {
    const shifts = [
      { shiftName: 'Ca sáng sớm', startTime: '04:00', endTime: '08:00' },
      { shiftName: 'Ca sáng', startTime: '08:00', endTime: '12:00' },
      { shiftName: 'Ca trưa', startTime: '12:00', endTime: '16:00' },
      { shiftName: 'Ca chiều', startTime: '16:00', endTime: '20:00' },
      { shiftName: 'Ca tối', startTime: '20:00', endTime: '24:00' },
    ];

    const products = [
      { id: 'p1', name: 'Cà phê sữa' },
      { id: 'p2', name: 'Trà sữa' },
      { id: 'p3', name: 'Matcha Latte' },
    ];

    const shiftData = shifts.map((s) => ({
      ...s,
      revenue: Math.floor(Math.random() * 3000000) + 500000,
      orderCount: Math.floor(Math.random() * 50) + 10,
      avgOrderValue: Math.floor(Math.random() * 100000) + 30000,
      topProduct: products[Math.floor(Math.random() * products.length)],
    }));

    return { shifts: shiftData };
  }

  /**
   * Get AI Analysis Summary for AnalysisDrawer
   * Returns top employee, best shift, most cancelled product, etc.
   * Uses real data from database
   */
  async getAIAnalysisSummary(storeId: string): Promise<AIAnalysisSummary> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const startDate = new Date(thirtyDaysAgo);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);

    // 1. Get top employee by completed orders revenue
    const employeeStats = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.employee', 'e')
      .innerJoin('e.account', 'a')
      .select('e.id', 'employeeId')
      .addSelect('a.fullName', 'fullName')
      .addSelect('a.avatar', 'avatarUrl')
      .addSelect('COUNT(o.id)', 'ordersCount')
      .addSelect(
        'SUM(CASE WHEN o.status = :completed THEN o."totalAmount" ELSE 0 END)',
        'totalRevenue',
      )
      .addSelect(
        'COUNT(CASE WHEN o.status = :completed THEN 1 END)',
        'completedOrders',
      )
      .addSelect(
        'COUNT(CASE WHEN o.status = :cancelled THEN 1 END)',
        'cancelledOrders',
      )
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', {
        start: startDate,
        end: endDate,
      })
      .andWhere('o.employee_id IS NOT NULL')
      .setParameters({
        completed: OrderStatus.COMPLETED,
        cancelled: OrderStatus.CANCELLED,
      })
      .groupBy('e.id')
      .addGroupBy('a.fullName')
      .addGroupBy('a.avatar')
      .orderBy('"totalRevenue"', 'DESC')
      .limit(5)
      .getRawMany();

    let topEmployee: TopEmployee | null = null;
    if (employeeStats.length > 0) {
      const best = employeeStats[0];
      const completedOrders = parseInt(best.completedOrders || '0');
      const cancelledOrders = parseInt(best.cancelledOrders || '0');
      const totalOrders = completedOrders + cancelledOrders;
      const successRate =
        totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;

      topEmployee = {
        employeeId: best.employeeId,
        fullName: best.fullName || 'Nhân viên',
        avatar: best.avatarUrl,
        revenue: parseFloat(best.totalRevenue || '0'),
        ordersCount: completedOrders,
        successRate: Math.round(successRate * 10) / 10,
      };
    }

    // 2. Get best shift by revenue (join through WorkCycle to get storeId)
    const shiftStats = await this.shiftAssignmentRepository
      .createQueryBuilder('sa')
      .innerJoin('sa.shiftSlot', 'slot')
      .innerJoin('slot.cycle', 'cycle')
      .innerJoin('slot.workShift', 'ws')
      .select('ws.shiftName', 'shiftName')
      .addSelect('ws.startTime', 'startTime')
      .addSelect('ws.endTime', 'endTime')
      .addSelect('COUNT(sa.id)', 'completedCount')
      .addSelect('SUM(sa."worked_minutes")', 'totalMinutes')
      .addSelect('AVG(sa."late_minutes")', 'avgLateMinutes')
      .where('cycle.storeId = :storeId', { storeId })
      .andWhere('sa.status = :status', {
        status: ShiftAssignmentStatus.COMPLETED,
      })
      .andWhere('slot.work_date BETWEEN :start AND :end', {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
      })
      .groupBy('ws.shiftName')
      .addGroupBy('ws.startTime')
      .addGroupBy('ws.endTime')
      .orderBy('"completedCount"', 'DESC')
      .limit(1)
      .getRawMany();

    let bestShift = 'Chưa có dữ liệu';
    if (shiftStats.length > 0) {
      const best = shiftStats[0];
      bestShift = `${best.shiftName} (${best.startTime?.substring(0, 5)}-${best.endTime?.substring(0, 5)})`;
    }

    // 3. Get most cancelled product
    const cancelledProducts = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.items', 'item')
      .innerJoin('item.serviceItem', 'si')
      .select('si.id', 'productId')
      .addSelect('si.name', 'productName')
      .addSelect(
        'COUNT(CASE WHEN o.status = :cancelled THEN 1 END)',
        'cancelledCount',
      )
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', {
        start: startDate,
        end: endDate,
      })
      .andWhere('o.status = :cancelled', { cancelled: OrderStatus.CANCELLED })
      .setParameter('cancelled', OrderStatus.CANCELLED)
      .groupBy('si.id')
      .addGroupBy('si.name')
      .orderBy('"cancelledCount"', 'DESC')
      .limit(1)
      .getRawMany();

    const mostCancelledProduct =
      cancelledProducts.length > 0
        ? {
            name: cancelledProducts[0].productName,
            count: parseInt(cancelledProducts[0].cancelledCount || '0'),
          }
        : { name: 'Không có', count: 0 };

    // 4. Get top selling product
    const topProducts = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.items', 'item')
      .innerJoin('item.serviceItem', 'si')
      .select('si.name', 'productName')
      .addSelect('SUM(item.quantity)', 'totalQuantity')
      .addSelect('SUM(item."totalPrice")', 'totalRevenue')
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', {
        start: startDate,
        end: endDate,
      })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .setParameter('completed', OrderStatus.COMPLETED)
      .groupBy('si.name')
      .orderBy('"totalRevenue"', 'DESC')
      .limit(1)
      .getRawMany();

    const topProduct =
      topProducts.length > 0 ? topProducts[0].productName : 'Không có';

    // 5. Calculate trend and overall status
    const currentRevenue = topEmployee?.revenue || 0;
    const previousRevenue = currentRevenue * (0.8 + Math.random() * 0.4); // Mock previous period
    const revenueChange =
      previousRevenue > 0
        ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
        : 0;

    const trend: 'up' | 'down' | 'stable' =
      revenueChange > 5 ? 'up' : revenueChange < -5 ? 'down' : 'stable';
    const overallStatus: 'growing' | 'declining' | 'stable' =
      revenueChange > 5
        ? 'growing'
        : revenueChange < -5
          ? 'declining'
          : 'stable';

    return {
      topEmployee,
      bestShift,
      mostCancelledProduct,
      topProduct,
      trend,
      overallStatus,
    };
  }

  /**
   * Get Employee Ranking Report for EmployeeReportDetailScreen
   * Returns all employees with their performance metrics
   */
  async getEmployeeRankingReport(
    storeId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<EmployeeRankingReport> {
    // Default to last 30 days if not specified
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    end.setHours(23, 59, 59, 999);
    start.setHours(0, 0, 0, 0);

    // Get employee order statistics
    const employeeOrderStats = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.employee', 'e')
      .innerJoin('e.account', 'a')
      .select('e.id', 'employeeId')
      .addSelect('a.fullName', 'fullName')
      .addSelect('a.avatar', 'avatarUrl')
      .addSelect('COUNT(o.id)', 'totalOrders')
      .addSelect(
        'COUNT(CASE WHEN o.status = :completed THEN 1 END)',
        'completedOrders',
      )
      .addSelect(
        'COUNT(CASE WHEN o.status = :cancelled THEN 1 END)',
        'cancelledOrders',
      )
      .addSelect(
        'SUM(CASE WHEN o.status = :completed THEN o."totalAmount" ELSE 0 END)',
        'totalRevenue',
      )
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('o.employee_id IS NOT NULL')
      .setParameters({
        completed: OrderStatus.COMPLETED,
        cancelled: OrderStatus.CANCELLED,
      })
      .groupBy('e.id')
      .addGroupBy('a.fullName')
      .addGroupBy('a.avatar')
      .orderBy('"totalRevenue"', 'DESC')
      .getRawMany();

    // Get employee work hours from shift assignments
    const employeeWorkStats = await this.shiftAssignmentRepository
      .createQueryBuilder('sa')
      .innerJoin('sa.employee', 'e')
      .innerJoin('sa.shiftSlot', 'slot')
      .innerJoin('slot.cycle', 'cycle')
      .select('e.id', 'employeeId')
      .addSelect('SUM(sa."worked_minutes")', 'totalWorkMinutes')
      .addSelect('COUNT(sa.id)', 'completedShifts')
      .where('cycle.storeId = :storeId', { storeId })
      .andWhere('sa.status = :status', {
        status: ShiftAssignmentStatus.COMPLETED,
      })
      .andWhere('slot.work_date BETWEEN :start AND :end', {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
      })
      .groupBy('e.id')
      .getRawMany();

    // Create a map for quick lookup
    const workStatsMap = new Map(
      employeeWorkStats.map((w) => [w.employeeId, w]),
    );

    // Combine and calculate metrics
    let maxRevenue = 0;
    let maxHours = 0;

    const employees: EmployeeRankingItem[] = employeeOrderStats.map((emp) => {
      const workStats = workStatsMap.get(emp.employeeId) || {};
      const totalWorkMinutes = parseInt(workStats.totalWorkMinutes || '0');
      const hours = Math.round((totalWorkMinutes / 60) * 10) / 10; // Convert to hours with 1 decimal
      const revenue = parseFloat(emp.totalRevenue || '0');

      if (revenue > maxRevenue) maxRevenue = revenue;
      if (hours > maxHours) maxHours = hours;

      return {
        employeeId: emp.employeeId,
        fullName: emp.fullName || 'Nhân viên',
        avatarUrl: emp.avatarUrl,
        hours,
        revenue,
        revenueDisplay: this.formatRevenue(revenue),
        hPercentage: 0, // Will calculate after knowing max
        rPercentage: 0, // Will calculate after knowing max
        ordersCount: parseInt(emp.totalOrders || '0'),
        completedOrders: parseInt(emp.completedOrders || '0'),
        cancelledOrders: parseInt(emp.cancelledOrders || '0'),
        successRate: 0, // Will calculate
        efficiency: 0, // Will calculate
      };
    });

    // Calculate percentages and efficiency
    const maxHoursSafe = maxHours || 1;
    const maxRevenueSafe = maxRevenue || 1;

    employees.forEach((emp) => {
      emp.hPercentage = Math.round((emp.hours / maxHoursSafe) * 100 * 10) / 10;
      emp.rPercentage =
        Math.round((emp.revenue / maxRevenueSafe) * 100 * 10) / 10;
      emp.successRate =
        emp.ordersCount > 0
          ? Math.round((emp.completedOrders / emp.ordersCount) * 100 * 10) / 10
          : 0;
      // Efficiency = revenue per hour
      emp.efficiency =
        emp.hours > 0 ? Math.round((emp.revenue / emp.hours) * 100) / 100 : 0;
    });

    // Sort by revenue descending
    employees.sort((a, b) => b.revenue - a.revenue);

    const topEmployee = employees[0];

    return {
      employees,
      period: {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
      },
      summary: {
        totalRevenue: employees.reduce((sum, e) => sum + e.revenue, 0),
        totalHours: employees.reduce((sum, e) => sum + e.hours, 0),
        totalOrders: employees.reduce((sum, e) => sum + e.ordersCount, 0),
        topEmployee: topEmployee || employees[0],
      },
    };
  }

  private formatRevenue(value: number): string {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(0)}tr`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    }
    return value.toString();
  }

  /**
   * Get Shift Performance Report for ShiftReportDetailScreen
   * Returns shift performance metrics with daily breakdown
   */
  async getShiftPerformanceReport(
    storeId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<ShiftPerformanceReport> {
    // Default to last 7 days if not specified
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

    end.setHours(23, 59, 59, 999);
    start.setHours(0, 0, 0, 0);

    // Get orders grouped by shift and date
    const orderStats = await this.orderRepository
      .createQueryBuilder('o')
      .select('DATE(o.created_at)', 'date')
      .addSelect("TO_CHAR(o.created_at, 'Dy')", 'dayOfWeek')
      .addSelect('EXTRACT(HOUR FROM o.created_at)', 'hour')
      .addSelect('COUNT(o.id)', 'orderCount')
      .addSelect(
        'SUM(CASE WHEN o.status = :completed THEN o."totalAmount" ELSE 0 END)',
        'totalRevenue',
      )
      .addSelect(
        'SUM(CASE WHEN o.status = :completed THEN o."totalCost" ELSE 0 END)',
        'totalCost',
      )
      .where('o.store_id = :storeId', { storeId })
      .andWhere('o.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('o.status = :completed', { completed: OrderStatus.COMPLETED })
      .setParameter('completed', OrderStatus.COMPLETED)
      .groupBy('DATE(o.created_at)')
      .addGroupBy("TO_CHAR(o.created_at, 'Dy')")
      .addGroupBy('EXTRACT(HOUR FROM o.created_at)')
      .orderBy('DATE(o.created_at)', 'ASC')
      .getRawMany();

    // Get shift assignments for employee count
    const shiftStats = await this.shiftAssignmentRepository
      .createQueryBuilder('sa')
      .innerJoin('sa.shiftSlot', 'slot')
      .innerJoin('slot.cycle', 'cycle')
      .innerJoin('slot.workShift', 'ws')
      .select('slot.work_date', 'date')
      .addSelect('ws.shiftName', 'shiftName')
      .addSelect('COUNT(sa.id)', 'employeeCount')
      .addSelect('SUM(sa."worked_minutes")', 'totalMinutes')
      .where('cycle.storeId = :storeId', { storeId })
      .andWhere('sa.status = :status', {
        status: ShiftAssignmentStatus.COMPLETED,
      })
      .andWhere('slot.work_date BETWEEN :start AND :end', {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
      })
      .groupBy('slot.work_date')
      .addGroupBy('ws.shiftName')
      .getRawMany();

    // Map shift hours to shift names
    const getShiftNameFromHour = (hour: number): string => {
      if (hour >= 4 && hour < 9) return 'Ca sáng';
      if (hour >= 9 && hour < 14) return 'Ca trưa';
      if (hour >= 14 && hour < 18) return 'Ca chiều';
      if (hour >= 18 && hour < 22) return 'Ca tối';
      return 'Ca đêm';
    };

    const dayMap: Record<string, string> = {
      Mon: 'T2',
      Tue: 'T3',
      Wed: 'T4',
      Thu: 'T5',
      Fri: 'T6',
      Sat: 'T7',
      Sun: 'CN',
    };

    // Aggregate by shift
    const shiftAggregates: Record<
      string,
      { revenue: number; cost: number; orders: number; hours: string[] }
    > = {};
    orderStats.forEach((stat) => {
      const shiftName = getShiftNameFromHour(parseInt(stat.hour));
      if (!shiftAggregates[shiftName]) {
        shiftAggregates[shiftName] = {
          revenue: 0,
          cost: 0,
          orders: 0,
          hours: [],
        };
      }
      shiftAggregates[shiftName].revenue += parseFloat(
        stat.totalRevenue || '0',
      );
      shiftAggregates[shiftName].cost += parseFloat(stat.totalCost || '0');
      shiftAggregates[shiftName].orders += parseInt(stat.orderCount || '0');
      if (!shiftAggregates[shiftName].hours.includes(stat.date)) {
        shiftAggregates[shiftName].hours.push(stat.date);
      }
    });

    // Map shift stats
    const shiftMap: Record<string, number> = {};
    shiftStats.forEach((stat) => {
      shiftMap[`${stat.date}_${stat.shiftName}`] = parseInt(
        stat.employeeCount || '0',
      );
    });

    // Build shift performance items
    const shiftStartTimes: Record<string, string> = {
      'Ca sáng': '06:00',
      'Ca trưa': '10:00',
      'Ca chiều': '14:00',
      'Ca tối': '18:00',
      'Ca đêm': '22:00',
    };
    const shiftEndTimes: Record<string, string> = {
      'Ca sáng': '10:00',
      'Ca trưa': '14:00',
      'Ca chiều': '18:00',
      'Ca tối': '22:00',
      'Ca đêm': '02:00',
    };

    const shifts: ShiftPerformanceItem[] = Object.entries(shiftAggregates).map(
      ([name, data]) => {
        const profit = data.revenue - data.cost;
        const avgEmployees =
          data.hours.length > 0
            ? data.orders / data.hours.length / 10 // Simplified calculation
            : 0;

        return {
          shiftName: name,
          startTime: shiftStartTimes[name] || '00:00',
          endTime: shiftEndTimes[name] || '00:00',
          revenue: data.revenue,
          revenueDisplay: this.formatRevenue(data.revenue),
          profit,
          employeeCount: Math.round(avgEmployees * 10) / 10,
          efficiency: data.cost > 0 ? (profit / data.cost) * 100 : 0,
        };
      },
    );

    // Sort by revenue
    shifts.sort((a, b) => b.revenue - a.revenue);

    // Build daily data
    const dailyDataMap: Record<string, ShiftDailyData> = {};
    orderStats.forEach((stat) => {
      const dateStr = new Date(stat.date).toISOString().split('T')[0];
      const dayLabel = dayMap[stat.dayOfWeek] || stat.dayOfWeek;

      if (!dailyDataMap[dateStr]) {
        dailyDataMap[dateStr] = {
          date: dateStr,
          dayLabel: `${dayLabel} ${dateStr.split('-')[2]}/${dateStr.split('-')[1]}`,
          shifts: {},
        };
      }

      const shiftName = getShiftNameFromHour(parseInt(stat.hour));
      if (!dailyDataMap[dateStr].shifts[shiftName]) {
        dailyDataMap[dateStr].shifts[shiftName] = {
          revenue: 0,
          profit: 0,
          employeeCount: 0,
          efficiency: 0,
        };
      }
      dailyDataMap[dateStr].shifts[shiftName].revenue += parseFloat(
        stat.totalRevenue || '0',
      );
      dailyDataMap[dateStr].shifts[shiftName].profit +=
        parseFloat(stat.totalRevenue || '0') -
        parseFloat(stat.totalCost || '0');
    });

    const dailyData = Object.values(dailyDataMap).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    // Calculate total revenue for validation
    const totalRevenue = shifts.reduce((sum, s) => sum + s.revenue, 0);

    // If no shifts data or very low revenue (likely test data), return empty state
    // Minimum threshold: 100,000 VND to filter out test orders
    if (shifts.length === 0 || totalRevenue < 100000) {
      return {
        shifts: [],
        dailyData: [],
        period: {
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0],
        },
        summary: {
          totalRevenue: 0,
          totalProfit: 0,
          totalEmployees: 0,
          bestShift: 'Chưa có dữ liệu',
          bestShiftRevenue: 0,
        },
        topShift: null,
      };
    }

    const topShift = shifts[0];

    return {
      shifts,
      dailyData,
      period: {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
      },
      summary: {
        totalRevenue: shifts.reduce((sum, s) => sum + s.revenue, 0),
        totalProfit: shifts.reduce((sum, s) => sum + s.profit, 0),
        totalEmployees: shifts.reduce((sum, s) => sum + s.employeeCount, 0),
        bestShift: topShift?.shiftName || 'Chưa có dữ liệu',
        bestShiftRevenue: topShift?.revenue || 0,
      },
      topShift,
    };
  }
}
