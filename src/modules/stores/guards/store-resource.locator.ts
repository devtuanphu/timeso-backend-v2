import { NotFoundException } from '@nestjs/common';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';

import { Asset } from '../entities/asset.entity';
import { BonusWorkRequest } from '../entities/bonus-work-request.entity';
import { ContractTemplate } from '../entities/contract-template.entity';
import { DailyEmployeeReport } from '../entities/daily-employee-report.entity';
import { EmployeeAssetAssignment } from '../entities/employee-asset-assignment.entity';
import { EmployeeContract } from '../entities/employee-contract.entity';
import { EmployeeKpi } from '../entities/employee-kpi.entity';
import { EmployeeLeaveRequest } from '../entities/employee-leave-request.entity';
import { EmployeePaymentHistory } from '../entities/employee-payment-history.entity';
import { EmployeeProfile } from '../entities/employee-profile.entity';
import { EmployeeSalary } from '../entities/employee-salary.entity';
import { EmployeeTerminationReason } from '../entities/employee-termination-reason.entity';
import { Feedback } from '../entities/feedback.entity';
import { InventoryReport } from '../entities/inventory-report.entity';
import { KpiApprovalRequest } from '../entities/kpi-approval-request.entity';
import { KpiTask } from '../entities/kpi-task.entity';
import { MonthlyPayroll } from '../entities/monthly-payroll.entity';
import { Order } from '../entities/order.entity';
import { Product } from '../entities/product.entity';
import { SalaryAdvanceRequest } from '../entities/salary-advance-request.entity';
import { SalaryConfig } from '../entities/salary-config.entity';
import {
  ServiceCategory,
  ServiceItem,
  ServiceItemRecipe,
} from '../entities/service-item.entity';
import { ShiftChangeRequest } from '../entities/shift-change-request.entity';
import {
  ShiftAssignment,
  ShiftSlot,
  ShiftSwap,
  WorkCycle,
} from '../entities/shift-management.entity';
import { StockTransaction } from '../entities/stock-transaction.entity';
import { StoreEmployeeType } from '../entities/store-employee-type.entity';
import { StoreEvent } from '../entities/store-event.entity';
import { StorePaymentAccount } from '../entities/store-payment-account.entity';
import { StorePayrollPaymentHistory } from '../entities/store-payroll-payment-history.entity';
import { StoreRole } from '../entities/store-role.entity';
import { StoreSkill } from '../entities/store-skill.entity';

/**
 * How a resource resolves to the store that owns it.
 *
 * `via` walks foreign keys toward the store: `EmployeeSalary` carries no
 * `store_id`, only an `employeeProfileId`, so the store is read from the
 * profile. `withDeleted` reads soft-deleted rows on that hop, so a
 * soft-deleted employee still resolves to its store (and is still checked)
 * instead of reading as "not found".
 *
 * `ownerAccountField` is for the one resource keyed by account rather than by
 * store (`SalaryConfig.ownerAccountId`).
 */
export interface ResourceScope {
  entity: EntityTarget<ObjectLiteral>;
  storeIdField?: string;
  ownerAccountField?: string;
  withDeleted?: boolean;
  via?: ResourceScope & { field: string };
}

type ViaHop = ResourceScope & { field: string };

export type ResourceLocation =
  /** The route does not address a mapped resource. */
  | { kind: 'unmapped' }
  | { kind: 'store'; storeId: string }
  | { kind: 'ownerAccount'; ownerAccountId: string };

/** Employee profiles are soft-deleted; read them regardless. */
const PROFILE_HOP: ViaHop = {
  field: 'employeeProfileId',
  entity: EmployeeProfile,
  withDeleted: true,
};

/** A shift assignment reaches its store through slot -> cycle. */
const ASSIGNMENT_TO_STORE: ViaHop = {
  field: 'shiftSlotId',
  entity: ShiftSlot,
  via: { field: 'cycleId', entity: WorkCycle },
};

/**
 * Route family (the first path segment) -> how to find its store. The id is
 * the route's first `:param`.
 *
 * Every entry was checked against the entity's actual columns. Routes whose
 * first `:param` names a *different* entity than the family suggests are
 * listed in `ROUTE_RULES` below, which take precedence.
 */
