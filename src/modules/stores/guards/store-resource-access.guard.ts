import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';

import { Asset } from '../entities/asset.entity';
import { BonusWorkRequest } from '../entities/bonus-work-request.entity';
import { ContractTemplate } from '../entities/contract-template.entity';
import { DailyEmployeeReport } from '../entities/daily-employee-report.entity';
import { EmployeeLeaveRequest } from '../entities/employee-leave-request.entity';
import { EmployeeProfile } from '../entities/employee-profile.entity';
import { EmployeeSalary } from '../entities/employee-salary.entity';
import { EmployeeTerminationReason } from '../entities/employee-termination-reason.entity';
import { Feedback } from '../entities/feedback.entity';
import { InventoryReport } from '../entities/inventory-report.entity';
import { KpiTask } from '../entities/kpi-task.entity';
import { MonthlyPayroll } from '../entities/monthly-payroll.entity';
import { Order } from '../entities/order.entity';
import { Product } from '../entities/product.entity';
import { EmployeeKpi } from '../entities/employee-kpi.entity';
import { KpiApprovalRequest } from '../entities/kpi-approval-request.entity';
import { SalaryAdjustment } from '../entities/salary-adjustment.entity';
import { SalaryAdvanceRequest } from '../entities/salary-advance-request.entity';
import {
  ServiceCategory,
  ServiceItem,
  ServiceItemRecipe,
} from '../entities/service-item.entity';
import {
  ShiftAssignment,
  ShiftSlot,
  ShiftSwap,
  WorkCycle,
} from '../entities/shift-management.entity';
import { ShiftChangeRequest } from '../entities/shift-change-request.entity';
import { StockTransaction } from '../entities/stock-transaction.entity';
import { StoreEmployeeType } from '../entities/store-employee-type.entity';
import { StoreEvent } from '../entities/store-event.entity';
import { StorePaymentAccount } from '../entities/store-payment-account.entity';
import { StorePayrollPaymentHistory } from '../entities/store-payroll-payment-history.entity';
import { StoreRole } from '../entities/store-role.entity';
import { StoreSkill } from '../entities/store-skill.entity';
import { StoreAccessResolver } from './store-access.resolver';

/**
 * How a resource family resolves to the store that owns it.
 *
 * `via` handles the one-hop case: `EmployeeSalary` carries no `store_id`, only
 * an `employeeProfileId`, so the store is read from the profile.
 */
interface ResourceScope {
  entity: EntityTarget<ObjectLiteral>;
  storeIdField?: string;
  via?: ViaHop;
}

/**
 * One foreign-key hop toward the store.
 *
 * `field` is read off the *current* entity and points at `entity`. Hops chain:
 * a shift swap names an assignment, which names an employee, which names the
 * store. `storeIdField` is the store column on this hop's own entity and is
 * only consulted on the last hop.
 */
interface ViaHop {
  field: string;
  entity: EntityTarget<ObjectLiteral>;
  storeIdField?: string;
  via?: ViaHop;
}

/**
 * Route family (the first path segment) -> how to find its store.
 *
 * A family that is absent from this map is **not** blocked: the guard returns
 * true and the route keeps whatever checking its service already does. That
 * keeps this table safe to extend one entry at a time — adding a mapping can
 * only ever tighten a route, never break an unmapped one.
 *
 * Every entry below was checked against the entity's actual columns.
 *
 * Deliberately absent:
 *   - `approvals/:requestId` — the id is polymorphic (shift registration, shift
 *     swap or leave request), so it cannot be resolved to a single entity here.
 *     The handler already dispatches on the request's own type.
 *   - `salary-configs/:configId` — `SalaryConfig` is keyed by `ownerAccountId`,
 *     not by store. It is a different boundary and needs its own check rather
 *     than a wrong answer from this one.
 */
