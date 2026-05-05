// Peak Hour Types
export interface PeakHour {
  day: string;
  date: string;
  time: string;
  shift?: string;
  confidence?: number;
}

export interface TrendPoint {
  x: number;
  y: number;
}

// Revenue Types
export interface RevenueTrendItem {
  date: string;
  revenue: number;
  profit: number;
  expense: number;
}

export interface RevenueForecast {
  peakHours: PeakHour[];
  trendData: TrendPoint[];
  forecastData: TrendPoint[];
  insight: string;
  trend: 'increasing' | 'decreasing' | 'stable';
  summary: {
    currentWeekRevenue: number;
    nextWeekRevenue: number;
    growthRate: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  };
}

// Product Types
export interface ProductData {
  id: string;
  name: string;
  avatar?: string;
  value: number;
  displayValue?: string;
  trend?: string;
  trendDirection?: 'up' | 'down';
}

export interface CancelledProduct {
  id: string;
  name: string;
  avatar?: string;
  count: number;
  value: number;
}

export interface PromotionProduct {
  id: string;
  name: string;
  avatar?: string;
  count: number;
  shift: 'morning' | 'noon' | 'evening';
}

// Loss Analysis
export interface LossAnalysis {
  cancelledProducts: CancelledProduct[];
  promotionProducts: PromotionProduct[];
  lowProfitProducts: ProductData[];
  totalLossValue: number;
  lossTrend: number;
  insight: string;
}

// Priority Report
export interface ShiftBestSelling {
  shift: string;
  time: string;
  product: string;
  productId: string;
  trend: string;
}

export interface PriorityReport {
  topSelling: ProductData[];
  highProfit: ProductData[];
  slowSelling: ProductData[];
  bestSellingShifts: ShiftBestSelling[];
  highlight: string;
  insight: string;
}

// AI Insights
export interface AIInsight {
  type: 'warning' | 'info' | 'success';
  message: string;
  priority: 'high' | 'medium' | 'low';
}

export interface AIInsightsResponse {
  insights: AIInsight[];
  summary: {
    revenue: number;
    expense: number;
    profit: number;
    change: number;
  };
}

// Shift Performance
export interface ShiftPerformance {
  shiftName: string;
  startTime: string;
  endTime: string;
  revenue: number;
  orderCount: number;
  avgOrderValue: number;
  topProduct: {
    id: string;
    name: string;
  };
}

export interface ShiftPerformanceResponse {
  shifts: ShiftPerformance[];
}

// Revenue Trend Response
export interface RevenueTrendResponse {
  data: RevenueTrendItem[];
  comparison: {
    revenueChange: number;
    profitChange: number;
    expenseChange: number;
  };
}

// Top Employee Type
export interface TopEmployee {
  employeeId: string;
  fullName: string;
  avatar?: string;
  revenue: number;
  ordersCount: number;
  successRate: number;
}

// Employee Ranking for EmployeeReportDetailScreen
export interface EmployeeRankingItem {
  employeeId: string;
  fullName: string;
  avatarUrl?: string;
  hours: number;
  revenue: number;
  revenueDisplay: string;
  hPercentage: number; // hours percentage relative to max
  rPercentage: number; // revenue percentage relative to max
  ordersCount: number;
  completedOrders: number;
  cancelledOrders: number;
  successRate: number;
  efficiency: number;
}

export interface EmployeeRankingReport {
  employees: EmployeeRankingItem[];
  period: {
    startDate: string;
    endDate: string;
  };
  summary: {
    totalRevenue: number;
    totalHours: number;
    totalOrders: number;
    topEmployee: EmployeeRankingItem;
  };
}

// Shift Performance Report for ShiftReportDetailScreen
export interface ShiftPerformanceItem {
  shiftName: string;
  startTime: string;
  endTime: string;
  revenue: number;
  revenueDisplay: string;
  profit: number;
  employeeCount: number;
  efficiency: number;
}

export interface ShiftDailyData {
  date: string;
  dayLabel: string;
  shifts: {
    [shiftName: string]: {
      revenue: number;
      profit: number;
      employeeCount: number;
      efficiency: number;
    };
  };
}

export interface ShiftPerformanceReport {
  shifts: ShiftPerformanceItem[];
  dailyData: ShiftDailyData[];
  period: {
    startDate: string;
    endDate: string;
  };
  summary: {
    totalRevenue: number;
    totalProfit: number;
    totalEmployees: number;
    bestShift: string;
    bestShiftRevenue: number;
  };
  topShift: ShiftPerformanceItem | null;
}

// AI Analysis Summary (for AnalysisDrawer)
export interface AIAnalysisSummary {
  topEmployee: TopEmployee | null;
  bestShift: string;
  mostCancelledProduct: {
    name: string;
    count: number;
  };
  topProduct: string;
  trend: 'up' | 'down' | 'stable';
  overallStatus: 'growing' | 'declining' | 'stable';
}