export const RESOURCE_SCOPES: Record<string, ResourceScope> = {
  assets: { entity: Asset },
  'bonus-work-requests': { entity: BonusWorkRequest },
  'contract-templates': { entity: ContractTemplate },
  'daily-reports': { entity: DailyEmployeeReport },
  'employee-salaries': { entity: EmployeeSalary, via: PROFILE_HOP },
  'employee-types': { entity: StoreEmployeeType },
  employees: { entity: EmployeeProfile, withDeleted: true },
  events: { entity: StoreEvent },
  feedbacks: { entity: Feedback },
  'inventory-reports': { entity: InventoryReport },
  // `KpiTask.storeId` is nullable; the parent KPI's employee is not.
  'kpi-tasks': {
    entity: KpiTask,
    via: { field: 'employeeKpiId', entity: EmployeeKpi, via: PROFILE_HOP },
  },
  'leave-requests': { entity: EmployeeLeaveRequest },
  orders: { entity: Order },
  'payment-accounts': { entity: StorePaymentAccount },
  'payroll-payments': { entity: StorePayrollPaymentHistory },
  payrolls: { entity: MonthlyPayroll },
  products: { entity: Product },
  roles: { entity: StoreRole },
  'employee-kpis': { entity: EmployeeKpi, via: PROFILE_HOP },
  'kpi-approval-requests': { entity: KpiApprovalRequest, via: PROFILE_HOP },
  // The only route in this family is `GET salary-adjustments/:employeeProfileId`:
  // its parameter is a profile id, not a SalaryAdjustment id.
  'salary-adjustments': { entity: EmployeeProfile, withDeleted: true },
  'salary-advance-requests': { entity: SalaryAdvanceRequest, via: PROFILE_HOP },
  profiles: { entity: EmployeeProfile, withDeleted: true },
  // `salaries/:id/pay` addresses the same rows as `employee-salaries`.
  salaries: { entity: EmployeeSalary, via: PROFILE_HOP },
  'service-categories': { entity: ServiceCategory },
  'service-items': { entity: ServiceItem },
  'service-item-recipes': {
    entity: ServiceItemRecipe,
    via: { field: 'serviceItemId', entity: ServiceItem },
  },
  'work-cycles': { entity: WorkCycle },
  'shift-assignments': {
    entity: ShiftAssignment,
    via: { field: 'employeeId', entity: EmployeeProfile, withDeleted: true },
  },
  'shift-slots': { entity: ShiftSlot, via: { field: 'cycleId', entity: WorkCycle } },
  'shift-swaps': {
    entity: ShiftSwap,
    via: {
      field: 'fromAssignmentId',
      entity: ShiftAssignment,
      via: { field: 'employeeId', entity: EmployeeProfile, withDeleted: true },
    },
  },
  'shift-change-requests': { entity: ShiftChangeRequest },
  skills: { entity: StoreSkill },
  'stock-transactions': { entity: StockTransaction },
  'termination-reasons': { entity: EmployeeTerminationReason },
};

interface RouteRule {
  /** Declared path prefix, e.g. `employees/contracts/:contractId`. */
  pattern: string;
  param: string;
  /** Fixed scope, or one chosen from the (JSON) request body. */
  scope: ResourceScope | ((request: any) => ResourceScope | null);
}

/**
 * Routes whose first `:param` does not belong to the family's entity. Matched
 * on the declared path, before the family table.
 */
export const ROUTE_RULES: RouteRule[] = [
  {
    pattern: 'employees/contracts/:contractId',
    param: 'contractId',
    scope: { entity: EmployeeContract, via: PROFILE_HOP },
  },
  {
    pattern: 'employees/assets/:assignmentId',
    param: 'assignmentId',
    scope: { entity: EmployeeAssetAssignment, via: PROFILE_HOP },
  },
  {
    pattern: 'employees/payment-histories/:id',
    param: 'id',
    scope: { entity: EmployeePaymentHistory },
  },
  {
    // Keyed by owner account, not store.
    pattern: 'salary-configs/:configId',
    param: 'configId',
    scope: { entity: SalaryConfig, ownerAccountField: 'ownerAccountId' },
  },
  {
    // The id is polymorphic; the JSON body names which table it lives in.
    pattern: 'approvals/:requestId',
    param: 'requestId',
    scope: (request) => {
      switch (request?.body?.type) {
        case 'REGISTER':
          return { entity: ShiftAssignment, via: ASSIGNMENT_TO_STORE };
        case 'SWAP':
          return {
            entity: ShiftSwap,
            via: {
              field: 'fromAssignmentId',
              entity: ShiftAssignment,
              via: ASSIGNMENT_TO_STORE,
            },
          };
        case 'LEAVE':
          return { entity: EmployeeLeaveRequest };
        default:
          return null;
      }
    },
  },
];