const RESOURCE_SCOPES: Record<string, ResourceScope> = {
  assets: { entity: Asset },
  'bonus-work-requests': { entity: BonusWorkRequest },
  'contract-templates': { entity: ContractTemplate },
  'daily-reports': { entity: DailyEmployeeReport },
  'employee-salaries': {
    entity: EmployeeSalary,
    via: { field: 'employeeProfileId', entity: EmployeeProfile },
  },
  'employee-types': { entity: StoreEmployeeType },
  employees: { entity: EmployeeProfile },
  events: { entity: StoreEvent },
  feedbacks: { entity: Feedback },
  'inventory-reports': { entity: InventoryReport },
  'kpi-tasks': { entity: KpiTask },
  'leave-requests': { entity: EmployeeLeaveRequest },
  orders: { entity: Order },
  'payment-accounts': { entity: StorePaymentAccount },
  'payroll-payments': { entity: StorePayrollPaymentHistory },
  payrolls: { entity: MonthlyPayroll },
  products: { entity: Product },
  roles: { entity: StoreRole },
  // These carry no store_id of their own, only the employee they belong to.
  'employee-kpis': {
    entity: EmployeeKpi,
    via: { field: 'employeeProfileId', entity: EmployeeProfile },
  },
  'kpi-approval-requests': {
    entity: KpiApprovalRequest,
    via: { field: 'employeeProfileId', entity: EmployeeProfile },
  },
  'salary-adjustments': {
    entity: SalaryAdjustment,
    via: { field: 'employeeProfileId', entity: EmployeeProfile },
  },
  'salary-advance-requests': {
    entity: SalaryAdvanceRequest,
    via: { field: 'employeeProfileId', entity: EmployeeProfile },
  },
  profiles: { entity: EmployeeProfile },
  // `salaries/:id/pay` addresses the same rows as `employee-salaries`.
  salaries: {
    entity: EmployeeSalary,
    via: { field: 'employeeProfileId', entity: EmployeeProfile },
  },
  'service-categories': { entity: ServiceCategory },
  'service-items': { entity: ServiceItem },
  'service-item-recipes': {
    entity: ServiceItemRecipe,
    via: { field: 'serviceItemId', entity: ServiceItem },
  },
  'work-cycles': { entity: WorkCycle },
  // Attendance routes: check-in, check-out, status. The assignment names the
  // employee, and the employee names the store.
  'shift-assignments': {
    entity: ShiftAssignment,
    via: { field: 'employeeId', entity: EmployeeProfile },
  },
  'shift-slots': { entity: ShiftSlot, via: { field: 'cycleId', entity: WorkCycle } },
  // Two hops: swap -> assignment -> employee -> store.
  'shift-swaps': {
    entity: ShiftSwap,
    via: {
      field: 'fromAssignmentId',
      entity: ShiftAssignment,
      via: { field: 'employeeId', entity: EmployeeProfile },
    },
  },
  'shift-change-requests': { entity: ShiftChangeRequest },
  skills: { entity: StoreSkill },
  'stock-transactions': { entity: StockTransaction },
  'termination-reasons': { entity: EmployeeTerminationReason },
};

/**
 * Tenancy guard for routes addressed by a sub-resource id.
 *
 * `StoreAccessGuard` covers routes whose path begins with the store itself
 * (`:id/...`, `:storeId/...`). It cannot cover `employees/:profileId`,
 * `payrolls/:payrollId`, `stock-transactions/:transactionId` and the rest,
 * because the store is not in the URL — it has to be read from the row.
 *
 * This guard does that: it maps the leading path segment to an entity, loads
 * the row named by the first route parameter, and applies the same
 * owner-or-current-employee rule.
 *
 * ## What neither guard can reach
 *
 * Collection and report routes (`POST employees/manual`, `GET kpi-tasks`,
 * `GET monthly-salary-fund`, ...) carry the store in the body or query string,
 * not the path. No path-based guard can scope those; they need the check in
 * the service method that reads the store id. They are the remaining gap.
 */
@Injectable()
export class StoreResourceAccessGuard implements CanActivate {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly accessResolver: StoreAccessResolver,
  ) {}

  /** `('employees/:profileId/assets')` -> `{ family, paramName }`. */
  private parseRoute(
    context: ExecutionContext,
  ): { family: string; paramName: string } | null {
    const path = Reflect.getMetadata(
      PATH_METADATA,
      context.getHandler(),
    ) as unknown;
    if (typeof path !== 'string') return null;

    const segments = path.replace(/^\/+/, '').split('/');
    const family = segments[0];
    if (!family || family.startsWith(':')) return null;

    const paramSegment = segments.find((segment) => segment.startsWith(':'));
    if (!paramSegment) return null;

    return { family, paramName: paramSegment.slice(1) };
  }

  /** Reads one string column off one row, or null if either is absent. */
  private async readField(
    entity: EntityTarget<ObjectLiteral>,
    id: string,
    field: string,
  ): Promise<string | null> {
    const row = await this.dataSource
      .getRepository(entity)
      .findOne({ where: { id } as never, select: ['id', field] as never });
    const value = (row as ObjectLiteral | null)?.[field];
    return typeof value === 'string' ? value : null;
  }

  /** Walks the `via` chain to the entity that carries the store id. */
  private async resolveStoreId(
    scope: ResourceScope,
    id: string,
  ): Promise<string | null> {
    let entity = scope.entity;
    let currentId = id;
    let storeIdField = scope.storeIdField ?? 'storeId';
    let hop = scope.via;

    while (hop) {
      const nextId = await this.readField(entity, currentId, hop.field);
      if (nextId === null) return null;
      entity = hop.entity;
      currentId = nextId;
      storeIdField = hop.storeIdField ?? 'storeId';
      hop = hop.via;
    }

    return this.readField(entity, currentId, storeIdField);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const route = this.parseRoute(context);
    if (!route) return true;

    const scope = RESOURCE_SCOPES[route.family];
    // Family not mapped: leave the route exactly as it was.
    if (!scope) return true;

    const request = context.switchToHttp().getRequest();
    const resourceId: unknown = request.params?.[route.paramName];
    if (typeof resourceId !== 'string' || !resourceId) return true;

    const accountId: string | undefined = request.user?.userId;
    if (!accountId) {
      throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
    }

    let storeId: string | null;
    try {
      storeId = await this.resolveStoreId(scope, resourceId);
    } catch {
      // A malformed id (not a uuid) makes Postgres reject the query. Treat it
      // as "no such resource" rather than leaking a driver error.
      throw new NotFoundException('Không tìm thấy dữ liệu');
    }

    // The row does not exist, or carries no store. Let the handler produce its
    // own 404 rather than guessing at its error shape.
    if (!storeId) return true;

    return this.accessResolver.assertAccess(storeId, accountId);
  }
}
