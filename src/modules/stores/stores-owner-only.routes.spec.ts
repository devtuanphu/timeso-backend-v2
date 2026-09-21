jest.mock('../../common/utils/multer-config', () => ({
  attendanceMulterConfig: {},
  multerConfig: {},
  mixedIdentityMulterConfig: () => ({}),
  identityImageUrl: (filename: string) => filename,
}));

import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { JobApplicationController } from './job-application.controller';
import { ShiftAggregationController } from './shift-aggregation.controller';
import { STORE_OWNER_ONLY_KEY } from './guards/store-owner-only.decorator';
import { StoreOwnerOnlyGuard } from './guards/store-owner-only.guard';
import {
  RESOURCE_SCOPES,
  ROUTE_RULES,
} from './guards/store-resource.locator';
import { StoresController } from './stores.controller';

const isOwnerOnly = (controller: any, handler: string) =>
  Reflect.getMetadata(STORE_OWNER_ONLY_KEY, controller.prototype[handler]) !==
  undefined;

/**
 * The owner-only decision is enforced by metadata, so a refactor that drops a
 * decorator silently reopens the route to every employee. These are the
 * store-administration actions where that would matter most.
 */
describe('owner-only route metadata', () => {
  const CRITICAL_STORES_HANDLERS = [
    'generatePayroll', // POST :id/payrolls/generate
    'recalculatePayroll', // POST :id/payrolls/recalculate
    'payEmployeeSalary', // POST salaries/:id/pay
    'reviewSalaryAdvanceRequest', // PATCH salary-advance-requests/:id/review
    'updateStoreLocation', // PUT :id/location
    'generateStoreQR', // POST :id/qr-code
    'createRole',
    'getRoles',
    'getPermissionTemplates',
    'getRolePermissionConfig',
    'updateRolePermissionConfig',
    'updateApprovalSetting', // PUT :id/approval-settings
    'permanentDeleteEmployee', // DELETE employees/:profileId/permanent
    'restoreEmployee', // POST employees/:profileId/restore
    'deleteEmployee', // DELETE employees/:profileId
    'approveBonusWorkRequest',
    'rejectBonusWorkRequest',
    'getInventoryReports',
    'processApproval',
    'updateSalaryConfig',
    'deleteSalaryConfig',
    'updateEmployeeKpiStatus', // PATCH employee-kpis/:id/status
    'updateKpiReminders', // PATCH employee-kpis/:id/reminders
    'updateKpiCompliments', // PATCH employee-kpis/:id/compliments
  ];

  it.each(CRITICAL_STORES_HANDLERS)('StoresController.%s is owner-only', (handler) => {
    expect(typeof (StoresController.prototype as any)[handler]).toBe('function');
    expect(isOwnerOnly(StoresController, handler)).toBe(true);
  });

  // Reads employees need for work, and actions on their own data, must stay
  // open to members; the guard would otherwise refuse the staff app.
  it.each([
    'findById',
    'getApprovalSetting',
    'getTimekeepingSetting',
    'getWorkShifts',
    'cancelBonusWorkRequest',
    'cancelSalaryAdvanceRequest',
    'getBonusHistory',
    'getPenaltyHistory',
    'getFeedbacksEarly',
    'checkIn',
    'checkOut',
    // KPI routes where the KPI's own employee keeps (service-scoped) access.
    'createEmployeeKpi',
    'duplicateEmployeeKpi',
    'deleteEmployeeKpi',
    'createKpiTask',
    'updateKpiTaskProgress',
    'deleteKpiTask',
    'hideKpiTask',
  ])('StoresController.%s is not owner-only', (handler) => {
    expect(typeof (StoresController.prototype as any)[handler]).toBe('function');
    expect(isOwnerOnly(StoresController, handler)).toBe(false);
  });

  it.each([
    [StoresController],
    [ShiftAggregationController],
    [JobApplicationController],
  ])('%p runs StoreOwnerOnlyGuard', (controller) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[];
    expect(guards).toContain(StoreOwnerOnlyGuard);
  });

  it('keeps owner routes of the other store controllers owner-only', () => {
    for (const handler of [
      'getShiftSlots',
      'getShiftSummary',
      'getMonthSummary',
      'getShiftSuggestions',
      'getShiftDetail',
    ]) {
      expect(isOwnerOnly(ShiftAggregationController, handler)).toBe(true);
    }
    for (const handler of ['list', 'accept', 'reject']) {
      expect(isOwnerOnly(JobApplicationController, handler)).toBe(true);
    }
    // Applicant and employee routes stay open.
    for (const handler of ['listMine', 'apply', 'withdraw']) {
      expect(isOwnerOnly(JobApplicationController, handler)).toBe(false);
    }
    expect(
      isOwnerOnly(ShiftAggregationController, 'getEmployeeScheduleGrid'),
    ).toBe(false);
  });

  // H3: query/body storeId only proves the store on routes that opt in.
  it.each([
    'getInventoryReports',
    'getAssetReport',
    'getAssetExportReport',
    'getProductReport',
    'getProductExportReport',
    'getApprovalStats',
  ])('StoresController.%s reads its store from the query', (handler) => {
    expect(
      Reflect.getMetadata(
        STORE_OWNER_ONLY_KEY,
        (StoresController.prototype as any)[handler],
      ),
    ).toEqual({ storeFrom: ['query'] });
  });

  it('gives every owner-only route a store source the guard can prove', () => {
    const unresolved: string[] = [];
    for (const name of Object.getOwnPropertyNames(StoresController.prototype)) {
      const handler = (StoresController.prototype as any)[name];
      const options = Reflect.getMetadata(STORE_OWNER_ONLY_KEY, handler);
      if (options === undefined) continue;
      const path = String(Reflect.getMetadata(PATH_METADATA, handler)).replace(
        /^\/+/,
        '',
      );
      const segments = path.split('/');
      const byPath =
        segments[0] === ':id' ||
        segments[0] === ':storeId' ||
        ROUTE_RULES.some((rule) => path.startsWith(rule.pattern)) ||
        (segments[0] in RESOURCE_SCOPES &&
          segments.some((segment) => segment.startsWith(':')));
      const declared =
        (options.storeFrom?.length ?? 0) > 0 ||
        (options.bodyResources?.length ?? 0) > 0 ||
        (options.bodyStoreIdLists?.length ?? 0) > 0;
      if (!byPath && !declared) unresolved.push(`${name} (${path})`);
    }
    expect(unresolved).toEqual([]);
  });
});