const notFound = () => new NotFoundException('Không tìm thấy dữ liệu');

/**
 * Resolves the resource a route addresses to the store (or owner account)
 * that owns it. Shared by `StoreResourceAccessGuard` (membership) and
 * `StoreOwnerOnlyGuard` (ownership) so both read the same answer.
 *
 * Fails closed: once a route is mapped, a missing row, a broken hop or a null
 * store column is a 404 — never a pass.
 */
export class StoreResourceLocator {
  constructor(private readonly dataSource: DataSource) {}

  /** Normalised declared path of a handler, e.g. `employees/:profileId`. */
  static normalizePath(path: unknown): string | null {
    if (typeof path !== 'string') return null;
    return path.replace(/^\/+/, '');
  }

  /** Locates the resource addressed by `path` (the declared route pattern). */
  async locate(path: string | null, request: any): Promise<ResourceLocation> {
    if (!path) return { kind: 'unmapped' };
    const segments = path.split('/');

    for (const rule of ROUTE_RULES) {
      const ruleSegments = rule.pattern.split('/');
      const matches = ruleSegments.every((segment, i) => segments[i] === segment);
      if (!matches) continue;
      const scope =
        typeof rule.scope === 'function' ? rule.scope(request) : rule.scope;
      if (!scope) return { kind: 'unmapped' };
      return this.locateParam(scope, request?.params?.[rule.param]);
    }

    const family = segments[0];
    if (!family || family.startsWith(':')) return { kind: 'unmapped' };
    const scope = RESOURCE_SCOPES[family];
    if (!scope) return { kind: 'unmapped' };

    const paramSegment = segments.find((segment) => segment.startsWith(':'));
    if (!paramSegment) return { kind: 'unmapped' };
    return this.locateParam(scope, request?.params?.[paramSegment.slice(1)]);
  }

  /** Resolves one id of a family in `RESOURCE_SCOPES` to its store id. */
  async storeIdOf(family: string, id: string): Promise<string> {
    const scope = RESOURCE_SCOPES[family];
    if (!scope) {
      throw new Error(`Unknown resource family: ${family}`);
    }
    const location = await this.resolve(scope, id);
    if (location.kind !== 'store') throw notFound();
    return location.storeId;
  }

  private async locateParam(
    scope: ResourceScope,
    value: unknown,
  ): Promise<ResourceLocation> {
    // Express always fills a declared param; an empty one addresses nothing.
    if (typeof value !== 'string' || !value) return { kind: 'unmapped' };
    return this.resolve(scope, value);
  }

  private async resolve(
    scope: ResourceScope,
    id: string,
  ): Promise<ResourceLocation> {
    try {
      let current: ResourceScope = scope;
      let currentId = id;
      while (current.via) {
        const hop: ViaHop = current.via;
        const nextId = await this.readField(current, currentId, hop.field);
        if (nextId === null) throw notFound();
        current = hop;
        currentId = nextId;
      }

      if (current.ownerAccountField) {
        const ownerAccountId = await this.readField(
          current,
          currentId,
          current.ownerAccountField,
        );
        if (ownerAccountId === null) throw notFound();
        return { kind: 'ownerAccount', ownerAccountId };
      }

      const storeId = await this.readField(
        current,
        currentId,
        current.storeIdField ?? 'storeId',
      );
      if (storeId === null) throw notFound();
      return { kind: 'store', storeId };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      // A malformed id (not a uuid) makes Postgres reject the query. Treat it
      // as "no such resource" rather than leaking a driver error.
      throw notFound();
    }
  }

  /** Reads one string column off one row, or null if either is absent. */
  private async readField(
    scope: ResourceScope,
    id: string,
    field: string,
  ): Promise<string | null> {
    const row = await this.dataSource.getRepository(scope.entity).findOne({
      where: { id } as never,
      select: ['id', field] as never,
      ...(scope.withDeleted ? { withDeleted: true } : {}),
    });
    const value = (row as ObjectLiteral | null)?.[field];
    return typeof value === 'string' && value ? value : null;
  }
}
