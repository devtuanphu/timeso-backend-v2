jest.mock('../../../../src/common/utils/multer-config', () => ({
  attendanceMulterConfig: {},
  multerConfig: {},
  mixedIdentityMulterConfig: () => ({}),
  identityImageUrl: (filename: string) => filename,
}));

import {
  GUARDS_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';

import { JobApplicationController } from '../../../../src/modules/stores/job-application.controller';
import { ShiftAggregationController } from '../../../../src/modules/stores/shift-aggregation.controller';
import { STORE_OWNER_ONLY_KEY } from '../../../../src/modules/stores/guards/store-owner-only.decorator';
import { StoreOwnerOnlyGuard } from '../../../../src/modules/stores/guards/store-owner-only.guard';
import { StoresModule } from '../../../../src/modules/stores/stores.module';
import {
  RESOURCE_SCOPES,
  ROUTE_RULES,
} from '../../../../src/modules/stores/guards/store-resource.locator';
import {
  controllerOf,
  routeHandler,
  STORE_ROUTE_CONTROLLERS,
} from '../../../support/store-route-controllers';

const isOwnerOnly = (controller: any, handler: string) =>
  Reflect.getMetadata(STORE_OWNER_ONLY_KEY, controller.prototype[handler]) !==
  undefined;

// StoresController's routes are split across STORE_ROUTE_CONTROLLERS; a handler
// is checked on whichever of them declares it.
const isStoreRouteOwnerOnly = (handler: string) =>
  Reflect.getMetadata(STORE_OWNER_ONLY_KEY, routeHandler(handler) as object) !==
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
    'createWorkShift', // POST :id/work-shifts
    'updateWorkShift', // PUT :storeId/work-shifts/:shiftId
    'deleteWorkShift', // DELETE :storeId/work-shifts/:shiftId
  ];

  it.each(CRITICAL_STORES_HANDLERS)('store route %s is owner-only', (handler) => {
    expect(typeof routeHandler(handler)).toBe('function');
    expect(isStoreRouteOwnerOnly(handler)).toBe(true);
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
  ])('store route %s is not owner-only', (handler) => {
    expect(typeof routeHandler(handler)).toBe('function');
    expect(isStoreRouteOwnerOnly(handler)).toBe(false);
  });

  it.each<[object]>([
    ...STORE_ROUTE_CONTROLLERS.map((controller): [object] => [controller]),
    [ShiftAggregationController],
    [JobApplicationController],
  ])('%p runs StoreOwnerOnlyGuard', (controller) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[];
    expect(guards).toContain(StoreOwnerOnlyGuard);
  });

  // A split controller that is imported but not registered serves no route at
  // all; registered out of order, it can shadow (or be shadowed by) a route of
  // StoresController. Express matches in registration order.
  it('registers every store route controller in StoresModule, in router order', () => {
    const registered = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      StoresModule,
    ) as unknown[];
    const positions = STORE_ROUTE_CONTROLLERS.map((controller) =>
      registered.indexOf(controller),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
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
  ])('store route %s reads its store from the query', (handler) => {
    expect(controllerOf(handler)).toBeDefined();
    expect(
      Reflect.getMetadata(STORE_OWNER_ONLY_KEY, routeHandler(handler) as object),
    ).toEqual({ storeFrom: ['query'] });
  });

  it('gives every owner-only route a store source the guard can prove', () => {
    const unresolved: string[] = [];
    const handlers = STORE_ROUTE_CONTROLLERS.flatMap((controller) =>
      Object.getOwnPropertyNames(controller.prototype).map(
        (name) => [name, (controller.prototype as any)[name]] as const,
      ),
    );
    for (const [name, handler] of handlers) {
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
