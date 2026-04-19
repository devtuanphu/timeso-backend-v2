import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Store } from './entities/store.entity';
import { StoreEmployeeType } from './entities/store-employee-type.entity';
import { StoreRole } from './entities/store-role.entity';
import { EmployeeProfile } from './entities/employee-profile.entity';
import { EmployeeProfileRole } from './entities/employee-profile-role.entity';
import { EmployeeContract } from './entities/employee-contract.entity';
import { WorkShift } from './entities/work-shift.entity';
import { Asset } from './entities/asset.entity';
import { Product } from './entities/product.entity';
import { AssetUnit } from './entities/asset-unit.entity';
import { ProductUnit } from './entities/product-unit.entity';
import { AssetCategory } from './entities/asset-category.entity';
import { AssetStatus } from './entities/asset-status.entity';
import { ProductCategory } from './entities/product-category.entity';
import { ProductStatus } from './entities/product-status.entity';
import { AssetExportType } from './entities/asset-export-type.entity';
import { ProductExportType } from './entities/product-export-type.entity';



import { MonthlyPayroll } from './entities/monthly-payroll.entity';
import { SalaryConfig } from './entities/salary-config.entity';
import { EmployeeSalary } from './entities/employee-salary.entity';
import { KpiType } from './entities/kpi-type.entity';
import { KpiUnit } from './entities/kpi-unit.entity';
import { KpiPeriod } from './entities/kpi-period.entity';
import { EmployeeKpi } from './entities/employee-kpi.entity';
import { KpiTask } from './entities/kpi-task.entity';
import { KpiApprovalRequest } from './entities/kpi-approval-request.entity';
import { DailyEmployeeReport } from './entities/daily-employee-report.entity';
import { EmployeeMonthlySummary } from './entities/employee-monthly-summary.entity';
import { EmployeePerformance } from './entities/employee-performance.entity';
import { StoreEvent } from './entities/store-event.entity';
import { InventoryReport } from './entities/inventory-report.entity';
import {
  StockTransaction,
  StockTransactionDetail,
} from './entities/stock-transaction.entity';
import {
  WorkCycle,
  ShiftSlot,
  ShiftAssignment,
  ShiftSwap,
  CycleShiftTemplate,
} from './entities/shift-management.entity';
import { EmployeeLeaveRequest } from './entities/employee-leave-request.entity';
import { EmployeeFace } from './entities/employee-face.entity';
import { AttendanceLog } from './entities/attendance-log.entity';
import { EmployeeAssetAssignment } from './entities/employee-asset-assignment.entity';
import {
  ServiceCategory,
  ServiceItem,
  ServiceItemRecipe,
} from './entities/service-item.entity';
import { Order, OrderItem } from './entities/order.entity';
import { EmployeeTerminationReason } from './entities/employee-termination-reason.entity';
import { StoreProbationSetting } from './entities/store-probation-setting.entity';
import { StoreSkill } from './entities/store-skill.entity';
import { StorePayrollPaymentHistory } from './entities/store-payroll-payment-history.entity';
import { SalaryFundHistory } from './entities/salary-fund-history.entity';
import { SalaryAdvanceRequest } from './entities/salary-advance-request.entity';
import { StoreApprovalSetting } from './entities/store-approval-setting.entity';
import { StoreTimekeepingSetting } from './entities/store-timekeeping-setting.entity';
import { StorePayrollSetting } from './entities/store-payroll-setting.entity';
import { StorePayrollRule } from './entities/store-payroll-rule.entity';
import { StorePayrollIncrementRule } from './entities/store-payroll-increment-rule.entity';
import { StoreInternalRule } from './entities/store-internal-rule.entity';
import { StorePermissionConfig } from './entities/store-permission-config.entity';
import { StoreShiftConfig } from './entities/store-shift-config.entity';
import { Feedback } from './entities/feedback.entity';


import { SalaryAdjustment } from './entities/salary-adjustment.entity';
import { SalaryAdjustmentReason } from './entities/salary-adjustment-reason.entity';
import { EmployeePaymentHistory } from './entities/employee-payment-history.entity';
import { StorePaymentAccount } from './entities/store-payment-account.entity';
import { ShiftChangeRequest } from './entities/shift-change-request.entity';
import { BonusWorkRequest } from './entities/bonus-work-request.entity';
import { CronLock } from './entities/cron-lock.entity';

import { StoresService } from './stores.service';
import { StoresCronService } from './stores-cron.service';
import { DistributedLockService } from './distributed-lock.service';
import { StoresController } from './stores.controller';
import { StoresPublicController } from './stores-public.controller';
import { AccountsModule } from '../accounts/accounts.module';
import { MailModule } from '../mail/mail.module';
import { ScheduleModule } from '@nestjs/schedule';
import { FaceRecognitionService } from './face-recognition.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Store,
      StoreEmployeeType,
      StoreRole,
      EmployeeProfile,
      EmployeeProfileRole,
      EmployeeContract,
      WorkShift,
      Asset,
      Product,
      AssetUnit,
      ProductUnit,
      AssetCategory,
      AssetStatus,
      ProductCategory,
      ProductStatus,

      MonthlyPayroll,
      SalaryConfig,
      EmployeeSalary,
      KpiType,
      KpiUnit,
      KpiPeriod,
      EmployeeKpi,
      KpiTask,
      KpiApprovalRequest,
      DailyEmployeeReport,
      EmployeeMonthlySummary,
      EmployeePerformance,
      StoreEvent,
      InventoryReport,
      StockTransaction,
      StockTransactionDetail,
      WorkCycle,
      ShiftSlot,
      ShiftAssignment,
      ShiftSwap,
      CycleShiftTemplate,
      EmployeeLeaveRequest,
      EmployeeFace,
      AttendanceLog,
      EmployeeAssetAssignment,
      ServiceCategory,
      ServiceItem,
      ServiceItemRecipe,
      Order,
      OrderItem,
      EmployeeTerminationReason,
      StoreProbationSetting,
      StoreSkill,
      StorePayrollPaymentHistory,
      SalaryFundHistory,
      SalaryAdvanceRequest,
      SalaryAdjustment,
      SalaryAdjustmentReason,
      EmployeePaymentHistory,
      StorePaymentAccount,
      StoreApprovalSetting,
      StoreTimekeepingSetting,
      StorePayrollSetting,
      StorePayrollRule,
      StorePayrollIncrementRule,
      StoreInternalRule,
      StorePermissionConfig,
      StoreShiftConfig,
      AssetExportType,

      ProductExportType,
      Feedback,
      ShiftChangeRequest,
      BonusWorkRequest,
      CronLock,
    ]),



    AccountsModule,
    MailModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [StoresController, StoresPublicController],
  providers: [StoresService, StoresCronService, DistributedLockService, FaceRecognitionService],
  exports: [StoresService, DistributedLockService],
})
export class StoresModule {}
